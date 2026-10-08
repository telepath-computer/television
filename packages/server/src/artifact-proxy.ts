import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import { STATUS_CODES } from "node:http";
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

/** A single-file artifact's file, by its name, under the folder that holds it. */
function fileNamePath(artifact: Artifact & { kind: "path" }): string {
  return `/${encodeURIComponent(artifactBasename(artifact.path))}`;
}

/**
 * Where a single-file artifact is served under an ID, to which the address
 * without it redirects. Under the artifact's own ID that is its file's name,
 * the address the app frames. Under a share ID it is the link's address
 * itself, and every other path there, the file's name included, is a missing
 * file (specs/arch/resources/index.md#^rs-share-serving).
 */
function fileEntry(artifact: Artifact & { kind: "path" }, reply: ProxyReply): string {
  return reply.underOwnID ? fileNamePath(artifact) : "/";
}

/** Whether a request for a single-file artifact names its address without the entry, and so redirects to it. */
function isShorthand(subpath: string, entry: string): boolean {
  return subpath === "" || (subpath === "/" && entry !== "/");
}

function requestSubpath(originalURL: string, id: string): string | null {
  const pathname = new URL(originalURL, "http://television.local").pathname;
  const mount = proxyMountPath(id);
  if (pathname === mount) return "";
  if (pathname.startsWith(`${mount}/`)) return pathname.slice(mount.length);
  return null;
}

/**
 * An error response, under any ID: the status and fixed text for it, never
 * the error's own message, which names the artifact's files and so, for an
 * artifact stored in a folder named for its ID, the ID a share link hides
 * (specs/arch/resources/index.md#^rs-share-serving). An error after the
 * response has begun ends it.
 */
function sendStatus(res: Response, status: number): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  applyProxyHeaders(res);
  res.status(status).type("text/plain").send(status === HTTP_NOT_FOUND ? "Not found" : (STATUS_CODES[status] ?? "Error"));
}

function sendNotFound(res: Response): void {
  sendStatus(res, HTTP_NOT_FOUND);
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

/**
 * The proxy's answers to one request other than the artifact's content and
 * the headers that describe it. Each is built from the request's own path
 * and fixed text alone, and none takes a string, so no path the proxy
 * resolved on disk, where a file's or folder's name can contain the
 * artifact's ID, reaches a status line, header or body through them. The
 * streaming library's own redirects and errors reach the viewer only through
 * `addSlash`, `artifactMissing`, `notFound` and `failed`
 * (specs/arch/resources/index.md#^rs-share-serving). The one answer built
 * from a name on disk is a single file's redirect to its name, which only a
 * request under the artifact's own ID gets.
 */
interface ProxyReply {
  /** Whether the request's ID is the artifact's own rather than a share ID. */
  readonly underOwnID: boolean;
  /** `404` with fixed text. */
  notFound(): void;
  /** The built missing-artifact document, for an entry whose file is gone. */
  artifactMissing(): void;
  /** An error status with fixed text. */
  failed(status: number): void;
  /** `301` to the request's own path with a trailing slash. */
  addSlash(): void;
  /** `301` to where a single file is served: the link's address under a share ID, the file's name under the artifact's own ID. */
  toFileEntry(): void;
}

function proxyReply(req: Parameters<RequestHandler>[0], res: Response, store: ServerStore, artifact: Artifact & { kind: "path" }, id: string): ProxyReply {
  const requestPath = new URL(req.originalUrl, "http://television.local").pathname;
  const underOwnID = id === artifact.id;
  const redirect = (location: string) => {
    applyProxyHeaders(res);
    res.redirect(HTTP_MOVED_PERMANENTLY, location);
  };
  const addSlash = () => redirect(`${requestPath}/`);
  return {
    underOwnID,
    notFound: () => sendNotFound(res),
    artifactMissing: () => sendArtifactNotFound(req, res, store),
    failed: (status) => sendStatus(res, status),
    addSlash,
    // Under a share ID only the address without its slash redirects, to the link's address.
    toFileEntry: () => (underOwnID ? redirect(`${proxyMountPath(id)}${fileNamePath(artifact)}`) : addSlash()),
  };
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

function sendInjectedHTML(req: Parameters<RequestHandler>[0], res: Response, reply: ProxyReply, stream: SendStreamWithSend, resolvedPath: string, stat: fs.Stats, appearanceSource: string, bridgeSource: string): void {
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
      reply.notFound();
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

function sendRenderedMarkdown(req: Parameters<RequestHandler>[0], res: Response, reply: ProxyReply, resolvedPath: string, stat: fs.Stats, appearanceSource: string, bridgeSource: string): void {
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
      reply.notFound();
    }
  })();
}

/**
 * Serves `subpath` under `options.root`: the path the request named for a
 * folder artifact, a single file's own name for one. The library's own
 * redirect, when the path is a folder, and its errors are answered only by
 * `onFolder`, `onMissing` and the reply, never from the path or the error.
 */
function pipeWithInjection(req: Parameters<RequestHandler>[0], res: Response, reply: ProxyReply, subpath: string, options: send.SendOptions, appearanceSource: string, bridgeSource: string, onFolder: () => void, onMissing: () => void): void {
  applyProxyHeaders(res);
  const stream = send(req, subpath, { ...options, etag: true }) as SendStreamWithSend;
  stream.on("directory", onFolder);
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
    sendInjectedHTML(req, res, reply, stream, resolvedPath, stat, appearanceSource, bridgeSource);
  };
  stream.on("error", (error: NodeJS.ErrnoException & { status?: number }) => {
    const status = error.status ?? HTTP_NOT_FOUND;
    if (status === HTTP_NOT_FOUND) onMissing();
    else reply.failed(status);
  });
  stream.pipe(res);
}

function serveDirectoryArtifact(req: Parameters<RequestHandler>[0], res: Response, reply: ProxyReply, artifact: Artifact & { kind: "path" }, subpath: string, appearanceSource: string, bridgeSource: string): void {
  // A folder's address without its trailing slash, the artifact's or a
  // subfolder's, redirects to the request's own path with one.
  if (subpath === "") {
    reply.addSlash();
    return;
  }
  pipeWithInjection(req, res, reply, subpath, { root: artifact.path, index: ["index.html", "index.htm"], dotfiles: "allow" }, appearanceSource, bridgeSource, reply.addSlash, subpath === "/" ? reply.artifactMissing : reply.notFound);
}

function serveFileArtifact(req: Parameters<RequestHandler>[0], res: Response, reply: ProxyReply, artifact: Artifact & { kind: "path" }, subpath: string, appearanceSource: string, bridgeSource: string): void {
  const entry = fileEntry(artifact, reply);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifact.path);
  } catch {
    if (subpath === entry) reply.artifactMissing();
    else reply.notFound();
    return;
  }

  if (!stat.isFile()) {
    if (subpath === entry) reply.artifactMissing();
    else reply.notFound();
    return;
  }
  if (isShorthand(subpath, entry)) {
    reply.toFileEntry();
    return;
  }
  if (subpath !== entry) {
    reply.notFound();
    return;
  }
  // A file that has become a folder since the check above is missing.
  pipeWithInjection(req, res, reply, fileNamePath(artifact), { root: path.dirname(artifact.path), index: false, dotfiles: "allow" }, appearanceSource, bridgeSource, reply.artifactMissing, reply.artifactMissing);
}

function serveMarkdownArtifact(req: Parameters<RequestHandler>[0], res: Response, reply: ProxyReply, artifact: Artifact & { kind: "path" }, subpath: string, appearanceSource: string, bridgeSource: string): void {
  const entry = fileEntry(artifact, reply);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifact.path);
  } catch {
    if (subpath === entry) reply.artifactMissing();
    else reply.notFound();
    return;
  }

  if (!stat.isFile()) {
    if (subpath === entry) reply.artifactMissing();
    else reply.notFound();
    return;
  }
  if (isShorthand(subpath, entry)) {
    reply.toFileEntry();
    return;
  }
  if (subpath !== entry) {
    reply.notFound();
    return;
  }
  sendRenderedMarkdown(req, res, reply, artifact.path, stat, appearanceSource, bridgeSource);
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

    // An artifact ID or a share ID; every redirect, error document and header
    // is built from the request, never from the artifact's own ID or the
    // names of its files (specs/arch/resources/index.md#^rs-share-serving).
    const id = req.params.id;
    if (typeof id !== "string") {
      sendNotFound(res);
      return;
    }
    const artifact = store.resolveArtifactAddress(id);
    const subpath = requestSubpath(req.originalUrl, id);
    if (!artifact || artifact.kind !== "path" || subpath === null) {
      sendNotFound(res);
      return;
    }

    const reply = proxyReply(req, res, store, artifact, id);
    if (isMarkdownPath(artifact.path)) serveMarkdownArtifact(req, res, reply, artifact, subpath, appearanceSource, bridgeSource);
    else if (hasTrailingSeparator(artifact.path)) serveDirectoryArtifact(req, res, reply, artifact, subpath, appearanceSource, bridgeSource);
    else serveFileArtifact(req, res, reply, artifact, subpath, appearanceSource, bridgeSource);
  };
}
