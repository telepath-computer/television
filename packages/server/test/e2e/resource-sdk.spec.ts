import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { PageEvent, ResourceInfo } from "@telepath-computer/television-shared/resources";
import {
  MAPPED_HOST_LAUNCH,
  SdkTestContext,
  TEST_HOST,
  artifactPath,
  openPage,
  pageURL,
  pageWaitFor,
  serverPort,
  sleep,
  type Outcome,
} from "./resource-sdk-harness.ts";

test.use({ launchOptions: MAPPED_HOST_LAUNCH });

const context = new SdkTestContext();
test.afterEach(() => context.cleanup());

/** How long to wait for traffic a test expects not to happen. */
const QUIET_MS = 300;

/** A resource ID that names no store on the server. */
const UNKNOWN_RESOURCE = "01J0000000000000000000NONE";

function refusedWith(code: string): Outcome {
  return { ok: false, isError: true, code, message: expect.any(String) as unknown as string };
}

const succeeded: Outcome = { ok: true, value: undefined };

/** The URLs of the WebSockets a page opens, as the browser reports them. */
function webSocketURLs(page: Page): string[] {
  const urls: string[] = [];
  page.on("websocket", (socket) => urls.push(socket.url()));
  return urls;
}

function byResourceID(infos: ResourceInfo[]): ResourceInfo[] {
  return [...infos].sort((left, right) => (left.resourceID < right.resourceID ? -1 : left.resourceID > right.resourceID ? 1 : 0));
}

// spec: proofs/arch/resources/sdk.md#^sdk-t-artifact-id
test.describe("finding the artifact", () => {
  test("reads and writes its own artifact's store at the level its address carries, from the folder, its index.html, a subfolder page and the share link, over ws: at the page's host", async ({ page }) => {
    const server = await context.start();
    const mine = await context.pageWithStore(server, { n: 0 }, "Mine");
    const other = await context.pageWithStore(server, { n: 100 }, "Other");
    const shareID = await server.sharedAt(mine.artifactID, "read");
    const port = serverPort(server);
    const sockets = webSocketURLs(page);
    const use = () =>
      page.evaluate(async () => {
        // Held open across the calls, so each page uses one connection.
        const stop = window.sdk.onConnectionStatusChanged(() => undefined);
        const n = window.sdk.ref(window.sdk.getStore(), "n");
        const before = (await window.sdk.get(n)).val();
        const access = await window.sdk.getAccess();
        const written = await window.outcome(() => window.sdk.set(n, window.sdk.increment(1)));
        stop();
        return { before, access, written };
      });

    let expected = 0;
    for (const rest of ["", "index.html", "sub/page.html"]) {
      await openPage(page, pageURL(port, artifactPath(mine.artifactID, rest)));
      expect(await use(), rest).toEqual({ before: expected, access: "read-write", written: succeeded });
      expected += 1;
    }
    await openPage(page, pageURL(port, artifactPath(shareID)));
    expect(await use()).toEqual({ before: expected, access: "read", written: refusedWith("read-only") });
    await openPage(page, pageURL(port, artifactPath(other.artifactID, "sub/page.html")));
    expect(await use()).toEqual({ before: 100, access: "read-write", written: succeeded });
    expect((await server.jsonGet({ artifactID: mine.artifactID }, "n")).body).toEqual({ exists: true, value: 3 });

    const connection = (id: string) => `ws://${TEST_HOST}:${port}/artifact-resources/${id}/v1/connection`;
    expect(sockets).toEqual([...Array(3).fill(connection(mine.artifactID)), connection(shareID), connection(other.artifactID)]);
  });

  test("fails every function it exports with not-artifact-page on a page of another form", async ({ page }) => {
    const server = await context.start({ staticDir: context.staticPageFolder() });
    await openPage(page, pageURL(serverPort(server), "/plain.html"));
    const outcomes = await page.evaluate(async (resourceID) => {
      const sdk = window.sdk;
      // No handle or reference can be made here, so the store functions get stand-ins.
      const store = { resourceID: null } as ReturnType<typeof sdk.getStore>;
      const at = { key: "a", parent: null, path: "a" } as unknown as ReturnType<typeof sdk.ref>;
      const calls: Record<string, () => unknown> = {
        getAccess: () => sdk.getAccess(),
        onAccessChanged: () => sdk.onAccessChanged(() => undefined),
        listResources: () => sdk.listResources(),
        getResourceInfo: () => sdk.getResourceInfo(resourceID),
        onResourcesChanged: () => sdk.onResourcesChanged(() => undefined),
        getConnectionStatus: () => sdk.getConnectionStatus(),
        onConnectionStatusChanged: () => sdk.onConnectionStatusChanged(() => undefined),
        getStore: () => sdk.getStore(),
        ref: () => sdk.ref(store, "a"),
        child: () => sdk.child(at, "b"),
        onValue: () => sdk.onValue(at, () => undefined),
        onChildAdded: () => sdk.onChildAdded(at, () => undefined),
        onChildChanged: () => sdk.onChildChanged(at, () => undefined),
        onChildRemoved: () => sdk.onChildRemoved(at, () => undefined),
        get: () => sdk.get(at),
        set: () => sdk.set(at, 1),
        update: () => sdk.update(at, { b: 1 }),
        push: () => sdk.push(at, 1),
        remove: () => sdk.remove(at),
        runTransaction: () => sdk.runTransaction(at, () => 1),
        serverTimestamp: () => sdk.serverTimestamp(),
        increment: () => sdk.increment(1),
        deleteValue: () => sdk.deleteValue(),
      };
      const exported = Object.keys(sdk).filter((name) => typeof (sdk as unknown as Record<string, unknown>)[name] === "function");
      const results: Record<string, unknown> = {};
      for (const name of Object.keys(calls)) results[name] = await window.outcome(calls[name]!);
      const handle = await window.outcome(() => sdk.getStore(resourceID));
      return { exported: exported.sort(), called: Object.keys(calls).sort(), results, handle };
    }, UNKNOWN_RESOURCE);
    expect(outcomes.exported).toEqual(outcomes.called);
    expect(outcomes.results).toEqual(Object.fromEntries(outcomes.called.map((name) => [name, refusedWith("not-artifact-page")])));
    expect(outcomes.handle).toEqual(refusedWith("not-artifact-page"));
  });
});

// spec: proofs/arch/resources/sdk.md#^sdk-t-layer
test.describe("the layer's functions", () => {
  test("getAccess resolves with the level the address carries, and onAccessChanged hears it, then each change of the link's level, and nothing after its Unsubscribe", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const port = serverPort(server);
    await openPage(page, pageURL(port, artifactPath(artifactID)));
    expect(await page.evaluate(() => window.sdk.getAccess())).toBe("read-write");

    const shareID = await server.sharedAt(artifactID, "read");
    await openPage(page, pageURL(port, artifactPath(shareID)));
    expect(await page.evaluate(() => window.sdk.getAccess())).toBe("read");
    await page.evaluate(() => {
      const heard = window.record("heard");
      const stopped = window.record("stopped");
      window.sdk.onAccessChanged((access) => heard.push(access));
      (window as unknown as { stop: () => void }).stop = window.sdk.onAccessChanged((access) => stopped.push(access));
    });
    await pageWaitFor(page, () => window.logs.heard!.length === 1 && window.logs.stopped!.length === 1);
    expect((await server.share(artifactID, "read-write")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.heard!.length === 2);
    await page.evaluate(() => (window as unknown as { stop: () => void }).stop());
    expect((await server.share(artifactID, "read")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.heard!.length === 3);
    expect(await page.evaluate(() => window.sdk.getAccess())).toBe("read");
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs)).toEqual({ heard: ["read", "read-write", "read"], stopped: ["read", "read-write"] });
  });

  test("onAccessChanged hears null on a page whose artifact has no store, and, as a page's only use of the SDK, once its share link is revoked, after which getAccess rejects with no-store", async ({ page }) => {
    const server = await context.start();
    const port = serverPort(server);
    const storeless = context.createPageArtifact(server, "No store", { id: "page-without-a-store" });
    await openPage(page, pageURL(port, artifactPath(storeless)));
    expect(await page.evaluate(() => window.outcome(() => window.sdk.getAccess()))).toEqual(refusedWith("no-store"));
    await page.evaluate(() => {
      const heard = window.record("heard");
      window.sdk.onAccessChanged((access) => heard.push(access));
    });
    await pageWaitFor(page, () => window.logs.heard!.length === 1);
    expect(await page.evaluate(() => window.logs.heard)).toEqual([null]);

    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const shareID = await server.sharedAt(artifactID, "read-write");
    await openPage(page, pageURL(port, artifactPath(shareID)));
    await page.evaluate(() => {
      const heard = window.record("heard");
      window.sdk.onAccessChanged((access) => heard.push(access));
    });
    await pageWaitFor(page, () => window.logs.heard!.length === 1);
    expect((await server.unshare(artifactID)).status).toBe(200);
    await pageWaitFor(page, () => window.logs.heard!.length === 2);
    expect(await page.evaluate(() => window.logs.heard)).toEqual(["read-write", null]);
    expect(await page.evaluate(() => window.outcome(() => window.sdk.getAccess()))).toEqual(refusedWith("no-store"));
  });

  test("with the bindings hook, keep the level null on a page opened through a share link to an artifact that has no store when the link's level changes: onAccessChanged hears nothing more and getAccess still rejects with no-store", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const storeless = context.createPageArtifact(server, "No store", { id: "page-without-a-store" });
    const bound = await server.createdStore({ value: { n: 0 } });
    await server.bind(bound, storeless, "read-write");
    const shareID = await server.sharedAt(storeless, "read");
    await openPage(page, pageURL(serverPort(server), artifactPath(shareID)));
    await page.evaluate(() => {
      const heard = window.record("heard");
      const events = window.record("events");
      window.sdk.onAccessChanged((access) => heard.push(access));
      window.sdk.onResourcesChanged((event) => events.push(event));
    });
    await pageWaitFor(page, () => window.logs.heard!.length === 1);

    // The bound event follows the server's change of access, so once the page has it, it has the change.
    expect((await server.share(storeless, "read-write")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.events!.length === 1);
    expect(await page.evaluate(() => window.logs)).toEqual({ heard: [null], events: [{ event: "bound", resourceID: bound, access: "read-write" }] });
    expect(await page.evaluate(() => window.outcome(() => window.sdk.getAccess()))).toEqual(refusedWith("no-store"));
    expect(await page.evaluate(() => window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(), "n"))))).toEqual(refusedWith("no-store"));
  });

  test("deliver changed for the artifact's store, without a resource ID, to onResourcesChanged until its Unsubscribe is called", async ({ page }) => {
    const server = await context.start();
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(async () => {
      const stopped = window.record("stopped");
      const kept = window.record("kept");
      (window as unknown as { stop: () => void }).stop = window.sdk.onResourcesChanged((event) => stopped.push(event));
      window.sdk.onResourcesChanged((event) => kept.push(event));
      await window.sdk.getAccess();
    });
    await server.describe(resourceID, { description: "Chores" });
    await server.jsonSet({ artifactID }, "n", 1);
    await pageWaitFor(page, () => window.logs.kept!.length === 1);
    await page.evaluate(() => (window as unknown as { stop: () => void }).stop());
    await server.jsonSet({ artifactID }, "n", 2);
    await pageWaitFor(page, () => window.logs.kept!.length === 2);

    const logs = (await page.evaluate(() => window.logs)) as Record<string, PageEvent[]>;
    expect(logs.kept).toEqual([
      { event: "changed", paths: ["n"] },
      { event: "changed", paths: ["n"] },
    ]);
    expect(logs.stopped).toEqual(logs.kept!.slice(0, 1));
  });

  test("with the flag off, listResources and getResourceInfo reject with not-enabled, as Errors with a code and a message", async ({ page }) => {
    const server = await context.start();
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const outcomes = await page.evaluate(async (own) => [await window.outcome(() => window.sdk.listResources()), await window.outcome(() => window.sdk.getResourceInfo(own))], resourceID);
    expect(outcomes).toEqual([refusedWith("not-enabled"), refusedWith("not-enabled")]);
  });

  test("with the bindings hook, list the stores the artifact can use by resource ID at the page's level, each with only its resource ID, type and level, describe any of them, refuse another with not-bound, and deliver the bound stores' events", async ({ page }) => {
    const first = await context.start({ resourceBindings: true });
    const own = await context.pageWithStore(first, { n: 0 }, "Mine");
    const theirs = await context.pageWithStore(first, { n: 0 }, "Theirs");
    const writable = await first.createdStore({ value: { n: 0 } });
    const described = await first.createdStore({ value: { n: 0 }, description: "Written by an agent", usage: "Content: {n}.\nSet n." });
    const broken = await first.createdStore({ value: "soon broken" });
    const unbound = await first.createdStore({ value: { n: 0 } });
    await first.bind(writable, own.artifactID, "read-write");
    await first.bind(described, own.artifactID, "read");
    await first.bind(broken, own.artifactID, "read-write");
    await first.bind(theirs.resourceID, own.artifactID, "read");
    await first.stop();
    writeFileSync(path.join(first.home, "resources", "json", broken, "content.json"), "not json");
    const server = await context.start({ home: first.home, resourceBindings: true });
    const shareID = await server.sharedAt(own.artifactID, "read");
    const port = serverPort(server);

    const levels: Record<string, ResourceInfo["access"]> = {
      [own.resourceID]: "read-write",
      [writable]: "read-write",
      [described]: "read",
      [broken]: "read-write",
      [theirs.resourceID]: "read",
    };
    const expected = (cap: ResourceInfo["access"]) =>
      byResourceID(Object.entries(levels).map(([resourceID, access]) => ({ resourceID, type: "json" as const, access: cap === "read" ? "read" : access })));

    for (const [id, cap] of [[own.artifactID, "read-write"], [shareID, "read"]] as const) {
      await openPage(page, pageURL(port, artifactPath(id)));
      const listed = await page.evaluate(() => window.sdk.listResources());
      expect(listed, id).toEqual(expected(cap));
      for (const info of listed) expect(Object.keys(info).sort(), id).toEqual(["access", "resourceID", "type"]);
      const described = await page.evaluate((ids) => Promise.all(ids.map((resourceID) => window.sdk.getResourceInfo(resourceID))), Object.keys(levels));
      expect(byResourceID(described), id).toEqual(expected(cap));
      expect(await page.evaluate((other) => window.outcome(() => window.sdk.getResourceInfo(other)), unbound), id).toEqual(refusedWith("not-bound"));
    }

    await page.evaluate(async () => {
      const events = window.record("events");
      window.sdk.onResourcesChanged((event) => events.push(event));
      await window.sdk.getAccess();
    });
    await server.jsonSet({ resourceID: writable }, "n", 1);
    await server.jsonSet({ resourceID: unbound }, "n", 1);
    await server.jsonSet({ artifactID: own.artifactID }, "n", 1);
    await pageWaitFor(page, () => window.logs.events!.length === 2);
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs.events)).toEqual([
      { event: "changed", resourceID: writable, paths: ["n"] },
      { event: "changed", paths: ["n"] },
    ]);
  });

  test("export no error class", async ({ page }) => {
    const server = await context.start();
    const artifactID = context.createPageArtifact(server);
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const classes = await page.evaluate(() =>
      Object.entries(window.sdk)
        .filter(([, value]) => typeof value === "function" && (/^class\b/.test(Function.prototype.toString.call(value)) || value.prototype instanceof Error))
        .map(([name]) => name),
    );
    expect(classes).toEqual([]);
  });
});

// spec: proofs/arch/resources/sdk.md#^sdk-t-handles
test.describe("handles", () => {
  test("are made without network traffic, the artifact's own with a null resource ID; its first operation fails no-store on a page whose artifact has no store, and one by resource ID fails not-enabled with the flag off", async ({ page }) => {
    const server = await context.start();
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const storeless = context.createPageArtifact(server, "No store", { id: "page-without-a-store" });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));

    const own = await page.evaluate((id) => {
      const handles = window as unknown as { own: ReturnType<typeof window.sdk.getStore>; byID: ReturnType<typeof window.sdk.getStore> };
      handles.own = window.sdk.getStore();
      handles.byID = window.sdk.getStore(id);
      return { resourceID: handles.own.resourceID, byID: handles.byID.resourceID };
    }, resourceID);
    expect(own).toEqual({ resourceID: null, byID: resourceID });
    await sleep(QUIET_MS);
    expect(proxy.webSocketAttempts).toEqual([]);

    expect(await page.evaluate((id) => window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(id), "n"))), resourceID)).toEqual(refusedWith("not-enabled"));
    expect(await page.evaluate(async () => (await window.sdk.get(window.sdk.ref(window.sdk.getStore(), "n"))).val())).toBe(0);

    await openPage(page, pageURL(proxy.port, artifactPath(storeless)));
    expect(await page.evaluate(() => window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(), "n"))))).toEqual(refusedWith("no-store"));
  });

  test("by an empty resource ID are not the artifact's own: with the flag off, a listener on one receives not-enabled and never the own store's value, though a listener on getStore()'s handle is registered at the same path", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const own = window.record("own");
      window.sdk.onValue(window.sdk.ref(window.sdk.getStore(), "n"), (snapshot) => own.push(snapshot.val()));
    });
    await pageWaitFor(page, () => window.logs.own!.length === 1);
    await page.evaluate(() => {
      const empty = window.record("empty");
      const errors = window.record("errors");
      window.sdk.onValue(
        window.sdk.ref(window.sdk.getStore(""), "n"),
        (snapshot) => empty.push(snapshot.val()),
        (error) => errors.push({ code: (error as Error & { code?: string }).code, isError: error instanceof Error }),
      );
    });
    await pageWaitFor(page, () => window.logs.empty!.length + window.logs.errors!.length > 0);
    await server.jsonSet({ artifactID }, "n", 1);
    await pageWaitFor(page, () => window.logs.own!.length === 2);
    expect(await page.evaluate(() => window.logs)).toEqual({ own: [0, 1], empty: [], errors: [{ code: "not-enabled", isError: true }] });
  });

  test("on a page opened through a share link, fail the next operation with no-store once the link is revoked and the SDK has reconnected, ending each active listener with the error", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const shareID = await server.sharedAt(artifactID, "read-write");
    await openPage(page, pageURL(serverPort(server), artifactPath(shareID)));
    await page.evaluate(() => {
      const values = window.record("values");
      const errors = window.record("errors");
      window.sdk.onValue(
        window.sdk.ref(window.sdk.getStore(), "n"),
        (snapshot) => values.push(snapshot.val()),
        (error) => errors.push({ code: (error as Error & { code?: string }).code, isError: error instanceof Error }),
      );
    });
    await pageWaitFor(page, () => window.logs.values!.length === 1);
    expect((await server.unshare(artifactID)).status).toBe(200);
    await pageWaitFor(page, () => window.logs.errors!.length === 1);
    expect(await page.evaluate(() => window.logs.errors)).toEqual([{ code: "no-store", isError: true }]);
    expect(await page.evaluate(() => window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(), "n"))))).toEqual(refusedWith("no-store"));
    await server.jsonSet({ artifactID }, "n", 1);
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs)).toEqual({ values: [0], errors: [{ code: "no-store", isError: true }] });
  });

  test("keep working when the artifact's own store is destroyed: the listener hears no value and stays, and the next write succeeds", async ({ page }) => {
    const server = await context.start();
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const values = window.record("values");
      const errors = window.record("errors");
      window.sdk.onValue(
        window.sdk.ref(window.sdk.getStore()),
        (snapshot) => values.push(snapshot.exists() ? snapshot.val() : "no value"),
        (error) => errors.push(error),
      );
    });
    await pageWaitFor(page, () => window.logs.values!.length === 1);
    expect((await server.destroy(resourceID, true)).status).toBe(200);
    await pageWaitFor(page, () => window.logs.values!.length === 2);
    expect(await page.evaluate(() => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 5)))).toEqual(succeeded);
    await pageWaitFor(page, () => window.logs.values!.length === 4);
    // The write is heard pending, then confirmed.
    expect(await page.evaluate(() => window.logs)).toEqual({ values: [{ n: 0 }, "no value", { n: 5 }, { n: 5 }], errors: [] });
    expect(server.storePointer(artifactID)).not.toBe(resourceID);
    expect((await server.jsonGet({ artifactID }, "n")).body).toEqual({ exists: true, value: 5 });
  });

  test("with the bindings hook, reach the artifact's own store by its resource ID at the page's level, fail not-bound for a store the artifact is not bound to, and end their listeners when the binding is removed, working again once it is bound again", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const todos = await server.createdStore({ value: { n: 0 } });
    const elsewhere = await server.createdStore({ value: { n: 0 } });
    await server.bind(todos, artifactID, "read-write");
    const shareID = await server.sharedAt(artifactID, "read");
    const port = serverPort(server);

    await openPage(page, pageURL(port, artifactPath(artifactID)));
    expect(
      await page.evaluate(async (own) => {
        await window.sdk.set(window.sdk.ref(window.sdk.getStore(own), "n"), 1);
        return (await window.sdk.get(window.sdk.ref(window.sdk.getStore(), "n"))).val();
      }, resourceID),
    ).toBe(1);
    expect(await page.evaluate((other) => window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(other)))), elsewhere)).toEqual(refusedWith("not-bound"));
    await openPage(page, pageURL(port, artifactPath(shareID)));
    expect(await page.evaluate((own) => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(own), "n"), 2)), resourceID)).toEqual(refusedWith("read-only"));
    expect((await server.jsonGet({ artifactID }, "n")).body).toEqual({ exists: true, value: 1 });

    await openPage(page, pageURL(port, artifactPath(artifactID)));
    await page.evaluate((bound) => {
      const values = window.record("values");
      const errors = window.record("errors");
      (window as unknown as { todos: ReturnType<typeof window.sdk.getStore> }).todos = window.sdk.getStore(bound);
      window.sdk.onValue(
        window.sdk.ref((window as unknown as { todos: ReturnType<typeof window.sdk.getStore> }).todos, "n"),
        (snapshot) => values.push(snapshot.val()),
        (error) => errors.push({ code: (error as Error & { code?: string }).code, isError: error instanceof Error }),
      );
    }, todos);
    await pageWaitFor(page, () => window.logs.values!.length === 1);
    expect((await server.unbind(todos, artifactID)).status).toBe(200);
    await pageWaitFor(page, () => window.logs.errors!.length === 1);
    expect(await page.evaluate(() => window.logs.errors)).toEqual([{ code: "not-bound", isError: true }]);
    expect(
      await page.evaluate(() => window.outcome(() => window.sdk.get(window.sdk.ref((window as unknown as { todos: ReturnType<typeof window.sdk.getStore> }).todos, "n")))),
    ).toEqual(refusedWith("not-bound"));

    await server.bind(todos, artifactID, "read-write");
    await server.jsonSet({ resourceID: todos }, "n", 5);
    const again = await page.evaluate(async () => {
      const fresh = window.record("fresh");
      const store = (window as unknown as { todos: ReturnType<typeof window.sdk.getStore> }).todos;
      window.sdk.onValue(window.sdk.ref(store, "n"), (snapshot) => fresh.push(snapshot.val()));
      await window.sdk.set(window.sdk.ref(store, "n"), 6);
      return (await window.sdk.get(window.sdk.ref(store, "n"))).val();
    });
    expect(again).toBe(6);
    await pageWaitFor(page, () => window.logs.fresh!.includes(6));
    expect(await page.evaluate(() => window.logs.values)).toEqual([0]);
  });
});

// spec: proofs/arch/resources/sdk.md#^sdk-t-connection
test.describe("connection lifecycle", () => {
  test("opens on first use, is shared by further stores, and closes when nothing is outstanding; onResourcesChanged, onAccessChanged and onConnectionStatusChanged each hold it open", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const second = await server.createdStore({ value: { n: 0 } });
    await server.bind(second, artifactID, "read-write");
    const proxy = await context.proxy(server);
    const url = pageURL(proxy.port, artifactPath(artifactID));
    await openPage(page, url);
    await sleep(QUIET_MS);
    expect(proxy.webSocketAttempts).toEqual([]);

    // A subscription opens the connection; another store's operations share it.
    await page.evaluate(async (other) => {
      const values = window.record("values");
      (window as unknown as { stop: () => void }).stop = window.sdk.onValue(window.sdk.ref(window.sdk.getStore(), "n"), (snapshot) => values.push(snapshot.val()));
      await window.sdk.get(window.sdk.ref(window.sdk.getStore(other), "n"));
      await window.sdk.set(window.sdk.ref(window.sdk.getStore(other), "n"), 1);
      await window.sdk.listResources();
    }, second);
    expect(proxy.webSocketAttempts).toHaveLength(1);
    expect(proxy.openWebSockets).toBe(1);

    await page.evaluate(() => (window as unknown as { stop: () => void }).stop());
    await proxy.waitFor(() => proxy.openWebSockets === 0);

    // The next operation opens a new one, and closes it once answered.
    await page.evaluate(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 2));
    await proxy.waitFor(() => proxy.openWebSockets === 0);
    expect(proxy.webSocketAttempts).toHaveLength(2);

    // Each kind of callback opens one, and holds it open until unsubscribed.
    const registrations = ["onResourcesChanged", "onAccessChanged", "onConnectionStatusChanged"] as const;
    for (const [index, registration] of registrations.entries()) {
      await page.evaluate((name) => {
        (window as unknown as { stop: () => void }).stop = window.sdk[name](() => undefined);
      }, registration);
      await proxy.waitFor(() => proxy.webSocketAttempts.length === 3 + index && proxy.openWebSockets === 1);
      await sleep(QUIET_MS);
      expect(proxy.openWebSockets, registration).toBe(1);
      await page.evaluate(() => (window as unknown as { stop: () => void }).stop());
      await proxy.waitFor(() => proxy.openWebSockets === 0);
    }
    expect(proxy.webSocketAttempts).toHaveLength(5);
  });
});

/** The page's connection status now. */
function status(page: Page): Promise<string> {
  return page.evaluate(() => window.sdk.getConnectionStatus());
}

// spec: proofs/arch/resources/sdk.md#^sdk-t-connection-status
test.describe("connection status", () => {
  test("is idle after loading without opening a connection, connecting until the opening state, connected after it, and idle once nothing needs the connection", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    expect(await status(page)).toBe("idle");
    await sleep(QUIET_MS);
    expect(proxy.webSocketAttempts).toEqual([]);

    proxy.hold("to-browser");
    expect(
      await page.evaluate(() => {
        const values = window.record("values");
        (window as unknown as { stop: () => void }).stop = window.sdk.onValue(window.sdk.ref(window.sdk.getStore(), "n"), (snapshot) => values.push(snapshot.val()));
        return window.sdk.getConnectionStatus();
      }),
    ).toBe("connecting");
    await proxy.waitFor(() => proxy.openWebSockets === 1);
    await sleep(QUIET_MS);
    expect(await status(page)).toBe("connecting");

    proxy.release("to-browser");
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");
    await pageWaitFor(page, () => window.logs.values!.length === 1);

    await page.evaluate(() => (window as unknown as { stop: () => void }).stop());
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "idle");
    await proxy.waitFor(() => proxy.openWebSockets === 0);
  });

  test("tells a callback the status soon after registration, then each change, and nothing after its Unsubscribe; the callback alone keeps the connection open", async ({ page }) => {
    const server = await context.start();
    const artifactID = context.createPageArtifact(server);
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));

    const heardAtRegistration = await page.evaluate(() => {
      const statuses = window.record("statuses");
      (window as unknown as { stop: () => void }).stop = window.sdk.onConnectionStatusChanged((current) => statuses.push(current));
      return [...statuses];
    });
    expect(heardAtRegistration).toEqual([]);
    await pageWaitFor(page, () => window.logs.statuses!.length === 2);
    expect(await page.evaluate(() => window.logs.statuses)).toEqual(["connecting", "connected"]);

    // A callback registered once connected hears that first.
    await page.evaluate(() => {
      const later = window.record("later");
      window.sdk.onConnectionStatusChanged((current) => later.push(current));
    });
    await pageWaitFor(page, () => window.logs.later!.length === 1);
    expect(await page.evaluate(() => window.logs.later)).toEqual(["connected"]);

    await sleep(QUIET_MS);
    expect(proxy.openWebSockets).toBe(1);
    expect(proxy.webSocketAttempts).toHaveLength(1);

    await page.evaluate(() => (window as unknown as { stop: () => void }).stop());
    proxy.refuse(true);
    proxy.sever();
    await pageWaitFor(page, () => window.logs.later!.length === 2);
    expect(await page.evaluate(() => window.logs)).toEqual({ statuses: ["connecting", "connected"], later: ["connected", "disconnected"] });
  });

  test("becomes disconnected at a loss before the page hears a write roll back or its promise reject, stays so through refused attempts, and is connected again with the opening state", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate(() => {
      const order = window.record("order");
      window.sdk.onConnectionStatusChanged((current) => order.push(`status ${current}`));
      window.sdk.onValue(window.sdk.ref(window.sdk.getStore(), "n"), (snapshot) =>
        order.push(`value ${String(snapshot.val())}${snapshot.metadata.hasPendingWrites ? " pending" : ""}`),
      );
    });
    await pageWaitFor(page, () => window.logs.order!.includes("status connected") && window.logs.order!.includes("value 0"));

    proxy.holdWrites();
    await page.evaluate(() => {
      const order = window.logs.order!;
      window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 1).then(
        () => order.push("resolved"),
        (error: Error & { code?: string }) => order.push(`rejected ${String(error.code)} while ${window.sdk.getConnectionStatus()}`),
      );
    });
    await proxy.waitFor(() => proxy.heldWriteCount === 1);
    const before = (await page.evaluate(() => window.logs.order!.length)) as number;
    proxy.refuse(true);
    proxy.sever();
    await pageWaitFor(page, () => window.logs.order!.some((entry) => String(entry).startsWith("rejected")));
    expect((await page.evaluate(() => window.logs.order)).slice(before)).toEqual(["status disconnected", "value 0", "rejected disconnected while disconnected"]);

    const attempts = proxy.webSocketAttempts.length;
    await proxy.waitFor(() => proxy.webSocketAttempts.length >= attempts + 2);
    expect(await status(page)).toBe("disconnected");
    expect((await page.evaluate(() => window.logs.order)).at(-1)).toBe("rejected disconnected while disconnected");

    proxy.refuse(false);
    await pageWaitFor(page, () => window.logs.order!.at(-1) === "status connected");
    expect(await status(page)).toBe("connected");
  });

  test("goes from connecting to disconnected when a first connection ends before its opening state", async ({ page }) => {
    const server = await context.start();
    const artifactID = context.createPageArtifact(server);
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    proxy.hold("to-browser");
    await page.evaluate(() => {
      const statuses = window.record("statuses");
      window.sdk.onConnectionStatusChanged((current) => statuses.push(current));
    });
    await proxy.waitFor(() => proxy.openWebSockets === 1);
    await pageWaitFor(page, () => window.logs.statuses!.length === 1);
    proxy.refuse(true);
    proxy.sever();
    await pageWaitFor(page, () => window.logs.statuses!.length === 2);
    expect(await page.evaluate(() => window.logs.statuses)).toEqual(["connecting", "disconnected"]);
  });
});

// spec: proofs/arch/resources/sdk.md#^sdk-t-reconnect
test.describe("reconnection", () => {
  test("backs off exponentially from 250 milliseconds with jitter, and stops growing at 30 seconds", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const proxy = await context.proxy(server);
    await page.clock.install();
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate(() => {
      const values = window.record("values");
      window.sdk.onValue(window.sdk.ref(window.sdk.getStore(), "n"), (snapshot) => values.push(snapshot.val()));
    });
    await pageWaitFor(page, () => window.logs.values!.length === 1);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    const pageNow = () => page.evaluate(() => Date.now());

    proxy.refuse(true);
    proxy.sever();
    // The page hears the loss at the paused time and schedules its first attempt from it.
    await sleep(QUIET_MS);
    let last = await pageNow();
    const bases = [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    const steps: number[] = [];
    const intervals: number[] = [];
    for (const base of bases) {
      const step = base / 20;
      steps.push(step);
      const attempts = proxy.webSocketAttempts.length;
      // No attempt comes before half the interval.
      await page.clock.runFor(base / 2 - step);
      await sleep(QUIET_MS / 3);
      expect(proxy.webSocketAttempts.length).toBe(attempts);
      let seen = false;
      for (let elapsed = base / 2 - step; elapsed < base + step && !seen; elapsed += step) {
        await page.clock.runFor(step);
        seen = await proxy.waitFor(() => proxy.webSocketAttempts.length > attempts, QUIET_MS / 3).then(
          () => true,
          () => false,
        );
      }
      expect(seen, `an attempt within ${base} ms`).toBe(true);
      const now = await pageNow();
      intervals.push(now - last);
      last = now;
      // Let the refused attempt's close reach the page while the clock is paused.
      await sleep(QUIET_MS / 2);
    }
    bases.forEach((base, index) => {
      expect(intervals[index], `interval ${index}`).toBeGreaterThanOrEqual(base / 2);
      expect(intervals[index], `interval ${index}`).toBeLessThanOrEqual(base + steps[index]!);
    });
    // Jitter: the intervals do not all sit at their full length.
    expect(intervals.some((interval, index) => interval < bases[index]! * 0.9)).toBe(true);
  });

  test("resubscribes every active subscription and sends no request made before or during the loss", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { a: 0, b: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate(() => {
      const store = window.sdk.getStore();
      for (const key of ["a", "b"]) {
        const values = window.record(key);
        window.sdk.onValue(window.sdk.ref(store, key), (snapshot) => values.push(snapshot.val()));
      }
    });
    await pageWaitFor(page, () => window.logs.a!.length === 1 && window.logs.b!.length === 1);
    const first = proxy.messages[0]!.connection;

    // A request and a write outstanding at the loss, their answers held.
    proxy.hold("to-browser");
    await page.evaluate(() => {
      const held = window as unknown as { read: Promise<Outcome>; written: Promise<Outcome> };
      held.read = window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(), "b")));
      held.written = window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "a"), 1));
    });
    await proxy.waitFor(() => proxy.messages.some(({ message }) => message.type === "write"));
    proxy.refuse(true);
    proxy.sever();
    proxy.release("to-browser");
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "disconnected");
    // Made during the loss.
    expect(await page.evaluate(() => window.outcome(() => window.sdk.get(window.sdk.ref(window.sdk.getStore(), "a"))))).toEqual(refusedWith("disconnected"));
    expect(
      await page.evaluate(async () => {
        const held = window as unknown as { read: Promise<Outcome>; written: Promise<Outcome> };
        return [await held.read, await held.written];
      }),
    ).toEqual([refusedWith("disconnected"), refusedWith("disconnected")]);

    proxy.refuse(false);
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");
    await proxy.waitFor(() => proxy.messages.filter(({ connection }) => connection !== first).length >= 2);
    await sleep(QUIET_MS);
    const sent = proxy.messages.filter(({ connection }) => connection !== first).map(({ message }) => message);
    expect(sent.map((message) => message.type)).toEqual(["subscribe", "subscribe"]);
    expect(sent.map((message) => message.path).sort()).toEqual(["a", "b"]);
  });

  test("makes getAccess wait while connecting and fail at once while disconnected, and keeps onResourcesChanged and onAccessChanged callbacks registered before and during the loss", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const shareID = await server.sharedAt(artifactID, "read-write");
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));
    const accessAtOnce = () => page.evaluate(() => window.atOnce(() => window.sdk.getAccess()));

    // A getAccess made while the first connection's opening state is held waits for it.
    proxy.hold("to-browser");
    await page.evaluate(() => {
      (window as unknown as { opening: Promise<Outcome> }).opening = window.outcome(() => window.sdk.getAccess());
    });
    await proxy.waitFor(() => proxy.openWebSockets === 1);
    expect(await accessAtOnce()).toBe("waiting");
    proxy.release("to-browser");
    expect(await page.evaluate(() => (window as unknown as { opening: Promise<Outcome> }).opening)).toEqual({ ok: true, value: "read-write" });
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "idle");

    // One waiting when that connection ends before its opening state rejects with disconnected.
    proxy.hold("to-browser");
    await page.evaluate(() => {
      (window as unknown as { waiting: Promise<Outcome> }).waiting = window.outcome(() => window.sdk.getAccess());
    });
    await proxy.waitFor(() => proxy.openWebSockets === 1);
    proxy.sever();
    proxy.release("to-browser");
    expect(await page.evaluate(() => (window as unknown as { waiting: Promise<Outcome> }).waiting)).toEqual(refusedWith("disconnected"));

    await page.evaluate(() => {
      const before = window.record("before");
      window.sdk.onResourcesChanged((event) => before.push(event.event));
      window.sdk.onAccessChanged((access) => before.push(access));
    });
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");
    await pageWaitFor(page, () => window.logs.before!.length === 1);
    proxy.refuse(true);
    proxy.sever();
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "disconnected");
    expect(await accessAtOnce()).toEqual(refusedWith("disconnected"));
    await page.evaluate(() => {
      const during = window.record("during");
      window.sdk.onResourcesChanged((event) => during.push(event.event));
      window.sdk.onAccessChanged((access) => during.push(access));
    });

    proxy.refuse(false);
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");
    await pageWaitFor(page, () => window.logs.during!.length === 1);
    await server.jsonSet({ artifactID }, "n", 1);
    expect((await server.share(artifactID, "read")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.before!.length === 3 && window.logs.during!.length === 3);
    expect(await page.evaluate(() => window.logs)).toEqual({ before: ["read-write", "changed", "read"], during: ["read-write", "changed", "read"] });
  });

  test("with the bindings hook, refuses listResources and getResourceInfo at once while disconnected, and one outstanding at the loss", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate(() => {
      window.sdk.onConnectionStatusChanged(() => undefined);
    });
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");

    proxy.hold("to-browser");
    await page.evaluate(() => {
      (window as unknown as { listed: Promise<Outcome> }).listed = window.outcome(() => window.sdk.listResources());
    });
    await proxy.waitFor(() => proxy.messages.some(({ message }) => message.type === "list"));
    proxy.refuse(true);
    proxy.sever();
    proxy.release("to-browser");
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "disconnected");
    expect(await page.evaluate(() => (window as unknown as { listed: Promise<Outcome> }).listed)).toEqual(refusedWith("disconnected"));
    expect(await page.evaluate(() => window.atOnce(() => window.sdk.listResources()))).toEqual(refusedWith("disconnected"));
    expect(await page.evaluate((own) => window.atOnce(() => window.sdk.getResourceInfo(own)), resourceID)).toEqual(refusedWith("disconnected"));
  });
});

// spec: proofs/arch/resources/sdk.md#^sdk-t-callback-isolation
test.describe("callback isolation", () => {
  test("reports a throwing callback as uncaught while the others and later changes still arrive on the same connection", async ({ page }) => {
    const server = await context.start();
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const sockets = webSocketURLs(page);
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const values = window.record("values");
      const events = window.record("events");
      const nRef = window.sdk.ref(window.sdk.getStore(), "n");
      window.sdk.onValue(nRef, (snapshot) => {
        if (snapshot.val() !== 0) throw new Error(`value callback ${String(snapshot.val())}`);
      });
      window.sdk.onValue(nRef, (snapshot) => values.push(snapshot.val()));
      window.sdk.onResourcesChanged((event) => {
        throw new Error(`event callback ${event.event}`);
      });
      window.sdk.onResourcesChanged((event) => events.push(event.event));
    });
    await pageWaitFor(page, () => window.logs.values!.length === 1);
    await server.jsonSet({ artifactID }, "n", 1);
    await server.jsonSet({ artifactID }, "n", 2);
    await pageWaitFor(page, () => window.logs.values!.length === 3 && window.logs.events!.length === 2);
    expect(await page.evaluate(() => window.logs)).toEqual({ values: [0, 1, 2], events: ["changed", "changed"] });
    await expect.poll(() => uncaught.sort()).toEqual(["event callback changed", "event callback changed", "value callback 1", "value callback 2"]);
    expect(sockets).toHaveLength(1);
  });
});
