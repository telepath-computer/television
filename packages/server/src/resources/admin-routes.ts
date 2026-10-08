import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import {
  ACCESS_LEVELS,
  JSON_STORE_MAX_WRITE_MESSAGE_BYTES,
  decodeUpdateEntries,
  decodeWriteValue,
  parseStoreAddress,
  writeMessageTooLarge,
  type AccessLevel,
  type StoreAddress,
} from "@telepath-computer/television-shared/resources";
import { isAuthorizedBearer } from "../auth.ts";
import type { ResourceLayer } from "./layer.ts";
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_UNAUTHORIZED, isClientErrorStatus, refusalResponse } from "./http.ts";

export interface AdminRouterOptions {
  layer: ResourceLayer;
  authRequired: boolean;
  authToken: string;
  /** The server's origins, as `/health` reports them, for share links (specs/arch/cli/index.md#^cli-server-origins). */
  origins: () => string[];
}

/** A request body the routes cannot use: answered with 400 and no code. */
class MalformedRequestError extends Error {}

/** body-parser's error for a body over its limit. */
function isBodyTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { type?: unknown }).type === "entity.too.large";
}

function body(req: Request): Record<string, unknown> {
  const parsed: unknown = req.body;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MalformedRequestError("The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function stringField(fields: Record<string, unknown>, key: string, fallback?: string): string {
  const value = fields[key] ?? fallback;
  if (typeof value !== "string") throw new MalformedRequestError(`${key} must be a string.`);
  return value;
}

function optionalString(fields: Record<string, unknown>, key: string): string | undefined {
  return fields[key] === undefined ? undefined : stringField(fields, key);
}

/** The store a JSON store request addresses: exactly one of an artifact ID and a resource ID. */
function storeAddress(fields: Record<string, unknown>, keys: "query" | "body"): StoreAddress {
  const source = keys === "body" ? fields.store : fields;
  const address = typeof source === "object" && source !== null && !Array.isArray(source)
    ? parseStoreAddress(source as Record<string, unknown>, keys)
    : null;
  if (address === null) throw new MalformedRequestError("Address the store by exactly one of an artifact ID and a resource ID.");
  return address;
}

/**
 * The administrative routes under `/api/resources/v1/` (specs/arch/resources/index.md
 * ^rs-admin-routes): JSON over HTTP, with full access to every resource. The
 * token is their authorization, whatever the request's origin; they send no
 * CORS headers and change state only on POST (^rs-any-origin).
 */
export function createAdminRouter(options: AdminRouterOptions): express.Router {
  const { layer } = options;
  const router = express.Router();

  router.use((req, res, next) => {
    if (options.authRequired && !isAuthorizedBearer(req.header("authorization"), options.authToken)) {
      res.status(HTTP_UNAUTHORIZED).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
  // Every body is JSON whatever its declared type. A body over the write
  // message limit is refused with too-large; the shared client never sends one
  // (specs/arch/resources/json-store.md#^js-arch-write-limit).
  router.use(express.json({ type: () => true, limit: JSON_STORE_MAX_WRITE_MESSAGE_BYTES }));

  const handle = (run: (req: Request<Record<string, string>>, res: Response) => void): RequestHandler<Record<string, string>> => (req, res, next) => {
    try {
      run(req, res);
    } catch (error) {
      next(error);
    }
  };

  // Share links, by the artifact's ID (specs/arch/resources/index.md#^rs-share-change).
  router.post("/artifacts/:artifactID/share", handle((req, res) => {
    // A request without a level leaves the level to the layer's default.
    const access = body(req).access;
    if (access !== undefined && !ACCESS_LEVELS.includes(access as AccessLevel)) throw new MalformedRequestError("access must be read or read-write.");
    const shared = layer.share(req.params.artifactID!, access as AccessLevel | undefined, { authRequired: options.authRequired });
    // The link's path apart from the server's origins, which a client joins with it (specs/arch/resources/index.md#^rs-share-cli-integration).
    res.json({ ...shared, path: `/artifact/${shared.shareID}/`, origins: options.origins() });
  }));
  router.post("/artifacts/:artifactID/unshare", handle((req, res) => {
    layer.unshare(req.params.artifactID!);
    res.json({});
  }));

  router.get("/resources", handle((req, res) => {
    const artifact = req.query.artifact;
    if (artifact !== undefined && typeof artifact !== "string") throw new MalformedRequestError("artifact must be a string.");
    res.json({ resources: layer.list(artifact === undefined ? {} : { artifactID: artifact }) });
  }));
  router.get("/resources/:resourceID", handle((req, res) => {
    res.json({ resource: layer.info(req.params.resourceID!) });
  }));
  router.post("/resources/:resourceID/describe", handle((req, res) => {
    const fields = body(req);
    const description = optionalString(fields, "description");
    const usage = optionalString(fields, "usage");
    if (description === undefined && usage === undefined) throw new MalformedRequestError("Give a description, a usage or both.");
    res.json({
      resource: layer.describe(req.params.resourceID!, {
        ...(description === undefined ? {} : { description }),
        ...(usage === undefined ? {} : { usage }),
      }),
    });
  }));
  router.post("/resources/:resourceID/bind", handle((req, res) => {
    const fields = body(req);
    const access = fields.access;
    if (!ACCESS_LEVELS.includes(access as AccessLevel)) throw new MalformedRequestError("access must be read or read-write.");
    layer.bind(req.params.resourceID!, stringField(fields, "artifactID"), access as AccessLevel);
    res.json({ authRequired: options.authRequired });
  }));
  router.post("/resources/:resourceID/unbind", handle((req, res) => {
    layer.unbind(req.params.resourceID!, stringField(body(req), "artifactID"));
    res.json({});
  }));
  router.post("/resources/:resourceID/destroy", handle((req, res) => {
    const force = body(req).force;
    if (force !== undefined && typeof force !== "boolean") throw new MalformedRequestError("force must be a boolean.");
    res.json({ removedBindings: layer.destroy(req.params.resourceID!, { force: force === true }) });
  }));

  router.post("/json/create", handle((req, res) => {
    const fields = body(req);
    const usage = optionalString(fields, "usage");
    const resource = layer.json.create({
      description: fields.description as string,
      ...(usage === undefined ? {} : { usage }),
      ...(Object.hasOwn(fields, "value") ? { value: fields.value as never } : {}),
    });
    res.status(HTTP_CREATED).json({ resource });
  }));
  router.get("/json/value", handle((req, res) => {
    const jsonPath = req.query.path ?? "";
    if (typeof jsonPath !== "string") throw new MalformedRequestError("path must be a string.");
    res.json(layer.json.get(storeAddress(req.query as Record<string, unknown>, "query"), jsonPath));
  }));
  router.post("/json/set", handle((req, res) => {
    const fields = body(req);
    layer.json.write(storeAddress(fields, "body"), { kind: "set", path: stringField(fields, "path", ""), value: decodeWriteValue(fields.value) });
    res.json({});
  }));
  router.post("/json/update", handle((req, res) => {
    const fields = body(req);
    layer.json.write(storeAddress(fields, "body"), { kind: "update", path: stringField(fields, "path", ""), entries: decodeUpdateEntries(fields.entries) });
    res.json({});
  }));
  router.post("/json/push", handle((req, res) => {
    const fields = body(req);
    layer.json.push(storeAddress(fields, "body"), stringField(fields, "path", ""), stringField(fields, "key"), decodeWriteValue(fields.value));
    res.json({});
  }));
  router.post("/json/remove", handle((req, res) => {
    const fields = body(req);
    layer.json.write(storeAddress(fields, "body"), { kind: "remove", path: stringField(fields, "path", "") });
    res.json({});
  }));

  router.use((_req, res) => {
    res.status(HTTP_NOT_FOUND).json({ error: "Not found" });
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const refusal = refusalResponse(isBodyTooLarge(error) ? writeMessageTooLarge() : error);
    if (refusal) {
      res.status(refusal.status).json(refusal.body);
      return;
    }
    if (error instanceof MalformedRequestError) {
      res.status(HTTP_BAD_REQUEST).json({ error: error.message });
      return;
    }
    const status = (error as { status?: unknown }).status;
    if (isClientErrorStatus(status)) {
      // body-parser: malformed JSON.
      res.status(status).json({ error: (error as Error).message });
      return;
    }
    next(error);
  });
  return router;
}
