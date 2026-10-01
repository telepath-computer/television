import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { createRequire, findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import frameset from "frameset/vite";
import type { ViteDevServer } from "vite";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const FRAME = path.join(
  REPO_ROOT,
  "specs",
  "ui",
  "app",
  "artifact-frame",
  "delete-confirm",
  "delete-confirm.frame",
);

let cacheRoot: string;
let vite: ViteDevServer;

beforeAll(async () => {
  cacheRoot = mkdtempSync(path.join(os.tmpdir(), "tv-artifact-delete-frame-"));
  const { createServer } = await import(pathToFileURL(
    createRequire(findPackageJSON("frameset", import.meta.url)!).resolve("vite"),
  ).href);
  vite = await createServer({
    configFile: false,
    root: REPO_ROOT,
    cacheDir: path.join(cacheRoot, "cache"),
    plugins: [frameset()],
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    appType: "custom",
    logLevel: "error",
  });
});

afterAll(async () => {
  await vite?.close();
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true });
});

async function render(params?: { title: string }): Promise<string> {
  const mod = (await vite.ssrLoadModule(FRAME)) as {
    default: { render(params?: { title: string }): string };
  };
  return mod.default.render(params);
}

describe("artifact delete reference frame", () => {
  // proofs/ui/app/artifact-frame/index.md#^af-ui-ac-delete-reference-render
  test("renders the named confirmation with exact copy (^af-ui-ac-delete-reference-render)", async () => {
    const fixtures = [
      { label: "the sample default", params: undefined, title: "Roadmap" },
      {
        label: "an ordinary supplied title",
        params: { title: "Audit sample artifact" },
        title: "Audit sample artifact",
      },
      {
        label: "an HTML-sensitive supplied title",
        params: { title: `Review & <draft> > "approved" 'later'` },
        title: "Review &amp; &lt;draft&gt; &gt; &#34;approved&#34; &#39;later&#39;",
      },
    ];

    for (const { label, params, title } of fixtures) {
      const markup = await render(params);
      const expected =
        `<div class="dialog-alert" role="alertdialog"><h2>Delete “${title}”?</h2>` +
        `<p>It’s removed from this channel; the file or web page it points to is not deleted.</p>` +
        `<div class="dialog-actions"><button>Cancel</button>` +
        `<button intent="danger">Delete</button></div></div>`;

      expect(markup, label).toContain(expected);
      expect(markup, label).not.toContain("{{ title }}");
    }
  });
});
