import { expect, test, type Page } from "@playwright/test";
import { adminRoutes, type JSONValue } from "@telepath-computer/television-shared/resources";
import type { RunningServer } from "../resources/harness.ts";
import { PROGRAM_START, checkProgram, runCallbackProgram } from "./callback-programs.ts";
import {
  MAPPED_HOST_LAUNCH,
  SdkTestContext,
  artifactPath,
  openPage,
  pageURL,
  pageWaitFor,
  serverPort,
  sleep,
  type Outcome,
  type Shot,
} from "./resource-sdk-harness.ts";

test.use({ launchOptions: MAPPED_HOST_LAUNCH });

const context = new SdkTestContext();
test.afterEach(() => context.cleanup());

/** How long to wait for traffic or calls a test expects not to happen. */
const QUIET_MS = 300;

function refusedWith(code: string): Outcome {
  return { ok: false, isError: true, code, message: expect.any(String) as unknown as string };
}

/** A server with an artifact's page whose own store holds `value`. */
async function ownStore(value: JSONValue): Promise<{ server: RunningServer; artifactID: string }> {
  const server = await context.start();
  const { artifactID } = await context.pageWithStore(server, value);
  return { server, artifactID };
}

async function stored(server: RunningServer, artifactID: string, path = ""): Promise<unknown> {
  return (await server.jsonGet({ artifactID }, path)).body;
}

/** Records every onValue snapshot at each path under its own log name. */
async function watchValues(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((watched) => {
    const store = window.sdk.getStore();
    for (const path of watched) {
      const shots = window.record(path);
      window.sdk.onValue(window.sdk.ref(store, path), (snapshot) => shots.push(window.shot(snapshot)));
    }
  }, paths);
  await page.waitForFunction((watched) => watched.every((path) => (window.logs[path]?.length ?? 0) > 0), paths);
}

async function shots(page: Page, path: string): Promise<Shot[]> {
  return (await page.evaluate((name) => window.logs[name], path)) as Shot[];
}

/** The write messages the browser has sent through the proxy, on every connection. */
function writesSent(proxy: { messages: Array<{ message: Record<string, unknown> }> }): number {
  return proxy.messages.filter(({ message }) => message.type === "write").length;
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-sdk
test.describe("the SDK's functions", () => {
  test("make references with key, parent, root and path on the artifact's store, whose resourceID is null, and refuse paths breaking the rules with invalid-path", async ({ page }) => {
    const { server, artifactID } = await ownStore({});
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const refs = await page.evaluate(() => {
      const store = window.sdk.getStore();
      const item = window.sdk.ref(store, "/items//a/");
      const deeper = window.sdk.child(item, "b/c");
      const describe = (ref: { key: string | null; path: string }) => ({ key: ref.key, path: ref.path });
      return {
        resourceID: store.resourceID,
        item: describe(item),
        parent: describe(item.parent!),
        root: describe(item.root),
        rootParent: item.root.parent,
        top: describe(window.sdk.ref(store)),
        deeper: describe(deeper),
        deeperParent: describe(deeper.parent!),
      };
    });
    expect(refs).toEqual({
      resourceID: null,
      item: { key: "a", path: "items/a" },
      parent: { key: "items", path: "items" },
      root: { key: null, path: "" },
      rootParent: null,
      top: { key: null, path: "" },
      deeper: { key: "c", path: "items/a/b/c" },
      deeperParent: { key: "b", path: "items/a/b" },
    });
    const refused = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      const segments = (count: number) => Array.from({ length: count }, (_, index) => `k${index}`).join("/");
      return [
        await window.outcome(() => window.sdk.ref(store, "x".repeat(769))),
        await window.outcome(() => window.sdk.ref(store, segments(33))),
        await window.outcome(() => window.sdk.child(window.sdk.ref(store, segments(2)), segments(31))),
      ];
    });
    expect(refused).toEqual([refusedWith("invalid-path"), refusedWith("invalid-path"), refusedWith("invalid-path")]);
    expect(await page.evaluate(() => window.outcome(() => window.sdk.ref(window.sdk.getStore(), "x".repeat(768)).key!.length))).toEqual({
      ok: true,
      value: 768,
    });
  });

  test("give snapshots exists, val, child, forEach, size and metadata", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: { b: 1, a: 2, "10": 3, "2": 4 }, arr: [5, 6], s: "x", nothing: null });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const read = await page.evaluate(async () => {
      const snapshot = await window.sdk.get(window.sdk.ref(window.sdk.getStore()));
      const visited: string[] = [];
      const stopped = snapshot.child("list").forEach((child) => {
        visited.push(child.key!);
        return child.key === "a";
      });
      const all: string[] = [];
      const completed = snapshot.child("arr").forEach((child) => {
        all.push(`${child.key}=${String(child.val())}`);
      });
      const copy = snapshot.child("list").val() as Record<string, number>;
      copy.a = 99;
      return {
        exists: snapshot.exists(),
        key: snapshot.key,
        size: snapshot.size,
        pending: snapshot.metadata.hasPendingWrites,
        sizes: ["list", "arr", "s", "nothing", "missing"].map((key) => snapshot.child(key).size),
        missing: { exists: snapshot.child("missing").exists(), val: snapshot.child("missing").val() === undefined },
        nothing: { exists: snapshot.child("nothing").exists(), val: snapshot.child("nothing").val() },
        nested: { key: snapshot.child("list/a").key, val: snapshot.child("list/a").val(), path: snapshot.child("list/a").ref.path },
        visited,
        stopped,
        all,
        completed,
        unchanged: (snapshot.child("list").val() as Record<string, number>).a,
      };
    });
    expect(read).toEqual({
      exists: true,
      key: null,
      size: 4,
      pending: false,
      sizes: [4, 2, 0, 0, 0],
      missing: { exists: false, val: true },
      nothing: { exists: true, val: null },
      nested: { key: "a", val: 2, path: "list/a" },
      visited: ["2", "10", "a"],
      stopped: true,
      all: ["0=5", "1=6"],
      completed: false,
      unchanged: 2,
    });
  });

  test("push returns its reference at once, resolving with the new child's reference when confirmed and rejecting when refused; without a value it sends nothing", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: {}, arr: [1] });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    const pushed = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      const reference = window.sdk.push(window.sdk.ref(store, "list"), { t: 1 });
      const key = reference.key;
      const path = reference.path;
      const confirmed = await window.outcome(async () => (await reference).key);
      const refused = await window.outcome(() => window.sdk.push(window.sdk.ref(store, "arr"), 2));
      return { key, path, confirmed, refused };
    });
    expect(pushed.key).toMatch(/^[-0-9A-Za-z_]{20}$/);
    expect(pushed.path).toBe(`list/${pushed.key}`);
    expect(pushed.confirmed).toEqual({ ok: true, value: pushed.key });
    expect(pushed.refused).toEqual(refusedWith("invalid-path"));
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { list: { [pushed.key!]: { t: 1 } }, arr: [1] } });

    await proxy.waitFor(() => proxy.openWebSockets === 0);
    const sent = proxy.messages.length;
    const attempts = proxy.webSocketAttempts.length;
    const empty = await page.evaluate(async () => {
      const reference = window.sdk.push(window.sdk.ref(window.sdk.getStore(), "list"));
      return { key: reference.key, outcome: await window.outcome(async () => (await reference).key) };
    });
    expect(empty.key).toMatch(/^[-0-9A-Za-z_]{20}$/);
    expect(empty.outcome).toEqual({ ok: true, value: empty.key });
    await sleep(QUIET_MS);
    expect(proxy.messages).toHaveLength(sent);
    expect(proxy.webSocketAttempts).toHaveLength(attempts);
  });

  test("push's reference has catch and finally: catch hears a refusal, and finally runs once the write settles", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: {}, arr: [1] });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const settled = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      const heard: string[] = [];
      // The common idiom: chain catch, then finally, straight onto push.
      const run = (path: string, value: number, name: string) =>
        window.sdk.push(window.sdk.ref(store, path), value)
          .catch((error: unknown) => {
            heard.push(`${name} caught ${(error as { code?: unknown }).code}`);
            return "handled";
          })
          .finally(() => heard.push(`${name} finally`));
      // A confirmation passes the new child's reference through the chain.
      const confirmed = await run("list", 1, "confirmed");
      // The server refuses a push below an array, after the page has shown it.
      const refused = await run("arr", 2, "refused");
      // finally straight onto push: it runs either way, and its promise settles as the write did.
      const finallyOnly = (path: string, value: number, name: string) =>
        window.outcome(async () => (await window.sdk.push(window.sdk.ref(store, path), value).finally(() => heard.push(`${name} finally only`))).path);
      const confirmedFinally = await finallyOnly("list", 3, "confirmed");
      const refusedFinally = await finallyOnly("arr", 4, "refused");
      return { confirmed: typeof confirmed === "string" ? confirmed : confirmed.path, refused, confirmedFinally, refusedFinally, heard };
    });
    expect(settled).toEqual({
      confirmed: expect.stringMatching(/^list\/[-0-9A-Za-z_]{20}$/),
      refused: "handled",
      confirmedFinally: { ok: true, value: expect.stringMatching(/^list\/[-0-9A-Za-z_]{20}$/) },
      refusedFinally: refusedWith("invalid-path"),
      heard: ["confirmed finally", "refused caught invalid-path", "refused finally", "confirmed finally only", "refused finally only"],
    });
    expect(Object.keys(((await stored(server, artifactID, "list")) as { value: Record<string, number> }).value)).toHaveLength(2);
    expect(await stored(server, artifactID, "arr")).toEqual({ exists: true, value: [1] });
  });

  test("awaiting push gives a reference to the new child that is not itself a promise", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: {} });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const awaited = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      const list = window.sdk.ref(store, "list");
      const reference = window.sdk.push(list, { t: 1 });
      // The common idiom: await push, then read the new child's key.
      const added = await reference;
      const read = await window.sdk.get(added);
      // Chaining catch or finally passes the reference through on a confirmation.
      const caught = await window.sdk.push(list, { t: 2 }).catch(() => null);
      const finished = await window.sdk.push(list, { t: 3 }).finally(() => undefined);
      const empty = window.sdk.push(list);
      return {
        returnedKey: reference.key,
        addedKey: added.key,
        addedPath: added.path,
        addedParent: added.parent?.path,
        thenable: "then" in added,
        read: read.val(),
        caughtKey: caught?.key,
        finishedKey: finished.key,
        empty: { returnedKey: empty.key, awaitedKey: (await empty).key },
      };
    });
    expect(awaited.addedKey).toMatch(/^[-0-9A-Za-z_]{20}$/);
    expect(awaited).toEqual({
      returnedKey: awaited.addedKey,
      addedKey: awaited.addedKey,
      addedPath: `list/${awaited.addedKey}`,
      addedParent: "list",
      thenable: false,
      read: { t: 1 },
      caughtKey: expect.stringMatching(/^[-0-9A-Za-z_]{20}$/),
      finishedKey: expect.stringMatching(/^[-0-9A-Za-z_]{20}$/),
      empty: { returnedKey: awaited.empty.returnedKey, awaitedKey: awaited.empty.returnedKey },
    });
    const list = ((await stored(server, artifactID, "list")) as { value: Record<string, unknown> }).value;
    expect(list).toEqual({ [awaited.addedKey!]: { t: 1 }, [awaited.caughtKey!]: { t: 2 }, [awaited.finishedKey!]: { t: 3 } });
  });

  test("push throws invalid-path, with or without a value, when its key would make a path of more than 32 segments, and shows and sends nothing", async ({
    page,
  }) => {
    const { server, artifactID } = await ownStore({});
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, [""]);
    const sent = proxy.messages.length;
    const pushed = await page.evaluate(() => {
      const store = window.sdk.getStore();
      const deep = (count: number) =>
        window.sdk.ref(store, Array.from({ length: count }, (_, index) => `k${index}`).join("/"));
      // How push ended before returning: a thrown error, or the reference it returned.
      const attempt = (run: () => { path: string } & PromiseLike<unknown>) => {
        try {
          const reference = run();
          Promise.resolve(reference).catch(() => undefined);
          return { threw: false, segments: reference.path.split("/").length };
        } catch (error) {
          return { threw: true, isError: error instanceof Error, code: (error as Error & { code?: string }).code };
        }
      };
      return {
        withValue: attempt(() => window.sdk.push(deep(32), 1)),
        withoutValue: attempt(() => window.sdk.push(deep(32))),
        deepestWithout: attempt(() => window.sdk.push(deep(31))),
      };
    });
    expect(pushed).toEqual({
      withValue: { threw: true, isError: true, code: "invalid-path" },
      withoutValue: { threw: true, isError: true, code: "invalid-path" },
      deepestWithout: { threw: false, segments: 32 },
    });
    await sleep(QUIET_MS);
    expect(await shots(page, "")).toEqual([{ key: null, exists: true, value: {}, pending: false }]);
    expect(proxy.messages).toHaveLength(sent);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: {} });
  });

  test("set stores null, deleteValue in update deletes, and NaN or undefined is refused with invalid-value, changing nothing", async ({ page }) => {
    const { server, artifactID } = await ownStore({ a: 1, b: 2, c: 3 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const outcomes = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      return [
        await window.outcome(() => window.sdk.set(window.sdk.ref(store, "a"), null)),
        await window.outcome(() => window.sdk.update(window.sdk.ref(store), { b: window.sdk.deleteValue() })),
        await window.outcome(() => window.sdk.set(window.sdk.ref(store, "c"), Number.NaN)),
        await window.outcome(() => window.sdk.set(window.sdk.ref(store, "c"), undefined as never)),
      ];
    });
    expect(outcomes).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: undefined },
      refusedWith("invalid-value"),
      refusedWith("invalid-value"),
    ]);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { a: null, c: 3 } });
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-local-view
test.describe("the local view", () => {
  test("shows writes at once, in order on the confirmed value, pending at, above and below their paths and nowhere else", async ({ page }) => {
    const { server, artifactID } = await ownStore({ items: { a: { done: false }, b: { done: false } }, other: 1 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["", "items", "items/a", "items/a/done", "items/b", "other"]);
    proxy.hold("to-browser");
    const shown = await page.evaluate(() => {
      const store = window.sdk.getStore();
      const counts = () => Object.fromEntries(Object.entries(window.logs).map(([path, log]) => [path, log.length]));
      const before = counts();
      void window.sdk.set(window.sdk.ref(store, "items/a"), { done: true });
      void window.sdk.set(window.sdk.ref(store, "items/a/note"), "x");
      const after = counts();
      const latest = (path: string) => window.logs[path]!.at(-1) as Shot;
      const root = window.logs[""]!.at(-1) as Shot;
      return { before, after, items: latest("items"), a: latest("items/a"), done: latest("items/a/done"), rootPending: root.pending };
    });
    // Shown at once: every location the writes change was called before set() returned.
    // Each write changed the root, items and items/a; only the first changed items/a/done.
    expect(shown.after).toEqual({ ...shown.before, "": 3, items: 3, "items/a": 3, "items/a/done": 2 });
    expect(shown.a).toEqual({ key: "a", exists: true, value: { done: true, note: "x" }, pending: true });
    expect(shown.done).toEqual({ key: "done", exists: true, value: true, pending: true });
    expect(shown.items).toMatchObject({ pending: true });
    expect(shown.rootPending).toBe(true);
    const elsewhere = await page.evaluate(async () => {
      const snapshot = await new Promise<import("../../../shared/src/resources/sdk.ts").Snapshot>((resolve) => {
        const stop = window.sdk.onValue(window.sdk.ref(window.sdk.getStore()), (value) => {
          resolve(value);
          queueMicrotask(stop);
        });
      });
      return { b: snapshot.child("items/b").metadata.hasPendingWrites, other: snapshot.child("other").metadata.hasPendingWrites };
    });
    expect(elsewhere).toEqual({ b: false, other: false });
    expect((await shots(page, "items/b")).length).toBe(1);
    expect((await shots(page, "other")).length).toBe(1);

    proxy.release("to-browser");
    await pageWaitFor(page, () => (window.logs["items/a"]!.at(-1) as Shot).pending === false);
    expect((await shots(page, "items/a")).at(-1)).toEqual({ key: "a", exists: true, value: { done: true, note: "x" }, pending: false });
  });

  test("estimates server values from the page's view and the server's clock, and replaces them with the server's on release", async ({ page }) => {
    const { server, artifactID } = await ownStore({ count: 5, stamp: 0 });
    const proxy = await context.proxy(server);
    // The page's clock runs an hour ahead of the server's; the estimate follows the server's.
    await page.clock.install({ time: Date.now() + 3_600_000 });
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["count", "stamp"]);
    proxy.hold("to-browser");
    const before = Date.now();
    await page.evaluate(() => {
      const store = window.sdk.getStore();
      void window.sdk.set(window.sdk.ref(store, "count"), window.sdk.increment(2));
      void window.sdk.set(window.sdk.ref(store, "stamp"), window.sdk.serverTimestamp());
    });
    const after = Date.now();
    const estimatedStamp = (await shots(page, "stamp")).at(-1)!;
    expect((await shots(page, "count")).at(-1)).toEqual({ key: "count", exists: true, value: 7, pending: true });
    expect(estimatedStamp.pending).toBe(true);
    expect(estimatedStamp.value as number).toBeGreaterThan(before - 5_000);
    expect(estimatedStamp.value as number).toBeLessThan(after + 5_000);

    proxy.release("to-browser");
    await pageWaitFor(page, () => (window.logs.stamp!.at(-1) as Shot).pending === false && (window.logs.count!.at(-1) as Shot).pending === false);
    const serverStamp = ((await stored(server, artifactID, "stamp")) as { value: number }).value;
    expect((await shots(page, "stamp")).at(-1)).toEqual({ key: "stamp", exists: true, value: serverStamp, pending: false });
    // The server's value arrives before the acknowledgement and already holds the increment, which is not applied again.
    expect((await shots(page, "count")).map((shot) => [shot.value, shot.pending])).toEqual([
      [5, false],
      [7, true],
      [7, false],
    ]);
  });

  test("tells onValue listeners when their last pending write is confirmed, even when the value did not change, and no other listener", async ({ page }) => {
    const { server, artifactID } = await ownStore({ same: 1, changed: 1 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["same", "changed", ""]);
    await page.evaluate(() => {
      const children = window.record("children");
      const root = window.sdk.ref(window.sdk.getStore());
      window.sdk.onChildAdded(root, (child) => children.push(`added ${child.key!}`));
      window.sdk.onChildChanged(root, (child) => children.push(`changed ${child.key!}`));
      window.sdk.onChildRemoved(root, (child) => children.push(`removed ${child.key!}`));
    });
    await pageWaitFor(page, () => window.logs.children!.length === 2);
    proxy.hold("to-browser");
    await page.evaluate(() => {
      const store = window.sdk.getStore();
      void window.sdk.set(window.sdk.ref(store, "same"), 1);
      void window.sdk.set(window.sdk.ref(store, "changed"), 2);
    });
    expect((await shots(page, "same")).length).toBe(1);
    expect((await shots(page, "changed")).at(-1)).toEqual({ key: "changed", exists: true, value: 2, pending: true });
    expect(await page.evaluate(() => window.logs.children)).toEqual(["added changed", "added same", "changed changed"]);

    proxy.release("to-browser");
    await pageWaitFor(page, () => window.logs.same!.length === 2 && (window.logs.changed!.at(-1) as Shot).pending === false);
    expect((await shots(page, "same")).at(-1)).toEqual({ key: "same", exists: true, value: 1, pending: false });
    expect((await shots(page, "changed")).map((shot) => [shot.value, shot.pending])).toEqual([
      [1, false],
      [2, true],
      [2, false],
    ]);
    expect((await shots(page, "")).at(-1)).toMatchObject({ value: { same: 1, changed: 2 }, pending: false });
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs.children)).toEqual(["added changed", "added same", "changed changed"]);
  });

  test("shows another client's change arriving under a queued write with the write applied again on top", async ({ page }) => {
    const { server, artifactID } = await ownStore({ items: { a: 1 } });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["items"]);
    proxy.hold("to-server");
    await page.evaluate(() => {
      void window.sdk.update(window.sdk.ref(window.sdk.getStore(), "items"), { b: 2 });
    });
    await server.jsonSet({ artifactID }, "items/c", 3);
    await pageWaitFor(page, () => window.logs.items!.length === 3);
    expect((await shots(page, "items")).map((shot) => [shot.value, shot.pending])).toEqual([
      [{ a: 1 }, false],
      [{ a: 1, b: 2 }, true],
      [{ a: 1, b: 2, c: 3 }, true],
    ]);
    proxy.release("to-server");
    await pageWaitFor(page, () => (window.logs.items!.at(-1) as Shot).pending === false);
    expect((await shots(page, "items")).at(-1)!.value).toEqual({ a: 1, b: 2, c: 3 });
    expect(await stored(server, artifactID, "items")).toEqual({ exists: true, value: { a: 1, b: 2, c: 3 } });
  });

  test("computes child events from successive values, in child order, and none for a value that is not an object", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: { b: 1, a: 2, "10": 0, "2": 0 }, arr: [1, 2], s: "x" });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const events = window.record("events");
      const store = window.sdk.getStore();
      for (const path of ["list", "arr", "s"]) {
        const at = window.sdk.ref(store, path);
        window.sdk.onChildAdded(at, (child) => events.push(`${path} added ${child.key!}=${JSON.stringify(child.val())}`));
        window.sdk.onChildChanged(at, (child) => events.push(`${path} changed ${child.key!}=${JSON.stringify(child.val())}`));
        window.sdk.onChildRemoved(at, (child) => events.push(`${path} removed ${child.key!}=${JSON.stringify(child.val())}`));
      }
    });
    await pageWaitFor(page, () => window.logs.events!.length === 4);
    await server.request("POST", adminRoutes.jsonUpdate, {
      store: { artifactID },
      path: "list",
      entries: [
        { key: "a", value: { value: 3 } },
        { key: "b", delete: true },
        { key: "c", value: { value: 4 } },
        { key: "0", value: { value: 9 } },
      ],
    });
    await server.jsonSet({ artifactID }, "arr", [1, 2, 3]);
    await server.jsonSet({ artifactID }, "s", "y");
    await pageWaitFor(page, () => window.logs.events!.length === 8);
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs.events)).toEqual([
      "list added 2=0",
      "list added 10=0",
      "list added a=2",
      "list added b=1",
      "list added 0=9",
      "list changed a=3",
      "list removed b=1",
      "list added c=4",
    ]);
  });

  test("rejects a write once the page knows its access through a share link is read, and an oversized write, before any listener is called", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0, list: [] });
    const shareID = await server.sharedAt(artifactID, "read-write");
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));
    await page.evaluate(() => {
      const access = window.record("access");
      window.sdk.onAccessChanged((level) => access.push(level));
    });
    await watchValues(page, ["n", "list"]);

    const sent = proxy.messages.length;
    const oversized = await page.evaluate(async () => {
      const value = Array.from({ length: 300_000 }, () => window.sdk.increment(1));
      return window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "list"), value));
    });
    expect(oversized).toEqual(refusedWith("too-large"));
    await sleep(QUIET_MS);
    expect(proxy.messages).toHaveLength(sent);
    expect((await shots(page, "list")).length).toBe(1);

    expect((await server.share(artifactID, "read")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.access!.at(-1) === "read");
    expect(await page.evaluate(() => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 5)))).toEqual(
      refusedWith("read-only"),
    );
    expect((await shots(page, "n")).length).toBe(1);
    expect(proxy.messages).toHaveLength(sent);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { n: 0, list: [] } });
  });

  test("with the bindings hook, rejects a write to a bound store once the page knows its level on it is read, from the opening state or a bound event, before any listener is called", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID } = await context.pageWithStore(server, { n: 0 });
    const bound = await server.createdStore({ value: { n: 0 } });
    await server.bind(bound, artifactID, "read-write");
    const shareID = await server.sharedAt(artifactID, "read");
    const proxy = await context.proxy(server);
    const write = () => page.evaluate((id) => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(id), "n"), 5)), bound);
    const watch = () =>
      page.evaluate(async (id) => {
        const shots = window.record("n");
        const events = window.record("events");
        window.sdk.onResourcesChanged((event) => events.push(event));
        window.sdk.onValue(window.sdk.ref(window.sdk.getStore(id), "n"), (snapshot) => shots.push(window.shot(snapshot)));
      }, bound);

    // Through the share link at read, the opening state gives the page read on the bound store.
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));
    await watch();
    await pageWaitFor(page, () => window.logs.n!.length === 1);
    const sent = proxy.messages.length;
    expect(await write()).toEqual(refusedWith("read-only"));
    await sleep(QUIET_MS);
    expect((await shots(page, "n")).length).toBe(1);
    expect(proxy.messages.length).toBe(sent);

    // Under the artifact's ID, a bound event gives it the binding's new level.
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watch();
    await pageWaitFor(page, () => window.logs.n!.length === 1);
    await server.bind(bound, artifactID, "read");
    await pageWaitFor(page, () => window.logs.events!.length === 1);
    const sentNow = proxy.messages.length;
    expect(await write()).toEqual(refusedWith("read-only"));
    await sleep(QUIET_MS);
    expect((await shots(page, "n")).length).toBe(1);
    expect(proxy.messages.length).toBe(sentNow);
    expect((await server.jsonGet({ resourceID: bound }, "n")).body).toEqual({ exists: true, value: 0 });
  });

  test("with the bindings hook, rejects a write to the artifact's own store by its resource ID once the page knows its level is read, whether the opening state gave it that resource ID or another client's first write created the store, before any listener is called", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const unwritten = context.createPageArtifact(server, "Unwritten");
    const proxy = await context.proxy(server);
    const write = (id: string) => page.evaluate((own) => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(own), "n"), 5)), id);
    const watch = (id: string) =>
      page.evaluate((own) => {
        const shots = window.record("n");
        window.sdk.onValue(window.sdk.ref(window.sdk.getStore(own), "n"), (snapshot) => shots.push(window.shot(snapshot)));
      }, id);

    // The opening state gives the page its store's resource ID.
    await openPage(page, pageURL(proxy.port, artifactPath(await server.sharedAt(artifactID, "read"))));
    await watch(resourceID);
    await pageWaitFor(page, () => window.logs.n!.length === 1);
    expect(await write(resourceID)).toEqual(refusedWith("read-only"));
    await sleep(QUIET_MS);
    expect((await shots(page, "n")).length).toBe(1);
    expect(writesSent(proxy)).toBe(0);

    // Another client's first write creates the store while the page is connected.
    await openPage(page, pageURL(proxy.port, artifactPath(await server.sharedAt(unwritten, "read"))));
    await page.evaluate(() => {
      const events = window.record("events");
      window.sdk.onResourcesChanged((event) => events.push(event));
    });
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");
    await server.jsonSet({ artifactID: unwritten }, "n", 0);
    await pageWaitFor(page, () => window.logs.events!.length === 1);
    const created = server.storePointer(unwritten)!;
    await watch(created);
    await pageWaitFor(page, () => window.logs.n!.length === 1);
    expect(await write(created)).toEqual(refusedWith("read-only"));
    await sleep(QUIET_MS);
    expect((await shots(page, "n")).length).toBe(1);
    expect(writesSent(proxy)).toBe(0);
    expect(await stored(server, unwritten)).toEqual({ exists: true, value: { n: 0 } });
  });

  test("with the bindings hook, treats the artifact's own store as one store by either address: a write through one shows at once at both, pending until confirmed, a transaction through the other starts from it, and a lost connection rolls it back at both", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate((own) => {
      for (const [name, store] of [
        ["own", window.sdk.getStore()],
        ["byID", window.sdk.getStore(own)],
      ] as const) {
        const shots = window.record(name);
        window.sdk.onValue(window.sdk.ref(store, "n"), (snapshot) => shots.push(window.shot(snapshot)));
      }
    }, resourceID);
    await pageWaitFor(page, () => window.logs.own!.length === 1 && window.logs.byID!.length === 1);
    const write = (address: "own" | "byID", value: number) =>
      page.evaluate(
        ([own, through, n]) => void window.sdk.set(window.sdk.ref(through === "own" ? window.sdk.getStore() : window.sdk.getStore(own), "n"), n),
        [resourceID, address, value] as const,
      );
    const history = async () => ({
      own: (await shots(page, "own")).map((shot) => [shot.value, shot.pending]),
      byID: (await shots(page, "byID")).map((shot) => [shot.value, shot.pending]),
    });
    const both = (states: Array<[number, boolean]>) => ({ own: states, byID: states });

    // A write through each address, held unconfirmed and then confirmed.
    for (const [address, value] of [
      ["own", 1],
      ["byID", 2],
    ] as const) {
      proxy.hold("to-browser");
      await write(address, value);
      expect((await history()).own.at(-1), address).toEqual([value, true]);
      expect((await history()).byID.at(-1), address).toEqual([value, true]);
      proxy.release("to-browser");
      await pageWaitFor(page, () => [window.logs.own!, window.logs.byID!].every((log) => (log.at(-1) as Shot).pending === false));
    }
    expect(await history()).toEqual(both([[0, false], [1, true], [1, false], [2, true], [2, false]]));

    // A transaction at the root through the resource ID, where only getStore()
    // listens, starts without fetching from the value a write through
    // getStore() shows, and its snapshot is pending while a later write
    // through getStore() is unconfirmed.
    type Held = { transaction?: unknown };
    await page.evaluate(() => {
      const shots = window.record("root");
      window.sdk.onValue(window.sdk.ref(window.sdk.getStore()), (snapshot) => shots.push(window.shot(snapshot)));
    });
    await pageWaitFor(page, () => window.logs.root!.length === 1);
    proxy.hold("to-browser");
    await write("own", 4);
    await page.evaluate((own) => {
      void window.sdk
        .runTransaction(window.sdk.ref(window.sdk.getStore(own)), (root) => ({ n: (root as { n: number }).n * 10 }))
        .then(({ committed, snapshot }) => {
          (window as unknown as Held).transaction = { committed, value: snapshot.val(), pending: snapshot.metadata.hasPendingWrites };
        });
    }, resourceID);
    await write("own", 7);
    proxy.release("to-browser");
    await pageWaitFor(page, () => (window as unknown as Held).transaction !== undefined);
    expect(await page.evaluate(() => (window as unknown as Held).transaction)).toEqual({ committed: true, value: { n: 40 }, pending: true });
    await pageWaitFor(page, () => [window.logs.own!, window.logs.byID!].every((log) => (log.at(-1) as Shot).pending === false));
    expect((await history()).own.at(-1)).toEqual([7, false]);
    expect((await history()).byID.at(-1)).toEqual([7, false]);
    expect(proxy.messages.filter(({ message }) => message.type === "get")).toEqual([]);

    // A write the server never receives, through the resource ID, rolled back when the connection is lost.
    proxy.holdWrites();
    await write("byID", 3);
    await proxy.waitFor(() => proxy.heldWriteCount === 1);
    proxy.refuse(true);
    proxy.sever();
    proxy.releaseWrites();
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "disconnected");
    await sleep(QUIET_MS);
    expect((await history()).own.slice(-2)).toEqual([[3, true], [7, false]]);
    expect((await history()).byID.slice(-2)).toEqual([[3, true], [7, false]]);
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 7 });
  });

  test("with the bindings hook, stops showing a write through the own store's resource ID at getStore()'s listeners once a destroy takes that resource ID away, and after the server refuses it", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate((own) => {
      const errors = window.record("errors");
      for (const [name, store] of [
        ["own", window.sdk.getStore()],
        ["byID", window.sdk.getStore(own)],
      ] as const) {
        const shots = window.record(name);
        window.sdk.onValue(
          window.sdk.ref(store, "n"),
          (snapshot) => shots.push(window.shot(snapshot)),
          (error) => errors.push(`${name} ${(error as Error & { code: string }).code}`),
        );
      }
    }, resourceID);
    await pageWaitFor(page, () => window.logs.own!.length === 1 && window.logs.byID!.length === 1);
    const ownHistory = async () => (await shots(page, "own")).map((shot) => [shot.exists ? shot.value : "none", shot.pending]);
    type Held = { written?: unknown };

    // A write through the resource ID that the server does not receive until after the destroy.
    proxy.holdWrites();
    await page.evaluate((own) => {
      void window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(own), "n"), 1)).then((outcome) => ((window as unknown as Held).written = outcome));
    }, resourceID);
    await proxy.waitFor(() => proxy.heldWriteCount === 1);
    expect(await ownHistory()).toEqual([
      [0, false],
      [1, true],
    ]);

    // The destroy ends the listener through the resource ID and takes the resource ID out of the page's access.
    expect((await server.destroy(resourceID, true)).status).toBe(200);
    await pageWaitFor(page, () => window.logs.errors!.length === 1);
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs.errors)).toEqual(["byID not-bound"]);
    expect(await ownHistory()).toEqual([
      [0, false],
      [1, true],
      ["none", false],
    ]);

    // The server refuses the write, and getStore()'s listener hears nothing more of it.
    proxy.releaseWrites();
    await pageWaitFor(page, () => (window as unknown as Held).written !== undefined);
    expect(await page.evaluate(() => (window as unknown as Held).written)).toEqual(refusedWith("not-bound"));
    await sleep(QUIET_MS);
    expect(await ownHistory()).toEqual([
      [0, false],
      [1, true],
      ["none", false],
    ]);
    expect(await stored(server, artifactID)).toEqual({ exists: false });
  });

  test("with the bindings hook, rejects a write made in the callback that hears the link's level become read, to the artifact's own store by either address and to a bound store, and shows and applies one made when it is back to read-write", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const { artifactID, resourceID } = await context.pageWithStore(server, { n: 0 });
    const bound = await server.createdStore({ value: { n: 0 } });
    await server.bind(bound, artifactID, "read-write");
    const shareID = await server.sharedAt(artifactID, "read-write");
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));
    await page.evaluate(
      ({ own, other }) => {
        const outcomes = window.record("outcomes");
        const shots = window.record("shots");
        const stores = { own: window.sdk.getStore(), byID: window.sdk.getStore(own), bound: window.sdk.getStore(other) };
        for (const [name, store] of Object.entries(stores)) {
          window.sdk.onValue(window.sdk.ref(store, "n"), (snapshot) => shots.push({ name, ...window.shot(snapshot) }));
        }
        let heard = 0;
        window.sdk.onAccessChanged((access) => {
          heard += 1;
          if (heard === 1) return;
          for (const [name, store] of Object.entries(stores)) {
            void window.outcome(() => window.sdk.set(window.sdk.ref(store, "n"), heard)).then((outcome) => outcomes.push({ access, name, outcome }));
          }
        });
      },
      { own: resourceID, other: bound },
    );
    await pageWaitFor(page, () => window.logs.shots!.length === 3);

    expect((await server.share(artifactID, "read")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.outcomes!.length === 3);
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs.outcomes)).toEqual(
      ["own", "byID", "bound"].map((name) => ({ access: "read", name, outcome: refusedWith("read-only") })),
    );
    expect((await page.evaluate(() => window.logs.shots!)).length).toBe(3);
    expect(writesSent(proxy)).toBe(0);

    expect((await server.share(artifactID, "read-write")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.outcomes!.length === 6);
    expect((await page.evaluate(() => window.logs.outcomes!)).slice(3)).toEqual(
      ["own", "byID", "bound"].map((name) => ({ access: "read-write", name, outcome: { ok: true, value: undefined } })),
    );
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 3 });
    expect((await server.jsonGet({ resourceID: bound }, "n")).body).toEqual({ exists: true, value: 3 });
  });

  test("with the bindings hook, on a page whose artifact has no store, rejects a write made in the callback that hears one bound store become read to another that the same change made read", async ({ page }) => {
    const server = await context.start({ resourceBindings: true });
    const storeless = context.createPageArtifact(server, "No store", { id: "page-without-a-store" });
    const first = await server.createdStore({ value: { n: 0 } });
    const second = await server.createdStore({ value: { n: 0 } });
    await server.bind(first, storeless, "read-write");
    await server.bind(second, storeless, "read-write");
    const shareID = await server.sharedAt(storeless, "read-write");
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));
    await page.evaluate(
      (ids) => {
        const outcomes = window.record("outcomes");
        const shots = window.record("shots");
        for (const id of ids) {
          window.sdk.onValue(window.sdk.ref(window.sdk.getStore(id), "n"), (snapshot) => shots.push({ id, ...window.shot(snapshot) }));
        }
        let wrote = false;
        window.sdk.onResourcesChanged((event) => {
          if (event.event !== "bound" || wrote) return;
          wrote = true;
          const other = ids.find((id) => id !== event.resourceID)!;
          void window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(other), "n"), 5)).then((outcome) => outcomes.push(outcome));
        });
      },
      [first, second],
    );
    await pageWaitFor(page, () => window.logs.shots!.length === 2);

    expect((await server.share(storeless, "read")).status).toBe(200);
    await pageWaitFor(page, () => window.logs.outcomes!.length === 1);
    await sleep(QUIET_MS);
    expect(await page.evaluate(() => window.logs.outcomes)).toEqual([refusedWith("read-only")]);
    expect((await page.evaluate(() => window.logs.shots!)).length).toBe(2);
    expect(writesSent(proxy)).toBe(0);
  });

  test("stops relying on a read level it learned once that connection has closed, whether nothing was outstanding or it was lost", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0 });
    const shareID = await server.sharedAt(artifactID, "read");
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));

    // Closed because nothing was outstanding: the next write opens a connection and learns the new level.
    expect(await page.evaluate(() => window.sdk.getAccess())).toBe("read");
    await proxy.waitFor(() => proxy.openWebSockets === 0);
    expect((await server.share(artifactID, "read-write")).status).toBe(200);
    expect(await page.evaluate(() => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 1)))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 1 });

    // Lost: while disconnected a write fails with disconnected, not read-only; reconnected at the
    // link's new read-write level, a write is shown and applied.
    expect((await server.share(artifactID, "read")).status).toBe(200);
    await watchValues(page, ["n"]);
    expect(await page.evaluate(() => window.sdk.getAccess())).toBe("read");
    proxy.refuse(true);
    proxy.sever();
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "disconnected");
    expect((await server.share(artifactID, "read-write")).status).toBe(200);
    expect(await page.evaluate(() => window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 2)))).toEqual(
      refusedWith("disconnected"),
    );
    proxy.refuse(false);
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "connected");
    const shown = await page.evaluate(() => {
      (window as unknown as { pending: Promise<Outcome> }).pending = window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 2));
      return window.logs.n!.at(-1) as Shot;
    });
    expect(shown).toEqual({ key: "n", exists: true, value: 2, pending: true });
    expect(await page.evaluate(() => (window as unknown as { pending: Promise<Outcome> }).pending)).toEqual({ ok: true, value: undefined });
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 2 });
  });

  test("sends a write that a listener makes as it hears the page's own write after that write, so both are applied", async ({ page }) => {
    const { server, artifactID } = await ownStore({ a: 0, b: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    const outcomes = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      let follow: Promise<void> | undefined;
      await new Promise<void>((heard) => {
        window.sdk.onValue(window.sdk.ref(store, "a"), (snapshot) => {
          if (snapshot.val() === 1 && follow === undefined) follow = window.sdk.set(window.sdk.ref(store, "b"), 1);
          heard();
        });
      });
      const first = window.outcome(() => window.sdk.set(window.sdk.ref(store, "a"), 1));
      return [await first, await window.outcome(() => follow!)];
    });
    expect(outcomes).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: undefined },
    ]);
    expect(writeSeqs(proxy).map(({ seq }) => seq)).toEqual([1, 2]);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { a: 1, b: 1 } });
  });

  test("shows each write as it was made, whatever the page later does to the values it passed", async ({ page }) => {
    const { server, artifactID } = await ownStore({ set: { n: 0 }, update: { n: 0 }, count: { n: 0 }, other: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await watchValues(page, ["set", "update", "pushed", "count"]);
    const outcomes = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      const at = (path: string) => window.sdk.ref(store, path);
      const setValue = { n: 1 };
      const updateValue = { n: 1 };
      const pushValue = { n: 1 };
      let transactionValue: { n: number } | undefined;
      const writes = [
        window.outcome(() => window.sdk.set(at("set"), setValue)),
        window.outcome(() => window.sdk.update(at(""), { update: updateValue })),
        window.outcome(() => window.sdk.push(at("pushed"), pushValue).then(() => undefined)),
        window.outcome(() => window.sdk.runTransaction(at("count"), () => (transactionValue = { n: 1 })).then(() => undefined)),
      ];
      // The listener held the transaction's value, so its function has run.
      setValue.n = 2;
      updateValue.n = 2;
      pushValue.n = 2;
      transactionValue!.n = 2;
      writes.push(window.outcome(() => window.sdk.set(at("other"), 1)));
      return Promise.all(writes);
    });
    expect(outcomes).toEqual(Array.from({ length: 5 }, () => ({ ok: true, value: undefined })));
    const pushed = (await stored(server, artifactID, "pushed")) as { value: Record<string, unknown> };
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { set: { n: 1 }, update: { n: 1 }, count: { n: 1 }, other: 1, pushed: pushed.value } });
    expect(Object.values(pushed.value)).toEqual([{ n: 1 }]);
    for (const path of ["set", "update", "count"]) {
      await page.waitForFunction((watched) => (window.logs[watched]!.at(-1) as Shot).pending === false, path);
      expect((await shots(page, path)).map((shot) => [shot.value, shot.pending]), path).toEqual([
        [{ n: 0 }, false],
        [{ n: 1 }, true],
        [{ n: 1 }, false],
      ]);
    }
    await pageWaitFor(page, () => (window.logs.pushed!.at(-1) as Shot).pending === false);
    expect((await shots(page, "pushed")).map((shot) => [shot.value, shot.pending])).toEqual([
      [undefined, false],
      [pushed.value, true],
      [pushed.value, false],
    ]);
  });

  test("applies an update of existing array elements whose result is within the size limit, though the same keys in an object would exceed it", async ({
    page,
  }) => {
    // 110,000 one-digit elements take 220,001 bytes as an array, and over 1 MiB as an object keyed by index.
    const length = 110_000;
    const { server, artifactID } = await ownStore({ list: Array.from({ length }, () => 1) });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["list/0"]);
    proxy.hold("to-browser");
    const shown = await page.evaluate((count) => {
      const entries: Record<string, number> = {};
      for (let index = 0; index < count; index++) entries[index] = 2;
      (window as unknown as { pending: Promise<Outcome> }).pending = window.outcome(() =>
        window.sdk.update(window.sdk.ref(window.sdk.getStore(), "list"), entries),
      );
      return window.logs["list/0"]!.at(-1) as Shot;
    }, length);
    expect(shown).toEqual({ key: "0", exists: true, value: 2, pending: true });
    proxy.release("to-browser");
    expect(await page.evaluate(() => (window as unknown as { pending: Promise<Outcome> }).pending)).toEqual({ ok: true, value: undefined });
    const list = ((await stored(server, artifactID, "list")) as { value: number[] }).value;
    expect(list).toHaveLength(length);
    expect(list.every((element) => element === 2)).toBe(true);
  });

  test("delivers a change in full before the change a callback's write makes, so a list kept from child events matches the store", async ({ page }) => {
    const { server, artifactID } = await ownStore({ known: { a: 1, b: 2 } });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await watchValues(page, ["known", "fresh"]);
    const lists = await page.evaluate(async () => {
      const store = window.sdk.getStore();
      const removals: Array<Promise<void>> = [];
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      /** Keeps a list of the children at `path` from its child events; hearing `a` added, it removes `b`. */
      const keep = async (path: string) => {
        const events = window.record(`${path} events`);
        const list = new Set<string>();
        const at = window.sdk.ref(store, path);
        window.sdk.onChildRemoved(at, (child) => {
          events.push(`removed ${child.key!}`);
          list.delete(child.key!);
        });
        await tick();
        window.sdk.onChildAdded(at, (child) => {
          events.push(`added ${child.key!}`);
          list.add(child.key!);
          if (child.key === "a") removals.push(window.sdk.remove(window.sdk.child(at, "b")));
        });
        await tick();
        return list;
      };
      // known holds a and b already, so the added listener hears them in its first delivery.
      const known = await keep("known");
      // fresh gets them from the page's own write.
      const fresh = await keep("fresh");
      await window.sdk.set(window.sdk.ref(store, "fresh"), { a: 1, b: 2 });
      await Promise.all(removals);
      return { known: [...known], fresh: [...fresh] };
    });
    expect(lists).toEqual({ known: ["a"], fresh: ["a"] });
    expect(await page.evaluate(() => [window.logs["known events"], window.logs["fresh events"]])).toEqual([
      ["added a", "added b", "removed b"],
      ["added a", "added b", "removed b"],
    ]);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { known: { a: 1 }, fresh: { a: 1 } } });
  });

  test("delivers a change to every onValue listener before the change a callback's write makes", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const at = window.sdk.ref(window.sdk.getStore(), "n");
      const first = window.record("first");
      const second = window.record("second");
      const held = window as unknown as { followed?: Promise<void> };
      window.sdk.onValue(at, (snapshot) => {
        first.push(window.shot(snapshot));
        if (snapshot.val() === 1 && held.followed === undefined) held.followed = window.sdk.set(at, 2);
      });
      window.sdk.onValue(at, (snapshot) => second.push(window.shot(snapshot)));
    });
    await pageWaitFor(page, () => window.logs.first!.length === 1 && window.logs.second!.length === 1);
    await page.evaluate(async () => {
      await window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 1);
      await (window as unknown as { followed: Promise<void> }).followed;
    });
    await pageWaitFor(page, () => (window.logs.first!.at(-1) as Shot).pending === false && (window.logs.second!.at(-1) as Shot).pending === false);
    const history = [
      [0, false],
      [1, true],
      [2, true],
      [2, false],
    ];
    expect((await shots(page, "first")).map((shot) => [shot.value, shot.pending])).toEqual(history);
    expect((await shots(page, "second")).map((shot) => [shot.value, shot.pending])).toEqual(history);
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 2 });
  });

  test("delivers every change that several writes in one callback make, each in turn", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0, list: {} });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await watchValues(page, ["list"]);
    await page.evaluate(() => {
      const store = window.sdk.getStore();
      const n = window.sdk.ref(store, "n");
      const list = window.sdk.ref(store, "list");
      const first = window.record("first");
      const second = window.record("second");
      const third = window.record("third");
      const events = window.record("events");
      const held = window as unknown as { followed: Array<Promise<void>> };
      held.followed = [];
      window.sdk.onValue(n, (snapshot) => {
        first.push(window.shot(snapshot));
        if (snapshot.val() !== 1) return;
        held.followed.push(window.sdk.set(n, 2), window.sdk.set(n, 3));
        // Added once the page shows 3: it first hears 3, not the changes before it.
        window.sdk.onValue(n, (added) => third.push(window.shot(added)));
      });
      window.sdk.onValue(n, (snapshot) => second.push(window.shot(snapshot)));
      window.sdk.onChildAdded(list, (child) => {
        events.push(`added ${child.key!}`);
        if (child.key === "a") held.followed.push(window.sdk.set(window.sdk.child(list, "c"), 1), window.sdk.remove(window.sdk.child(list, "c")));
      });
      window.sdk.onChildRemoved(list, (child) => events.push(`removed ${child.key!}`));
    });
    await pageWaitFor(page, () => window.logs.first!.length === 1 && window.logs.second!.length === 1);
    await page.evaluate(async () => {
      const store = window.sdk.getStore();
      await Promise.all([window.sdk.set(window.sdk.ref(store, "n"), 1), window.sdk.set(window.sdk.ref(store, "list/a"), 1)]);
      await Promise.all((window as unknown as { followed: Array<Promise<void>> }).followed);
    });
    await pageWaitFor(page, () => ["first", "second", "third"].every((name) => (window.logs[name]!.at(-1) as Shot | undefined)?.pending === false));
    const history = [
      [0, false],
      [1, true],
      [2, true],
      [3, true],
      [3, false],
    ];
    expect({
      first: (await shots(page, "first")).map((shot) => [shot.value, shot.pending]),
      second: (await shots(page, "second")).map((shot) => [shot.value, shot.pending]),
      third: (await shots(page, "third")).map((shot) => [shot.value, shot.pending]),
      events: await page.evaluate(() => window.logs.events),
    }).toEqual({
      first: history,
      second: history,
      third: [
        [3, true],
        [3, false],
      ],
      events: ["added a", "added c", "removed c"],
    });
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { n: 3, list: { a: 1 } } });
  });

  test("delivers each change at every watched path before a callback's writes change the store again", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const store = window.sdk.getStore();
      const n = window.sdk.ref(store, "n");
      const atN = window.record("n");
      const atRoot = window.record("root");
      const held = window as unknown as { followed: Array<Promise<void>> };
      held.followed = [];
      window.sdk.onValue(n, (snapshot) => {
        atN.push(window.shot(snapshot));
        if (snapshot.val() === 1) held.followed.push(window.sdk.set(n, 2), window.sdk.set(n, 3));
      });
      window.sdk.onValue(window.sdk.ref(store), (snapshot) => atRoot.push(window.shot(snapshot)));
    });
    await pageWaitFor(page, () => window.logs.n!.length === 1 && window.logs.root!.length === 1);
    await page.evaluate(async () => {
      await window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 1);
      await Promise.all((window as unknown as { followed: Array<Promise<void>> }).followed);
    });
    await pageWaitFor(page, () => (window.logs.n!.at(-1) as Shot).pending === false && (window.logs.root!.at(-1) as Shot).pending === false);
    expect({
      n: (await shots(page, "n")).map((shot) => [shot.value, shot.pending]),
      root: (await shots(page, "root")).map((shot) => [shot.value, shot.pending]),
    }).toEqual({
      n: [
        [0, false],
        [1, true],
        [2, true],
        [3, true],
        [3, false],
      ],
      root: [
        [{ n: 0 }, false],
        [{ n: 1 }, true],
        [{ n: 2 }, true],
        [{ n: 3 }, true],
        [{ n: 3 }, false],
      ],
    });
  });

  test("starts a listener from the value where it was added, so it hears a change made before its first delivery", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: { a: 1, b: 2 } });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await watchValues(page, ["list"]);
    const heard = await page.evaluate(async () => {
      const list = window.sdk.ref(window.sdk.getStore(), "list");
      const events: string[] = [];
      window.sdk.onChildRemoved(list, (child) => events.push(`removed ${child.key!}`));
      window.sdk.onChildAdded(list, (child) => events.push(`added ${child.key!}`));
      const values: unknown[] = [];
      window.sdk.onValue(list, (snapshot) => values.push([snapshot.val(), snapshot.metadata.hasPendingWrites]));
      // Before any of the three has had its first delivery.
      await window.sdk.remove(window.sdk.child(list, "b"));
      return { events, values };
    });
    expect(heard).toEqual({
      events: ["added a", "added b", "removed b"],
      values: [
        [{ a: 1, b: 2 }, false],
        [{ a: 1 }, true],
        [{ a: 1 }, false],
      ],
    });
  });

  test("gives each snapshot the hasPendingWrites of the change that called the listener, not of a write a callback made since", async ({ page }) => {
    const { server, artifactID } = await ownStore({ list: {} });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await page.evaluate(() => {
      const list = window.sdk.ref(window.sdk.getStore(), "list");
      const children = window.record("children");
      const held = window as unknown as { followed: Array<Promise<void>> };
      held.followed = [];
      window.sdk.onChildAdded(list, (child) => {
        children.push(`added ${child.key!}=${JSON.stringify(child.val())} ${child.metadata.hasPendingWrites}`);
        if (child.key === "a") held.followed.push(window.sdk.set(window.sdk.child(list, "b"), 2));
      });
      window.sdk.onChildChanged(list, (child) => {
        children.push(`changed ${child.key!}=${JSON.stringify(child.val())} ${child.metadata.hasPendingWrites}`);
      });
      const values = window.record("list");
      window.sdk.onValue(list, (snapshot) => values.push(window.shot(snapshot)));
    });
    await pageWaitFor(page, () => window.logs.list!.length === 1);
    // Another client's change: nothing is pending when it arrives, and the onChildAdded callback for a writes before b is heard.
    await server.jsonSet({ artifactID }, "list", { a: 1, b: 1 });
    await pageWaitFor(page, () => window.logs.list!.length === 4);
    await page.evaluate(() => Promise.all((window as unknown as { followed: Array<Promise<void>> }).followed));
    expect({
      children: await page.evaluate(() => window.logs.children),
      list: (await shots(page, "list")).map((shot) => [shot.value, shot.pending]),
    }).toEqual({
      children: ["added a=1 false", "added b=1 false", "changed b=2 true"],
      list: [
        [{}, false],
        [{ a: 1, b: 1 }, false],
        [{ a: 1, b: 2 }, true],
        [{ a: 1, b: 2 }, false],
      ],
    });
    expect(await stored(server, artifactID, "list")).toEqual({ exists: true, value: { a: 1, b: 2 } });
  });

  test("keeps each listener's history to the states the page showed after it was added, in order, whatever callbacks do (generated programs)", async ({
    page,
  }) => {
    const seeds = Array.from({ length: 40 }, (_, index) => index + 1);
    const server = await context.start({ resourceBindings: true });
    const start = (store: string) => Object.fromEntries(seeds.map((seed) => [`p${seed}`, PROGRAM_START[store]!]));
    // The programs' two stores: the artifact's own, and a created store bound to it at read-write.
    const { artifactID } = await context.pageWithStore(server, start("todos"));
    const other = await server.createdStore({ value: start("other") });
    await server.bind(other, artifactID, "read-write");
    const addresses: Record<string, { artifactID: string } | { resourceID: string }> = { todos: { artifactID }, other: { resourceID: other } };
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    const problems: string[] = [];
    for (const seed of seeds) {
      const result = await page.evaluate(runCallbackProgram, { seed, budget: 30, other });
      const finals: Record<string, JSONValue | undefined> = {};
      for (const store of Object.keys(PROGRAM_START)) {
        const read = (await server.jsonGet(addresses[store]!, `p${seed}`)).body as { exists: boolean; value?: JSONValue };
        finals[store] = read.exists ? read.value : undefined;
      }
      problems.push(...checkProgram(seed, result, finals));
    }
    expect(problems).toEqual([]);
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-refused-after-shown
test.describe("a write the server refuses after the page showed it", () => {
  test("rolls back to the previous value and rejects with read-only when the share link's level became read meanwhile", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0 });
    const shareID = await server.sharedAt(artifactID, "read-write");
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(shareID)));
    await watchValues(page, ["n"]);
    proxy.hold("to-server");
    proxy.hold("to-browser");
    await page.evaluate(() => {
      (window as unknown as { pending: Promise<Outcome> }).pending = window.outcome(() => window.sdk.set(window.sdk.ref(window.sdk.getStore(), "n"), 5));
    });
    expect((await shots(page, "n")).at(-1)).toEqual({ key: "n", exists: true, value: 5, pending: true });
    expect((await server.share(artifactID, "read")).status).toBe(200);
    proxy.release("to-browser");
    proxy.release("to-server");
    expect(await page.evaluate(() => (window as unknown as { pending: Promise<Outcome> }).pending)).toEqual(refusedWith("read-only"));
    expect((await shots(page, "n")).map((shot) => [shot.value, shot.pending])).toEqual([
      [0, false],
      [5, true],
      [0, false],
    ]);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { n: 0 } });
  });
});

/** The sequence numbers of the writes the page sent on each connection. */
function writeSeqs(proxy: Awaited<ReturnType<SdkTestContext["proxy"]>>): Array<{ connection: number; seq: unknown }> {
  return proxy.messages.filter(({ message }) => message.type === "write").map(({ connection, message }) => ({ connection, seq: message.seq }));
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-lost-connection
test.describe("a lost connection with unconfirmed writes", () => {
  test("rolls both writes back at once with disconnected, sends neither again, and shows the current value once on reconnection", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0, other: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await page.evaluate(() => {
      const root = window.record("root");
      const store = window.sdk.getStore();
      const held = window as unknown as { results: Record<string, unknown> };
      held.results = {};
      let sawPending = false;
      window.sdk.onValue(window.sdk.ref(store), (snapshot) => {
        root.push(window.shot(snapshot));
        if (snapshot.metadata.hasPendingWrites) sawPending = true;
        // A write the listener makes as it hears the rollback.
        else if (sawPending && held.results.late === undefined) {
          held.results.late = "waiting";
          void window.outcome(() => window.sdk.set(window.sdk.ref(store, "late"), 1)).then((result) => (held.results.late = result));
        }
      });
    });
    await pageWaitFor(page, () => window.logs.root!.length === 1);
    const write = (name: string) =>
      page.evaluate((result) => {
        const held = window as unknown as { results: Record<string, unknown> };
        const n = window.sdk.ref(window.sdk.getStore(), "n");
        void window.outcome(() => window.sdk.set(n, window.sdk.increment(1))).then(
          (outcome) => (held.results[result] = { ...outcome, status: window.sdk.getConnectionStatus() }),
        );
      }, name);

    // The server applies the first write and its reply is held; the second never reaches the server.
    proxy.hold("to-browser");
    await write("applied");
    await expect.poll(() => stored(server, artifactID, "n")).toEqual({ exists: true, value: 1 });
    proxy.holdWrites();
    await write("unsent");
    await proxy.waitFor(() => proxy.heldWriteCount === 1);
    proxy.refuse(true);
    proxy.sever();
    proxy.release("to-browser");
    proxy.releaseWrites();

    await pageWaitFor(page, () => Object.keys((window as unknown as { results: Record<string, unknown> }).results).length === 3, 5_000);
    const disconnected = { ...refusedWith("disconnected"), status: "disconnected" };
    await pageWaitFor(page, () => (window as unknown as { results: Record<string, unknown> }).results.late !== "waiting");
    expect(await page.evaluate(() => (window as unknown as { results: Record<string, unknown> }).results)).toEqual({
      applied: disconnected,
      unsent: disconnected,
      late: refusedWith("disconnected"),
    });
    expect((await shots(page, "root")).map((shot) => [shot.value, shot.pending])).toEqual([
      [{ n: 0, other: 0 }, false],
      [{ n: 1, other: 0 }, true],
      [{ n: 2, other: 0 }, true],
      [{ n: 0, other: 0 }, false],
    ]);

    await server.jsonSet({ artifactID }, "other", 1);
    await server.jsonSet({ artifactID }, "other", 2);
    proxy.refuse(false);
    await pageWaitFor(page, () => window.logs.root!.length === 5);
    await sleep(QUIET_MS);
    expect((await shots(page, "root")).slice(4).map((shot) => [shot.value, shot.pending])).toEqual([[{ n: 1, other: 2 }, false]]);
    const writes = writeSeqs(proxy);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.connection).toBe(proxy.messages[0]!.connection);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { n: 1, other: 2 } });
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-disconnected
test.describe("reads and writes while disconnected", () => {
  test("fail at once with disconnected, showing and sending nothing, while listeners registered before and during the loss stay and catch up", async ({
    page,
  }) => {
    const { server, artifactID } = await ownStore({ n: 0, other: { x: 0 } });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["n"]);

    // A get outstanding at the loss, its reply held.
    proxy.hold("to-browser");
    await page.evaluate(() => {
      (window as unknown as { outstanding: Promise<Outcome> }).outstanding = window.outcome(() =>
        window.sdk.get(window.sdk.ref(window.sdk.getStore(), "other")),
      );
    });
    await proxy.waitFor(() => proxy.messages.some(({ message }) => message.type === "get"));
    proxy.refuse(true);
    proxy.sever();
    proxy.release("to-browser");
    expect(await page.evaluate(() => (window as unknown as { outstanding: Promise<Outcome> }).outstanding)).toEqual(refusedWith("disconnected"));
    await pageWaitFor(page, () => window.sdk.getConnectionStatus() === "disconnected");

    const outcomes = await page.evaluate(async () => {
      const atOnce = window.atOnce;
      const store = window.sdk.getStore();
      const n = window.sdk.ref(store, "n");
      const calls: unknown[] = [];
      const pushed = window.sdk.push(window.sdk.ref(store, "list"), 1);
      return {
        get: await atOnce(() => window.sdk.get(n).then(() => undefined)),
        set: await atOnce(() => window.sdk.set(n, 5)),
        update: await atOnce(() => window.sdk.update(window.sdk.ref(store), { n: 6 })),
        remove: await atOnce(() => window.sdk.remove(n)),
        transaction: await atOnce(() =>
          window.sdk.runTransaction(n, (current) => {
            calls.push(current);
            return 7;
          }),
        ),
        push: await atOnce(() => pushed.then(() => undefined)),
        pushKey: pushed.key,
        calls,
      };
    });
    expect(outcomes).toEqual({
      get: refusedWith("disconnected"),
      set: refusedWith("disconnected"),
      update: refusedWith("disconnected"),
      remove: refusedWith("disconnected"),
      transaction: refusedWith("disconnected"),
      push: refusedWith("disconnected"),
      pushKey: expect.stringMatching(/^.{20}$/),
      calls: [],
    });
    expect((await shots(page, "n")).length).toBe(1);

    // A listener added during the loss, at a path no listener holds.
    await page.evaluate(() => {
      const during = window.record("other/x");
      window.sdk.onValue(window.sdk.ref(window.sdk.getStore(), "other/x"), (snapshot) => during.push(window.shot(snapshot)));
    });
    await server.jsonSet({ artifactID }, "n", 10);
    await server.jsonSet({ artifactID }, "other/x", 1);
    proxy.refuse(false);
    await pageWaitFor(page, () => (window.logs.n!.at(-1) as Shot).value === 10 && window.logs["other/x"]!.length === 1);
    await server.jsonSet({ artifactID }, "n", 11);
    await server.jsonSet({ artifactID }, "other/x", 2);
    await pageWaitFor(page, () => (window.logs.n!.at(-1) as Shot).value === 11 && window.logs["other/x"]!.length === 2);
    expect((await shots(page, "n")).map((shot) => shot.value)).toEqual([0, 10, 11]);
    expect((await shots(page, "other/x")).map((shot) => shot.value)).toEqual([1, 2]);
    expect(writeSeqs(proxy)).toEqual([]);
    expect(await stored(server, artifactID)).toEqual({ exists: true, value: { n: 11, other: { x: 2 } } });

    // After the reconnection, a write is shown and applied.
    const written = await page.evaluate(async () => {
      const n = window.sdk.ref(window.sdk.getStore(), "n");
      const done = window.outcome(() => window.sdk.set(n, 12));
      const shown = window.logs.n!.at(-1);
      return { shown, done: await done };
    });
    expect(written).toEqual({ shown: { key: "n", exists: true, value: 12, pending: true }, done: { ok: true, value: undefined } });
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 12 });
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-first-connection
test.describe("waiting for a first connection", () => {
  test("makes a write and a get made while connecting wait, then sends the write and answers the get once the opening state arrives", async ({ page }) => {
    const { server, artifactID } = await ownStore({ n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    proxy.hold("to-browser");
    const early = await page.evaluate(async () => {
      const atOnce = window.atOnce;
      const n = window.sdk.ref(window.sdk.getStore(), "n");
      const shots = window.record("n");
      window.sdk.onValue(n, (snapshot) => shots.push(window.shot(snapshot)));
      const held = window as unknown as { set: Promise<Outcome>; get: Promise<Outcome> };
      held.set = window.outcome(() => window.sdk.set(n, 1));
      held.get = window.outcome(() => window.sdk.get(n).then((snapshot) => [snapshot.val(), snapshot.metadata.hasPendingWrites]));
      return { status: window.sdk.getConnectionStatus(), set: await atOnce(() => held.set), get: await atOnce(() => held.get) };
    });
    expect(early).toEqual({ status: "connecting", set: "waiting", get: "waiting" });
    expect(proxy.messages).toEqual([]);

    proxy.release("to-browser");
    expect(
      await page.evaluate(async () => {
        const held = window as unknown as { set: Promise<Outcome>; get: Promise<Outcome> };
        return [await held.set, await held.get];
      }),
    ).toEqual([
      { ok: true, value: undefined },
      { ok: true, value: [1, true] },
    ]);
    await pageWaitFor(page, () => (window.logs.n!.at(-1) as Shot).pending === false);
    expect((await shots(page, "n")).map((shot) => [shot.value, shot.pending])).toEqual([
      [1, true],
      [1, false],
    ]);
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 1 });
  });

  test("rejects a write and a get made while connecting with disconnected when the first connection ends before its opening state, and rolls the write back", async ({
    page,
  }) => {
    const { server, artifactID } = await ownStore({ n: 0 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    proxy.hold("to-browser");
    await page.evaluate(() => {
      const n = window.sdk.ref(window.sdk.getStore(), "n");
      const shots = window.record("n");
      window.sdk.onValue(n, (snapshot) => shots.push(window.shot(snapshot)));
      const held = window as unknown as { set: Promise<Outcome>; get: Promise<Outcome> };
      held.set = window.outcome(() => window.sdk.set(n, 1));
      held.get = window.outcome(() => window.sdk.get(n).then(() => undefined));
    });
    await proxy.waitFor(() => proxy.openWebSockets === 1);
    proxy.sever();
    proxy.release("to-browser");
    expect(
      await page.evaluate(async () => {
        const held = window as unknown as { set: Promise<Outcome>; get: Promise<Outcome> };
        return [await held.set, await held.get];
      }),
    ).toEqual([refusedWith("disconnected"), refusedWith("disconnected")]);

    // The listener reconnects, and its first value does not include the write.
    await pageWaitFor(page, () => window.logs.n!.length === 1);
    expect(await shots(page, "n")).toEqual([{ key: "n", exists: true, value: 0, pending: false }]);
    expect(writeSeqs(proxy)).toEqual([]);
    expect(await stored(server, artifactID, "n")).toEqual({ exists: true, value: 0 });
  });
});

/** Sets `count` through the administrative route with a synchronous request, from the page's own code. */
/** The source of a function the page evaluates to set `count` in the artifact's store as another client, synchronously, through the administrative routes. */
function adminSetSource(artifactID: string): string {
  return `(token, value) => {
  const request = new XMLHttpRequest();
  request.open("POST", ${JSON.stringify(adminRoutes.jsonSet)}, false);
  request.setRequestHeader("Authorization", "Bearer " + token);
  request.setRequestHeader("Content-Type", "application/json");
  request.send(JSON.stringify({ store: { artifactID: ${JSON.stringify(artifactID)} }, path: "count", value: { value } }));
}`;
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-transactions
test.describe("transactions", () => {
  test("call the function with the value the page sees, fetched first when no listener holds it, and abort on undefined sending nothing", async ({ page }) => {
    const { server, artifactID } = await ownStore({ count: 5, free: 1 });
    const proxy = await context.proxy(server);
    await openPage(page, pageURL(proxy.port, artifactPath(artifactID)));
    await watchValues(page, ["count"]);
    const sent = proxy.messages.length;
    const aborted = await page.evaluate(async () => {
      const seen: unknown[] = [];
      const result = await window.sdk.runTransaction(window.sdk.ref(window.sdk.getStore(), "count"), (current) => {
        seen.push(current);
        return undefined;
      });
      return { seen, committed: result.committed, value: result.snapshot.val() };
    });
    expect(aborted).toEqual({ seen: [5], committed: false, value: 5 });
    await sleep(QUIET_MS);
    expect(proxy.messages).toHaveLength(sent);

    const fetched = await page.evaluate(async () => {
      const seen: unknown[] = [];
      const result = await window.sdk.runTransaction(window.sdk.ref(window.sdk.getStore(), "free"), (current) => {
        seen.push(current);
        return (current as number) + 1;
      });
      return { seen, committed: result.committed, value: result.snapshot.val() };
    });
    expect(fetched).toEqual({ seen: [1], committed: true, value: 2 });
    const types = proxy.messages.slice(sent).map(({ message }) => message.type);
    expect(types).toEqual(["get", "write"]);
    expect(proxy.messages.at(-1)!.message.write).toMatchObject({ kind: "compare-and-set", path: "free", expected: { exists: true, value: 1 }, value: 2 });
    expect(await stored(server, artifactID, "free")).toEqual({ exists: true, value: 2 });
  });

  test("call the function again with the current value after another client's change, showing each attempt in place of the last, and commit once", async ({
    page,
  }) => {
    const { server, artifactID } = await ownStore({ count: 5 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await watchValues(page, ["count"]);
    const result = await page.evaluate(
      async ({ token, source }) => {
        const adminSet = (0, eval)(source) as (token: string, value: number) => void;
        const seen: unknown[] = [];
        const outcome = await window.sdk.runTransaction(window.sdk.ref(window.sdk.getStore(), "count"), (current) => {
          seen.push(current);
          if (seen.length === 1) adminSet(token, 100);
          return (current as number) + 1;
        });
        return { seen, committed: outcome.committed, value: outcome.snapshot.val() };
      },
      { token: server.token, source: adminSetSource(artifactID) },
    );
    expect(result).toEqual({ seen: [5, 100], committed: true, value: 101 });
    expect(await stored(server, artifactID, "count")).toEqual({ exists: true, value: 101 });
    await pageWaitFor(page, () => (window.logs.count!.at(-1) as Shot).pending === false);
    expect((await shots(page, "count")).map((shot) => [shot.value, shot.pending])).toEqual([
      [5, false],
      [6, true],
      [101, true],
      [101, false],
    ]);
  });

  test("roll back an attempt after an abort, and reject with max-retries after 25 calls whose value always changed", async ({ page }) => {
    const { server, artifactID } = await ownStore({ count: 5 });
    await openPage(page, pageURL(serverPort(server), artifactPath(artifactID)));
    await watchValues(page, ["count"]);
    const aborted = await page.evaluate(
      async ({ token, source }) => {
        const adminSet = (0, eval)(source) as (token: string, value: number) => void;
        let calls = 0;
        const outcome = await window.sdk.runTransaction(window.sdk.ref(window.sdk.getStore(), "count"), (current) => {
          calls += 1;
          if (calls === 1) {
            adminSet(token, 100);
            return (current as number) + 1;
          }
          return undefined;
        });
        return { calls, committed: outcome.committed, value: outcome.snapshot.val() };
      },
      { token: server.token, source: adminSetSource(artifactID) },
    );
    expect(aborted).toEqual({ calls: 2, committed: false, value: 100 });
    await pageWaitFor(page, () => (window.logs.count!.at(-1) as Shot).value === 100);
    expect((await shots(page, "count")).map((shot) => [shot.value, shot.pending])).toEqual([
      [5, false],
      [6, true],
      [100, false],
    ]);

    const exhausted = await page.evaluate(
      async ({ token, source }) => {
        const adminSet = (0, eval)(source) as (token: string, value: number) => void;
        let calls = 0;
        const outcome = await window.outcome(() =>
          window.sdk.runTransaction(window.sdk.ref(window.sdk.getStore(), "count"), (current) => {
            calls += 1;
            adminSet(token, 1_000 + calls);
            return (current as number) + 1;
          }),
        );
        return { calls, outcome };
      },
      { token: server.token, source: adminSetSource(artifactID) },
    );
    expect(exhausted).toEqual({ calls: 25, outcome: refusedWith("max-retries") });
    expect(await stored(server, artifactID, "count")).toEqual({ exists: true, value: 1_025 });
    await pageWaitFor(page, () => (window.logs.count!.at(-1) as Shot).value === 1_025);
    expect((await shots(page, "count")).at(-1)).toEqual({ key: "count", exists: true, value: 1_025, pending: false });
  });
});
