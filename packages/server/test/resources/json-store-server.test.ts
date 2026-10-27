import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JSON_STORE_MAX_WRITE_MESSAGE_BYTES,
  adminRoutes,
  encodeUpdateEntries,
  encodeWriteValue,
  increment,
  serverTimestamp,
  utf8ByteLength,
  type JSONValue,
  type JsonReadResult,
  type ResourceEvent,
  type WriteValue,
} from "@telepath-computer/television-shared/resources";
import { failingStorage, pageWrite, ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

function update(server: RunningServer, artifactID: string, values: Record<string, Parameters<typeof encodeUpdateEntries>[0][string]>) {
  return server.request("POST", adminRoutes.jsonUpdate, { store: { artifactID }, path: "", entries: encodeUpdateEntries(values) });
}

/** An artifact whose own store holds `value`, written through the administrative routes. */
async function ownStore(server: RunningServer, value: JSONValue, title = "Artifact"): Promise<{ artifactID: string; resourceID: string }> {
  const artifactID = server.createArtifact(title);
  expect((await server.jsonSet({ artifactID }, "", value)).status).toBe(200);
  return { artifactID, resourceID: server.storePointer(artifactID)! };
}

/** Follows the value at a path of an artifact's own store through the artifact's page connection. */
async function follow(server: RunningServer, store: { artifactID: string }, jsonPath = "") {
  const page = await server.pageConnection(store.artifactID);
  const id = await page.subscribe(jsonPath);
  return { page, id, values: () => page.values(id).map((value) => value.result) };
}

/** A page's messages other than its events. */
function withoutEvents(messages: Array<{ type: string }>): Array<{ type: string }> {
  return messages.filter((message) => message.type !== "event");
}


// spec: proofs/arch/resources/json-store.md#^js-arch-t-apply-writes
describe("applying writes on the server", () => {
  it("applies concurrent writes from several clients each whole, one at a time", async () => {
    const server = await context.start();
    const tally = await ownStore(server, {});
    const follower = await follow(server, tally);
    const writers = ["w1", "w2", "w3"];
    const perWriter = 12;
    await Promise.all(writers.map(async (writer) => {
      for (let index = 0; index < perWriter; index++) {
        const id = `${writer}-${index}`;
        // Both halves of a write must appear together.
        const result = await update(server, tally.artifactID, { [`left/${id}`]: true, [`right/${id}`]: true });
        expect(result.status).toBe(200);
      }
    }));
    const total = writers.length * perWriter;
    await follower.page.log.waitFor((message) => message.type === "value" && message.result.exists && Object.keys((message.result.value as { left?: object }).left ?? {}).length === total);

    const values = follower.values().map((result) => (result.exists ? result.value : undefined)) as Array<{ left?: Record<string, true>; right?: Record<string, true> }>;
    expect(values).toHaveLength(total + 1);
    const applied: string[] = [];
    for (const [index, value] of values.entries()) {
      const left = Object.keys(value.left ?? {});
      expect(Object.keys(value.right ?? {}).sort()).toEqual([...left].sort());
      if (index === 0) {
        expect(left).toEqual([]);
        continue;
      }
      const added = left.filter((id) => !applied.includes(id));
      expect(added, `value ${index} adds exactly one write`).toHaveLength(1);
      expect(left).toHaveLength(applied.length + 1);
      applied.push(added[0]!);
    }
    for (const writer of writers) {
      // One client's writes apply in the order it sent them.
      const order = applied.filter((id) => id.startsWith(`${writer}-`));
      expect(order).toEqual(Array.from({ length: perWriter }, (_, index) => `${writer}-${index}`));
    }
  });

  it("fills serverTimestamp() with the server's time and increment(n), nested in an object, with the number before plus n", async () => {
    const server = await context.start();
    const { artifactID } = await ownStore(server, { counter: { n: 5, label: "x" } });
    const store = { artifactID };
    const sentAt = Date.now();
    expect((await server.jsonSet(store, "stamp", { at: serverTimestamp() })).status).toBe(200);
    const acknowledgedAt = Date.now();
    const stamp = (await server.jsonGet(store, "stamp/at")).body.value as number;
    expect(stamp).toBeGreaterThanOrEqual(sentAt);
    expect(stamp).toBeLessThanOrEqual(acknowledgedAt);

    await server.jsonSet(store, "counter", { n: increment(2), label: increment(3), fresh: increment(-4) });
    expect((await server.jsonGet(store, "counter")).body.value).toEqual({ n: 7, label: 3, fresh: -4 });
    await update(server, artifactID, { "counter/n": increment(10) });
    expect((await server.jsonGet(store, "counter/n")).body.value).toBe(17);
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-uncertain
describe("durability failures", () => {
  it("refuses a write that fails before the rename, leaving the file, reads and availability unchanged", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const { artifactID, resourceID } = await ownStore(server, { a: 1 });
    const file = path.join(server.home, "resources", "json", resourceID, "content.json");
    const before = readFileSync(file, "utf8");
    for (const operation of ["writeTemporaryFile", "flushFile", "rename"] as const) {
      hook.fail(operation, "content.json");
      const refused = await server.jsonSet({ artifactID }, "a", 2);
      expect(refused.status, operation).toBeGreaterThanOrEqual(400);
      expect(readFileSync(file, "utf8")).toBe(before);
      expect((await server.jsonGet({ artifactID }, "a")).body).toEqual({ exists: true, value: 1 });
      expect((await server.info(resourceID)).body.resource.status).toBe("available");
    }
    hook.succeed();
    expect((await server.jsonSet({ artifactID }, "a", 3)).status).toBe(200);
  });

  it("takes the write's result when the flush after the rename fails, refusing the write as of unknown outcome and staying available", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const store = await ownStore(server, { a: 1 });
    const { page, id: subscription } = await follow(server, store, "a");
    const events = await server.eventsClient();

    hook.fail("flushDirectory", `resources/json/${store.resourceID}`);
    const from = page.messages.length;
    const refused = await page.write(1, pageWrite.set("a", 2));
    hook.succeed();
    expect(refused).toEqual({ type: "refused", seq: 1, code: "unavailable", error: expect.stringMatching(/outcome is unknown/) });
    // The subscriber hears the write's result as a change, carrying its sequence number, before the refusal.
    expect(withoutEvents(page.messages.slice(from))).toEqual([
      { type: "value", id: subscription, result: { exists: true, value: 2 }, seq: 1 },
      refused,
    ]);
    const changed = { event: "changed", resourceID: store.resourceID, artifactID: store.artifactID, paths: ["a"] };
    expect(await events.waitForEvent((event) => event.event === "changed")).toEqual(changed);
    expect((await server.jsonGet({ artifactID: store.artifactID }, "a")).body).toEqual({ exists: true, value: 2 });
    expect((await server.info(store.resourceID)).body.resource.status).toBe("available");
    expect(await page.write(2, pageWrite.set("a", 3))).toEqual({ type: "applied", seq: 2 });
    await events.log.waitFor(() => events.events.length === 2);
    expect(events.events.map((event) => event.event)).toEqual(["changed", "changed"]);
  });

  it("takes no value when the flush after deleting content.json fails, refusing the write as of unknown outcome", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const { artifactID, resourceID } = await ownStore(server, { a: 1 });
    const events = await server.eventsClient();
    hook.fail("flushDirectory", `resources/json/${resourceID}`);
    expect((await server.jsonRemove({ artifactID }, "")).body).toEqual({ error: expect.stringMatching(/outcome is unknown/), code: "unavailable" });
    hook.succeed();
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: false });
    expect(await events.waitForEvent((event) => event.event === "changed")).toEqual({ event: "changed", resourceID, artifactID, paths: [""] });
    expect((await server.info(resourceID)).body.resource.status).toBe("available");
    expect((await server.jsonSet({ artifactID }, "b", 1)).status).toBe(200);
    expect(events.events.map((event) => event.event)).not.toContain("updated");
  });

  it("keeps the value before the write when reading the file back fails, refusing the write as of unknown outcome", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const { artifactID, resourceID } = await ownStore(server, { a: 1 });
    const events = await server.eventsClient();
    hook.fail("flushDirectory", `resources/json/${resourceID}`);
    hook.fail("readFile", "content.json");
    expect((await server.jsonSet({ artifactID }, "a", 2)).body).toEqual({ error: expect.stringMatching(/outcome is unknown/), code: "unavailable" });
    hook.succeed();
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.info(resourceID)).body.resource.status).toBe("available");
    expect((await server.jsonSet({ artifactID }, "b", 1)).status).toBe(200);
    expect(JSON.parse(readFileSync(path.join(server.home, "resources", "json", resourceID, "content.json"), "utf8"))).toEqual({ a: 1, b: 1 });
    await events.waitForEvent((event) => event.event === "changed");
    expect(events.events).toEqual([{ event: "changed", resourceID, artifactID, paths: ["b"] }]);
  });

  it("keeps the value before the write when the file cannot be read back, and saves a file built on it at the next write", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const store = await ownStore(server, { a: 1 });
    const { page } = await follow(server, store);
    const events = await server.eventsClient();
    const file = path.join(server.home, "resources", "json", store.resourceID, "content.json");

    hook.fail("flushDirectory", `resources/json/${store.resourceID}`, { corrupt: true });
    const from = page.messages.length;
    const refused = await page.write(1, pageWrite.set("a", 2));
    hook.succeed();
    expect(refused).toEqual({ type: "refused", seq: 1, code: "unavailable", error: expect.stringMatching(/outcome is unknown/) });
    expect(page.messages.slice(from)).toEqual([refused]);
    expect(readFileSync(file, "utf8")).toBe("{ not valid");
    expect((await server.jsonGet({ artifactID: store.artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.info(store.resourceID)).body.resource.status).toBe("available");

    expect((await server.jsonSet({ artifactID: store.artifactID }, "b", 1)).status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 1, b: 1 });
    await events.waitForEvent((event) => event.event === "changed");
    expect(events.events).toEqual([{ event: "changed", resourceID: store.resourceID, artifactID: store.artifactID, paths: ["b"] }]);
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-changed-paths
describe("the paths a changed event lists", () => {
  it("lists each path a write touched, as its segments joined with single slashes", async () => {
    const server = await context.start();
    const { artifactID, resourceID } = await ownStore(server, { items: { a: 1 }, list: {} });
    const store = { artifactID };
    const page = await server.pageConnection(artifactID);
    const events = await server.eventsClient();

    expect((await server.jsonSet(store, "items/a", 2)).status).toBe(200);
    expect((await server.request("POST", adminRoutes.jsonRemove, { store, path: "/items//a/" })).status).toBe(200);
    expect((await server.request("POST", adminRoutes.jsonPush, { store, path: "list", key: "k1", value: encodeWriteValue(true) })).status).toBe(200);
    expect(await page.write(1, pageWrite.push("list/", "k2", false))).toEqual({ type: "applied", seq: 1 });
    expect((await server.request("POST", adminRoutes.jsonUpdate, { store, path: "items", entries: encodeUpdateEntries({ "b/c": 1, d: 2, "/e//f/": 3 }) })).status).toBe(200);
    expect(await page.write(2, pageWrite.update("", { "items/d": increment(1), x: true }))).toEqual({ type: "applied", seq: 2 });
    expect(await page.write(3, pageWrite.compareAndSet("items//d", { exists: true, value: 3 }, 5))).toEqual({ type: "applied", seq: 3 });
    expect((await server.jsonSet(store, "", { whole: true })).status).toBe(200);
    expect((await server.jsonSet(store, "/", { whole: false })).status).toBe(200);

    const expected = [["items/a"], ["items/a"], ["list/k1"], ["list/k2"], ["items/b/c", "items/d", "items/e/f"], ["items/d", "x"], ["items/d"], [""], [""]];
    await events.log.waitFor(() => events.events.length === expected.length);
    expect(events.events.map((event) => (event as Extract<ResourceEvent, { event: "changed" }>).paths)).toEqual(expected);
    expect(events.events.every((event) => event.event === "changed" && event.resourceID === resourceID && event.artifactID === artifactID)).toBe(true);
  });
});

/** A value of `increment(1)` placeholders and padding whose write, serialized by `message`, is exactly `bytes` long. */
function placeholderValue(message: (value: WriteValue) => string, bytes: number): { value: WriteValue; count: number } {
  // Each placeholder takes under 80 bytes of the message, so growing the list by spare / 80 never passes `bytes`.
  let count = Math.floor(bytes / 80);
  const sized = (pad: number): WriteValue => ({ pad: "x".repeat(pad), list: Array.from({ length: count }, () => increment(1)) });
  let spare = bytes - utf8ByteLength(message(sized(0)));
  while (spare >= 160) {
    count += Math.floor(spare / 80);
    spare = bytes - utf8ByteLength(message(sized(0)));
  }
  const value = sized(spare);
  expect(utf8ByteLength(message(value))).toBe(bytes);
  return { value, count };
}

const pageMessage = (value: WriteValue) => JSON.stringify({ type: "write", seq: 1, write: pageWrite.set("", value) });
const adminBody = (artifactID: string) => (value: WriteValue) => JSON.stringify({ store: { artifactID }, path: "", value: encodeWriteValue(value) });

// spec: proofs/arch/resources/json-store.md#^js-arch-t-write-limit
describe("the message limit", () => {
  it("applies a set of placeholders whose message is exactly the limit, through the page connection and the administrative route", async () => {
    const server = await context.start();
    const todos = await ownStore(server, {});
    const page = await server.pageConnection(todos.artifactID);
    const viaPage = placeholderValue(pageMessage, JSON_STORE_MAX_WRITE_MESSAGE_BYTES);
    expect(await page.write(1, pageWrite.set("", viaPage.value))).toEqual({ type: "applied", seq: 1 });
    const stored = (await server.jsonGet({ artifactID: todos.artifactID })).body as { value: { list: number[] } };
    expect(stored.value.list).toEqual(Array.from({ length: viaPage.count }, () => 1));

    const notes = server.createArtifact("Notes");
    const viaAdmin = placeholderValue(adminBody(notes), JSON_STORE_MAX_WRITE_MESSAGE_BYTES);
    expect((await server.request("POST", adminRoutes.jsonSet, { store: { artifactID: notes }, path: "", value: encodeWriteValue(viaAdmin.value) })).status).toBe(200);
    expect(((await server.jsonGet({ artifactID: notes })).body as { value: { list: number[] } }).value.list).toHaveLength(viaAdmin.count);
  });

  it("closes the page connection with 1009 at one byte more, and the administrative route refuses it with too-large, changing nothing", async () => {
    const server = await context.start();
    const { artifactID } = await ownStore(server, { kept: true });
    const page = await server.pageConnection(artifactID);
    page.socket.send(pageMessage(placeholderValue(pageMessage, JSON_STORE_MAX_WRITE_MESSAGE_BYTES + 1).value));
    expect(await page.closed).toBe(1009);
    expect(page.messages.filter((received) => received.type !== "open")).toEqual([]);

    const over = placeholderValue(adminBody(artifactID), JSON_STORE_MAX_WRITE_MESSAGE_BYTES + 1);
    const refused = await server.request("POST", adminRoutes.jsonSet, { store: { artifactID }, path: "", value: encodeWriteValue(over.value) });
    expect(refused.status).toBe(413);
    expect(refused.body).toEqual({ error: expect.any(String), code: "too-large" });
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { kept: true } });
  });
});
