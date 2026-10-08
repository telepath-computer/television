import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Frame } from "playwright";
import {
  ProductContext,
  artifactFrame,
  artifactURL,
  browserAvailable,
  createPathArtifact,
  focusedChannel,
  ok,
  openApp,
  origin,
  parse,
  share,
  writeArtifactPage,
  type BrowserName,
  type BuiltServer,
  type PageWindow,
  type Shot,
} from "./resource-product-harness.ts";

/*
 * An artifact's page using its own store, as people use Television: the
 * built `tv` CLI and the server it starts, with the bindings flag off as
 * shipped, and the app in a real browser at a mapped plain-HTTP host name,
 * showing an authored artifact that imports the SDK as that server serves
 * it. Proves
 * [[product/resources/resources.md#^rs-ac-page-spine]],
 * [[product/resources/json-store.md#^js-ac-page-spine]] and
 * [[product/resources/json-store.md#^js-ac-local-writes]].
 */

const HOST = "tv-page.test";
const context = new ProductContext();

afterEach(async () => {
  await context.cleanup();
});

/** A served home, a focused channel, and an authored page registered on it with the built CLI. */
async function pageOnServer(title: string, script: string): Promise<{ server: BuiltServer; artifactID: string; source: string }> {
  const server = await context.serve(context.temporaryDirectory("television-resource-page-home-"));
  const folder = writeArtifactPage(context, title, script);
  const channelID = await focusedChannel(server, title);
  const artifactID = await createPathArtifact(server, channelID, title, folder);
  return { server, artifactID, source: readFileSync(path.join(folder, "index.html"), "utf8") };
}

/** Opens the app at the mapped host name and returns the artifact's frame, which runs outside a secure context. */
async function showArtifact(browserName: BrowserName, server: BuiltServer, artifactID: string): Promise<Frame> {
  const browser = await context.launch(browserName, [HOST]);
  const { page } = await openApp(browser, server, HOST);
  const frame = await artifactFrame(page, artifactURL(server, HOST, artifactID));
  expect(await frame.evaluate(() => ({ origin: location.origin, secure: isSecureContext }))).toEqual({ origin: origin(server, HOST), secure: false });
  // A marker the document keeps until it is replaced, so a later check can tell that nothing reloaded it.
  await frame.evaluate(() => { (window as unknown as { loadMarker: string }).loadMarker = "first load"; });
  return frame;
}

/** Retries `check` until it passes, for state that reaches the page or the store asynchronously. */
function eventually(check: () => unknown): Promise<unknown> {
  return vi.waitFor(check, { timeout: 10_000, interval: 50 });
}

async function sameDocument(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => (window as unknown as { loadMarker?: string }).loadMarker === "first load");
}

async function shots(frame: Frame, name: string): Promise<Shot[]> {
  return frame.evaluate((log) => (window as unknown as PageWindow).logs[log] as Shot[], name);
}

async function logged(frame: Frame, name: string): Promise<unknown[]> {
  return frame.evaluate((log) => (window as unknown as PageWindow).logs[log]!, name);
}

/** An artifact's record, as `tv get-artifact` prints it. */
async function record(server: BuiltServer, artifactID: string): Promise<Record<string, unknown>> {
  return (parse(await server.tv(["get-artifact", "--id", artifactID])) as { artifact: Record<string, unknown> }).artifact;
}

describe.each(["chromium", "firefox"] as const)("a page uses its artifact's store (%s)", (browserName) => {
  it.skipIf(!browserAvailable(browserName))("uses its artifact's store before and after the first write, hears shell changes, and finds stores by resource ID not enabled", async () => {
    const { server, artifactID, source } = await pageOnServer("Page notes", `
window.stores = { own: sdk.getStore() };
`);
    // The source calls getStore() and carries no artifact ID or token.
    expect(source).toContain("sdk.getStore()");
    expect(source).not.toContain(artifactID);
    expect(server.token).not.toBeNull();
    expect(source).not.toContain(server.token!);
    const byArtifact = ["--artifact", artifactID];
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":false}\n'));
    expect(await record(server, artifactID)).not.toHaveProperty("store");

    const frame = await showArtifact(browserName, server, artifactID);
    const level = await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      const { sdk } = page;
      const root = page.record("root");
      const access = page.record("access");
      const events = page.record("events");
      sdk.onValue(sdk.ref(page.stores.own!), (snapshot) => root.push(page.shot(snapshot)));
      sdk.onAccessChanged((current) => access.push(current));
      sdk.onResourcesChanged((event) => events.push(event));
      return sdk.getAccess();
    });
    expect(level).toBe("read-write");
    const noValue = { key: null, exists: false, pending: false };
    await eventually(async () => {
      expect(await logged(frame, "access")).toEqual(["read-write"]);
      expect(await shots(frame, "root")).toEqual([noValue]);
    });

    // The first write: the listener hears it at once and confirmed, and for no other reason.
    expect(await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.set(page.sdk.ref(page.stores.own!, "note"), "from the page"));
    })).toEqual({ ok: true, value: undefined });
    await eventually(async () => expect(await shots(frame, "root")).toEqual([
      noValue,
      { key: null, exists: true, value: { note: "from the page" }, pending: true },
      { key: null, exists: true, value: { note: "from the page" }, pending: false },
    ]));
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":true,"value":{"note":"from the page"}}\n'));

    // A change from the shell reaches the page without a reload, with a changed event that names no store and no artifact.
    expect(await server.tv(["resource", "json", "set", ...byArtifact, "note", '"from the shell"'])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    await eventually(async () => {
      expect((await shots(frame, "root")).at(-1)).toEqual({ key: null, exists: true, value: { note: "from the shell" }, pending: false });
      expect(await logged(frame, "events")).toEqual([{ event: "changed", paths: ["note"] }, { event: "changed", paths: ["note"] }]);
    });
    expect((await shots(frame, "root")).length).toBe(4);
    expect(await sameDocument(frame)).toBe(true);

    // With the flag off, a handle by the store's own resource ID is not enabled, while the artifact's store keeps working.
    const resourceID = (await record(server, artifactID)).store;
    expect(typeof resourceID).toBe("string");
    const handles = await frame.evaluate(async (id) => {
      const page = window as unknown as PageWindow;
      const { sdk } = page;
      return {
        byID: await page.outcome(() => sdk.get(sdk.ref(sdk.getStore(id), "note"))),
        own: await page.outcome(async () => (await sdk.get(sdk.ref(page.stores.own!, "note"))).val()),
      };
    }, resourceID as string);
    expect(handles.byID).toMatchObject({ ok: false, isError: true, code: "not-enabled" });
    expect(handles.own).toEqual({ ok: true, value: "from the shell" });
  });
});

describe("a page and an agent share a store", () => {
  it("uses the store's functions on plain JSON, sees shell changes live, and keeps the data across a restart", async () => {
    const { server, artifactID } = await pageOnServer("Household", `
window.stores = { household: sdk.getStore() };
`);
    const byArtifact = ["--artifact", artifactID];
    expect(await server.tv(["resource", "json", "set", ...byArtifact, '{"items":{}}'])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    const get = async (pathArgument: string) => (await server.tv(["resource", "json", "get", ...byArtifact, pathArgument])).stdout;

    const frame = await showArtifact("chromium", server, artifactID);
    await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      const { sdk } = page;
      const items = sdk.ref(page.stores.household!, "items");
      const values = page.record("items");
      const added = page.record("added");
      sdk.onValue(items, (snapshot) => values.push(page.shot(snapshot)));
      sdk.onChildAdded(items, (snapshot) => added.push(snapshot.key));
    });
    await eventually(async () => expect((await shots(frame, "items")).length).toBeGreaterThan(0));
    expect((await shots(frame, "items"))[0]).toEqual({ key: "items", exists: true, value: {}, pending: false });

    const pushed = await frame.evaluate(async () => {
      const page = window as unknown as PageWindow;
      const { sdk } = page;
      const items = sdk.ref(page.stores.household!, "items");
      const first = sdk.push(items, { title: "Buy milk", done: false });
      const second = sdk.push(items, { title: "Walk the dog", done: false });
      // The keys exist when push returns, before either write is confirmed.
      const keys = [first.key, second.key];
      const confirmed = await page.outcome(() => Promise.all([first, second]));
      return { keys, confirmed };
    });
    const [first, second] = pushed.keys as [string, string];
    expect(pushed.confirmed.ok).toBe(true);
    expect(typeof first).toBe("string");
    expect([first, second].sort()).toEqual([first, second]);
    expect(await frame.evaluate(() => (window as unknown as PageWindow).logs.added)).toEqual([first, second]);
    expect(JSON.parse(await get("items"))).toEqual({
      exists: true,
      value: { [first]: { title: "Buy milk", done: false }, [second]: { title: "Walk the dog", done: false } },
    });

    const before = Date.now();
    const writes = await frame.evaluate(async (firstKey) => {
      const page = window as unknown as PageWindow;
      const { sdk } = page;
      const store = page.stores.household!;
      const run = (write: () => Promise<unknown>) => page.outcome(write);
      return {
        update: await run(() => sdk.update(sdk.ref(store), { [`items/${firstKey}/done`]: true, "meta/title": "Chores" })),
        transaction: await run(async () => {
          const result = await sdk.runTransaction(sdk.ref(store, "counter"), (count) => (typeof count === "number" ? count : 0) + 1);
          return { committed: result.committed, value: result.snapshot.val() };
        }),
        visits: await run(() => sdk.set(sdk.ref(store, "stats/visits"), 3)),
        stats: await run(() => sdk.set(sdk.ref(store, "stats"), { savedAt: sdk.serverTimestamp(), visits: sdk.increment(2) })),
        array: await run(() => sdk.set(sdk.ref(store, "tags"), ["home", "weekly"])),
        arrayRead: await run(async () => {
          const tags = (await sdk.get(sdk.ref(store, "tags"))).val();
          return { isArray: Array.isArray(tags), tags };
        }),
      };
    }, first);
    const after = Date.now();
    expect(writes).toEqual({
      update: { ok: true, value: undefined },
      transaction: { ok: true, value: { committed: true, value: 1 } },
      visits: { ok: true, value: undefined },
      stats: { ok: true, value: undefined },
      array: { ok: true, value: undefined },
      arrayRead: { ok: true, value: { isArray: true, tags: ["home", "weekly"] } },
    });
    expect(JSON.parse(await get(`items/${first}/done`))).toEqual({ exists: true, value: true });
    expect(JSON.parse(await get("meta"))).toEqual({ exists: true, value: { title: "Chores" } });
    expect(JSON.parse(await get("counter"))).toEqual({ exists: true, value: 1 });
    const stats = JSON.parse(await get("stats")) as { value: { savedAt: number; visits: number } };
    expect(stats.value.visits).toBe(5);
    // The server and the test share a clock; the timestamp falls within the write.
    expect(stats.value.savedAt).toBeGreaterThanOrEqual(before);
    expect(stats.value.savedAt).toBeLessThanOrEqual(after);
    expect(await get("tags")).toBe('{"exists":true,"value":["home","weekly"]}\n');

    expect(await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.set(page.sdk.ref(page.stores.household!, "meta/title"), null));
    })).toEqual({ ok: true, value: undefined });
    expect(await get("meta/title")).toBe('{"exists":true,"value":null}\n');
    expect(await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.remove(page.sdk.ref(page.stores.household!, "meta")));
    })).toEqual({ ok: true, value: undefined });
    expect(await get("meta")).toBe('{"exists":false}\n');

    expect(await server.tv(["resource", "json", "set", ...byArtifact, "items/from-shell", '{"title":"Water the plants","done":false}'])).toEqual(
      ok(`JSON store of artifact ${artifactID} updated.\n`),
    );
    await eventually(async () => expect((await shots(frame, "items")).at(-1)?.value).toEqual({
      [first]: { title: "Buy milk", done: true },
      [second]: { title: "Walk the dog", done: false },
      "from-shell": { title: "Water the plants", done: false },
    }));
    expect(await sameDocument(frame)).toBe(true);

    const whole = (await server.tv(["resource", "json", "get", ...byArtifact])).stdout;
    await server.stop();
    const restarted = await context.serve(server.home);
    expect(await restarted.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok(whole));
  });
});

describe("a page sees its own writes", () => {
  it("shows a write at once as pending, clears pending on confirmation, and refuses a write through read access without showing it", async () => {
    const { server, artifactID } = await pageOnServer("Draft", `
window.stores = { draft: sdk.getStore() };
`);
    const byArtifact = ["--artifact", artifactID];
    expect((await server.tv(["resource", "json", "set", ...byArtifact, '{"text":"first"}'])).exitCode).toBe(0);
    const { link } = await share(server, artifactID, "read-write", HOST);

    // The page opened through its share link, in a browser that holds no token.
    const browser = await context.launch("chromium", [HOST]);
    const opened = await browser.newPage();
    await opened.goto(link);
    await opened.waitForFunction(() => (window as unknown as PageWindow).pageReady === true);
    const frame = opened.mainFrame();
    await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      const text = page.record("text");
      const access = page.record("access");
      page.sdk.onValue(page.sdk.ref(page.stores.draft!, "text"), (snapshot) => text.push(page.shot(snapshot)));
      page.sdk.onAccessChanged((current) => access.push(current));
    });
    await eventually(async () => {
      expect(await shots(frame, "text")).toEqual([{ key: "text", exists: true, value: "first", pending: false }]);
      expect(await logged(frame, "access")).toEqual(["read-write"]);
    });

    const shown = await frame.evaluate(async () => {
      const page = window as unknown as PageWindow;
      const written = page.sdk.set(page.sdk.ref(page.stores.draft!, "text"), "second");
      // What the listener had heard when set() returned, before any answer from the server.
      const atOnce = [...page.logs.text!];
      const result = await page.outcome(() => written);
      return { atOnce, result };
    });
    expect(shown.atOnce).toEqual([
      { key: "text", exists: true, value: "first", pending: false },
      { key: "text", exists: true, value: "second", pending: true },
    ]);
    expect(shown.result).toEqual({ ok: true, value: undefined });
    await eventually(async () => expect(await shots(frame, "text")).toEqual([
      ...shown.atOnce,
      { key: "text", exists: true, value: "second", pending: false },
    ]));
    expect(await server.tv(["resource", "json", "get", ...byArtifact, "text"])).toEqual(ok('{"exists":true,"value":"second"}\n'));

    // The link's level changes to read while the page stays open.
    await share(server, artifactID, "read", HOST);
    await eventually(async () => expect(await logged(frame, "access")).toEqual(["read-write", "read"]));
    const heardBefore = (await shots(frame, "text")).length;
    const refused = await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.set(page.sdk.ref(page.stores.draft!, "text"), "third"));
    });
    expect(refused).toMatchObject({ ok: false, isError: true, code: "read-only" });
    expect((await shots(frame, "text")).length).toBe(heardBefore);
    expect((await shots(frame, "text")).map((shot) => shot.value)).not.toContain("third");
    expect(await server.tv(["resource", "json", "get", ...byArtifact, "text"])).toEqual(ok('{"exists":true,"value":"second"}\n'));
  });
});
