import express, { type Request, type RequestHandler, type Response } from "express";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  validatePageLayout,
  type TabPage,
} from "@telepath-computer/television-shared";
import { ServerStore } from "./server-store.ts";
import { parseClientTelemetryMetaHeader, TELEVISION_CLIENT_META_HEADER, type TelemetryClientContext } from "./telemetry/client-meta.ts";
import type { TelemetryStatus } from "./telemetry/index.ts";
import { serveArtifactProxy } from "./artifact-proxy.ts";
import { serveMarkdownContent } from "./markdown.ts";
import type { ArtifactPollCadence } from "@telepath-computer/television-artifact/browser";

/** Home-directory file that turns on browser demo mode. */
const BROWSER_DEMO_MARKER = ".tv-mozfest-demo";

const patchChannelSchema = z
  .object({
    name: z.string().optional(),
    layout: z.array(z.unknown()).optional(),
    // Accepted but never read: the onboarding marker is installer-only and a
    // stray `onboarding` field must not fail an otherwise-valid request
    // (specs/arch/onboarding/installer.md#^marker-api-readonly).
    onboarding: z.unknown().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.layout !== undefined,
    { message: "At least one of name or layout must be provided" },
  );

// Non-strict: unknown fields — including an `onboarding` marker attempt — are
// stripped and ignored (specs/arch/onboarding/installer.md#^marker-api-readonly).
const createChannelSchema = z.object({
  name: z.string(),
  id: z.string().optional(),
});

const createPathArtifactSchema = z
  .object({
    kind: z.literal("path"),
    title: z.string(),
    path: z.string(),
  })
  .strict();

const createURLArtifactSchema = z
  .object({
    kind: z.literal("url"),
    title: z.string(),
    url: z.string(),
  })
  .strict();

const createArtifactBodySchema = z.discriminatedUnion("kind", [
  createPathArtifactSchema.extend({ channelID: z.string() }).strict(),
  createURLArtifactSchema.extend({ channelID: z.string() }).strict(),
]);

const patchArtifactSchema = z
  .object({
    title: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
  })
  .strict()
  .refine(
    (value) => value.title !== undefined || value.path !== undefined || value.url !== undefined,
    { message: "At least one of title, path, or url must be provided" },
  );

const patchDisplaySchema = z
  .object({
    focusedChannelId: z.string().nullable().optional(),
    pinnedChannelIds: z.array(z.string()).optional(),
    activeThemeName: z.string().nullable().optional(),
    appearanceMode: z.enum(["system", "light", "dark"]).optional(),
    themeJavaScriptConsentIds: z.array(z.string().min(1))
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "themeJavaScriptConsentIds must not contain duplicate theme ids",
      })
      .optional(),
  })
  .strict();

const focusSchema = z
  .object({
    artifactID: z.string(),
  })
  .strict();

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": `Authorization, Content-Type, ${TELEVISION_CLIENT_META_HEADER}`,
  // Cross-origin clients can read the version advertisement header
  // (specs/arch/updates/version-advertisement.md ^version-header).
  "Access-Control-Expose-Headers": "X-TV-Version",
};

function applyCorsHeaders(res: Response): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(name, value);
  }
}

const applyCorsMiddleware: RequestHandler = (_req, res, next) => {
  applyCorsHeaders(res);
  next();
};

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/**
 * Map a store-thrown error to an HTTP response. Handles the two typed
 * boundary errors (NotFoundError → 404, InvalidRequestError → 400) and
 * rethrows everything else so Express's default handler produces a 500.
 */
function handleStoreError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof NotFoundError) {
    sendError(res, HTTP_NOT_FOUND, error.message);
    return;
  }
  if (error instanceof InvalidRequestError) {
    sendError(res, HTTP_BAD_REQUEST, error.message);
    return;
  }
  if (error instanceof ConflictError) {
    sendError(res, HTTP_CONFLICT, error.message);
    return;
  }
  throw error instanceof Error ? error : new Error(fallback);
}

/** Register every REST route on `app`. */
export function registerRoutes(
  app: express.Express,
  store: ServerStore,
  options: {
    requireAuth: RequestHandler | null;
    requireBearerAuth: RequestHandler | null;
    acpEnabled: boolean;
    observeTelemetryClientRequest?: (clientContext: TelemetryClientContext | null) => void;
    getTelemetryStatus?: () => TelemetryStatus;
    enableTelemetry?: () => Promise<TelemetryStatus>;
    disableTelemetry?: () => Promise<TelemetryStatus>;
    testArtifactPollCadence?: ArtifactPollCadence;
  },
): void {
  const auth: RequestHandler[] = options.requireAuth ? [options.requireAuth] : [];
  const bearerAuth: RequestHandler[] = options.requireBearerAuth ? [options.requireBearerAuth] : [];
  const telemetryContexts = new WeakMap<Request, TelemetryClientContext | null>();
  const telemetryMiddleware: RequestHandler = (req, _res, next) => {
    const clientContext = parseClientTelemetryMetaHeader(req.header(TELEVISION_CLIENT_META_HEADER));
    telemetryContexts.set(req, clientContext);
    options.observeTelemetryClientRequest?.(clientContext);
    next();
  };
  const telemetryContext = (req: Request): TelemetryClientContext | null => telemetryContexts.get(req) ?? null;

  // This cross-release contract freezes Authorization: Bearer, so keep it on
  // the bearer-only middleware rather than /display's general API auth hook.
  app.get("/desktop/connect-check", ...bearerAuth, (_req, res) => {
    res.status(HTTP_OK).json({ product: "television" });
  });

  app.use("/channels", applyCorsMiddleware, telemetryMiddleware);
  app.use("/artifacts", applyCorsMiddleware, telemetryMiddleware);
  app.use("/display", applyCorsMiddleware, telemetryMiddleware);
  app.use("/themes", applyCorsMiddleware, telemetryMiddleware);
  app.use("/markdown", applyCorsMiddleware, telemetryMiddleware);
  app.use("/telemetry", applyCorsMiddleware);
  app.use("/demo-mode", applyCorsMiddleware);

  const artifactProxy = serveArtifactProxy(store, { pollCadence: options.testArtifactPollCadence });
  app.all("/artifact/:id", artifactProxy);
  app.all("/artifact/:id/*", artifactProxy);

  const markdownContent = serveMarkdownContent(store);
  app.get("/markdown/:id", ...bearerAuth, markdownContent.get);
  app.put("/markdown/:id", ...bearerAuth, markdownContent.put);

  app.options("/channels", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/channels/:id", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/artifacts", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/artifacts/:id", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/display", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/display/focus", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/themes", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/themes/refresh", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/markdown/:id", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/telemetry", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/demo-mode", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/telemetry/enable", (_req, res) => res.status(HTTP_NO_CONTENT).end());
  app.options("/telemetry/disable", (_req, res) => res.status(HTTP_NO_CONTENT).end());

  // Browser demo mode (specs/product/artifacts.md#^af-demo-mode) is read per
  // request, so adding or removing the marker needs no server restart.
  app.get("/demo-mode", ...auth, (_req, res) => {
    res.json({ browserExternalPages: existsSync(path.join(os.homedir(), BROWSER_DEMO_MARKER)) });
  });

  app.get("/telemetry", ...auth, (_req, res) => {
    res.json(options.getTelemetryStatus?.() ?? { state: "unavailable", reason: null, guidPresent: false, region: "us" });
  });

  app.post("/telemetry/enable", ...auth, async (_req, res) => {
    res.json(await options.enableTelemetry?.() ?? { state: "unavailable", reason: null, guidPresent: false, region: "us" });
  });

  app.post("/telemetry/disable", ...auth, async (_req, res) => {
    res.json(await options.disableTelemetry?.() ?? { state: "unavailable", reason: null, guidPresent: false, region: "us" });
  });

  app.get("/themes", ...auth, (_req, res) => {
    res.json(store.getThemeRegistry());
  });

  app.post("/themes/refresh", ...auth, (req, res) => {
    res.json(store.refreshThemeRegistry(telemetryContext(req)));
  });

  app.get("/channels", ...auth, (_req, res) => {
    res.json({ channels: store.listChannels() });
  });

  app.post("/channels", ...auth, (req, res) => {
    const parsed = createChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, HTTP_BAD_REQUEST, parsed.error.issues[0]?.message ?? "Invalid request body");
      return;
    }
    try {
      const channel = store.createChannel({
        name: parsed.data.name,
        ...(parsed.data.id !== undefined ? { id: parsed.data.id } : {}),
      }, telemetryContext(req));
      res.status(HTTP_CREATED).json({ channel });
    } catch (error) {
      sendError(res, HTTP_BAD_REQUEST, error instanceof Error ? error.message : "Failed to create channel");
    }
  });

  app.get("/channels/:id", ...auth, (req: Request<{ id: string }>, res) => {
    const snapshot = store.getChannel(req.params.id);
    if (!snapshot) {
      sendError(res, HTTP_NOT_FOUND, `Channel not found: ${req.params.id}`);
      return;
    }
    res.json(snapshot);
  });

  app.delete("/channels/:id", ...auth, (req: Request<{ id: string }>, res) => {
    try {
      const result = store.removeChannel(req.params.id, telemetryContext(req));
      res.json(result);
    } catch (error) {
      handleStoreError(res, error, "Failed to delete channel");
    }
  });

  app.patch("/channels/:id", ...auth, (req: Request<{ id: string }>, res) => {
    const parsed = patchChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, HTTP_BAD_REQUEST, parsed.error.issues[0]?.message ?? "Invalid request body");
      return;
    }

    if (parsed.data.layout !== undefined) {
      const validation = validatePageLayout(parsed.data.layout);
      if (!validation.valid) {
        sendError(res, HTTP_BAD_REQUEST, validation.errors.join("; "));
        return;
      }
    }

    try {
      // Only name and layout are forwarded; a supplied `onboarding` field is
      // deliberately dropped (installer-only marker).
      const channel = store.updateChannel({
        channelID: req.params.id,
        fields: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          layout: parsed.data.layout as TabPage[] | undefined,
        },
      }, telemetryContext(req));
      res.json({ channel });
    } catch (error) {
      handleStoreError(res, error, "Failed to update channel");
    }
  });

  app.get("/artifacts", ...auth, (req, res) => {
    const rawChannelID = req.query.channelID;
    const channelIDFilter = typeof rawChannelID === "string" ? rawChannelID : undefined;

    if (channelIDFilter !== undefined) {
      const snapshot = store.getChannel(channelIDFilter);
      if (!snapshot) {
        sendError(res, HTTP_NOT_FOUND, `Channel not found: ${channelIDFilter}`);
        return;
      }
      res.json({ artifacts: snapshot.artifacts });
      return;
    }

    res.json({ artifacts: store.listArtifacts() });
  });

  app.post("/artifacts", ...auth, (req, res) => {
    const parsed = createArtifactBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, HTTP_BAD_REQUEST, parsed.error.issues[0]?.message ?? "Invalid request body");
      return;
    }

    try {
      const artifact = store.createArtifact(parsed.data, telemetryContext(req));
      res.status(HTTP_CREATED).json({ artifact, channelID: parsed.data.channelID });
    } catch (error) {
      handleStoreError(res, error, "Failed to create artifact");
    }
  });

  app.delete("/artifacts/:id", ...auth, (req: Request<{ id: string }>, res) => {
    try {
      const result = store.deleteArtifact(req.params.id, telemetryContext(req));
      res.json(result);
    } catch (error) {
      handleStoreError(res, error, "Failed to delete artifact");
    }
  });

  app.patch("/artifacts/:id", ...auth, (req: Request<{ id: string }>, res) => {
    const parsed = patchArtifactSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, HTTP_BAD_REQUEST, parsed.error.issues[0]?.message ?? "Invalid request body");
      return;
    }


    try {
      const artifact = store.updateArtifact({ artifactID: req.params.id, fields: parsed.data }, telemetryContext(req));
      res.json({ artifact });
    } catch (error) {
      handleStoreError(res, error, "Failed to update artifact");
    }
  });

  app.get("/artifacts/:id", ...auth, (req: Request<{ id: string }>, res) => {
    const artifact = store.getArtifact(req.params.id);
    if (!artifact) {
      sendError(res, HTTP_NOT_FOUND, `Artifact not found: ${req.params.id}`);
      return;
    }
    res.json({ artifact });
  });

  app.get("/display", ...auth, (_req, res) => {
    const display = store.getDisplayState();
    res.json({
      ...display,
      activeScreenID: null,
      acpEnabled: options.acpEnabled,
    });
  });

  app.patch("/display", ...auth, (req, res) => {
    const parsed = patchDisplaySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, HTTP_BAD_REQUEST, parsed.error.issues[0]?.message ?? "Invalid request body");
      return;
    }
    try {
      store.patchDisplay(parsed.data, telemetryContext(req));
      res.status(HTTP_NO_CONTENT).end();
    } catch (error) {
      handleStoreError(res, error, "Failed to patch display");
    }
  });

  app.post("/display/focus", ...auth, (req, res) => {
    const parsed = focusSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, HTTP_BAD_REQUEST, parsed.error.issues[0]?.message ?? "Invalid request body");
      return;
    }
    try {
      const result = store.focus({ artifactID: parsed.data.artifactID });
      res.status(HTTP_OK).json(result);
    } catch (error) {
      handleStoreError(res, error, "Failed to focus artifact");
    }
  });
}
