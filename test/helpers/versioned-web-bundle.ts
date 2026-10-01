import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Versioned web-bundle builder for the update-notifications harnesses: a real
// `vite build` of packages/web stamped at a chosen version via the sanctioned
// TV_TEST_WEB_VERSION build input
// (specs/arch/updates/version-advertisement.md ^hook-web-version), emitted
// into a temp directory — never packages/web/dist — and cached per version
// within the worker process. The contract is exactly (version) → dist path;
// no Vite configuration leaks to callers.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_PACKAGE_DIR = path.join(REPO_ROOT, "packages", "web");

const distByVersion = new Map<string, Promise<string>>();
// Builds are serialized: the version reaches the vite config through
// process.env, which concurrent in-process builds would race on.
let buildChain: Promise<unknown> = Promise.resolve();

type ViteModule = {
  build(config: {
    configFile: string;
    logLevel?: "error";
    build?: { outDir: string; emptyOutDir: boolean };
  }): Promise<unknown>;
};

async function loadVite(): Promise<ViteModule> {
  const require = createRequire(path.join(WEB_PACKAGE_DIR, "package.json"));
  const loaded = (await import(pathToFileURL(require.resolve("vite")).href)) as ViteModule & { default?: ViteModule };
  // Under runners that resolve vite's CJS entry (Playwright's transform, vs
  // vitest's native ESM), the API lands on the interop `default` export.
  return typeof loaded.build === "function" ? loaded : loaded.default!;
}

async function runBuild(version: string | undefined): Promise<string> {
  const vite = await loadVite();
  const outDir = mkdtempSync(path.join(os.tmpdir(), "television-web-bundle-"));
  const previous = process.env.TV_TEST_WEB_VERSION;
  if (version === undefined) delete process.env.TV_TEST_WEB_VERSION;
  else process.env.TV_TEST_WEB_VERSION = version;
  try {
    await vite.build({
      configFile: path.join(WEB_PACKAGE_DIR, "vite.config.ts"),
      logLevel: "error",
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (previous === undefined) delete process.env.TV_TEST_WEB_VERSION;
    else process.env.TV_TEST_WEB_VERSION = previous;
  }
  return outDir;
}

/**
 * Build the web bundle stamped at `version` (or the workspace package version
 * when omitted) and return the dist directory. Cached per version per worker.
 */
export function buildVersionedWebBundle(version?: string): Promise<string> {
  const key = version ?? "<workspace>";
  let dist = distByVersion.get(key);
  if (dist === undefined) {
    dist = buildChain.then(() => runBuild(version), () => runBuild(version));
    buildChain = dist.catch(() => undefined);
    distByVersion.set(key, dist);
  }
  return dist;
}
