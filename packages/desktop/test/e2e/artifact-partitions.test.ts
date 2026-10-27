import type { ElectronApplication, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { configureTestMotion } from "../../../web/test/e2e/helpers.ts";
import { createUserDataDir, expectPermanentApplicationShell, launchDesktop } from "./helpers.ts";

// Desktop artifact partitions in the real Electron app against really-running
// servers, with Electron's sessions and the filesystem real
// (proofs/arch/desktop/artifact-partitions.md). Artifacts are authored
// fixtures registered through the production API.

type ArtifactInput =
  | { kind: "path"; title: string; path: string }
  | { kind: "url"; title: string; url: string };

async function createArtifact(product: Pick<ProductServer, "serverURL" | "token">, input: ArtifactInput): Promise<string> {
  const client = new TelevisionClient(product.serverURL, { token: product.token });
  const display = await client.display.get();
  const channelID = display.focusedChannelId ?? (await client.channels.list()).channels[0]!.id;
  const { artifact } = await client.artifacts.create({ channelID, ...input });
  return artifact.id;
}

function artifactPartitionName(serverURL: string, artifactID: string): string {
  const origin = new URL(serverURL).origin;
  return `artifact-${createHash("sha256").update(`${origin}\n${artifactID}`, "utf8").digest("hex").slice(0, 32)}`;
}

interface Guest {
  url: string;
  storagePath: string | null;
  windowSession: boolean;
}

/** Every artifact webview's address and the session it uses. */
async function guests(app: ElectronApplication): Promise<Guest[]> {
  return app.evaluate(({ session, webContents }) => webContents.getAllWebContents()
    .filter((contents) => contents.getType() === "webview")
    .map((contents) => ({
      url: contents.getURL(),
      storagePath: contents.session.getStoragePath(),
      windowSession: contents.session === session.defaultSession,
    })));
}

/** Runs `source` in the webview whose address contains `marker`, playing the artifact's own code; null while there is none. */
async function inWebview(app: ElectronApplication, marker: string, source: string): Promise<unknown> {
  return app.evaluate(async ({ webContents }, { expectedMarker, script }) => {
    const guest = webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker) && !contents.isLoading());
    return guest ? await guest.executeJavaScript(script) : null;
  }, { expectedMarker: marker, script: source });
}

/** A page that keeps the first value it writes to `localStorage` and shows what it found on load. */
function writePersistingFolder(folder: string, extra = ""): string {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "index.html"), `<!doctype html>
    <p id="found"></p>${extra}
    <script>
      const found = localStorage.getItem("partition-probe");
      document.getElementById("found").textContent = found ?? "none";
      if (found === null) localStorage.setItem("partition-probe", "written " + crypto.randomUUID());
    </script>`);
  return `${folder}${path.sep}`;
}

function readRecord(userDataDir: string): unknown {
  return JSON.parse(readFileSync(path.join(userDataDir, "artifact-partitions.json"), "utf8"));
}

interface FixtureSite {
  origin: string;
  close(): Promise<void>;
}

/** A local HTTP server for the pages that are not Television's. */
async function serveFixtureSite(pages: Record<string, string>): Promise<FixtureSite> {
  const server = http.createServer((request, response) => {
    const page = pages[new URL(request.url ?? "/", "http://fixture.invalid").pathname];
    if (page === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function openConnected(product: ProductServer, userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await launchDesktop({
    connectTo: { serverURL: product.serverURL, token: product.token },
    userDataDir,
    env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
  });
  try {
    await expectPermanentApplicationShell(launched.page);
    await configureTestMotion(launched.page);
    return launched;
  } catch (error) {
    await launched.app.close().catch(() => undefined);
    throw error;
  }
}

// spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-sessions-seam
test("places each artifact's webview in its partition and records the server's artifact partitions", async () => {
  const product = await launchProductServer({ auth: true });
  const producer = await launchProductServer({ auth: true });
  const site = await serveFixtureSite({
    "/page.html": "<!doctype html><title>External page</title><p>External page</p>",
    "/linked.html": "<!doctype html><title>Linked page</title><p>Linked page</p>",
  });
  const userDataDir = createUserDataDir("television-partitions-e2e-");
  let app: ElectronApplication | null = null;
  try {
    const folder = writePersistingFolder(path.join(product.home, "folder-fixture"), `<a id="out" href="${site.origin}/linked.html">Out</a>`);
    const markdown = path.join(product.home, "notes.md");
    writeFileSync(markdown, "# Notes\n");
    const sharedSource = writePersistingFolder(path.join(producer.home, "shared-fixture"));
    const sharedID = await createArtifact(producer, { kind: "path", title: "Shared source", path: sharedSource });
    const sharedURL = `${producer.serverURL}/artifact/${sharedID}/`;
    const folderID = await createArtifact(product, { kind: "path", title: "Folder", path: folder });
    const markdownID = await createArtifact(product, { kind: "path", title: "Notes", path: markdown });
    const externalID = await createArtifact(product, { kind: "url", title: "External", url: `${site.origin}/page.html` });
    const sharedArtifactID = await createArtifact(product, { kind: "url", title: "Shared", url: sharedURL });

    let page: Page;
    ({ app, page } = await openConnected(product, userDataDir));
    const partitions = path.join(userDataDir, "Partitions");
    const expected: Array<[string, string, string]> = [
      [folderID, "tv-artifact:" + folderID, path.join(partitions, artifactPartitionName(product.serverURL, folderID))],
      [markdownID, "tv-artifact:" + markdownID, path.join(partitions, artifactPartitionName(product.serverURL, markdownID))],
      [externalID, "tv-url-artifact", path.join(partitions, "url-artifacts")],
      [sharedArtifactID, "tv-url-artifact", path.join(partitions, "url-artifacts")],
    ];
    for (const [id, attribute] of expected) {
      await expect(page.locator(`.stage .page[data-page-key="${id}"] webview.artifact-content`)).toHaveAttribute("partition", attribute, { timeout: 15_000 });
    }
    await expect.poll(async () => (await guests(app!)).filter((guest) => guest.url !== "").length, { timeout: 15_000 }).toBe(4);
    const byURL = (marker: string) => async () => (await guests(app!)).find((guest) => guest.url.includes(marker)) ?? null;
    for (const [marker, storagePath] of [
      [`/artifact/${folderID}/`, expected[0]![2]],
      ["/views/markdown/", expected[1]![2]],
      [`${site.origin}/page.html`, expected[2]![2]],
      [sharedURL, expected[3]![2]],
    ] as const) {
      await expect.poll(byURL(marker), { timeout: 15_000 }).toEqual({ url: expect.stringContaining(marker), storagePath, windowSession: false });
    }
    expect((await guests(app)).every((guest) => !guest.windowSession)).toBe(true);
    expect(readRecord(userDataDir)).toEqual({
      version: 1,
      servers: {
        [new URL(product.serverURL).origin]: {
          [artifactPartitionName(product.serverURL, folderID)]: folderID,
          [artifactPartitionName(product.serverURL, markdownID)]: markdownID,
        },
      },
    });

    // The folder artifact's partition persists across a restart of the app.
    const folderMarker = `/artifact/${folderID}/`;
    await expect.poll(() => inWebview(app!, folderMarker, `document.getElementById("found")?.textContent ?? ""`), { timeout: 15_000 }).toBe("none");
    const written = await inWebview(app, folderMarker, `localStorage.getItem("partition-probe")`);
    expect(written).toMatch(/^written /);
    await app.close();
    ({ app, page } = await openConnected(product, userDataDir));
    await expect.poll(() => inWebview(app!, folderMarker, `document.getElementById("found")?.textContent ?? ""`), { timeout: 15_000 }).toBe(written);

    // Its webview keeps the partition when its document leaves for another site.
    await inWebview(app, folderMarker, `document.getElementById("out").click()`);
    await expect.poll(byURL(`${site.origin}/linked.html`), { timeout: 15_000 })
      .toEqual({ url: `${site.origin}/linked.html`, storagePath: expected[0]![2], windowSession: false });
  } finally {
    await app?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
    await site.close();
    await producer.dispose();
    await product.dispose();
  }
});

// spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-fallback-seam
test("puts webviews named with no partition in the fallback partition, still sandboxed, and refuses unknown partitions", async () => {
  const product = await launchProductServer();
  const userDataDir = createUserDataDir("television-partitions-e2e-");
  let site: FixtureSite | null = null;
  let app: ElectronApplication | null = null;
  try {
    const folder = path.join(product.home, "sandboxed-fixture");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), `<!doctype html><p id="report"></p><script>
      let storage;
      try { localStorage.getItem("x"); storage = "accessible"; } catch (error) { storage = error.name; }
      document.getElementById("report").textContent = JSON.stringify({ origin: String(self.origin), storage });
    </script>`);
    const artifactID = await createArtifact(product, { kind: "path", title: "Sandboxed", path: `${folder}${path.sep}` });
    const artifactURL = `${product.serverURL}/artifact/${artifactID}/`;
    // A stand-in for a served interface without partition support: it names
    // no partition, and one name the main process does not know.
    site = await serveFixtureSite({
      "/stand-in.html": `<!doctype html><title>Stand-in interface</title><body>
        <script>localStorage.setItem("window-sentinel", "kept");</script>
        <webview id="artifact" src="${artifactURL}" style="width:400px;height:200px"></webview>
        <webview id="same-origin" src="/same-origin.html" style="width:400px;height:200px"></webview>
        <webview id="arbitrary" partition="persist:arbitrary" src="/refused.html" style="width:400px;height:200px"></webview>
      </body>`,
      "/same-origin.html": `<!doctype html><p id="report"></p><script>
        const sentinel = localStorage.getItem("window-sentinel");
        localStorage.setItem("fallback-probe", "written");
        document.getElementById("report").textContent = JSON.stringify({ sentinel });
      </script>`,
      "/refused.html": "<!doctype html><p>Refused</p>",
    });
    let page: Page;
    ({ app, page } = await launchDesktop({ fixture: `${site.origin}/stand-in.html`, userDataDir }));
    const fallback = path.join(userDataDir, "Partitions", "webview-fallback");

    await expect.poll(() => inWebview(app!, artifactURL, `document.getElementById("report")?.textContent ?? ""`), { timeout: 15_000 })
      .toBe(JSON.stringify({ origin: "null", storage: "SecurityError" }));
    await expect.poll(() => inWebview(app!, "/same-origin.html", `document.getElementById("report")?.textContent ?? ""`), { timeout: 15_000 })
      .toBe(JSON.stringify({ sentinel: null }));
    const shown = await guests(app);
    const byAddress = (left: Guest, right: Guest) => left.url.localeCompare(right.url);
    expect([...shown].sort(byAddress)).toEqual([
      { url: artifactURL, storagePath: fallback, windowSession: false },
      { url: `${site.origin}/same-origin.html`, storagePath: fallback, windowSession: false },
    ].sort(byAddress));
    expect(await page.evaluate(() => ({
      sentinel: localStorage.getItem("window-sentinel"),
      probe: localStorage.getItem("fallback-probe"),
    }))).toEqual({ sentinel: "kept", probe: null });

    // The refused webview never gets web contents, or a partition on disk.
    expect(shown.some((guest) => guest.url.includes("refused"))).toBe(false);
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter((contents) => contents.getType() === "webview").length)).toBe(2);
    expect(existsSync(path.join(userDataDir, "Partitions", "arbitrary"))).toBe(false);
  } finally {
    await app?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
    await site?.close();
    await product.dispose();
  }
});

// spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-acceptance
test("deletes a deleted artifact's partition at the first reaping after a restart and keeps the others", async () => {
  const product = await launchProductServer({ auth: true });
  const userDataDir = createUserDataDir("television-partitions-e2e-");
  let app: ElectronApplication | null = null;
  const origin = new URL(product.serverURL).origin;
  // A reaping is observed through an entry for a partition of an artifact the
  // server never had, which no webview opens: the first reaping after it is
  // written removes it.
  const seedUnknown = (name: string) => {
    mkdirSync(path.join(userDataDir, "Partitions", name), { recursive: true });
    const file = path.join(userDataDir, "artifact-partitions.json");
    const record: { version: number; servers: Record<string, Record<string, string>> } = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8")) as { version: number; servers: Record<string, Record<string, string>> }
      : { version: 1, servers: {} };
    record.servers[origin] = { ...record.servers[origin], [name]: `never-${name}` };
    writeFileSync(file, JSON.stringify(record));
  };
  const reaped = (name: string) => () => existsSync(path.join(userDataDir, "Partitions", name));
  try {
    const aID = await createArtifact(product, { kind: "path", title: "A", path: writePersistingFolder(path.join(product.home, "a")) });
    const bID = await createArtifact(product, { kind: "path", title: "B", path: writePersistingFolder(path.join(product.home, "b")) });
    const aName = artifactPartitionName(product.serverURL, aID);
    const bName = artifactPartitionName(product.serverURL, bID);
    const aDir = path.join(userDataDir, "Partitions", aName);
    const bDir = path.join(userDataDir, "Partitions", bName);

    seedUnknown("artifact-unknown-1");
    let page: Page;
    ({ app, page } = await openConnected(product, userDataDir));
    await expect.poll(reaped("artifact-unknown-1"), { timeout: 15_000 }).toBe(false);
    for (const id of [aID, bID]) {
      await expect.poll(() => inWebview(app!, `/artifact/${id}/`, `document.getElementById("found")?.textContent ?? ""`), { timeout: 15_000 }).toBe("none");
    }
    const bWritten = await inWebview(app, `/artifact/${bID}/`, `localStorage.getItem("partition-probe")`);
    expect((readRecord(userDataDir) as { servers: Record<string, unknown> }).servers[origin]).toEqual({ [aName]: aID, [bName]: bID });

    // Electron opened A's partition in this run, so a reaping keeps it.
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    await client.artifacts.delete({ artifactID: aID });
    await expect(page.locator(`.stage .page[data-page-key="${aID}"]`)).toHaveCount(0, { timeout: 15_000 });
    seedUnknown("artifact-unknown-2");
    await page.reload();
    await expectPermanentApplicationShell(page);
    await expect.poll(reaped("artifact-unknown-2"), { timeout: 15_000 }).toBe(false);
    expect(existsSync(aDir)).toBe(true);
    expect((readRecord(userDataDir) as { servers: Record<string, unknown> }).servers[origin]).toEqual({ [aName]: aID, [bName]: bID });

    // After a restart, the first reaping deletes it and keeps B.
    await app.close();
    ({ app, page } = await openConnected(product, userDataDir));
    await expect.poll(() => existsSync(aDir), { timeout: 15_000 }).toBe(false);
    expect((readRecord(userDataDir) as { servers: Record<string, unknown> }).servers[origin]).toEqual({ [bName]: bID });
    expect(existsSync(bDir)).toBe(true);
    await expect.poll(() => inWebview(app!, `/artifact/${bID}/`, `document.getElementById("found")?.textContent ?? ""`), { timeout: 15_000 }).toBe(bWritten);
  } finally {
    await app?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
    await product.dispose();
  }
});
