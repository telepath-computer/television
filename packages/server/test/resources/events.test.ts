import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OWN_STORE_DESCRIPTION, type ResourceEvent } from "@telepath-computer/television-shared/resources";
import { nodeResourceStorageOperations, type ResourceStorageOperations } from "../../src/resources/storage.ts";
import { ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

const summary = (resourceID: string, fields: { description?: string; usage?: string; ownerArtifactID?: string } = {}) => ({
  resourceID,
  type: "json",
  description: fields.description ?? OWN_STORE_DESCRIPTION,
  usage: fields.usage ?? "",
  status: "available",
  createdAt: expect.any(String),
  ...(fields.ownerArtifactID === undefined ? {} : { ownerArtifactID: fields.ownerArtifactID }),
});

function readJsonIfExists(file: string): unknown {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The resource ID an event names. */
function eventStore(event: ResourceEvent): string {
  return "resource" in event ? event.resource.resourceID : event.resourceID;
}

/** What a client reading the stored files finds the moment each resource event arrives, by the store the event names. */
function observeFiles(
  server: RunningServer,
  socket: { on(event: "message", listener: (data: Buffer) => void): unknown },
  files: (resourceID: string) => Record<string, string>,
): string[] {
  const observed: string[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as { type: string; event?: ResourceEvent };
    if (message.type !== "resource-event") return;
    const found = Object.fromEntries(Object.entries(files(eventStore(message.event!))).map(([label, file]) => [label, readJsonIfExists(path.join(server.home, file))]));
    observed.push(`${message.event!.event}: ${JSON.stringify(found)}`);
  });
  return observed;
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-events
describe("resource events", () => {
  it("emits changed, updated and destroyed for an artifact's own store with the flag off, each after its change is stored, and nothing else", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const deleted = server.createArtifact("Deleted");
    const events = await server.eventsClient();
    const observed = observeFiles(server, events.socket, (store) => ({
      record: `state/artifacts/${artifactID}.json`,
      manifest: `resources/json/${store}/manifest.json`,
      content: `resources/json/${store}/content.json`,
    }));

    expect((await server.jsonSet({ artifactID }, "a", 1)).status).toBe(200);
    const resourceID = server.storePointer(artifactID)!;
    expect((await server.describe(resourceID, { description: "Chores" })).status).toBe(200);
    expect((await server.describe(resourceID, { usage: "Content: {a}.\nSet a." })).status).toBe(200);
    // The stream's other messages come between the resource events.
    server.createArtifact("Interleaved");
    expect((await server.jsonUpdate({ resourceID }, "", { b: 2 })).status).toBe(200);
    await server.jsonSet({ artifactID: deleted }, "", { kept: true });
    const deletedStore = server.storePointer(deleted)!;
    server.store.deleteArtifact(deleted);
    expect((await server.jsonSet({ resourceID: deletedStore }, "kept", false)).status).toBe(200);
    expect((await server.destroy(resourceID, true)).status).toBe(200);

    await events.waitForEvent((event) => event.event === "destroyed");
    const owned = { ownerArtifactID: artifactID };
    const expected: unknown[] = [
      { event: "changed", resourceID, artifactID, paths: ["a"] },
      { event: "updated", resource: summary(resourceID, { ...owned, description: "Chores" }) },
      { event: "updated", resource: summary(resourceID, { ...owned, description: "Chores", usage: "Content: {a}.\nSet a." }) },
      { event: "changed", resourceID, artifactID, paths: ["b"] },
      { event: "changed", resourceID: deletedStore, artifactID: deleted, paths: [""] },
      { event: "changed", resourceID: deletedStore, artifactID: deleted, paths: ["kept"] },
      { event: "destroyed", resourceID, artifactID },
    ];
    expect(events.resourceMessages).toEqual(expected.map((event) => ({ type: "resource-event", event })));
    expect(events.log.messages.map((message) => message.type)).toContain("artifact-created");

    const record = (store: string | undefined) => expect.objectContaining({ id: artifactID, ...(store === undefined ? {} : { store }) });
    const manifest = (description: string, usage: string) => ({ version: 1, createdAt: expect.any(String), description, usage, ownerArtifactID: artifactID });
    const usage = "Content: {a}.\nSet a.";
    const parsed = observed.slice(0, 4).map((line) => JSON.parse(line.slice(line.indexOf(":") + 2)));
    expect(parsed).toEqual([
      { record: record(resourceID), manifest: manifest(OWN_STORE_DESCRIPTION, ""), content: { a: 1 } },
      { record: record(resourceID), manifest: manifest("Chores", ""), content: { a: 1 } },
      { record: record(resourceID), manifest: manifest("Chores", usage), content: { a: 1 } },
      { record: record(resourceID), manifest: manifest("Chores", usage), content: { a: 1, b: 2 } },
    ]);
    // The destroy's first step is saving the owner's record without its pointer.
    const atDestroyed = JSON.parse(observed.at(-1)!.slice("destroyed: ".length)) as { record: Record<string, unknown> };
    expect(atDestroyed.record).not.toHaveProperty("store");
  });

  it("emits the matching event for creating, binding, rebinding, unbinding, writing to and destroying a created store with the flag on", async () => {
    const server = await context.start({ resourceBindings: true });
    const artifactID = server.createArtifact();
    const events = await server.eventsClient();
    const observed = observeFiles(server, events.socket, (store) => ({
      manifest: `resources/json/${store}/manifest.json`,
      content: `resources/json/${store}/content.json`,
      bindings: "state/resource-bindings.json",
    }));

    const resourceID = await server.createdStore({ description: "Chores", value: { a: 1 } });
    expect((await server.bind(resourceID, artifactID, "read")).status).toBe(200);
    expect((await server.bind(resourceID, artifactID, "read-write")).status).toBe(200);
    expect((await server.unbind(resourceID, artifactID)).status).toBe(200);
    expect((await server.jsonSet({ resourceID }, "a", 2)).status).toBe(200);
    expect((await server.bind(resourceID, artifactID, "read")).status).toBe(200);
    expect((await server.destroy(resourceID, true)).status).toBe(200);

    await events.waitForEvent((event) => event.event === "destroyed");
    expect(events.events).toEqual([
      { event: "created", resource: summary(resourceID, { description: "Chores" }) },
      { event: "bound", resourceID, artifactID, access: "read" },
      { event: "bound", resourceID, artifactID, access: "read-write" },
      { event: "unbound", resourceID, artifactID },
      { event: "changed", resourceID, paths: ["a"] },
      { event: "bound", resourceID, artifactID, access: "read" },
      { event: "destroyed", resourceID },
    ]);
    const binding = (access: string) => ({ version: 1, bindings: [{ resourceID, artifactID, access }] });
    const none = { version: 1, bindings: [] };
    const manifest = { version: 1, createdAt: expect.any(String), description: "Chores", usage: "" };
    const parsed = observed.map((line) => JSON.parse(line.slice(line.indexOf(":") + 2)));
    expect(parsed).toEqual([
      { manifest, content: { a: 1 }, bindings: null },
      { manifest, content: { a: 1 }, bindings: binding("read") },
      { manifest, content: { a: 1 }, bindings: binding("read-write") },
      { manifest, content: { a: 1 }, bindings: none },
      { manifest, content: { a: 2 }, bindings: none },
      { manifest, content: { a: 2 }, bindings: binding("read") },
      // A destroy whose first step is the bindings file has saved it when `destroyed` arrives;
      // its later steps may have run by the time the client reads.
      expect.objectContaining({ bindings: none }),
    ]);
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-artifact-delete
describe("artifact deletion", () => {
  it("deletes the record with a flush of its directory and leaves its store, which its manifest still names and its resource ID reaches", async () => {
    const log: string[] = [];
    const storage: ResourceStorageOperations = {
      ...nodeResourceStorageOperations,
      deleteFile: (file) => {
        log.push(`deleteFile ${path.basename(file)}`);
        nodeResourceStorageOperations.deleteFile(file);
      },
      flushDirectory: (directory) => {
        log.push(`flushDirectory ${path.basename(directory)}`);
        nodeResourceStorageOperations.flushDirectory(directory);
      },
    };
    const server = await context.start({ storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "", { a: 1 });
    const resourceID = server.storePointer(artifactID)!;
    log.length = 0;

    expect((await server.request("DELETE", `/artifacts/${artifactID}`)).status).toBe(200);
    expect(log).toEqual([`deleteFile ${artifactID}.json`, "flushDirectory artifacts"]);
    expect(existsSync(server.recordFile(artifactID))).toBe(false);
    expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.info(resourceID)).body.resource).toMatchObject({ ownerArtifactID: artifactID, bindings: [] });
    expect((await server.jsonGet({ artifactID })).body).toMatchObject({ code: "no-artifact" });
  });

  it("deletes a shared artifact's record with a flush of its directory, stops its share ID resolving and closes the page connections opened under its ID and its share ID, through the delete route and with its channel", async () => {
    const log: string[] = [];
    const storage: ResourceStorageOperations = {
      ...nodeResourceStorageOperations,
      deleteFile: (file) => {
        log.push(`deleteFile ${path.basename(file)}`);
        nodeResourceStorageOperations.deleteFile(file);
      },
      flushDirectory: (directory) => {
        log.push(`flushDirectory ${path.basename(directory)}`);
        nodeResourceStorageOperations.flushDirectory(directory);
      },
    };
    const server = await context.start({ storage });
    for (const through of ["route", "channel"] as const) {
      const channel = (await server.request("POST", "/channels", { name: `Doomed by ${through}` })).body.channel as { id: string };
      const file = path.join(server.home, `doomed-${through}.html`);
      writeFileSync(file, "<!doctype html>");
      const artifactID = server.store.createArtifact({ kind: "path", title: "Doomed", channelID: channel.id, path: file }).id;
      await server.jsonSet({ artifactID }, "", { kept: through });
      const resourceID = server.storePointer(artifactID)!;
      const shareID = await server.sharedAt(artifactID, "read");
      const pages = [await server.pageConnection(artifactID), await server.pageConnection(shareID)];

      log.length = 0;
      const deleted = through === "route" ? await server.request("DELETE", `/artifacts/${artifactID}`) : await server.request("DELETE", `/channels/${channel.id}`);
      expect(deleted.status, through).toBe(200);
      expect(log, through).toEqual([`deleteFile ${artifactID}.json`, "flushDirectory artifacts"]);
      for (const page of pages) await page.closed;
      const revoked = await server.pageConnection(shareID);
      expect(revoked.opening, through).toEqual({ type: "open", serverTime: expect.any(Number), bindings: [] });
      expect(await revoked.get()).toMatchObject({ type: "error", code: "no-store" });
      expect((await fetch(`${server.baseURL}/artifact/${shareID}/`, { redirect: "manual" })).status, through).toBe(404);
      expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { kept: through } });
      expect((await server.info(resourceID)).body.resource.ownerArtifactID).toBe(artifactID);
    }
  });

  it("with the flag on, removes every binding of an artifact deleted through the artifact delete route, emitting unbound for each, and leaves other artifacts' bindings to its own store", async () => {
    const server = await context.start({ resourceBindings: true });
    const artifactID = server.createArtifact();
    const other = server.createArtifact("Other");
    await server.jsonSet({ artifactID }, "", { own: true });
    const ownStore = server.storePointer(artifactID)!;
    const todos = await server.createdStore({ value: { a: 1 } });
    const notes = await server.createdStore({ value: ["n"] });
    await server.bind(todos, artifactID, "read-write");
    await server.bind(notes, artifactID, "read");
    await server.bind(notes, other, "read-write");
    await server.bind(ownStore, other, "read");
    const events = await server.eventsClient();

    expect((await server.request("DELETE", `/artifacts/${artifactID}`)).status).toBe(200);
    const expected = [notes, todos].sort().map((resourceID) => ({ event: "unbound", resourceID, artifactID }));
    await events.waitForEvent((event) => event.event === "unbound" && event.resourceID === expected[1]!.resourceID);
    expect(events.events).toEqual(expected);
    expect((await server.info(todos)).body.resource.bindings).toEqual([]);
    expect((await server.info(notes)).body.resource.bindings).toEqual([{ artifactID: other, access: "read-write" }]);
    expect((await server.info(ownStore)).body.resource.bindings).toEqual([{ artifactID: other, access: "read" }]);
    expect((await server.jsonGet({ resourceID: todos })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.jsonGet({ resourceID: ownStore })).body).toEqual({ exists: true, value: { own: true } });
    expect(JSON.parse(readFileSync(path.join(server.home, "state", "resource-bindings.json"), "utf8")).bindings).toEqual(
      [
        { resourceID: notes, artifactID: other, access: "read-write" },
        { resourceID: ownStore, artifactID: other, access: "read" },
      ].sort((left, right) => (left.resourceID < right.resourceID ? -1 : 1)),
    );
  });

  it("with the flag on, removes the bindings of an artifact deleted with its channel", async () => {
    const server = await context.start({ resourceBindings: true });
    const channel = (await server.request("POST", "/channels", { name: "Doomed" })).body.channel as { id: string };
    const file = path.join(server.home, "doomed.html");
    writeFileSync(file, "<!doctype html>");
    const artifactID = server.store.createArtifact({ kind: "path", title: "Doomed", channelID: channel.id, path: file }).id;
    await server.jsonSet({ artifactID }, "", { own: true });
    const ownStore = server.storePointer(artifactID)!;
    const todos = await server.createdStore({ value: { a: 1 } });
    await server.bind(todos, artifactID, "read-write");
    const events = await server.eventsClient();

    expect((await server.request("DELETE", `/channels/${channel.id}`)).status).toBe(200);
    await events.waitForEvent((event) => event.event === "unbound");
    expect(events.events).toEqual([{ event: "unbound", resourceID: todos, artifactID }]);
    expect(existsSync(server.recordFile(artifactID))).toBe(false);
    expect((await server.info(todos)).body.resource.bindings).toEqual([]);
    expect((await server.jsonGet({ resourceID: todos })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.jsonGet({ resourceID: ownStore })).body).toEqual({ exists: true, value: { own: true } });
  });

  it("with the flag on, emits unbound for each binding of a deleted artifact when the bindings file cannot be saved", async () => {
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
    const todos = await server.createdStore({ value: { a: 1 } });
    const notes = await server.createdStore({ value: ["n"] });
    await server.bind(todos, artifactID, "read-write");
    await server.bind(notes, artifactID, "read");
    const events = await server.eventsClient();
    failing.bindingsRename = true;

    expect((await server.request("DELETE", `/artifacts/${artifactID}`)).status).toBe(200);
    const expected = [notes, todos].sort().map((resourceID) => ({ event: "unbound", resourceID, artifactID }));
    await events.waitForEvent((event) => event.event === "unbound" && event.resourceID === expected[1]!.resourceID);
    expect(events.events).toEqual(expected);
    expect((await server.info(todos)).body.resource.bindings).toEqual([]);
    // The file still names the deleted artifact, which grants nothing.
    expect(JSON.parse(readFileSync(path.join(server.home, "state", "resource-bindings.json"), "utf8")).bindings).toHaveLength(2);
  });
});
