import { execFileSync, type ChildProcessByStdio } from "node:child_process";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import type { Duplex, Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConnectURL } from "@telepath-computer/television-shared";
import { spawnOwnedProcess, type OwnedProcess } from "./owned-process.ts";
import { writeHomeConfig } from "./television-home.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const CLI_BUILD_SCRIPT = path.join(REPO_ROOT, "packages/cli/build.mjs");
let sourceCLIEntry: string | null = null;
const serverStartupTimeoutMs = 30_000;

export interface ProductServer {
  serverURL: string;
  /** The Television home the server serves. */
  home: string;
  token: string;
  appURL(viteBaseURL: string): Promise<string>;
  /**
   * Stop the server process and boot a new port-0 backend against the same
   * home — a real server restart, as required by `^ac-new-channel-appears` (which replaced the retired promotion walk)
   * transports demand. `onboardingBundle` swaps the runtime's `./onboarding`
   * sibling before the reboot (the upgrade walk). Existing app proxies keep
   * their origin and update their forwarding target to the published backend.
   */
  restart(options?: { onboardingBundle?: string }): Promise<void>;
  /** Run a real `tv` command that contacts this server, with its home and port; returns stdout. */
  runCLI(args: string[]): string;
  dispose(): Promise<void>;
}

export interface LaunchProductServerOptions {
  /** The Television home to serve; a new temporary home by default. */
  home?: string;
  /** Remove the home on disposal; defaults to true for a home this helper created. */
  cleanupHome?: boolean;
  /** Require the bearer token; the home's config file sets `"auth": false` otherwise. */
  auth?: boolean;
  /**
   * Opt-in onboarding bundle: absolute path to an onboarding content tree to
   * place as the `./onboarding` sibling of this launch's CLI binary, using the
   * production sibling-resolution mechanism. When absent, the isolated CLI
   * runtime keeps the missing-bundle behavior — do not copy the production
   * bundle unconditionally.
   */
  onboardingBundle?: string;
  /**
   * Opt-in bundled installed-theme tree to place at the runtime's `./themes`
   * sibling. This exercises the production package-resolution and first-boot
   * installation path without changing launches that intentionally omit it.
   */
  bundledThemesBundle?: string;
  /**
   * Extra environment for the served process, applied over the test runner's.
   * Browser demo mode acceptance sets `HOME` to a temporary directory so the
   * server's home-directory marker file is test-owned.
   */
  env?: Record<string, string>;
}

function getSourceCLIEntry(): string {
  if (sourceCLIEntry) return sourceCLIEntry;
  const buildDir = mkdtempSync(path.join(os.tmpdir(), "television-source-cli-e2e-"));
  sourceCLIEntry = path.join(buildDir, "tv.cjs");
  execFileSync(process.execPath, [CLI_BUILD_SCRIPT, "--outfile", sourceCLIEntry], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  installProductRuntimeAssets(buildDir);
  return sourceCLIEntry;
}

/**
 * A per-launch CLI runtime layout carrying an `./onboarding` sibling bundle.
 * The shared cached layout stays bundle-free so ordinary launches keep the
 * missing-bundle behavior.
 */
function getCLIEntryWithBundles(options: {
  onboardingBundle?: string;
  bundledThemesBundle?: string;
}): { cliEntry: string; dispose: () => void } {
  const sharedEntry = getSourceCLIEntry();
  const runDir = mkdtempSync(path.join(os.tmpdir(), "television-product-e2e-bundle-"));
  cpSync(path.dirname(sharedEntry), runDir, { recursive: true });
  if (options.onboardingBundle !== undefined) {
    cpSync(options.onboardingBundle, path.join(runDir, "onboarding"), { recursive: true });
  }
  if (options.bundledThemesBundle !== undefined) {
    cpSync(options.bundledThemesBundle, path.join(runDir, "themes"), { recursive: true });
  }
  return {
    cliEntry: path.join(runDir, path.basename(sharedEntry)),
    dispose: () => rmSync(runDir, { recursive: true, force: true }),
  };
}

function installProductRuntimeAssets(buildDir: string): void {
  const webDist = path.join(REPO_ROOT, "packages/web/dist");
  const artifactMissingView = path.join(webDist, "views/artifact-missing");
  const markdownView = path.join(REPO_ROOT, "packages/view-markdown/dist");
  const canonical = path.join(REPO_ROOT, "packages/canonical/dist/canonical");
  const sdk = path.join(REPO_ROOT, "packages/server/dist/sdk");
  const webIndex = path.join(webDist, "index.html");
  const webAssets = path.join(webDist, "assets");
  if (!existsSync(path.join(artifactMissingView, "index.html"))) {
    throw new Error(`Web build produced no artifact-missing view at ${artifactMissingView}`);
  }
  if (!existsSync(path.join(markdownView, "index.html"))) {
    throw new Error(`View build produced no markdown view at ${markdownView}`);
  }
  if (!existsSync(path.join(canonical, "v1/styles.css"))) {
    throw new Error(`Canonical build produced no v1 stylesheet at ${canonical}`);
  }
  if (!existsSync(path.join(sdk, "v1/resources.js"))) {
    throw new Error(`SDK build produced no module at ${sdk}`);
  }
  if (!existsSync(webIndex)) {
    throw new Error(`Web build produced no index.html at ${webIndex}`);
  }
  if (!existsSync(webAssets)) {
    throw new Error(`Web build produced no assets directory at ${webAssets}`);
  }

  cpSync(artifactMissingView, path.join(buildDir, "views/artifact-missing"), { recursive: true });
  cpSync(markdownView, path.join(buildDir, "views/markdown"), { recursive: true });
  cpSync(canonical, path.join(buildDir, "canonical"), { recursive: true });
  cpSync(sdk, path.join(buildDir, "sdk"), { recursive: true });
  const staticDir = path.join(buildDir, "web");
  mkdirSync(staticDir, { recursive: true });
  cpSync(webIndex, path.join(staticDir, "index.html"));
  cpSync(webAssets, path.join(staticDir, "assets"), { recursive: true });
}

type ProductServerDisposer = () => Promise<void>;

const activeProductServerDisposers = new Set<ProductServerDisposer>();

/** Dispose every product-server launch registered in this test worker, including launches still waiting for readiness. */
export async function disposeAllProductServers(): Promise<void> {
  const failures: unknown[] = [];
  for (const dispose of [...activeProductServerDisposers].reverse()) {
    try {
      await dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Failed to dispose one or more product servers");
}

export async function launchProductServer(options: LaunchProductServerOptions = {}): Promise<ProductServer> {
  const createdHome = options.home === undefined;
  const home = options.home ?? mkdtempSync(path.join(os.tmpdir(), "television-product-e2e-"));
  // The test-runner recipe for spawned `tv serve`: config port 0, with the
  // acquired port read from startup output and passed to client commands.
  writeHomeConfig(home, options.auth ? { port: 0 } : { port: 0, auth: false });
  const { TELEVISION_ACP_AGENT: _ignoredAgent, ...inheritedEnv } = process.env;
  const env = { ...inheritedEnv, ...options.env };
  let bundledRuntime = options.onboardingBundle !== undefined || options.bundledThemesBundle !== undefined
    ? getCLIEntryWithBundles({
        ...(options.onboardingBundle !== undefined
          ? { onboardingBundle: options.onboardingBundle }
          : {}),
        ...(options.bundledThemesBundle !== undefined
          ? { bundledThemesBundle: options.bundledThemesBundle }
          : {}),
      })
    : undefined;
  const cliEntry = (): string => bundledRuntime?.cliEntry ?? getSourceCLIEntry();
  const proxies = new Map<string, DevelopmentProxy>();
  let current: { process: ProductServerProcess; serverURL: string } | null = null;
  let pendingProcess: ProductServerProcess | null = null;
  let disposalRequested = false;
  let disposalPromise: Promise<void> | null = null;

  async function startServe(): Promise<{ process: ProductServerProcess; serverURL: string }> {
    const owned = spawnOwnedProcess(process.execPath, [cliEntry(), "--home", home, "serve", "--print-links"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const processHandle = { owned, child: owned.child as ProductServerChild };
    pendingProcess = processHandle;
    try {
      return {
        process: processHandle,
        serverURL: parseConnectURL(await waitForServerURL(processHandle.child)).serverURL,
      };
    } catch (error) {
      await owned.dispose();
      throw error;
    }
  }

  const dispose: ProductServerDisposer = () => {
    disposalRequested = true;
    disposalPromise ??= (async () => {
      try {
        await Promise.all([...proxies.values()].map((proxy) => proxy.dispose()));
        const processes = new Set([current?.process, pendingProcess].filter((process): process is ProductServerProcess => process != null));
        await Promise.all([...processes].map(stopProcess));
        bundledRuntime?.dispose();
        if (options.cleanupHome ?? createdHome) {
          rmSync(home, { recursive: true, force: true });
        }
      } finally {
        activeProductServerDisposers.delete(dispose);
      }
    })();
    return disposalPromise;
  };
  activeProductServerDisposers.add(dispose);

  try {
    current = await startServe();
    pendingProcess = null;
    if (disposalRequested) {
      await dispose();
      throw new Error("Product server was disposed during startup");
    }
    const token = readFileSync(path.join(home, "state", "token"), "utf8").trim();
    return {
      get serverURL(): string {
        return current!.serverURL;
      },
      home,
      token,
      async appURL(viteBaseURL: string): Promise<string> {
        const existing = proxies.get(viteBaseURL);
        if (existing) return existing.url;
        const proxy = await startDevelopmentProxy({ productServerURL: current!.serverURL, viteBaseURL });
        proxies.set(viteBaseURL, proxy);
        return proxy.url;
      },
      async restart(restartOptions: { onboardingBundle?: string } = {}): Promise<void> {
        await stopProcess(current!.process);
        if (restartOptions.onboardingBundle !== undefined) {
          if (bundledRuntime) {
            const sibling = path.join(path.dirname(bundledRuntime.cliEntry), "onboarding");
            rmSync(sibling, { recursive: true, force: true });
            cpSync(restartOptions.onboardingBundle, sibling, { recursive: true });
          } else {
            bundledRuntime = getCLIEntryWithBundles({
              onboardingBundle: restartOptions.onboardingBundle,
              ...(options.bundledThemesBundle !== undefined
                ? { bundledThemesBundle: options.bundledThemesBundle }
                : {}),
            });
          }
        }
        current = await startServe();
        pendingProcess = null;
        if (disposalRequested) {
          await dispose();
          throw new Error("Product server was disposed during restart");
        }
        for (const proxy of proxies.values()) proxy.setProductServerURL(current.serverURL);
      },
      runCLI(args: string[]): string {
        const port = new URL(current!.serverURL).port;
        return execFileSync(process.execPath, [cliEntry(), "--home", home, ...args, "--port", port], {
          cwd: path.dirname(cliEntry()),
          env,
          encoding: "utf8",
        });
      },
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (disposalError) {
      throw new AggregateError([error, disposalError], "Product server startup and cleanup both failed");
    }
    throw error;
  }
}

export interface DevelopmentProxy {
  url: string;
  setProductServerURL(url: string): void;
  trackedSocketCount(): number;
  dispose(): Promise<void>;
}

const serverAppURLs = new Map<string, Promise<string>>();

/**
 * Puts a server the test started itself and the test Vite server on one
 * origin, and returns that origin, since the app reaches only the server that
 * served it (specs/arch/updates/version-advertisement.md#^reload-origin-rule).
 * Repeated calls for the same pair return the same origin. Such a server has
 * no built views, so the app's views come from the test Vite server's
 * sources. The proxy is disposed with the test's product servers.
 */
export function appURLForServer(serverURL: string, viteBaseURL: string): Promise<string> {
  const key = `${serverURL} ${viteBaseURL}`;
  const existing = serverAppURLs.get(key);
  if (existing) return existing;
  const appURL = (async () => {
    const proxy = await startDevelopmentProxy({ productServerURL: serverURL, viteBaseURL, viewsFromVite: true });
    const dispose: ProductServerDisposer = async () => {
      activeProductServerDisposers.delete(dispose);
      serverAppURLs.delete(key);
      await proxy.dispose();
    };
    activeProductServerDisposers.add(dispose);
    return proxy.url;
  })();
  serverAppURLs.set(key, appURL);
  appURL.catch(() => serverAppURLs.delete(key));
  return appURL;
}

export async function startDevelopmentProxy(options: {
  productServerURL: string;
  viteBaseURL: string;
  /** Send the Markdown view to the test Vite server too, for a server without built views. */
  viewsFromVite?: boolean;
}): Promise<DevelopmentProxy> {
  let product = new URL(options.productServerURL);
  const vite = new URL(options.viteBaseURL);
  const sockets = new Set<Socket>();
  const peers = new Map<Duplex, Duplex>();
  const unlinkPeer = (stream: Duplex): Duplex | undefined => {
    const peer = peers.get(stream);
    peers.delete(stream);
    if (peer) peers.delete(peer);
    return peer;
  };
  const closeLinked = (stream: Duplex): void => {
    const peer = unlinkPeer(stream);
    destroyQuietly(stream);
    if (peer) destroyQuietly(peer);
  };
  const endLinked = (stream: Duplex): void => {
    const peer = unlinkPeer(stream);
    if (peer && !peer.destroyed && !peer.writableEnded) peer.end();
  };
  const linkPeers = (left: Duplex, right: Duplex): void => {
    peers.set(left, right);
    peers.set(right, left);
  };
  const toVite = (pathname: string): boolean =>
    shouldProxyToVite(pathname) || (options.viewsFromVite === true && pathname.startsWith("/views/markdown/"));
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const target = toVite(pathname) ? vite : product;
    proxyRequest(req, res, target);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => closeLinked(socket));
    socket.on("end", () => endLinked(socket));
    socket.once("close", () => {
      sockets.delete(socket);
      if (peers.has(socket)) closeLinked(socket);
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const target = toVite(pathname) ? vite : product;
    req.on("error", () => closeLinked(socket));
    proxyUpgrade(req, socket, head, target, { link: linkPeers, close: closeLinked, end: endLinked });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Development proxy did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    setProductServerURL(url: string): void {
      product = new URL(url);
    },
    trackedSocketCount: () => sockets.size,
    async dispose(): Promise<void> {
      for (const socket of [...sockets]) closeLinked(socket);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function shouldProxyToVite(pathname: string): boolean {
  return pathname === "/" ||
    pathname.startsWith("/packages/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/views/url-unsupported");
}

function targetPort(target: URL): number {
  if (target.port) return Number.parseInt(target.port, 10);
  return target.protocol === "https:" ? 443 : 80;
}

interface ProxyPeerBridge {
  link(left: Duplex, right: Duplex): void;
  close(stream: Duplex): void;
  end(stream: Duplex): void;
}

function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: URL, bridge: ProxyPeerBridge): void {
  const upstream = net.connect(targetPort(target), target.hostname, () => {
    upstream.write(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.toLowerCase() === "host" || value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) upstream.write(`${name}: ${item}\r\n`);
    }
    upstream.write(`host: ${target.host}\r\n`);
    upstream.write("\r\n");
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  bridge.link(socket, upstream);
  upstream.on("error", () => bridge.close(upstream));
  upstream.on("end", () => bridge.end(upstream));
  upstream.once("close", () => bridge.close(upstream));
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, target: URL): void {
  const targetURL = new URL(req.url ?? "/", target);
  let proxiedResponse: IncomingMessage | undefined;
  const proxied = request(targetURL, {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }, (response) => {
    proxiedResponse = response;
    response.on("error", closeBridge);
    res.writeHead(response.statusCode ?? 500, response.headers);
    response.pipe(res);
  });
  const closeBridge = (): void => {
    req.unpipe(proxied);
    proxiedResponse?.unpipe(res);
    destroyQuietly(req);
    destroyQuietly(proxied);
    if (proxiedResponse) destroyQuietly(proxiedResponse);
    destroyQuietly(res);
  };
  req.on("error", closeBridge);
  req.on("aborted", closeBridge);
  res.on("error", closeBridge);
  res.on("close", () => {
    if (!res.writableFinished) closeBridge();
  });
  proxied.on("error", (error) => {
    req.unpipe(proxied);
    if (proxiedResponse) destroyQuietly(proxiedResponse);
    if (!res.headersSent && !res.destroyed) {
      res.statusCode = 502;
      res.end(error.message);
    } else {
      destroyQuietly(res);
    }
    destroyQuietly(req);
  });
  req.pipe(proxied);
}

function destroyQuietly(stream: { destroyed?: boolean; destroy(): unknown }): void {
  if (stream.destroyed) return;
  if (stream instanceof net.Socket) {
    stream.resetAndDestroy();
    return;
  }
  stream.destroy();
}

type ProductServerChild = ChildProcessByStdio<null, Readable, Readable>;
interface ProductServerProcess {
  owned: OwnedProcess;
  child: ProductServerChild;
}

function extractStartupURL(text: string): string | null {
  return text.match(/https?:\/\/[^\s\u001B]+/)?.[0] ?? null;
}

function waitForServerURL(child: ProductServerChild): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for tv serve startup. stderr:\n${stderr}`));
    }, serverStartupTimeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const tryParseLines = (): void => {
      const url = extractStartupURL(stdout);
      if (url) {
        cleanup();
        resolve(url);
      }
    };

    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8");
      tryParseLines();
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`tv serve exited before startup (code ${code}, signal ${signal}). stdout:\n${stdout}\nstderr:\n${stderr}`));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopProcess(processHandle: ProductServerProcess): Promise<void> {
  const cleanup = await processHandle.owned.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Product server process group ${processHandle.owned.pid} survived cleanup`);
}
