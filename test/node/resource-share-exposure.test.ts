import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { ProductContext, createPathArtifact, focusedChannel, ok, parse, share, type BuiltServer } from "./resource-product-harness.ts";

/*
 * A share viewer never sees the artifact's ID, through the built product: the
 * server `tv serve` starts, the built CLI, and a real browser context that
 * holds no token, at a mapped plain-HTTP host name. The shared artifacts are
 * stored as people store them, in a folder and a file named for their IDs,
 * so that anything built from a name on disk would carry the ID. The walk
 * records everything the viewer receives and finds the ID in none of it.
 * Proves [[product/resources/resources.md#^rs-ac-share-hides-id]].
 */

const HOST = "tv-exposure.test";
const context = new ProductContext();

afterEach(async () => {
  await context.cleanup();
});

function eventually(check: () => unknown): Promise<unknown> {
  return vi.waitFor(check, { timeout: 10_000, interval: 50 });
}

/** A page that imports the SDK, runs `script` as a module with `sdk` and `log` in scope, and then sets `pageReady`. */
function sdkPage(title: string, script: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<h1>${title}</h1>
<script type="module">
import * as sdk from "/sdk/v1/resources.js";
window.sdk = sdk;
window.logs = {};
const log = (name, value) => (window.logs[name] ??= []).push(value);
const failure = (error) => ({ code: error.code, message: error.message });
${script}
window.pageReady = true;
</script>
`;
}

/** The shared folder's page: it uses its store in every way a page can, and loads a missing file and a subfolder by relative links. */
const FOLDER_PAGE = sdkPage("Shared folder", `
const store = sdk.getStore();
const note = sdk.ref(store, "note");
log("read", (await sdk.get(note)).val());
log("access", await sdk.getAccess());
sdk.onAccessChanged((access) => log("accessChanged", access));
sdk.onValue(sdk.ref(store), (snapshot) => log("value", snapshot.val()), (error) => log("valueError", failure(error)));
sdk.onResourcesChanged((event) => log("event", event));
log("write", await sdk.set(note, "from a read page").then(() => "ok", failure));
for (const relative of ["missing.html", "sub", "sub/"]) {
  const response = await fetch(relative);
  log("fetch", { url: response.url, status: response.status, redirected: response.redirected, text: await response.text() });
}
window.writeNow = (value) => sdk.set(note, value).then(() => "ok", failure);
`);

/** The shared single file's page: it reads its store and its level. */
const FILE_PAGE = sdkPage("Shared file", `
const store = sdk.getStore();
log("read", (await sdk.get(sdk.ref(store))).val());
log("access", await sdk.getAccess());
`);

/** Registers `draft`, then moves it to `named`, a name containing the artifact's ID, and repoints the artifact there. */
async function storedUnderItsID(server: BuiltServer, channelID: string, title: string, draft: string, named: (id: string) => string): Promise<{ id: string; location: string }> {
  const id = await createPathArtifact(server, channelID, title, draft);
  const location = named(id);
  renameSync(draft, location);
  const moved = await server.tv(["update-artifact", "--id", id, "--path", location]);
  expect(moved.exitCode, moved.stderr).toBe(0);
  return { id, location };
}

/** Records every page address, request, response with its status, headers and body, WebSocket message, console message and page error. */
function record(page: Page, recording: string[], pending: Array<Promise<void>>): void {
  page.on("framenavigated", (frame) => recording.push(`page ${frame.url()}`));
  page.on("request", (request) => {
    recording.push(`request ${request.method()} ${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ""}`);
  });
  page.on("response", (response) => {
    pending.push((async () => {
      const headers = await response.allHeaders();
      // A redirect's body is not available to the browser; its status and headers are recorded.
      const body = await response.body().then((bytes) => bytes.toString("utf8"), () => "");
      recording.push(`response ${response.status()} ${response.url()} ${JSON.stringify(headers)} ${body}`);
    })());
  });
  page.on("websocket", (socket) => {
    recording.push(`websocket ${socket.url()}`);
    socket.on("framesent", (frame) => recording.push(`sent ${String(frame.payload)}`));
    socket.on("framereceived", (frame) => recording.push(`received ${String(frame.payload)}`));
  });
  page.on("console", (message) => recording.push(`console ${message.text()}`));
  page.on("pageerror", (error) => recording.push(`pageerror ${error.message}`));
}

describe("a share viewer and the artifact's ID", () => {
  it("a share viewer receives nothing that carries the artifact's ID", async () => {
    const server = await context.serve(context.temporaryDirectory("television-exposure-home-"));
    const channelID = await focusedChannel(server, "Shared");
    const base = context.temporaryDirectory("television-exposure-");

    const draftFolder = path.join(base, "draft-folder");
    mkdirSync(path.join(draftFolder, "sub"), { recursive: true });
    writeFileSync(path.join(draftFolder, "index.html"), FOLDER_PAGE);
    writeFileSync(path.join(draftFolder, "sub", "index.html"), "<!doctype html><title>Subfolder</title><h1>Subfolder</h1>");
    const folder = await storedUnderItsID(server, channelID, "Shared folder", draftFolder, (id) => path.join(base, id));
    const draftFile = path.join(base, "draft-page.html");
    writeFileSync(draftFile, FILE_PAGE);
    const file = await storedUnderItsID(server, channelID, "Shared file", draftFile, (id) => path.join(base, `${id}.html`));
    expect(path.basename(folder.location)).toBe(folder.id);
    expect(path.basename(file.location)).toBe(`${file.id}.html`);
    const ids = [folder.id, file.id];

    for (const artifact of [folder, file]) {
      expect((await server.tv(["resource", "json", "set", "--artifact", artifact.id, '{"note":"start"}'])).exitCode).toBe(0);
    }
    const folderShare = await share(server, folder.id, "read", HOST);
    const fileShare = await share(server, file.id, "read", HOST);

    // The viewer's browser holds no token.
    const browser = await context.launch("chromium", [HOST]);
    const viewer = await browser.newContext();
    const recording: string[] = [];
    const pending: Array<Promise<void>> = [];

    // The folder's link without its trailing slash first.
    const folderPage = await viewer.newPage();
    record(folderPage, recording, pending);
    await folderPage.goto(folderShare.link.replace(/\/$/, ""));
    expect(folderPage.url()).toBe(folderShare.link);
    await folderPage.waitForFunction(() => (window as unknown as { pageReady?: boolean }).pageReady === true);
    const logs = () => folderPage.evaluate(() => (window as unknown as { logs: Record<string, unknown[]> }).logs);
    await eventually(async () => expect((await logs()).fetch).toHaveLength(3));

    // Meanwhile the shell writes, describes the store with the artifact's ID, and opens the link to writing.
    expect(await server.tv(["resource", "json", "set", "--artifact", folder.id, "note", '"from the shell"'])).toEqual(ok(`JSON store of artifact ${folder.id} updated.\n`));
    const resourceID = (parse(await server.tv(["get-artifact", "--id", folder.id])) as { artifact: { store: string } }).artifact.store;
    const described = await server.tv(["resource", "describe", resourceID, `Notes of artifact ${folder.id}`, "--usage", `Written for artifact ${folder.id}.\nThe page reads note.`]);
    expect(described.exitCode, described.stderr).toBe(0);
    await share(server, folder.id, "read-write", HOST);
    await eventually(async () => expect((await logs()).accessChanged).toEqual(["read", "read-write"]));
    expect(await folderPage.evaluate(() => (window as unknown as { writeNow(value: string): Promise<unknown> }).writeNow("after the change"))).toBe("ok");
    await eventually(async () => expect((await logs()).value?.at(-1)).toEqual({ note: "after the change" }));

    const filePage = await viewer.newPage();
    record(filePage, recording, pending);
    await filePage.goto(fileShare.link);
    await filePage.waitForFunction(() => (window as unknown as { pageReady?: boolean }).pageReady === true);

    // The redirect to the trailing slash, as a client that does not follow it receives it. The host
    // name is mapped only in the browser, so this request goes to the loopback address.
    const redirect = await fetch(`http://127.0.0.1:${server.port}/artifact/${folderShare.shareID}`, { redirect: "manual" });
    recording.push(`fetched ${redirect.status} ${JSON.stringify([...redirect.headers])} ${await redirect.text()}`);

    const folderLogs = await logs();
    const fileLogs = await filePage.evaluate(() => (window as unknown as { logs: Record<string, unknown[]> }).logs);
    recording.push(`folder logs ${JSON.stringify(folderLogs)}`, `file logs ${JSON.stringify(fileLogs)}`);
    await Promise.all(pending);

    // What the page received, so that the recording is known to hold each case the walk claims.
    expect(folderLogs.read).toEqual(["start"]);
    expect(folderLogs.access).toEqual(["read"]);
    expect(folderLogs.write).toEqual([{ code: "read-only", message: expect.any(String) }]);
    expect(folderLogs.event).toContainEqual({ event: "changed", paths: ["note"] });
    expect(folderLogs.fetch).toEqual([
      { url: `${folderShare.link}missing.html`, status: 404, redirected: false, text: expect.any(String) },
      { url: `${folderShare.link}sub/`, status: 200, redirected: true, text: expect.stringContaining("Subfolder") },
      { url: `${folderShare.link}sub/`, status: 200, redirected: false, text: expect.stringContaining("Subfolder") },
    ]);
    expect(fileLogs).toEqual({ read: [{ note: "start" }], access: ["read"] });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe(`/artifact/${folderShare.shareID}/`);
    const seen = recording.join("\n");
    expect(seen).toMatch(/^response 301 [^\n]*\/artifact\/[^/\s]+ /m);
    expect(seen).toMatch(/^response 301 [^\n]*\/sub /m);
    expect(seen).toMatch(/^response 404 [^\n]*\/missing\.html /m);
    expect(seen).toContain(`response 200 ${fileShare.link} `);
    expect(seen).toMatch(/^received \{"type":"open"/m);
    expect(seen).toMatch(/^received \{"type":"access"/m);
    expect(seen).toMatch(/^received \{"type":"event","event":\{"event":"changed"/m);

    for (const id of ids) {
      const carrying = recording.filter((entry) => entry.includes(id));
      expect(carrying, `entries carrying ${id}`).toEqual([]);
    }
  });
});
