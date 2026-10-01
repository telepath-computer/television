import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import type { RequestHandler, Response } from "express";
import send, { type SendStream } from "send";
import { marked } from "marked";
import { artifactBasename, hasTrailingSeparator, isMarkdownPath, type Artifact } from "@telepath-computer/television-artifact";
import {
  appearanceResolverScriptSource,
  bridgeScriptSource,
  type ArtifactPollCadence,
} from "@telepath-computer/television-artifact/browser";
import { MARKDOWN_DOC_CSS } from "./markdown-doc-style.ts";
import { ServerStore } from "./server-store.ts";

const HTTP_OK = 200;
const HTTP_MOVED_PERMANENTLY = 301;
const HTTP_NOT_MODIFIED = 304;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTML_CACHE_CONTROL = "no-cache, must-revalidate";
const SHARED_PROXY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

interface SendStreamWithSend extends SendStream {
  send: (resolvedPath: string, stat?: fs.Stats) => void;
  setHeader: (resolvedPath: string, stat: fs.Stats) => void;
  type: (resolvedPath: string) => void;
}

function applyProxyHeaders(res: Response): void {
  for (const [name, value] of Object.entries(SHARED_PROXY_HEADERS)) res.setHeader(name, value);
}

function proxyMountPath(id: string): string {
  return `/artifact/${encodeURIComponent(id)}`;
}

function proxyFilePath(id: string, basename: string): string {
  return `${proxyMountPath(id)}/${encodeURIComponent(basename)}`;
}

function requestSubpath(originalURL: string, id: string): string | null {
  const pathname = new URL(originalURL, "http://television.local").pathname;
  const mount = proxyMountPath(id);
  if (pathname === mount) return "";
  if (pathname.startsWith(`${mount}/`)) return pathname.slice(mount.length);
  return null;
}

function sendNotFound(res: Response): void {
  applyProxyHeaders(res);
  res.status(HTTP_NOT_FOUND).type("text/plain").send("Not found");
}

function sendArtifactNotFound(req: Parameters<RequestHandler>[0], res: Response, store: ServerStore): void {
  void (async () => {
    // Serve the built view bytes verbatim. Its relative asset URLs are emitted
    // for a depth-2 view path and intentionally resolve from both canonical
    // proxy entry shapes (`/artifact/<id>/` and `/artifact/<id>/<basename>`).
    const viewPath = store.getViewPath("artifact-missing");
    if (viewPath === null) {
      sendNotFound(res);
      return;
    }
    try {
      const body = await readFile(path.join(viewPath, "index.html"));
      applyProxyHeaders(res);
      res.status(HTTP_NOT_FOUND).type("text/html; charset=utf-8");
      res.setHeader("Content-Length", String(body.byteLength));
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
    } catch {
      sendNotFound(res);
    }
  })();
}

function sendMethodNotAllowed(res: Response): void {
  applyProxyHeaders(res);
  res.setHeader("Allow", "GET, HEAD");
  res.status(HTTP_METHOD_NOT_ALLOWED).type("text/plain").send("Method not allowed");
}

function isHTMLResponse(res: Response): boolean {
  const contentType = res.getHeader("Content-Type");
  const value = Array.isArray(contentType) ? contentType.join("; ") : String(contentType ?? "");
  return value.toLowerCase().startsWith("text/html");
}

export function injectedETag(
  stat: fs.Stats,
  body: Buffer,
  bridgeSource: string,
  appearanceSource = "",
): string {
  const hash = createHash("sha256");
  hash.update(String(stat.size));
  hash.update("\0");
  hash.update(String(stat.mtimeMs));
  hash.update("\0");
  hash.update(bridgeSource);
  hash.update("\0");
  hash.update(appearanceSource);
  hash.update("\0");
  hash.update(body);
  return `"${hash.digest("base64url")}"`;
}

function appearanceScript(source: string): string {
  return `<script>\n${source}\n</script>`;
}

function injectAppearance(source: string, appearanceSource: string): string {
  const script = appearanceScript(appearanceSource);
  const head = /<head\b[^>]*>/i.exec(source);
  if (head) {
    const afterHead = source.slice(head.index + head[0].length);
    const headEnd = /<\/head\s*>/i.exec(afterHead);
    const searchEnd = headEnd === null
      ? source.length
      : head.index + head[0].length + headEnd.index;
    const headContent = source.slice(head.index + head[0].length, searchEnd);
    let insertion = head.index + head[0].length;
    for (const match of headContent.matchAll(/<meta\b[^>]*>/gi)) {
      if (/\bhttp-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(match[0])) {
        insertion = head.index + head[0].length + match.index + match[0].length;
      }
    }
    return `${source.slice(0, insertion)}\n${script}${source.slice(insertion)}`;
  }

  const firstStyleOrBody = /<(?:link\b[^>]*rel\s*=\s*["']?stylesheet|style\b|body\b)/i.exec(source);
  const searchEnd = firstStyleOrBody?.index ?? source.length;
  const prefix = source.slice(0, searchEnd);
  const doctype = /<!doctype\b[^>]*>/i.exec(prefix);
  let insertion = doctype === null ? 0 : doctype.index + doctype[0].length;
  for (const match of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    if (/\bhttp-equiv\s*=\s*["']?Content-Security-Policy["']?/i.test(match[0])) {
      insertion = match.index + match[0].length;
    }
  }
  return `${source.slice(0, insertion)}\n${script}${source.slice(insertion)}`;
}

function injectDocument(body: Buffer, appearanceSource: string, bridgeSource: string): Buffer {
  const early = injectAppearance(body.toString("utf8"), appearanceSource);
  return Buffer.from(`${early}\n<script>\n${bridgeSource}\n</script>\n`);
}

function sendInjectedHTML(req: Parameters<RequestHandler>[0], res: Response, stream: SendStreamWithSend, resolvedPath: string, stat: fs.Stats, appearanceSource: string, bridgeSource: string): void {
  void (async () => {
    try {
      const source = await readFile(resolvedPath);
      const body = injectDocument(source, appearanceSource, bridgeSource);
      const etag = injectedETag(stat, body, bridgeSource, appearanceSource);
      stream.setHeader(resolvedPath, stat);
      stream.type(resolvedPath);
      res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
      res.setHeader("ETag", etag);
      res.setHeader("Content-Length", String(body.byteLength));
      if (req.headers["if-none-match"] === etag) {
        res.status(HTTP_NOT_MODIFIED).end();
        return;
      }
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
    } catch {
      sendNotFound(res);
    }
  })();
}

function markdownDocument(renderedHTML: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/canonical/v2/styles.css">
    <style>${MARKDOWN_DOC_CSS}</style>
  </head>
  <body>
${renderedHTML}
  </body>
</html>`;
}

function sendRenderedMarkdown(req: Parameters<RequestHandler>[0], res: Response, resolvedPath: string, stat: fs.Stats, appearanceSource: string, bridgeSource: string): void {
  void (async () => {
    try {
      const source = await readFile(resolvedPath, "utf8");
      // Key the ETag on the markdown SOURCE (so HEAD polls don't re-render),
      // the bridge source, and the document template shell — including its
      // <style>. Folding in the shell means a change to the rendering wrapper
      // (page styling, head markup, etc.) invalidates caches, so a normal
      // reload picks it up instead of silently 304-ing to a hard refresh.
      const etag = injectedETag(
        stat,
        Buffer.from(source + markdownDocument("")),
        bridgeSource,
        appearanceSource,
      );
      applyProxyHeaders(res);
      res.status(HTTP_OK).type("text/html; charset=utf-8");
      res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        res.status(HTTP_NOT_MODIFIED).end();
        return;
      }
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const rendered = marked.parse(source, { async: false });
      const body = injectDocument(
        Buffer.from(markdownDocument(rendered)),
        appearanceSource,
        bridgeSource,
      );
      res.setHeader("Content-Length", String(body.byteLength));
      res.end(body);
    } catch {
      sendNotFound(res);
    }
  })();
}

function pipeWithInjection(req: Parameters<RequestHandler>[0], res: Response, subpath: string, options: send.SendOptions, appearanceSource: string, bridgeSource: string, notFound?: () => void): void {
  applyProxyHeaders(res);
  const stream = send(req, subpath, { ...options, etag: true }) as SendStreamWithSend;
  const sendOriginal = stream.send.bind(stream);
  stream.send = (resolvedPath: string, stat?: fs.Stats) => {
    if (!stat) {
      sendOriginal(resolvedPath, stat);
      return;
    }
    stream.setHeader(resolvedPath, stat);
    stream.type(resolvedPath);
    if (!isHTMLResponse(res)) {
      res.setHeader("Cache-Control", "no-cache");
      sendOriginal(resolvedPath, stat);
      return;
    }
    res.removeHeader("ETag");
    sendInjectedHTML(req, res, stream, resolvedPath, stat, appearanceSource, bridgeSource);
  };
  stream.on("error", (error: NodeJS.ErrnoException & { status?: number }) => {
    if ((error.status ?? HTTP_NOT_FOUND) === HTTP_NOT_FOUND && notFound) {
      notFound();
      return;
    }
    applyProxyHeaders(res);
    res.status(error.status === HTTP_NOT_FOUND ? HTTP_NOT_FOUND : (error.status ?? HTTP_NOT_FOUND)).type("text/plain").send(error.message);
  });
  stream.pipe(res);
}

function serveDirectoryArtifact(req: Parameters<RequestHandler>[0], res: Response, store: ServerStore, artifact: Artifact & { kind: "path" }, subpath: string, appearanceSource: string, bridgeSource: string): void {
  if (subpath === "") {
    applyProxyHeaders(res);
    res.redirect(HTTP_MOVED_PERMANENTLY, `${proxyMountPath(artifact.id)}/`);
    return;
  }
  pipeWithInjection(req, res, subpath, { root: artifact.path, index: ["index.html", "index.htm"], dotfiles: "allow" }, appearanceSource, bridgeSource, subpath === "/" ? () => sendArtifactNotFound(req, res, store) : undefined);
}

function serveFileArtifact(req: Parameters<RequestHandler>[0], res: Response, store: ServerStore, artifact: Artifact & { kind: "path" }, subpath: string, appearanceSource: string, bridgeSource: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifact.path);
  } catch {
    const basename = artifactBasename(artifact.path);
    if (subpath === `/${encodeURIComponent(basename)}`) sendArtifactNotFound(req, res, store);
    else sendNotFound(res);
    return;
  }

  const basename = artifactBasename(artifact.path);
  const canonical = proxyFilePath(artifact.id, basename);
  if (!stat.isFile()) {
    if (subpath === `/${encodeURIComponent(basename)}`) sendArtifactNotFound(req, res, store);
    else sendNotFound(res);
    return;
  }
  if (subpath === "" || subpath === "/") {
    applyProxyHeaders(res);
    res.redirect(HTTP_MOVED_PERMANENTLY, canonical);
    return;
  }
  if (subpath !== `/${encodeURIComponent(basename)}`) {
    sendNotFound(res);
    return;
  }
  pipeWithInjection(req, res, subpath, { root: path.dirname(artifact.path), index: false, dotfiles: "allow" }, appearanceSource, bridgeSource, () => sendArtifactNotFound(req, res, store));
}

function serveMarkdownArtifact(req: Parameters<RequestHandler>[0], res: Response, store: ServerStore, artifact: Artifact & { kind: "path" }, subpath: string, appearanceSource: string, bridgeSource: string): void {
  const basename = artifactBasename(artifact.path);
  const canonical = proxyFilePath(artifact.id, basename);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifact.path);
  } catch {
    if (subpath === `/${encodeURIComponent(basename)}`) sendArtifactNotFound(req, res, store);
    else sendNotFound(res);
    return;
  }

  if (!stat.isFile()) {
    if (subpath === `/${encodeURIComponent(basename)}`) sendArtifactNotFound(req, res, store);
    else sendNotFound(res);
    return;
  }
  if (subpath === "" || subpath === "/") {
    applyProxyHeaders(res);
    res.redirect(HTTP_MOVED_PERMANENTLY, canonical);
    return;
  }
  if (subpath !== `/${encodeURIComponent(basename)}`) {
    sendNotFound(res);
    return;
  }
  sendRenderedMarkdown(req, res, artifact.path, stat, appearanceSource, bridgeSource);
}

export function serveArtifactProxy(
  store: ServerStore,
  options: { pollCadence?: ArtifactPollCadence } = {},
): RequestHandler {
  const appearanceSource = appearanceResolverScriptSource('"system"');
  const bridgeSource = bridgeScriptSource({ pollCadence: options.pollCadence });
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendMethodNotAllowed(res);
      return;
    }

    const rawID = req.params.id;
    if (typeof rawID !== "string") {
      sendNotFound(res);
      return;
    }
    const artifact = store.getArtifact(rawID);
    const subpath = requestSubpath(req.originalUrl, rawID);
    if (!artifact || artifact.kind !== "path" || subpath === null) {
      sendNotFound(res);
      return;
    }

    if (isMarkdownPath(artifact.path)) serveMarkdownArtifact(req, res, store, artifact, subpath, appearanceSource, bridgeSource);
    else if (hasTrailingSeparator(artifact.path)) serveDirectoryArtifact(req, res, store, artifact, subpath, appearanceSource, bridgeSource);
    else serveFileArtifact(req, res, store, artifact, subpath, appearanceSource, bridgeSource);
  };
}
