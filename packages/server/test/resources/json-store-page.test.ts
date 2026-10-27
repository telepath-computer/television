import { afterEach, describe, expect, it } from "vitest";
import { generatePushKey, increment, type JSONValue } from "@telepath-computer/television-shared/resources";
import { pageWrite, ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

/** An artifact whose own store holds `value`; returns the artifact's ID. */
async function ownStore(server: RunningServer, value: JSONValue): Promise<string> {
  const artifactID = server.createArtifact();
  expect((await server.jsonSet({ artifactID }, "", value)).status).toBe(200);
  return artifactID;
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-read-order
describe("read order and sequence numbers", () => {
  it("answers a get and registers a subscription sent directly after a write with values that include it", async () => {
    const server = await context.start();
    const artifactID = await ownStore(server, { n: 0 });
    const page = await server.pageConnection(artifactID);
    page.send({ type: "write", seq: 1, write: pageWrite.set("n", increment(1)) });
    page.send({ type: "get", id: "get", path: "n" });
    page.send({ type: "subscribe", id: "sub", path: "n" });
    await page.log.waitFor((message) => message.type === "value" && message.id === "sub");
    expect(page.replies("get")).toEqual([{ type: "value", id: "get", result: { exists: true, value: 1 }, seq: 1 }]);
    expect(page.values("sub")).toEqual([{ result: { exists: true, value: 1 }, seq: 1 }]);
  });

  it("labels every value with the highest sequence number of the connection's writes it includes", async () => {
    const server = await context.start();
    const artifactID = await ownStore(server, { n: 0, other: 0 });
    const page = await server.pageConnection(artifactID);
    const elsewhere = await server.pageConnection(artifactID);
    const sub = await page.subscribe("n");
    await server.jsonSet({ artifactID }, "n", 1);
    await page.write(3, pageWrite.set("other", 1));
    await server.jsonSet({ artifactID }, "n", 2);
    await page.write(7, pageWrite.set("n", 3));
    await elsewhere.write(50, pageWrite.set("n", 4));
    await page.log.waitFor((message) => message.type === "value" && message.id === sub && message.result.exists && message.result.value === 4);
    expect(page.values(sub)).toEqual([
      { result: { exists: true, value: 0 }, seq: 0 },
      { result: { exists: true, value: 1 }, seq: 0 },
      { result: { exists: true, value: 2 }, seq: 3 },
      { result: { exists: true, value: 3 }, seq: 7 },
      { result: { exists: true, value: 4 }, seq: 7 },
    ]);
  });

  it("counts only the new connection's writes on a new connection", async () => {
    const server = await context.start();
    const artifactID = await ownStore(server, { n: 0 });
    const page = await server.pageConnection(artifactID);
    await page.write(1, pageWrite.set("n", increment(1)));
    await page.write(2, pageWrite.set("n", increment(1)));
    expect(await page.get("n")).toMatchObject({ result: { exists: true, value: 2 }, seq: 2 });
    await page.close();

    const again = await server.pageConnection(artifactID);
    expect(await again.get("n")).toMatchObject({ result: { exists: true, value: 2 }, seq: 0 });
    const sub = await again.subscribe("n");
    await again.write(1, pageWrite.set("n", increment(1)));
    expect(again.values(sub)).toEqual([
      { result: { exists: true, value: 2 }, seq: 0 },
      { result: { exists: true, value: 3 }, seq: 1 },
    ]);
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-cas
describe("compare-and-set", () => {
  it("applies a transaction's write only when the value at its path equals the one it carries, including both absent", async () => {
    const server = await context.start();
    const artifactID = await ownStore(server, { a: { x: 1, y: [1, 2] } });
    const page = await server.pageConnection(artifactID);
    // Equal as JSON, with its keys in another order.
    expect(await page.write(1, pageWrite.compareAndSet("a", { exists: true, value: { y: [1, 2], x: 1 } }, { x: 2 }))).toEqual({ type: "applied", seq: 1 });
    expect(await page.write(2, pageWrite.compareAndSet("missing", { exists: false }, 5))).toEqual({ type: "applied", seq: 2 });
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: { x: 2 }, missing: 5 } });

    expect(await page.write(3, pageWrite.compareAndSet("a", { exists: true, value: { x: 1, y: [1, 2] } }, { x: 9 }))).toEqual({
      type: "mismatch",
      seq: 3,
      current: { exists: true, value: { x: 2 } },
      valueSeq: 3,
    });
    expect(await page.write(4, pageWrite.compareAndSet("a", { exists: false }, { x: 9 }))).toMatchObject({
      type: "mismatch",
      current: { exists: true, value: { x: 2 } },
    });
    expect(await page.write(5, pageWrite.compareAndSet("absent", { exists: true, value: null }, 1))).toMatchObject({
      type: "mismatch",
      current: { exists: false },
    });
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: { x: 2 }, missing: 5 } });
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-subscriptions
describe("page subscriptions", () => {
  it("send the current value or its absence, then a value after each write that changes it at the path", async () => {
    const server = await context.start();
    const artifactID = await ownStore(server, { items: { a: { done: false } }, other: 1 });
    const page = await server.pageConnection(artifactID);
    const present = await page.subscribe("items/a");
    const absent = await page.subscribe("items/b");
    await server.jsonSet({ artifactID }, "other", 2); // elsewhere in the store
    await server.jsonSet({ artifactID }, "items/a", { done: false }); // leaves the value equal
    await server.jsonSet({ artifactID }, "items/a/done", true);
    await server.jsonSet({ artifactID }, "items/b", "new");
    await server.jsonRemove({ artifactID }, "items/a");
    await page.log.waitFor((message) => message.type === "value" && message.id === present && !message.result.exists);

    expect(page.values(present).map(({ result }) => result)).toEqual([
      { exists: true, value: { done: false } },
      { exists: true, value: { done: true } },
      { exists: false },
    ]);
    expect(page.values(absent).map(({ result }) => result)).toEqual([{ exists: false }, { exists: true, value: "new" }]);

    page.send({ type: "unsubscribe", id: present });
    await server.jsonSet({ artifactID }, "items/a", 1);
    await server.jsonSet({ artifactID }, "items/b", "newer");
    await page.log.waitFor((message) => message.type === "value" && message.id === absent && message.result.exists && message.result.value === "newer");
    expect(page.values(present)).toHaveLength(3);
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-access
describe("access classification", () => {
  it("allows get and subscriptions through a share ID at read and refuses every write with read-only, changing nothing", async () => {
    const server = await context.start();
    const artifactID = await ownStore(server, { list: { a: 1 } });
    const page = await server.pageConnection(await server.sharedAt(artifactID, "read"));
    expect(await page.get("list")).toMatchObject({ type: "value", result: { exists: true, value: { a: 1 } } });
    const sub = await page.subscribe("list");
    expect(page.values(sub)).toEqual([{ result: { exists: true, value: { a: 1 } }, seq: 0 }]);
    const writes = [
      pageWrite.set("list/b", 2),
      pageWrite.update("list", { b: 2 }),
      pageWrite.push("list", generatePushKey(), 2),
      pageWrite.remove("list/a"),
      pageWrite.compareAndSet("list", { exists: true, value: { a: 1 } }, { a: 2 }),
    ];
    for (const [index, write] of writes.entries()) {
      expect(await page.write(index + 1, write), write.kind).toMatchObject({ type: "refused", code: "read-only" });
    }
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { list: { a: 1 } } });
    expect(page.values(sub)).toHaveLength(1);
  });
});
