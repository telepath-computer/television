import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_ROUTE_PREFIX,
  artifactRoutes,
  increment,
  type JSONValue,
  type PageEvent,
} from "@telepath-computer/television-shared/resources";
import { nodeResourceStorageOperations, type ResourceStorageOperations } from "../../src/resources/storage.ts";
import {
  failingStorage,
  pageWrite,
  ResourceTestContext,
  type PageConnectionClient,
  type RunningServer,
  type StorageOperation,
} from "./harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

function corsHeaders(headers: Headers): string[] {
  return [...headers.keys()].filter((name) => name.toLowerCase().startsWith("access-control-"));
}

interface OwnStore {
  artifactID: string;
  resourceID: string;
}

/** An artifact whose own store holds `value`, written through the administrative routes. */
async function ownStore(server: RunningServer, title: string, value: JSONValue): Promise<OwnStore> {
  const artifactID = server.createArtifact(title);
  expect((await server.jsonSet({ artifactID }, "", value)).status).toBe(200);
  return { artifactID, resourceID: server.storePointer(artifactID)! };
}

async function storeValue(server: RunningServer, store: { artifactID: string } | { resourceID: string }, jsonPath = ""): Promise<unknown> {
  return (await server.jsonGet(store, jsonPath)).body;
}

/** The administrative address of an artifact's own store. */
const at = (store: OwnStore) => ({ artifactID: store.artifactID });

const byResourceID = <T extends { resourceID: string }>(items: T[]): T[] => [...items].sort((left, right) => (left.resourceID < right.resourceID ? -1 : 1));

/** The code a connection closed with, or "open" when it is still open a moment later. */
function closeCode(page: PageConnectionClient): Promise<number | "open"> {
  return Promise.race([page.closed, new Promise<"open">((resolve) => setTimeout(() => resolve("open"), 2_000))]);
}

/** Every operation on a store, each answered with an error or a refused write carrying `code`. */
async function expectRefusedEverywhere(page: PageConnectionClient, code: string, seq: number, resourceID?: string): Promise<void> {
  for (const reply of [await page.get("", resourceID), await page.request({ type: "subscribe", id: page.newID(), ...(resourceID === undefined ? {} : { resourceID }), path: "" })]) {
    expect(reply, `${resourceID ?? "own store"}`).toMatchObject({ type: "error", code });
  }
  expect(await page.write(seq, pageWrite.set("n", 99), resourceID)).toMatchObject({ type: "refused", seq, code });
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-artifact-routes
describe("the artifact routes", () => {
  it("reach the artifact's own store at read-write under its ID and at the link's level under its share ID, and no other store, whatever token the request carries", async () => {
    const server = await context.start({ auth: true });
    const a = await ownStore(server, "A", { n: 1 });
    const b = await ownStore(server, "B", { n: 2 });
    const shareID = await server.sharedAt(a.artifactID, "read");
    const variants = [
      { name: "no token" },
      { name: "token header", headers: { Authorization: `Bearer ${server.token}` } },
      { name: "token query", query: { token: server.token } },
    ];
    let expected = 1;
    for (const variant of variants) {
      const own = await server.pageConnection(a.artifactID, variant);
      expect(own.opening.access, variant.name).toBe("read-write");
      expect(await own.get("n")).toMatchObject({ type: "value", result: { exists: true, value: expected } });
      expect(await own.write(1, pageWrite.set("n", increment(1)))).toEqual({ type: "applied", seq: 1 });
      expected += 1;

      const shared = await server.pageConnection(shareID, variant);
      expect(shared.opening.access, variant.name).toBe("read");
      expect(await shared.get("n")).toMatchObject({ type: "value", result: { exists: true, value: expected } });
      expect(await shared.write(1, pageWrite.set("n", 99))).toMatchObject({ type: "refused", seq: 1, code: "read-only" });

      for (const page of [own, shared]) await expectRefusedEverywhere(page, "not-enabled", 2, b.resourceID);
    }
    expect(await storeValue(server, at(a), "n")).toEqual({ exists: true, value: 4 });
    expect(await storeValue(server, at(b))).toEqual({ exists: true, value: { n: 2 } });
  });

  it("accept a path whose ID reaches no artifact, with no level, and refuse every operation on the artifact's store with no-store", async () => {
    const server = await context.start({ auth: true });
    await ownStore(server, "A", { n: 1 });
    const page = await server.pageConnection("01NOSUCHARTIFACT0000000000");
    expect(page.opening).toEqual({ type: "open", serverTime: expect.any(Number), bindings: [] });
    await expectRefusedEverywhere(page, "no-store", 1);
  });

  it("send no message that carries an artifact ID or a share ID, under either", async () => {
    const server = await context.start({ auth: true });
    const a = await ownStore(server, "A", { n: 1 });
    const shareID = await server.sharedAt(a.artifactID, "read-write");
    for (const id of [a.artifactID, shareID]) {
      const page = await server.pageConnection(id);
      await page.subscribe();
      await page.get("n");
      await page.write(1, pageWrite.set("n", increment(1)));
      await server.jsonSet(at(a), "m", id === shareID);
      await page.waitForEvent((event) => event.event === "changed" && event.paths.includes("m"));
      const sent = JSON.stringify(page.messages);
      expect(sent).not.toContain(a.artifactID);
      expect(sent).not.toContain(shareID);
    }
  });

  it("send no message that carries an artifact ID, a share ID or the server's own text when a request fails or its outcome is unknown, and leave a page no ID that reaches the store once its link is revoked", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    const shareID = await server.sharedAt(artifactID, "read-write");
    const page = await server.pageConnection(shareID);
    const records = path.join("state", "artifacts");
    const stores = path.join("resources", "json");
    // Each fails a later step of the first write, then a later save: the
    // record's pointer, the store's directory, its manifest and its content.
    const failures: Array<[StorageOperation, string, boolean]> = [
      ["rename", records, false],
      ["flushDirectory", records, true],
      ["flushDirectory", stores, true],
      ["flushDirectory", stores, true],
      ["flushDirectory", stores, true],
      ["rename", stores, false],
    ];
    let seq = 0;
    for (const [operation, file, outcomeUnknown] of failures) {
      hook.fail(operation, file);
      seq += 1;
      const reply = await page.write(seq, pageWrite.set("n", seq));
      hook.succeed();
      expect(reply, `${operation} ${file}`).toMatchObject({ type: "refused", seq, code: "unavailable" });
      expect(reply.type === "refused" && /outcome is unknown/.test(reply.error), `${operation} ${file}`).toBe(outcomeUnknown);
    }
    expect(await storeValue(server, { artifactID }, "n")).toEqual({ exists: true, value: 5 });

    // A store whose files cannot be read.
    const resourceID = server.storePointer(artifactID)!;
    await server.stop();
    const unreadable = failingStorage();
    unreadable.fail("readFile", path.join(stores, resourceID));
    const restarted = await context.start({ home: server.home, storage: unreadable.storage });
    const again = await restarted.pageConnection(shareID);
    await expectRefusedEverywhere(again, "unavailable", 1);
    expect(JSON.stringify(again.messages)).not.toMatch(/outcome is unknown/);

    for (const sent of [JSON.stringify(page.messages), JSON.stringify(again.messages)]) {
      for (const forbidden of [artifactID, shareID, server.home]) expect(sent).not.toContain(forbidden);
    }
    expect((await restarted.unshare(artifactID)).status).toBe(200);
    expect(await again.closed).toBe(1000);
    // Neither the share ID nor any ID the page received reaches the store any more.
    const received = JSON.stringify([...page.messages, ...again.messages]).match(/[0-9A-HJKMNP-TV-Z]{26}/g) ?? [];
    for (const id of [shareID, ...received]) {
      const later = await restarted.pageConnection(id);
      expect(later.opening.access, id).toBeUndefined();
      expect(await later.write(1, pageWrite.set("n", 99))).toMatchObject({ type: "refused", code: "no-store" });
    }
  });

  it("with the flag on, reach exactly the stores the artifact is bound to by resource ID, its own included, at the lower of the ID's level and the binding's, and refuse any other with not-bound", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const b = await ownStore(server, "B", { n: 2 });
    const writable = await server.createdStore({ value: { n: 3 } });
    const readable = await server.createdStore({ value: { n: 4 } });
    const elsewhere = await server.createdStore({ value: { n: 5 } });
    await server.bind(writable, a.artifactID, "read-write");
    await server.bind(readable, a.artifactID, "read");
    await server.bind(elsewhere, b.artifactID, "read-write");
    const shareID = await server.sharedAt(a.artifactID, "read");

    const own = await server.pageConnection(a.artifactID);
    expect(await own.get("n", a.resourceID)).toMatchObject({ type: "value", result: { exists: true, value: 1 } });
    expect(await own.write(1, pageWrite.set("n", increment(1)), a.resourceID)).toEqual({ type: "applied", seq: 1 });
    expect(await own.write(2, pageWrite.set("n", increment(1)), writable)).toEqual({ type: "applied", seq: 2 });
    expect(await own.write(3, pageWrite.set("n", 0), readable)).toMatchObject({ type: "refused", code: "read-only" });
    expect(await own.get("n", readable)).toMatchObject({ type: "value", result: { exists: true, value: 4 } });
    for (const [index, resourceID] of [elsewhere, b.resourceID].entries()) {
      await expectRefusedEverywhere(own, "not-bound", 10 + index, resourceID);
      expect(await own.info(resourceID)).toMatchObject({ type: "error", code: "not-bound" });
    }
    expect(await own.list()).toMatchObject({
      type: "resources",
      resources: byResourceID([
        { resourceID: a.resourceID, type: "json", access: "read-write" },
        { resourceID: writable, type: "json", access: "read-write" },
        { resourceID: readable, type: "json", access: "read" },
      ]),
    });
    expect(await own.info(writable)).toMatchObject({ type: "resource", resource: { resourceID: writable, type: "json", access: "read-write" } });

    const shared = await server.pageConnection(shareID);
    for (const [index, resourceID] of [a.resourceID, writable, readable].entries()) {
      expect(await shared.write(index + 1, pageWrite.set("n", 0), resourceID)).toMatchObject({ type: "refused", code: "read-only" });
    }
    expect(await shared.get("n", writable)).toMatchObject({ type: "value", result: { exists: true, value: 4 } });
    expect(await shared.list()).toMatchObject({
      type: "resources",
      resources: byResourceID([
        { resourceID: a.resourceID, type: "json", access: "read" },
        { resourceID: writable, type: "json", access: "read" },
        { resourceID: readable, type: "json", access: "read" },
      ]),
    });
    await expectRefusedEverywhere(shared, "not-bound", 9, elsewhere);
    expect(await storeValue(server, { resourceID: elsewhere })).toEqual({ exists: true, value: { n: 5 } });
  });

  it("with the flag on, send a page opened through a share link nothing carrying the artifact's ID, another artifact's ID or bindings, or a description or usage", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const b = await ownStore(server, "B", { n: 2 });
    const bound = await server.createdStore({ value: { n: 3 } });
    await server.bind(bound, a.artifactID, "read-write");
    await server.bind(bound, b.artifactID, "read");
    await server.bind(b.resourceID, a.artifactID, "read");
    const secret = `Written for artifact ${a.artifactID}`;
    for (const resourceID of [a.resourceID, bound]) {
      expect((await server.describe(resourceID, { description: secret, usage: `${secret}\nSecond line.` })).status).toBe(200);
    }
    const shareID = await server.sharedAt(a.artifactID, "read");

    const page = await server.pageConnection(shareID);
    const infos = [await page.list(), await page.info(a.resourceID), await page.info(bound), await page.info(b.resourceID)];
    for (const reply of infos.slice(1)) {
      expect(reply.type === "resource" && Object.keys(reply.resource).sort()).toEqual(["access", "resourceID", "type"]);
    }
    await page.subscribe("n");
    await page.subscribe("n", bound);
    await server.describe(bound, { description: `${secret} again` });
    await server.describe(a.resourceID, { usage: `${secret} again` });
    await server.unbind(bound, b.artifactID);
    await server.bind(bound, b.artifactID, "read-write");
    await server.jsonSet({ resourceID: bound }, "n", 4);
    await server.jsonSet(at(a), "n", 5);
    await page.waitForEvent((event) => event.event === "changed" && event.resourceID === undefined);

    const sent = JSON.stringify(page.messages);
    for (const forbidden of [a.artifactID, b.artifactID, shareID, secret, "Second line"]) expect(sent).not.toContain(forbidden);
    expect(page.events.map((event) => event.event)).toEqual(["changed", "changed"]);
  });

  it("with the flag on, send a page opened through a share link no message carrying an artifact ID, a share ID or the server's own text when a write to a bound store fails or its outcome is unknown, or the bindings file cannot be read", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage, resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const bound = await server.createdStore({ value: { n: 2 } });
    await server.bind(bound, a.artifactID, "read-write");
    const shareID = await server.sharedAt(a.artifactID, "read-write");
    const page = await server.pageConnection(shareID);
    const failures: Array<[StorageOperation, boolean]> = [
      ["flushDirectory", true],
      ["rename", false],
    ];
    let seq = 0;
    for (const [operation, outcomeUnknown] of failures) {
      hook.fail(operation, path.join("resources", "json", bound));
      seq += 1;
      const reply = await page.write(seq, pageWrite.set("n", seq), bound);
      hook.succeed();
      expect(reply, operation).toMatchObject({ type: "refused", seq, code: "unavailable" });
      expect(reply.type === "refused" && /outcome is unknown/.test(reply.error), operation).toBe(outcomeUnknown);
    }

    await server.stop();
    const unreadable = failingStorage();
    unreadable.fail("readFile", "resource-bindings.json");
    const restarted = await context.start({ home: server.home, storage: unreadable.storage, resourceBindings: true });
    const again = await restarted.pageConnection(shareID);
    for (const reply of [await again.list(), await again.info(bound)]) expect(reply).toMatchObject({ type: "error", code: "unavailable" });
    await expectRefusedEverywhere(again, "unavailable", 1, bound);
    expect(await again.write(2, pageWrite.set("n", 3))).toEqual({ type: "applied", seq: 2 });

    for (const sent of [JSON.stringify(page.messages), JSON.stringify(again.messages)]) {
      for (const forbidden of [a.artifactID, shareID, server.home]) expect(sent).not.toContain(forbidden);
    }
  });

  it("enforce the same levels on a tokenless server", async () => {
    const server = await context.start({ auth: false, resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const b = await ownStore(server, "B", { n: 2 });
    const readable = await server.createdStore({ value: { n: 3 } });
    await server.bind(readable, a.artifactID, "read");
    const page = await server.pageConnection(a.artifactID);
    expect(await page.write(1, pageWrite.set("n", 6))).toEqual({ type: "applied", seq: 1 });
    expect(await page.write(2, pageWrite.set("n", 6), readable)).toMatchObject({ type: "refused", code: "read-only" });
    await expectRefusedEverywhere(page, "not-bound", 3, b.resourceID);
    expect(await storeValue(server, { resourceID: readable })).toEqual({ exists: true, value: { n: 3 } });
    expect(await storeValue(server, at(b))).toEqual({ exists: true, value: { n: 2 } });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-origin
describe("requests from other origins on the artifact routes", () => {
  const plainPost = (server: RunningServer, route: string, headers: Record<string, string>) =>
    server.request("POST", route, undefined, {
      token: null,
      rawBody: JSON.stringify({ type: "write", seq: 1, write: { kind: "set", path: "n", value: { value: 99 } } }),
      headers: { "Content-Type": "text/plain;charset=UTF-8", ...headers },
    });

  /** The origins of pages on another site, of sandboxed artifact pages, and of pages behind a front that terminates TLS for the server's own host. */
  const otherOrigins = (server: RunningServer): Array<[string, string]> => [
    ["another site", "http://other-site.example"],
    ["a sandboxed page", "null"],
    ["an HTTPS front", `https://${server.host}`],
  ];

  /** An artifact with a store and a share link, and the IDs a page connection can be opened under. */
  async function sharedArtifact(server: RunningServer): Promise<{ store: OwnStore; ids: string[] }> {
    const store = await ownStore(server, "A", { n: 1 });
    const shareID = await server.sharedAt(store.artifactID, "read-write");
    return { store, ids: [store.artifactID, shareID] };
  }

  it("answers a POST of the kind browsers send without a preflight from another site or an HTTPS front as the WebSocket route it is, under an artifact ID and a share ID, changing nothing", async () => {
    const server = await context.start({ auth: true });
    const { store, ids } = await sharedArtifact(server);
    for (const id of ids) {
      for (const [name, origin] of otherOrigins(server)) {
        const result = await plainPost(server, artifactRoutes.connection(id), { Origin: origin });
        expect(result.status, name).toBe(426);
        expect(corsHeaders(result.headers), name).toEqual([]);
      }
    }
    expect(await storeValue(server, at(store), "n")).toEqual({ exists: true, value: 1 });
  });

  it("opens the page connection from another site or an HTTPS front under an artifact ID at read-write and a share ID at the link's level, refusing a write through a read link", async () => {
    const server = await context.start({ auth: true });
    const store = await ownStore(server, "A", { n: 1 });
    const shareID = await server.sharedAt(store.artifactID, "read");
    for (const [name, origin] of otherOrigins(server)) {
      const own = await server.pageConnection(store.artifactID, { headers: { Origin: origin } });
      expect(own.opening.access, name).toBe("read-write");
      expect(await own.write(1, pageWrite.set("n", 2)), name).toMatchObject({ type: "applied" });
      const shared = await server.pageConnection(shareID, { headers: { Origin: origin } });
      expect(shared.opening.access, name).toBe("read");
      expect(await shared.write(1, pageWrite.set("n", 3)), name).toMatchObject({ type: "refused", code: "read-only" });
    }
    expect(await storeValue(server, at(store), "n")).toEqual({ exists: true, value: 2 });
  });

  it("sends no CORS headers on any response, including OPTIONS, and changes nothing on GET or HEAD", async () => {
    const server = await context.start({ auth: true });
    const { store, ids } = await sharedArtifact(server);
    for (const id of ids) {
      const route = artifactRoutes.connection(id);
      const responses = [
        await server.request("OPTIONS", route, undefined, { token: null, headers: { Origin: "http://attacker.example", "Access-Control-Request-Method": "POST" } }),
        await server.request("OPTIONS", route, undefined, { token: null, headers: { Origin: `http://${server.host}` } }),
        await server.request("GET", route, undefined, { token: null }),
        await server.request("HEAD", route, undefined, { token: null }),
        await server.request("GET", `${ARTIFACT_ROUTE_PREFIX}/${id}/v1/unknown`, undefined, { token: null, headers: { Origin: `http://${server.host}` } }),
      ];
      for (const response of responses) {
        expect(corsHeaders(response.headers)).toEqual([]);
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
    expect(await storeValue(server, at(store))).toEqual({ exists: true, value: { n: 1 } });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-opening-state
describe("the opening state, and connections that stand alone", () => {
  it("opens with the level the connection's ID carries, with the flag on its own store's resource ID once written and the artifact's explicit bindings, and the server's time, and nothing that identifies the artifact, the page or an earlier connection", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const writable = await server.createdStore({ value: {} });
    const readable = await server.createdStore({ value: {} });
    await server.bind(writable, a.artifactID, "read-write");
    await server.bind(readable, a.artifactID, "read");
    const shareID = await server.sharedAt(a.artifactID, "read");

    const before = Date.now();
    const page = await server.pageConnection(a.artifactID);
    const after = Date.now();
    const opening = {
      type: "open",
      serverTime: expect.any(Number),
      access: "read-write",
      store: a.resourceID,
      bindings: byResourceID([
        { resourceID: writable, type: "json", access: "read-write" },
        { resourceID: readable, type: "json", access: "read" },
      ]),
    };
    expect(page.opening).toEqual(opening);
    expect(page.opening.serverTime).toBeGreaterThanOrEqual(before);
    expect(page.opening.serverTime).toBeLessThanOrEqual(after);
    await page.close();
    expect((await server.pageConnection(a.artifactID)).opening).toEqual(opening);

    expect((await server.pageConnection(shareID)).opening).toEqual({
      type: "open",
      serverTime: expect.any(Number),
      access: "read",
      store: a.resourceID,
      bindings: byResourceID([
        { resourceID: writable, type: "json", access: "read" },
        { resourceID: readable, type: "json", access: "read" },
      ]),
    });
    expect((await server.pageConnection("01NOSUCHARTIFACT0000000000")).opening).toEqual({ type: "open", serverTime: expect.any(Number), bindings: [] });
    const unwritten = server.createArtifact("Unwritten");
    expect((await server.pageConnection(unwritten)).opening).toEqual({ type: "open", serverTime: expect.any(Number), access: "read-write", bindings: [] });
  });

  it("opens with no bindings and no resource ID for its own store while the flag is off, and is sent no access when the store's first write creates it", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    expect((await server.pageConnection(a.artifactID)).opening).toEqual({ type: "open", serverTime: expect.any(Number), access: "read-write", bindings: [] });
    const unwritten = server.createArtifact("Unwritten");
    const page = await server.pageConnection(unwritten);
    expect((await server.jsonSet({ artifactID: unwritten }, "n", 1)).status).toBe(200);
    await page.waitForEvent((event) => event.event === "changed");
    expect(page.messages.filter((message) => message.type === "access")).toEqual([]);
  });

  it("applies a write sent on a new connection with the sequence number of one applied on an earlier connection", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const first = await server.pageConnection(a.artifactID);
    expect(await first.write(1, pageWrite.set("n", increment(1)))).toEqual({ type: "applied", seq: 1 });
    expect(await first.write(2, pageWrite.set("items/x", 1))).toEqual({ type: "applied", seq: 2 });
    await first.close();

    const next = await server.pageConnection(a.artifactID);
    expect(await next.write(1, pageWrite.set("n", increment(1)))).toEqual({ type: "applied", seq: 1 });
    expect(await next.write(2, pageWrite.set("items/y", 1))).toEqual({ type: "applied", seq: 2 });
    expect(await storeValue(server, at(a))).toEqual({ exists: true, value: { n: 3, items: { x: 1, y: 1 } } });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-sequence
describe("write order", () => {
  it("applies one connection's writes to its own store and, with the flag on, a bound store in the order sent, whatever gaps its sequence numbers leave", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const bound = await server.createdStore({ value: {} });
    await server.bind(bound, a.artifactID, "read-write");
    const events = await server.eventsClient();
    const page = await server.pageConnection(a.artifactID);
    const sent = [
      { seq: 1, resourceID: undefined },
      { seq: 4, resourceID: bound },
      { seq: 5, resourceID: bound },
      { seq: 9, resourceID: undefined },
      { seq: 20, resourceID: bound },
      { seq: 21, resourceID: undefined },
    ];
    for (const { seq, resourceID } of sent) {
      page.send({ type: "write", seq, ...(resourceID === undefined ? {} : { resourceID }), write: pageWrite.set(`log/s${seq}`, true) });
    }
    await page.waitForWriteReply(21);
    expect(page.messages.flatMap((message) => (message.type === "applied" ? [message.seq] : []))).toEqual(sent.map(({ seq }) => seq));
    const changed = () => events.events.filter((event) => event.event === "changed");
    await events.log.waitFor(() => changed().length === sent.length);
    expect(changed().map((event) => (event as { resourceID: string }).resourceID)).toEqual(sent.map(({ resourceID }) => resourceID ?? a.resourceID));
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-checks
describe("checks at application time", () => {
  it("refuses a write through a share ID at read with read-only, leaving the store and its events unchanged", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const shareID = await server.sharedAt(a.artifactID, "read");
    const events = await server.eventsClient();
    const page = await server.pageConnection(shareID);
    expect(await page.write(1, pageWrite.set("n", 5))).toMatchObject({ type: "refused", seq: 1, code: "read-only" });
    await server.jsonSet(at(a), "m", 1);
    await events.waitForEvent((event) => event.event === "changed");
    expect(events.events).toEqual([{ event: "changed", resourceID: a.resourceID, artifactID: a.artifactID, paths: ["m"] }]);
    expect(await storeValue(server, at(a))).toEqual({ exists: true, value: { n: 1, m: 1 } });
  });

  it("applies each write at the level the share link has when it is applied", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const shareID = await server.sharedAt(a.artifactID, "read-write");
    const page = await server.pageConnection(shareID);
    expect(await page.write(1, pageWrite.set("n", 2))).toEqual({ type: "applied", seq: 1 });
    expect((await server.share(a.artifactID, "read")).status).toBe(200);
    expect(await page.write(2, pageWrite.set("n", 3))).toMatchObject({ type: "refused", seq: 2, code: "read-only" });
    expect((await server.share(a.artifactID, "read-write")).status).toBe(200);
    expect(await page.write(3, pageWrite.set("n", 4))).toEqual({ type: "applied", seq: 3 });
    expect(await storeValue(server, at(a), "n")).toEqual({ exists: true, value: 4 });
  });

  it("keeps the connection's subscriptions to its own store when that store is destroyed, each hearing no value, and applies its next write to a new store", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const page = await server.pageConnection(a.artifactID);
    const root = await page.subscribe();
    const leaf = await page.subscribe("n");
    expect((await server.destroy(a.resourceID, true)).status).toBe(200);
    await page.log.waitFor((message) => message.type === "value" && message.id === leaf && !message.result.exists);
    expect(page.values(root).map(({ result }) => result)).toEqual([{ exists: true, value: { n: 1 } }, { exists: false }]);
    expect(await page.write(1, pageWrite.set("n", 7))).toEqual({ type: "applied", seq: 1 });
    expect(page.values(leaf).map(({ result }) => result)).toEqual([{ exists: true, value: 1 }, { exists: false }, { exists: true, value: 7 }]);
    expect(server.storePointer(a.artifactID)).not.toBe(a.resourceID);
    expect(page.replies(root).filter((message) => message.type === "error")).toEqual([]);
  });

  it("closes nothing when a change of the artifact's path moves it between kinds of file: its store stays its own", async () => {
    const server = await context.start();
    const a = await ownStore(server, "Notes", { n: 1 });
    const shareID = await server.sharedAt(a.artifactID, "read");
    const record = server.store.getArtifact(a.artifactID);
    if (record?.kind !== "path") throw new Error("the artifact is not a path artifact");
    const html = record.path;
    const markdown = `${html.replace(/\.html$/, "")}.md`;
    writeFileSync(markdown, "# Notes\n");
    const changePath = async (to: string) => expect((await server.request("PATCH", `/artifacts/${a.artifactID}`, { path: to })).status).toBe(200);

    const own = await server.pageConnection(a.artifactID);
    const shared = await server.pageConnection(shareID);
    const sharedRoot = await shared.subscribe();

    // To Markdown and back, the artifact keeps its store: both connections stay open, subscribed and at their levels.
    let seq = 0;
    for (const [to, n] of [[markdown, 2], [html, 3]] as const) {
      await changePath(to);
      seq += 1;
      expect(await own.write(seq, pageWrite.set("n", n)), to).toEqual({ type: "applied", seq });
      await shared.log.waitFor((message) => message.type === "value" && message.id === sharedRoot && message.result.exists && (message.result.value as { n: number }).n === n);
    }
    expect([own.accessChanges, shared.accessChanges]).toEqual([[], []]);
    expect(await Promise.all([closeCode(own), closeCode(shared)])).toEqual(["open", "open"]);
    expect(server.storePointer(a.artifactID)).toBe(a.resourceID);
  });

  it("sends a connection whose artifact has no store no level when its share link's level changes, and with the flag on its bindings at the page's new level", async () => {
    const server = await context.start({ resourceBindings: true, fixedIDArtifacts: [{ id: "page-without-a-store" }] });
    const artifactID = "page-without-a-store";
    const bound = await server.createdStore({ value: { n: 1 } });
    await server.bind(bound, artifactID, "read-write");
    const page = await server.pageConnection(await server.sharedAt(artifactID, "read"));
    expect(page.opening).toEqual({ type: "open", serverTime: expect.any(Number), bindings: [{ resourceID: bound, type: "json", access: "read" }] });

    const before = page.messages.length;
    expect((await server.share(artifactID, "read-write")).status).toBe(200);
    await page.waitForEvent((event) => event.event === "bound", before);
    expect(page.messages.slice(before)).toEqual([
      { type: "access", bindings: [{ resourceID: bound, type: "json", access: "read-write" }] },
      { type: "event", event: { event: "bound", resourceID: bound, access: "read-write" } },
    ]);
    expect(await page.write(1, pageWrite.set("n", 2))).toMatchObject({ type: "refused", seq: 1, code: "no-store" });
    expect(await page.write(2, pageWrite.set("n", 2), bound)).toEqual({ type: "applied", seq: 2 });
  });

  it("with the flag on, sends the access again, before the page's event, when the artifact's own store gets its resource ID at its first write and when a destroy takes it away", async () => {
    const server = await context.start({ resourceBindings: true });
    const artifactID = server.createArtifact("Unwritten");
    const page = await server.pageConnection(await server.sharedAt(artifactID, "read"));
    expect(page.opening).toEqual({ type: "open", serverTime: expect.any(Number), access: "read", bindings: [] });

    const opened = page.messages.length;
    expect((await server.jsonSet({ artifactID }, "n", 1)).status).toBe(200);
    const resourceID = server.storePointer(artifactID)!;
    await page.waitForEvent((event) => event.event === "changed", opened);
    expect(page.messages.slice(opened)).toEqual([
      { type: "access", access: "read", store: resourceID, bindings: [] },
      { type: "event", event: { event: "changed", paths: ["n"] } },
    ]);

    const before = page.messages.length;
    expect((await server.destroy(resourceID, true)).status).toBe(200);
    await page.log.waitFor((message) => message.type === "access", before);
    expect(page.messages.slice(before)).toEqual([{ type: "access", access: "read", bindings: [] }]);
    expect(await page.write(1, pageWrite.set("n", 2), resourceID)).toMatchObject({ type: "refused", seq: 1, code: "not-bound" });
  });

  it("with the flag on, sends the access with the own store's resource ID once the first write saves the pointer, even when that write is then refused, and none when the pointer is not saved", async () => {
    const hook = failingStorage();
    const server = await context.start({ resourceBindings: true, storage: hook.storage });
    const records = path.join("state", "artifacts");
    const stores = path.join("resources", "json");
    // The pointer's save, with its outcome unknown; the store's directory; its manifest.
    const afterPointer: Array<[StorageOperation, string]> = [
      ["flushDirectory", records],
      ["flushDirectory", stores],
      ["rename", stores],
    ];
    for (const [operation, file] of afterPointer) {
      const artifactID = server.createArtifact("Unwritten");
      const page = await server.pageConnection(await server.sharedAt(artifactID, "read"));
      const opened = page.messages.length;
      hook.fail(operation, file);
      expect((await server.jsonSet({ artifactID }, "n", 1)).status, `${operation} ${file}`).toBe(503);
      hook.succeed();
      const resourceID = server.storePointer(artifactID);
      expect(resourceID, `${operation} ${file}`).toBeDefined();
      await page.log.waitFor((message) => message.type === "access", opened);
      expect(page.messages.slice(opened), `${operation} ${file}`).toEqual([{ type: "access", access: "read", store: resourceID, bindings: [] }]);
    }

    const artifactID = server.createArtifact("Unwritten");
    const page = await server.pageConnection(await server.sharedAt(artifactID, "read"));
    const opened = page.messages.length;
    hook.fail("rename", records);
    expect((await server.jsonSet({ artifactID }, "n", 1)).status).toBe(503);
    hook.succeed();
    expect(server.storePointer(artifactID)).toBeUndefined();
    expect(await page.get("")).toMatchObject({ type: "value", result: { exists: false } });
    expect(page.messages.slice(opened).filter((message) => message.type === "access")).toEqual([]);
  });

  it("with the flag off, refuses every operation on a store by resource ID with not-enabled, the artifact's own included", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const page = await server.pageConnection(a.artifactID);
    await expectRefusedEverywhere(page, "not-enabled", 1, a.resourceID);
    expect(await page.list()).toMatchObject({ type: "error", code: "not-enabled" });
    expect(await page.info(a.resourceID)).toMatchObject({ type: "error", code: "not-enabled" });
    expect(await storeValue(server, at(a))).toEqual({ exists: true, value: { n: 1 } });
  });

  it("with the flag on, under a share ID at read, refuses a write to a store bound read-write with read-only", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const bound = await server.createdStore({ value: { n: 2 } });
    await server.bind(bound, a.artifactID, "read-write");
    const page = await server.pageConnection(await server.sharedAt(a.artifactID, "read"));
    expect(await page.write(1, pageWrite.set("n", 5), bound)).toMatchObject({ type: "refused", seq: 1, code: "read-only" });
    expect(await storeValue(server, { resourceID: bound })).toEqual({ exists: true, value: { n: 2 } });
  });

  it("with the flag on, follows a share link's new level with its whole access at that level, then bound for each binding whose level for the page it changes", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const writable = await server.createdStore({ value: { n: 2 } });
    const readable = await server.createdStore({ value: { n: 3 } });
    await server.bind(writable, a.artifactID, "read-write");
    await server.bind(readable, a.artifactID, "read");
    const page = await server.pageConnection(await server.sharedAt(a.artifactID, "read-write"));
    expect(await page.write(1, pageWrite.set("n", 4), writable)).toEqual({ type: "applied", seq: 1 });

    const before = page.messages.length;
    await server.share(a.artifactID, "read");
    await page.waitForEvent((event) => event.event === "bound", before);
    expect(page.messages.slice(before)).toEqual([
      {
        type: "access",
        access: "read",
        store: a.resourceID,
        bindings: byResourceID([
          { resourceID: writable, type: "json", access: "read" },
          { resourceID: readable, type: "json", access: "read" },
        ]),
      },
      { type: "event", event: { event: "bound", resourceID: writable, access: "read" } },
    ]);
    expect(await page.write(2, pageWrite.set("n", 5), writable)).toMatchObject({ type: "refused", code: "read-only" });
    const from = page.messages.length;
    await server.share(a.artifactID, "read-write");
    await page.log.waitFor((message) => message.type === "event", from);
    expect(page.messages.slice(from)).toEqual([
      {
        type: "access",
        access: "read-write",
        store: a.resourceID,
        bindings: byResourceID([
          { resourceID: writable, type: "json", access: "read-write" },
          { resourceID: readable, type: "json", access: "read" },
        ]),
      },
      { type: "event", event: { event: "bound", resourceID: writable, access: "read-write" } },
    ]);
    expect(await page.write(3, pageWrite.set("n", 6), writable)).toEqual({ type: "applied", seq: 3 });
  });

  it("with the flag on, checks the binding as it stands when each operation is applied, sending bound with the page's new level", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const bound = await server.createdStore({ value: { n: 1 } });
    await server.bind(bound, a.artifactID, "read-write");
    const page = await server.pageConnection(a.artifactID);
    expect(await page.write(1, pageWrite.set("n", 5), bound)).toEqual({ type: "applied", seq: 1 });
    await server.bind(bound, a.artifactID, "read");
    expect(await page.waitForEvent((event) => event.event === "bound")).toEqual({ event: "bound", resourceID: bound, access: "read" });
    expect(await page.write(2, pageWrite.set("n", 6), bound)).toMatchObject({ type: "refused", seq: 2, code: "read-only" });
    expect(await page.get("n", bound)).toMatchObject({ type: "value", result: { exists: true, value: 5 } });
    await server.unbind(bound, a.artifactID);
    await page.waitForEvent((event) => event.event === "unbound");
    expect(await page.get("n", bound)).toMatchObject({ type: "error", code: "not-bound" });
    expect(await page.write(3, pageWrite.set("n", 7), bound)).toMatchObject({ type: "refused", seq: 3, code: "not-bound" });
    expect(await storeValue(server, { resourceID: bound }, "n")).toEqual({ exists: true, value: 5 });
  });

  it("with the flag on, ends subscriptions with not-bound when the binding is removed or the store destroyed, and sends the event", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const first = await server.createdStore({ value: {} });
    const second = await server.createdStore({ value: {} });
    await server.bind(first, a.artifactID, "read-write");
    await server.bind(second, a.artifactID, "read");
    const page = await server.pageConnection(a.artifactID);
    const toFirst = await page.subscribe("", first);
    const toSecond = await page.subscribe("", second);
    await server.unbind(first, a.artifactID);
    await page.waitForEvent((event) => event.event === "unbound");
    expect(page.replies(toFirst).at(-1)).toMatchObject({ type: "error", code: "not-bound" });
    await server.destroy(second, true);
    expect(await page.waitForEvent((event) => event.event === "destroyed")).toEqual({ event: "destroyed", resourceID: second });
    expect(page.replies(toSecond).at(-1)).toMatchObject({ type: "error", code: "not-bound" });
    expect(page.events).toEqual([
      { event: "unbound", resourceID: first },
      { event: "destroyed", resourceID: second },
    ]);
  });

  it("with the flag on, ends subscriptions and sends unbound when the artifact is deleted while the bindings file cannot be saved, and nothing of the store after", async () => {
    const failing = { bindingsRename: false };
    const storage: ResourceStorageOperations = {
      ...nodeResourceStorageOperations,
      rename: (from, to) => {
        if (failing.bindingsRename && path.basename(to) === "resource-bindings.json") throw new Error("injected rename failure");
        nodeResourceStorageOperations.rename(from, to);
      },
    };
    const server = await context.start({ storage, resourceBindings: true });
    const artifactID = server.createArtifact();
    const todos = await server.createdStore({ value: { secret: 1 } });
    await server.bind(todos, artifactID, "read-write");
    const page = await server.pageConnection(artifactID);
    const subscription = await page.subscribe("", todos);
    failing.bindingsRename = true;

    expect((await server.request("DELETE", `/artifacts/${artifactID}`)).status).toBe(200);
    await page.closed;
    await server.jsonSet({ resourceID: todos }, "secret", 2);
    expect(page.replies(subscription).at(-1)).toMatchObject({ type: "error", code: "not-bound" });
    expect(page.values(subscription)).toEqual([{ result: { exists: true, value: { secret: 1 } }, seq: 0 }]);
    expect(page.events).toEqual([{ event: "unbound", resourceID: todos }]);
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-notify-before-ack
describe("notifications before acknowledgement", () => {
  it("sends a write's subscription update on the writing connection before the write's acknowledgement", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const page = await server.pageConnection(a.artifactID);
    const id = await page.subscribe("n");
    await page.write(1, pageWrite.set("n", increment(1)));
    const update = page.messages.findIndex((message) => message.type === "value" && message.id === id && message.seq === 1);
    const ack = page.messages.findIndex((message) => message.type === "applied" && message.seq === 1);
    expect(update).toBeGreaterThan(-1);
    expect(update).toBeLessThan(ack);
    expect(page.values(id).at(-1)).toEqual({ result: { exists: true, value: 2 }, seq: 1 });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-page-events
describe("a page's events", () => {
  it("are changed for the artifact's own store, without a resource ID or artifact ID, and nothing for another artifact's store, under its ID and its share ID", async () => {
    const server = await context.start();
    const a = await ownStore(server, "A", { n: 1 });
    const b = await ownStore(server, "B", { n: 2 });
    const pages = [await server.pageConnection(a.artifactID), await server.pageConnection(await server.sharedAt(a.artifactID, "read"))];
    await server.jsonSet(at(b), "n", 3);
    await server.describe(b.resourceID, { description: "Not this page's" });
    await server.describe(a.resourceID, { description: "This page's, but no page hears of it" });
    await server.jsonUpdate(at(a), "", { n: 4, m: 1 });
    await server.destroy(b.resourceID, true);
    await server.jsonSet(at(a), "last", true);
    for (const page of pages) {
      await page.waitForEvent((event) => event.event === "changed" && event.paths.includes("last"));
      expect(page.events).toEqual([
        { event: "changed", paths: ["n", "m"] },
        { event: "changed", paths: ["last"] },
      ]);
    }
  });

  it("with the flag on, are destroyed and changed for the stores bound explicitly, bound and unbound for the artifact's own bindings, and no updated or created", async () => {
    const server = await context.start({ resourceBindings: true });
    const a = await ownStore(server, "A", { n: 1 });
    const b = await ownStore(server, "B", { n: 2 });
    const mine = await server.createdStore({ value: { n: 1 } });
    const theirs = await server.createdStore({ value: { n: 2 } });
    await server.bind(mine, a.artifactID, "read-write");
    await server.bind(theirs, b.artifactID, "read-write");
    await server.bind(b.resourceID, a.artifactID, "read");
    const page = await server.pageConnection(a.artifactID);
    const expected: PageEvent[] = [];

    await server.createdStore({ value: {} });
    await server.describe(theirs, { description: "Not this page's" });
    await server.jsonSet({ resourceID: theirs }, "n", 5);
    await server.bind(mine, b.artifactID, "read");
    await server.unbind(mine, b.artifactID);
    await server.destroy(theirs, true);
    await server.describe(mine, { description: "Mine" });

    await server.jsonSet({ resourceID: mine }, "n", 6);
    expected.push({ event: "changed", resourceID: mine, paths: ["n"] });
    await server.jsonSet(at(b), "n", 7);
    expected.push({ event: "changed", resourceID: b.resourceID, paths: ["n"] });
    await server.jsonSet(at(a), "n", 8);
    expected.push({ event: "changed", paths: ["n"] });
    const fresh = await server.createdStore({ value: {} });
    await server.bind(fresh, a.artifactID, "read");
    expected.push({ event: "bound", resourceID: fresh, access: "read" });
    await server.bind(fresh, a.artifactID, "read-write");
    expected.push({ event: "bound", resourceID: fresh, access: "read-write" });
    await server.unbind(fresh, a.artifactID);
    expected.push({ event: "unbound", resourceID: fresh });
    await server.destroy(mine, true);
    expected.push({ event: "destroyed", resourceID: mine });

    await page.waitForEvent((event) => event.event === "destroyed");
    expect(page.events).toEqual(expected);
  });
});
