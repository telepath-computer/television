import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "playwright";
import { startHttpsFront, type HttpsFront } from "./helpers/https-front.ts";
import {
  ProductContext,
  artifactFrame,
  browserAvailable,
  createPathArtifact,
  focusedChannel,
  ok,
  openApp,
  share,
  writeArtifactPage,
  type PageWindow,
  type Shot,
} from "./resource-product-harness.ts";

/*
 * Television behind an HTTPS front: a test front terminates TLS at a mapped
 * host name and forwards plain HTTP to the server the built `tv` CLI starts,
 * as `tailscale serve` does. The app and an artifact's pages are opened at the
 * front's https: address in Chromium. Proves
 * [[product/resources/resources.md#^rs-ac-https-front]].
 */

const HOST = "tv-front.test";
const context = new ProductContext();
const fronts: HttpsFront[] = [];

afterEach(async () => {
  for (const front of fronts.splice(0)) await front.close();
  await context.cleanup();
});

/** Retries `check` until it passes, for state that reaches the page or the store asynchronously. */
function eventually(check: () => unknown): Promise<unknown> {
  return vi.waitFor(check, { timeout: 10_000, interval: 50 });
}

async function shots(frame: Frame, name: string): Promise<Shot[]> {
  return frame.evaluate((log) => (window as unknown as PageWindow).logs[log] as Shot[], name);
}

/** Registers a listener on the page's whole value and returns the page's access level. */
function listen(frame: Frame): Promise<unknown> {
  return frame.evaluate(() => {
    const page = window as unknown as PageWindow;
    const root = page.record("root");
    page.sdk.onValue(page.sdk.ref(page.stores.own!), (snapshot) => root.push(page.shot(snapshot)));
    return page.sdk.getAccess();
  });
}

describe("pages behind an HTTPS front", () => {
  it.skipIf(!browserAvailable("chromium"))("uses its artifact's store and a share link's level through a front that terminates TLS", async () => {
    const server = await context.serve(context.temporaryDirectory("television-resource-front-home-"));
    const folder = writeArtifactPage(context, "Front notes", "window.stores = { own: sdk.getStore() };\n");
    const artifactID = await createPathArtifact(server, await focusedChannel(server, "Front notes"), "Front notes", folder);
    const front = await startHttpsFront(HOST, server.port);
    fronts.push(front);
    const frontOrigin = `https://${HOST}:${front.port}`;
    const byArtifact = ["--artifact", artifactID];

    // The app at the front's address shows the artifact in a secure context with the front's origin.
    const browser = await context.launch("chromium", [HOST]);
    const { page } = await openApp(browser, server, HOST, frontOrigin);
    const sockets: string[] = [];
    page.on("websocket", (socket) => sockets.push(socket.url()));
    const frame = await artifactFrame(page, `${frontOrigin}/artifact/${artifactID}/`);
    expect(await frame.evaluate(() => ({ origin: location.origin, secure: isSecureContext }))).toEqual({ origin: frontOrigin, secure: true });

    // The page connects at wss: through the front, works at read-write, and hears the shell.
    expect(await listen(frame)).toBe("read-write");
    expect(sockets).toContain(`wss://${HOST}:${front.port}/artifact-resources/${artifactID}/v1/connection`);
    expect(sockets.filter((url) => url.startsWith("ws:"))).toEqual([]);
    expect(await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.set(page.sdk.ref(page.stores.own!, "note"), "through the front"));
    })).toEqual({ ok: true, value: undefined });
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":true,"value":{"note":"through the front"}}\n'));
    expect(await server.tv(["resource", "json", "set", ...byArtifact, "note", '"from the shell"'])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    await eventually(async () => expect((await shots(frame, "root")).at(-1)).toEqual({ key: null, exists: true, value: { note: "from the shell" }, pending: false }));

    // The share link at read, opened at the front's address, connects at wss: too, hears the value and cannot write.
    const { shareID } = await share(server, artifactID, "read", HOST);
    const shared = await browser.newPage({ ignoreHTTPSErrors: true });
    const sharedSockets: string[] = [];
    shared.on("websocket", (socket) => sharedSockets.push(socket.url()));
    await shared.goto(`${frontOrigin}/artifact/${shareID}/`);
    const sharedFrame = shared.mainFrame();
    await sharedFrame.waitForFunction(() => (window as unknown as { pageReady?: boolean }).pageReady === true);
    expect(await listen(sharedFrame)).toBe("read");
    expect(sharedSockets).toEqual([`wss://${HOST}:${front.port}/artifact-resources/${shareID}/v1/connection`]);
    await eventually(async () => expect((await shots(sharedFrame, "root")).at(-1)).toEqual({ key: null, exists: true, value: { note: "from the shell" }, pending: false }));
    expect(await sharedFrame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.set(page.sdk.ref(page.stores.own!, "note"), "from the share link"));
    })).toMatchObject({ ok: false, isError: true, code: "read-only" });
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":true,"value":{"note":"from the shell"}}\n'));
  });
});
