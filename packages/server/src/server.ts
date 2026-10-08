import express from "express";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, buildServerURL, type ACPAgentProfile } from "./config.ts";
import { registerRoutes } from "./routes.ts";
import { EventStreamServer } from "./event-stream.ts";
import { buildACPAgentTVArgs } from "./acp-bridge.ts";
import { ACPServer } from "./acp-server.ts";
import { ServerStore } from "./server-store.ts";
import { isAuthorizedBearer } from "./auth.ts";
import { resolveBindAddresses } from "./bind-addresses.ts";
import { serveCanonicalBase, serveCanonicalStyles } from "./canonical.ts";
import { serveActiveTheme } from "./themes.ts";
import { log } from "./logger.ts";
import { buildStartupBindFailureRecord, StartupBindError, type StartupBindAttempt } from "./startup-bind-failure.ts";
import { createServerStoreTelemetryHooks, deriveServerConfigSnapshotProperties, emitServerBootTelemetry } from "./telemetry/emitters.ts";
import { deriveThemeSettingsProperties } from "./telemetry/derivation.ts";
import { createTelemetryRuntime, type TelemetryRuntime, type TelemetryRuntimeSink } from "./telemetry/runtime.ts";
import { telemetryVersion, type LaunchMode, type TelemetryEnv, type TelemetrySessionManager, type TelemetryVersion } from "./telemetry/index.ts";
import { resolveUpdateReleaseVersion } from "./updates/version.ts";
import { buildServerStatus } from "./updates/server-status.ts";
import { createUpdateChannelPoller, type UpdateChannelPoller } from "./updates/update-channel.ts";
import { createAdminRouter } from "./resources/admin-routes.ts";
import { createArtifactRouter } from "./resources/artifact-routes.ts";
import { PageConnectionServer } from "./resources/page-connection.ts";
import { SDK_NOTICES_ROUTE, SDK_ROUTE, serveResourceSdk, serveResourceSdkNotices } from "./resources/sdk-route.ts";
import {
  ADMIN_ROUTE_PREFIX,
  ARTIFACT_ROUTE_PREFIX,
  RESOURCE_BINDINGS_ENABLED,
  parsePageConnectionPath,
} from "@telepath-computer/television-shared/resources";
import type { ArtifactPollCadence } from "@telepath-computer/television-artifact/browser";

const HTTP_UNAUTHORIZED_STATUS = 401;
const HTTP_FIRST_ERROR_STATUS = 400;
const HTTP_INTERNAL_SERVER_ERROR_STATUS = 500;
const HTTP_STATUS_LIMIT = 600;

/** An uncaught request error's status, as Express's own handler finds it: its own if it is an error status, otherwise 500. */
function errorStatus(error: unknown): number {
  const fields = typeof error === "object" && error !== null ? (error as { status?: unknown; statusCode?: unknown }) : {};
  const status = fields.status ?? fields.statusCode;
  return typeof status === "number" && status >= HTTP_FIRST_ERROR_STATUS && status < HTTP_STATUS_LIMIT ? status : HTTP_INTERNAL_SERVER_ERROR_STATUS;
}
const CANONICAL_VERSION_DIRECTORY_PATTERN = /^v\d+(?:\.\d+)?$/;

interface CanonicalVersionDirectory {
  version: string;
  directory: string;
  frozen: boolean;
}

function resolveCanonicalVersionDirectories(
  canonicalDir: string,
): CanonicalVersionDirectory[] {
  const canonicalRoot = path.resolve(canonicalDir);
  const versions = readdirSync(canonicalRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        CANONICAL_VERSION_DIRECTORY_PATTERN.test(entry.name),
    )
    .map((entry) => {
      const directory = path.join(canonicalRoot, entry.name);
      return {
        version: entry.name,
        directory,
        frozen: existsSync(path.join(directory, "frozen.json")),
      };
    })
    .sort((left, right) =>
      left.version.localeCompare(right.version, undefined, { numeric: true })
    );

  if (versions.length === 0) {
    throw new Error(
      `canonical root ${canonicalRoot} contains no version directories matching v<n>`,
    );
  }

  return versions;
}

declare const __TV_VERSION__: string | undefined;

const ANY_IPV4 = "0.0.0.0";

/** Every IPv4 address of the machine's network interfaces, loopback included, in the order the system reports them. */
function interfaceIPv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4")
    .map((entry) => entry.address);
}

export interface ServerTelemetryOptions {
  env?: TelemetryEnv;
  sink?: TelemetryRuntimeSink;
  version?: TelemetryVersion;
  launchMode?: LaunchMode;
  installedByAgent?: string | null;
  developerHost?: boolean;
  /** Test seam: injected session manager, mirroring createTelemetryRuntime's. */
  sessions?: TelemetrySessionManager;
  /** Test seam: injected clock for session activity, mirroring createTelemetryRuntime's. */
  nowMs?: () => number;
}

export interface ServerOptions {
  store: ServerStore;
  /** @deprecated use listen instead. Kept for package-local test helpers. */
  host?: string;
  listen?: readonly string[];
  port?: number;
  auth?: boolean;
  staticDir?: string;
  /**
   * Root containing versioned canonical artifact build output (`v<n>/`), each
   * mounted at `/canonical/v<n>/*` for artifact rendering. If omitted,
   * canonical routes are not registered.
   */
  canonicalDir?: string;
  /**
   * The built resource SDK's directory, holding `v1/resources.js` and its
   * notices, served at `/sdk/v1/resources.js` and
   * `/sdk/v1/THIRD-PARTY-NOTICES.txt`. Without it those paths answer 404 and
   * the rest of the resource layer works (specs/arch/resources/sdk.md#^sdk-packaging).
   */
  sdkDir?: string;
  /**
   * The bindings flag (specs/arch/resources/index.md#^rs-flag-constant):
   * `RESOURCE_BINDINGS_ENABLED` unless given. Production never passes it;
   * tests turn it on.
   */
  resourceBindings?: boolean;
  acpProfile?: ACPAgentProfile;
  telemetry?: ServerTelemetryOptions;
  /**
   * Test-only scheduling hook for the injected shared-artifact content poll.
   * Production server construction omits this option.
   */
  testArtifactPollCadence?: ArtifactPollCadence;
}

/**
 * Composition root for Television's transport layer. Creates the Express app,
 * registers REST routes, wires the `/events` pub-sub stream and the `/acp`
 * bridge socket, and owns lifecycle.
 */
export class Server {
  public readonly app: express.Express;
  public readonly httpServer: http.Server;
  public readonly httpServers: http.Server[];
  private readonly store: ServerStore;
  private readonly events: EventStreamServer;
  private readonly acp: ACPServer | null;
  private readonly pageConnections: PageConnectionServer;
  private readonly port: number;
  private readonly authRequired: boolean;
  private readonly authMode: "auth" | "no-auth" | "none";
  private readonly bindAddresses: string[];
  private readonly telemetryOptions: ServerTelemetryOptions;
  private readonly launchMode: LaunchMode;
  private telemetryRuntime: TelemetryRuntime | null = null;
  private updateChannel: UpdateChannelPoller | null = null;
  private listeningPort: number;
  private baseURLs: string[];
  private disposed = false;

  constructor(options: ServerOptions) {
    this.store = options.store;
    this.port = options.port ?? DEFAULT_SERVER_PORT;
    this.authRequired = options.auth ?? false;
    this.authMode = options.auth === true ? "auth" : options.auth === false ? "no-auth" : "none";
    this.bindAddresses = resolveBindAddresses(options.host ? [options.host] : options.listen);
    this.telemetryOptions = options.telemetry ?? {};
    this.launchMode = this.telemetryOptions.launchMode ?? "cli";
    this.listeningPort = this.port;
    this.baseURLs = [];

    this.app = express();
    this.httpServers = this.bindAddresses.map(() => http.createServer(this.app));
    this.httpServer = this.httpServers[0]!;

    // Version advertisement (specs/arch/updates/version-advertisement.md
    // ^version-header): every HTTP response carries the release version.
    // Registered before all routes so error responses carry it too.
    const updateReleaseVersion = resolveUpdateReleaseVersion();
    this.app.use((_req, res, next) => {
      res.setHeader("X-TV-Version", updateReleaseVersion);
      next();
    });

    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        // ^health-version: the unauthenticated liveness probe carries the
        // release version; a release version is not sensitive.
        version: updateReleaseVersion,
        bindAddresses: this.bindAddresses,
        // Unauthenticated, so a wildcard listener's interface addresses are
        // readable here; TV-952 moves them behind the token.
        origins: this.getOrigins(),
        port: this.getListeningPort(),
      });
    });
    // The resource routes come before the shared JSON parser and every CORS
    // middleware: they parse their own bodies, up past a store's size limit,
    // and send no CORS headers (specs/arch/resources/index.md#^rs-any-origin).
    // The flag reaches the layer before the server accepts connections; with
    // it on, the layer reads the bindings file (specs/arch/resources/index.md#^rs-startup).
    if (options.resourceBindings ?? RESOURCE_BINDINGS_ENABLED) this.store.resources.enableBindings();
    const resourceAccess = { layer: this.store.resources, authRequired: this.authRequired, authToken: this.store.authToken, origins: () => this.getOrigins() };
    this.app.use(ADMIN_ROUTE_PREFIX, createAdminRouter(resourceAccess));
    this.app.use(ARTIFACT_ROUTE_PREFIX, createArtifactRouter());
    if (options.sdkDir) {
      this.app.get(SDK_ROUTE, serveResourceSdk(options.sdkDir));
      this.app.get(SDK_NOTICES_ROUTE, serveResourceSdkNotices(options.sdkDir));
    }
    this.pageConnections = new PageConnectionServer({ layer: this.store.resources });
    this.app.use(express.json());

    this.events = new EventStreamServer({
      store: this.store,
      authRequired: this.authRequired,
      buildServerStatus: () => buildServerStatus(undefined, undefined, undefined, this.updateChannel?.getState() ?? null),
      recordTelemetryActivity: (clientContext) => this.telemetryRuntime?.recordClientActivity(clientContext),
      // Validated client signals forward through the ordinary chokepoint with
      // completely normal handling — $session_id attribution (which bumps
      // session activity like any client-attributed request) and the
      // suppression gate (specs/arch/telemetry/client-signals.md
      // ^signal-forwarding).
      recordTelemetryClientSignal: (clientContext, event) => this.telemetryRuntime?.capture(event, clientContext),
    });
    this.acp = options.acpProfile
      ? new ACPServer({
          authToken: this.store.authToken,
          authRequired: this.authRequired,
          profile: options.acpProfile,
          getAgentTVArgs: () => buildACPAgentTVArgs({
            home: this.store.storagePath,
            configuredPort: this.port,
            acquiredPort: this.getListeningPort(),
          }),
        })
      : null;

    registerRoutes(this.app, this.store, {
      requireAuth: this.requireAuthorization,
      requireBearerAuth: this.requireBearerAuthorization,
      acpEnabled: this.acp !== null,
      observeTelemetryClientRequest: (clientContext) => {
        this.telemetryRuntime?.observeClientRequest(clientContext);
      },
      getTelemetryStatus: () => this.telemetryRuntime?.status() ?? { state: "unavailable", reason: null, guidPresent: false, region: "us" },
      enableTelemetry: async () => this.telemetryRuntime?.enable() ?? { state: "unavailable", reason: null, guidPresent: false, region: "us" },
      disableTelemetry: async () => this.telemetryRuntime?.disable() ?? { state: "unavailable", reason: null, guidPresent: false, region: "us" },
      testArtifactPollCadence: options.testArtifactPollCadence,
    });

    if (options.canonicalDir) {
      for (const { version, directory, frozen } of resolveCanonicalVersionDirectories(
        options.canonicalDir,
      )) {
        const mountPath = `/canonical/${version}`;
        // Artifact iframe documents and canonical stylesheet subresources may
        // have different origins depending on the client/server URL in use.
        this.app.use(mountPath, (_req, res, next) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
          next();
        });
        // Mounted before staticDir so canonical paths always win, even if
        // staticDir would happen to contain a colliding path.
        this.app.get(
          `${mountPath}/styles.css`,
          serveCanonicalStyles(version, frozen),
        );
        this.app.get(`${mountPath}/base.css`, serveCanonicalBase(directory));
        this.app.use(
          mountPath,
          express.static(directory, {
            setHeaders: (res, filePath) => {
              if (
                filePath.startsWith(
                  `${path.resolve(directory, "fonts")}${path.sep}`,
                )
              ) {
                res.setHeader(
                  "Cache-Control",
                  "public, max-age=31536000, immutable",
                );
              } else {
                res.setHeader("Cache-Control", "no-cache");
              }
            },
          }),
        );
      }
    }

    // Public because cross-origin stylesheets cannot supply the display API's
    // bearer token. The handler exposes only the cached registry's active
    // package and contains every request within it.
    this.app.use("/theme", serveActiveTheme(this.store));

    for (const viewID of ["artifact-missing", "markdown"]) {
      const viewPath = this.store.getViewPath(viewID);
      if (viewPath) {
        this.app.use(`/views/${viewID}`, express.static(viewPath));
      }
    }

    if (options.staticDir) {
      // Cache policy for the GUI web bundle only — not the artifact proxy or
      // /views/* mounts (specs/arch/updates/version-advertisement.md
      // ^cache-headers): entry documents revalidate on every use so a reload
      // always fetches the interface matching the running server; Vite's
      // content-hashed assets are immutable by construction.
      this.app.use(express.static(options.staticDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
            res.setHeader("Referrer-Policy", "no-referrer");
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }));
    }

    // The last error handler answers with the status and its fixed text.
    // Express's own would send the error's stack, since the server does not
    // run with NODE_ENV=production, and an error's text can name the files
    // of an artifact a share link serves, and so its ID
    // (specs/arch/resources/index.md#^rs-share-serving).
    this.app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      log(this.store.storagePath, "uncaught request error", { error });
      if (res.headersSent) {
        next(error);
        return;
      }
      const status = errorStatus(error);
      res.status(status).type("text/plain").send(http.STATUS_CODES[status] ?? "Error");
    });

    for (const httpServer of this.httpServers) {
      httpServer.on("upgrade", this.handleUpgrade);
    }
  }

  async start(): Promise<http.Server> {
    this.baseURLs = [];
    let resolvedPort = this.port;
    const attempts: StartupBindAttempt[] = [];
    const boundServers: http.Server[] = [];
    const pendingBaseURLs: string[] = [];

    for (const [index, server] of this.httpServers.entries()) {
      const address = this.bindAddresses[index]!;
      const port = index === 0 ? this.port : resolvedPort;
      try {
        await this.listenServer(server, address, port);
        const serverAddress = server.address();
        if (typeof serverAddress === "object" && serverAddress) {
          resolvedPort = serverAddress.port;
        }
        const baseURL = buildServerURL(address, resolvedPort);
        attempts.push({ address, port: resolvedPort, outcome: "bound" });
        boundServers.push(server);
        pendingBaseURLs.push(baseURL);
      } catch (error) {
        const bindError = error instanceof Error ? error : new Error(String(error));
        attempts.push({ address, port, outcome: "failed", error: bindError });
        console.error(`Television failed to bind ${address}:${port}: ${bindError.message}`);
      }
    }

    if (attempts.some((attempt) => attempt.outcome === "failed")) {
      log(
        this.store.storagePath,
        "server startup failed",
        buildStartupBindFailureRecord(attempts, this.launchMode),
      );
      await Promise.allSettled(boundServers.map((server) => this.closeServer(server)));
      throw new StartupBindError(attempts);
    }

    this.listeningPort = resolvedPort;
    this.baseURLs = pendingBaseURLs;
    for (const [index, baseURL] of this.baseURLs.entries()) {
      const address = this.bindAddresses[index]!;
      log(this.store.storagePath, `bound ${address}:${resolvedPort}`, { address, port: resolvedPort, baseURL });
    }

    await this.startTelemetry();
    this.startUpdateChannel();

    log(this.store.storagePath, "server started", { snapshot: this.configurationSnapshot() });

    // `tv serve` prints the tokenless warnings (specs/product/cli.md, server
    // lifecycle commands); the server records the mode in its log.
    if (!this.authRequired) {
      log(this.store.storagePath, "server running without bearer-token enforcement", { authMode: this.authMode });
    }

    return this.httpServer;
  }

  getBaseURL(): string {
    return this.baseURLs[0] ?? buildServerURL(DEFAULT_SERVER_HOST, this.port);
  }

  getBaseURLs(): string[] {
    return [...this.baseURLs];
  }

  /**
   * The origins this server can be reached at, after `start()`
   * (specs/arch/cli/index.md#^cli-server-origins): one for each bind address
   * on the bound port, with `0.0.0.0` standing for each IPv4 address of the
   * machine's interfaces as they are now. None is preferred.
   */
  getOrigins(): string[] {
    const hosts = this.bindAddresses.flatMap((address) => (address === ANY_IPV4 ? interfaceIPv4Addresses() : [address]));
    return [...new Set(hosts.map((host) => new URL(buildServerURL(host, this.getListeningPort())).origin))];
  }

  getAuthToken(): string {
    return this.store.authToken;
  }

  getACPBridgePID(): number | null {
    return this.acp?.getChildPIDs()[0] ?? null;
  }

  getACPBridgePIDs(): number[] {
    return this.acp?.getChildPIDs() ?? [];
  }

  getListeningPort(): number {
    return this.listeningPort;
  }

  async dispose(signal?: NodeJS.Signals | string): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.updateChannel?.stop();
    this.updateChannel = null;

    let disposalError: unknown;
    try {
      await Promise.all([
        this.events.dispose(),
        this.pageConnections.dispose(),
        this.acp?.dispose() ?? Promise.resolve(),
        Promise.resolve(this.store.dispose()),
        this.telemetryRuntime?.shutdown() ?? Promise.resolve(),
      ]);

      await Promise.all(this.httpServers.map((server) => this.closeServer(server)));
    } catch (error) {
      disposalError = error;
    }

    log(this.store.storagePath, "server stopped", {
      signal: signal ?? null,
      outcome: disposalError ? "error" : "disposed",
      snapshot: this.configurationSnapshot(),
      ...(disposalError ? { error: disposalError } : {}),
    });

    if (disposalError) {
      throw disposalError instanceof Error ? disposalError : new Error(String(disposalError));
    }
  }

  [Symbol.dispose](): void {
    void this.dispose();
  }

  private readonly handleUpgrade = (request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void => {
    const parsed = new URL(request.url ?? "/", this.getBaseURL());
    const duplex = socket as Duplex;
    if (parsed.pathname === "/events") {
      this.events.handleUpgrade(request, duplex, head);
      return;
    }
    if (parsed.pathname === "/acp" && this.acp) {
      this.acp.handleUpgrade(request, duplex, head);
      return;
    }
    const pageID = parsePageConnectionPath(parsed.pathname);
    if (pageID !== null) {
      this.pageConnections.handleUpgrade(request, duplex, head, pageID);
      return;
    }
    socket.destroy();
  };

  private listenServer(server: http.Server, address: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const handleError = (error: Error) => {
        server.off("listening", handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off("error", handleError);
        resolve();
      };

      server.once("error", handleError);
      server.once("listening", handleListening);
      server.listen(port, address);
    });
  }

  /**
   * Update-channel poller lifecycle (specs/arch/updates/update-channel.md):
   * owned by the Server — started here, stopped in dispose() with its timer
   * cleared and any in-flight fetch aborted.
   */
  private startUpdateChannel(): void {
    this.updateChannel = createUpdateChannelPoller({
      serverVersion: resolveUpdateReleaseVersion(),
      onStateChange: () => this.events.broadcastServerStatus(),
    });
    this.updateChannel.start();
  }

  private async startTelemetry(): Promise<void> {
    const version = this.telemetryOptions.version ?? readServerPackageVersion();
    const runtime = await createTelemetryRuntime({
      storagePath: this.store.storagePath,
      version,
      dataDirCreated: this.store.dataDirCreated,
      readThemeSettings: () => deriveThemeSettingsProperties({
        ...this.store.getDisplayState(),
        themes: this.store.getThemeRegistry().themes,
      }),
      ...(this.telemetryOptions.env === undefined ? {} : { env: this.telemetryOptions.env }),
      ...(this.telemetryOptions.sink === undefined ? {} : { sink: this.telemetryOptions.sink }),
      ...(this.telemetryOptions.developerHost === undefined ? {} : { developerHost: this.telemetryOptions.developerHost }),
      ...(this.telemetryOptions.sessions === undefined ? {} : { sessions: this.telemetryOptions.sessions }),
      ...(this.telemetryOptions.nowMs === undefined ? {} : { nowMs: this.telemetryOptions.nowMs }),
    });
    this.telemetryRuntime = runtime;
    this.store.setTelemetryHooks(createServerStoreTelemetryHooks(this.store, runtime.capture));
    if (!runtime.boot) return;

    emitServerBootTelemetry(
      runtime.capture,
      runtime.boot.events,
      deriveServerConfigSnapshotProperties({
        version,
        storagePath: this.store.storagePath,
        port: this.getListeningPort(),
        bindAddresses: this.bindAddresses,
        authMode: this.authMode,
        launchMode: this.launchMode,
        installedByAgent: this.telemetryOptions.installedByAgent ?? null,
      }),
      { telemetry_opted_out: runtime.boot.state.optedOut },
    );
  }

  private configurationSnapshot(): Record<string, unknown> {
    return {
      storagePath: this.store.storagePath,
      port: this.getListeningPort(),
      bindAddresses: this.bindAddresses,
      boundURLs: this.baseURLs,
      authMode: this.authMode,
    };
  }

  private closeServer(server: http.Server): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
    });
  }

  private readonly requireAuthorization: express.RequestHandler = (req, res, next) => {
    if (!this.authRequired) {
      next();
      return;
    }

    if (isAuthorizedBearer(req.header("authorization"), this.store.authToken)) {
      next();
      return;
    }
    res.status(HTTP_UNAUTHORIZED_STATUS).json({ error: "Unauthorized" });
  };

  private readonly requireBearerAuthorization: express.RequestHandler = (req, res, next) => {
    if (!this.authRequired) {
      next();
      return;
    }

    if (isAuthorizedBearer(req.header("authorization"), this.store.authToken)) {
      next();
      return;
    }
    res.status(HTTP_UNAUTHORIZED_STATUS).json({ error: "Unauthorized" });
  };
}

function readServerPackageVersion(): TelemetryVersion {
  if (typeof __TV_VERSION__ === "string" && __TV_VERSION__.length > 0) {
    return telemetryVersion(__TV_VERSION__);
  }

  const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  if (!existsSync(packageJsonPath)) return telemetryVersion("0.0.0");
  return telemetryVersion((JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version);
}
