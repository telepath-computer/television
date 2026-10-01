/*
 * skillbenchMiddleware() — serves the skillbench page, its API, and eval
 * output files, per specs/arch/skillbench.md. Mounted by the
 * Storybook dev server at /skillbench (the same pattern as the canonical
 * middleware).
 *
 * Routes (relative to the mount):
 *   /               → public/index.html (the app)
 *   /app.js, /style.css, /sizes.json
 *                   → package assets
 *   /api/eval?path=<repo-rel eval.json>
 *                   → { path, dir, jobs: [{ name, prompt, cwd, hasOutput }] }
 *   /files/<repo-rel path>
 *                   → any file inside the repo (containment-checked) — the
 *                     artifact iframes point here, path-shaped so the
 *                     artifacts' relative asset links resolve.
 *
 * Read-only by design: v1 opens no write paths and spawns nothing.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const publicDir = path.join(here, "public");

const CONTENT_TYPES = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function send(res, status, type, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
}

async function sendFile(res, filepath) {
  try {
    const body = await fs.readFile(filepath);
    const type = CONTENT_TYPES[path.extname(filepath).toLowerCase()] ?? "application/octet-stream";
    send(res, 200, type, body);
  } catch {
    send(res, 404, "text/plain", "not found");
  }
}

// Resolve a repo-root-relative reference; null when it escapes the repo.
// Containment is checked lexically AND against the real path: eval outputs
// are agent-written content, and a symlink inside an out/ dir pointing
// outside the repo must not be served.
const realRepoRoot = await fs.realpath(repoRoot);
function contained(filepath) {
  return filepath === realRepoRoot || filepath.startsWith(realRepoRoot + path.sep);
}
async function resolveInRepo(relative) {
  if (relative.includes("\\") || relative.split("/").includes("..")) return null;
  const filepath = path.resolve(realRepoRoot, relative);
  if (!contained(filepath)) return null;
  let real;
  try {
    real = await fs.realpath(filepath);
  } catch {
    return filepath; // nonexistent: lexically contained, reads will 404
  }
  return contained(real) ? real : null;
}

async function evalApi(res, url) {
  const evalPath = url.searchParams.get("path");
  if (!evalPath) return send(res, 400, "application/json", JSON.stringify({ error: "path required" }));
  const configPath = await resolveInRepo(evalPath);
  if (!configPath) return send(res, 403, "application/json", JSON.stringify({ error: "path escapes repo" }));

  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {
    return send(res, 404, "application/json", JSON.stringify({ error: `no eval config at ${evalPath}` }));
  }

  const dir = path.posix.dirname(evalPath);
  const jobs = [];
  for (const job of config.jobs ?? []) {
    let hasOutput = false;
    const jobDir = await resolveInRepo(path.posix.join(dir, job.cwd));
    if (jobDir) {
      hasOutput = await fs
        .stat(path.join(jobDir, "index.html"))
        .then((s) => s.isFile())
        .catch(() => false);
    }
    jobs.push({ name: job.name, prompt: job.prompt, cwd: job.cwd, hasOutput });
  }
  send(res, 200, "application/json", JSON.stringify({ path: evalPath, dir, jobs }));
}

// Connect handler; mount with server.middlewares.use("/skillbench", skillbenchMiddleware()).
export function skillbenchMiddleware() {
  return async (req, res, next) => {
    if (req.method !== "GET") return next();

    const url = new URL(req.url ?? "", "http://internal");
    let route;
    try {
      route = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      return send(res, 400, "text/plain", "bad path");
    }

    if (route === "") return sendFile(res, path.join(publicDir, "index.html"));
    if (route === "app.js" || route === "style.css") return sendFile(res, path.join(publicDir, route));
    if (route === "sizes.json") return sendFile(res, path.join(here, "sizes.json"));
    if (route === "api/eval") return evalApi(res, url);
    if (route.startsWith("files/")) {
      const filepath = await resolveInRepo(route.slice("files/".length));
      if (!filepath) return send(res, 403, "text/plain", "path escapes repo");
      return sendFile(res, filepath);
    }
    next();
  };
}
