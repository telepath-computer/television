import type express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const CACHE_CONTROL_NO_CACHE = "no-cache";
const ETAG_DIGEST_LENGTH = 16;
const HTTP_NOT_MODIFIED_STATUS = 304;
const CANONICAL_STYLESHEET = "styles.css";

export function canonicalWrapper(
  version: string,
  frozen = false,
  querySuffix = "",
): string {
  const baseImport = `@import url("/canonical/${version}/base.css${querySuffix}");\n`;
  if (frozen) return baseImport;
  return `${baseImport}@import url("/theme/theme.css${querySuffix}");\n`;
}

/** Expose a canonical version's built stylesheet as the wrapper's base layer. */
export function serveCanonicalBase(canonicalDir: string): express.RequestHandler {
  const body = readFileSync(path.join(canonicalDir, CANONICAL_STYLESHEET));
  const digest = createHash("sha256").update(body).digest("hex").slice(0, ETAG_DIGEST_LENGTH);
  const etag = `W/"canonical-base-${digest}"`;

  return (req, res) => {
    res.type("text/css");
    res.setHeader("Cache-Control", CACHE_CONTROL_NO_CACHE);
    res.setHeader("ETag", etag);

    if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
      res.status(HTTP_NOT_MODIFIED_STATUS).end();
      return;
    }
    res.send(body);
  };
}

/** Serve the stable wrapper selected by the canonical version's input class. */
export function serveCanonicalStyles(
  version: string,
  frozen = false,
): express.RequestHandler {
  return (req, res) => {
    const queryIndex = req.originalUrl.indexOf("?");
    const querySuffix = queryIndex === -1
      ? ""
      : req.originalUrl.slice(queryIndex);
    const body = canonicalWrapper(version, frozen, querySuffix);
    const digest = createHash("sha256").update(body).digest("hex").slice(0, ETAG_DIGEST_LENGTH);
    const etag = `W/"canonical-${version}-${digest}"`;

    res.type("text/css");
    res.setHeader("Cache-Control", CACHE_CONTROL_NO_CACHE);
    res.setHeader("ETag", etag);

    if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
      res.status(HTTP_NOT_MODIFIED_STATUS).end();
      return;
    }
    res.send(body);
  };
}

function matchesIfNoneMatch(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false;
  const values = Array.isArray(header) ? header : [header];
  return values.some((value) =>
    value
      .split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate === etag)
  );
}
