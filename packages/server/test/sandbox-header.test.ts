import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

// The sandbox header (proofs/arch/artifact-frame/isolation.md ^iso-t-header):
// a really-running server over temporary artifact and theme folders, driven
// over real HTTP. Every response from the artifact proxy and the active-theme
// route carries exactly this header, whatever the response.

const SANDBOX_HEADER =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";

interface Case {
  name: string;
  method?: string;
  route: string;
  headers?: Record<string, string>;
  body?: string;
  status: number;
}

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root: string, relative: string, contents: string | Buffer): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), contents);
}

async function startServer(options: { activeTheme: boolean }): Promise<{ baseURL: string; store: ReturnType<typeof createServingStore> }> {
  const storagePath = tempDir("television-sandbox-home-");
  if (options.activeTheme) {
    const themeDir = seedThemePackage(storagePath, "sandboxed-theme", ".probe { color: red; }\n", {
      enableIframeBackgroundJS: true,
      iframeBackgroundJS: "globalThis.background = true;\n",
    });
    write(themeDir, "page.html", "<!doctype html><title>theme page</title>");
  }
  const viewsDir = tempDir("television-sandbox-views-");
  write(viewsDir, "artifact-missing/index.html", "<!doctype html><title>Artifact file not found</title>");
  const store = createServingStore(storagePath, { bundledViewsPath: viewsDir });
  if (options.activeTheme) store.patchDisplay({ activeThemeName: "sandboxed-theme" });
  const server = new Server({ store, host: "127.0.0.1", port: 0 });
  await server.start();
  servers.push(server);
  return { baseURL: server.getBaseURL(), store };
}

async function fetchCase(baseURL: string, testCase: Case): Promise<Response> {
  const response = await fetch(`${baseURL}${testCase.route}`, {
    method: testCase.method ?? "GET",
    headers: testCase.headers,
    body: testCase.body,
    redirect: "manual",
  });
  await response.arrayBuffer();
  return response;
}

async function etagOf(baseURL: string, route: string): Promise<string> {
  const response = await fetch(`${baseURL}${route}`);
  await response.arrayBuffer();
  const etag = response.headers.get("etag");
  if (etag === null) throw new Error(`${route} sent no ETag`);
  return etag;
}

// A browser's revalidation. Without its own `Cache-Control`, fetch adds
// `no-cache` to a conditional request, which the file server answers in full.
function revalidation(etag: string): Record<string, string> {
  return { "If-None-Match": etag, "Cache-Control": "max-age=0" };
}

// A body the server's JSON parser rejects before any route sees the request.
const UNPARSABLE_BODY = { headers: { "Content-Type": "application/json" }, body: "{" };

async function expectSandboxed(baseURL: string, cases: Case[]): Promise<void> {
  for (const testCase of cases) {
    const response = await fetchCase(baseURL, testCase);
    expect({ name: testCase.name, status: response.status }).toEqual({ name: testCase.name, status: testCase.status });
    expect({ name: testCase.name, csp: response.headers.get("content-security-policy") })
      .toEqual({ name: testCase.name, csp: SANDBOX_HEADER });
  }
}

describe("the sandbox header (^iso-t-header)", () => {
  it("is on every artifact proxy response, under the artifact's ID and its share ID", async () => {
    const { baseURL, store } = await startServer({ activeTheme: false });
    const folder = tempDir("television-sandbox-folder-");
    write(folder, "index.html", "<!doctype html><title>page</title><p>page</p>");
    write(folder, "image.png", Buffer.from("89504e470d0a1a0a", "hex"));
    write(folder, "doc.pdf", "%PDF-1.4\n%%EOF\n");
    write(folder, "data.json", "{\"ok\":true}\n");
    write(folder, "picture.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");
    write(folder, "sub/index.html", "<!doctype html><title>sub</title>");
    const notesDir = tempDir("television-sandbox-notes-");
    write(notesDir, "notes.md", "# Notes\n");
    const goneDir = tempDir("television-sandbox-gone-");
    write(goneDir, "gone.html", "<!doctype html>");
    const channelID = store.listChannels()[0]!.id;
    const folderArtifact = store.createArtifact({ channelID, kind: "path", title: "Folder", path: `${folder}${path.sep}` });
    const markdownArtifact = store.createArtifact({ channelID, kind: "path", title: "Notes", path: path.join(notesDir, "notes.md") });
    const goneArtifact = store.createArtifact({ channelID, kind: "path", title: "Gone", path: path.join(goneDir, "gone.html") });
    rmSync(path.join(goneDir, "gone.html"));
    const share = (id: string) => store.resources.share(id, "read", { authRequired: true }).shareID;

    for (const [folderID, markdownID, goneID] of [
      [folderArtifact.id, markdownArtifact.id, goneArtifact.id],
      [share(folderArtifact.id), share(markdownArtifact.id), share(goneArtifact.id)],
    ] as const) {
      const markdownRoute = markdownID === markdownArtifact.id ? `/artifact/${markdownID}/notes.md` : `/artifact/${markdownID}/`;
      const goneRoute = goneID === goneArtifact.id ? `/artifact/${goneID}/gone.html` : `/artifact/${goneID}/`;
      await expectSandboxed(baseURL, [
        { name: "HTML page with the bridge injected", route: `/artifact/${folderID}/`, status: 200 },
        { name: "rendered Markdown", route: markdownRoute, status: 200 },
        { name: "image", route: `/artifact/${folderID}/image.png`, status: 200 },
        { name: "PDF", route: `/artifact/${folderID}/doc.pdf`, status: 200 },
        { name: "JSON", route: `/artifact/${folderID}/data.json`, status: 200 },
        { name: "SVG", route: `/artifact/${folderID}/picture.svg`, status: 200 },
        { name: "redirect to the folder's trailing slash", route: `/artifact/${folderID}`, status: 301 },
        { name: "redirect to a subfolder's trailing slash", route: `/artifact/${folderID}/sub`, status: 301 },
        { name: "missing file", route: `/artifact/${folderID}/missing.html`, status: 404 },
        { name: "missing-file page", route: goneRoute, status: 404 },
        { name: "refused method", method: "POST", route: `/artifact/${folderID}/`, status: 405 },
        { name: "body the server cannot parse", method: "POST", route: `/artifact/${folderID}/`, ...UNPARSABLE_BODY, status: 400 },
        { name: "HEAD", method: "HEAD", route: `/artifact/${folderID}/`, status: 200 },
        {
          name: "304 for an HTML page",
          route: `/artifact/${folderID}/`,
          headers: revalidation(await etagOf(baseURL, `/artifact/${folderID}/`)),
          status: 304,
        },
        {
          name: "304 for a file",
          route: `/artifact/${folderID}/data.json`,
          headers: revalidation(await etagOf(baseURL, `/artifact/${folderID}/data.json`)),
          status: 304,
        },
        {
          name: "304 for rendered Markdown",
          route: markdownRoute,
          headers: revalidation(await etagOf(baseURL, markdownRoute)),
          status: 304,
        },
      ]);
    }
    await expectSandboxed(baseURL, [
      { name: "artifact ID the server cannot decode", route: "/artifact/%E0%A4%A/", status: 400 },
    ]);
  });

  it("is on every active-theme route response", async () => {
    const themed = await startServer({ activeTheme: true });
    await expectSandboxed(themed.baseURL, [
      { name: "active package's stylesheet", route: "/theme/theme.css", status: 200 },
      { name: "script entry", route: "/theme/iframe-background.js", status: 200 },
      { name: "HTML file", route: "/theme/page.html", status: 200 },
      { name: "missing path", route: "/theme/missing.css", status: 404 },
      { name: "refused method", method: "POST", route: "/theme/theme.css", status: 405 },
      { name: "body the server cannot parse", method: "POST", route: "/theme/theme.css", ...UNPARSABLE_BODY, status: 400 },
    ]);

    const unthemed = await startServer({ activeTheme: false });
    await expectSandboxed(unthemed.baseURL, [
      { name: "null theme's empty stylesheet", route: "/theme/theme.css", status: 200 },
    ]);
  });
});
