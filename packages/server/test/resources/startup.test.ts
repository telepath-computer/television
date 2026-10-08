import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWN_STORE_DESCRIPTION, type JSONValue } from "@telepath-computer/television-shared/resources";
import { failingStorage, pageWrite, ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();
afterEach(async () => {
  vi.restoreAllMocks();
  await context.cleanup();
});

function nested(depth: number): JSONValue {
  let value: JSONValue = true;
  for (let level = 0; level < depth; level++) value = { k: value };
  return value;
}

function recordWarnings(): string[] {
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  return warnings;
}

interface WrittenStore {
  artifactID: string;
  resourceID: string;
  directory: string;
}

/** Gives an artifact a store holding `value` through a real first write, and returns where its files are. */
async function writtenStore(server: RunningServer, value: JSONValue, title = "Artifact"): Promise<WrittenStore> {
  const artifactID = server.createArtifact(title);
  expect((await server.jsonSet({ artifactID }, "", value)).status).toBe(200);
  const resourceID = (JSON.parse(readFileSync(server.recordFile(artifactID), "utf8")) as { store: string }).store;
  return { artifactID, resourceID, directory: path.join(server.home, "resources", "json", resourceID) };
}

function bytesOf(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).sort().map((name) => [name, readFileSync(path.join(directory, name), "utf8")]));
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-load
describe("stores load when first used", () => {
  it("reads nothing at startup, then removes a store's leftovers and reports damage when it is first used", async () => {
    const first = await context.start();
    const damaged = await writtenStore(first, { a: 1 }, "Damaged");
    const kept = await writtenStore(first, { b: 2 }, "Kept");
    await first.stop();
    writeFileSync(path.join(damaged.directory, "content.json"), "{ not valid");
    const leftover = path.join(kept.directory, ".content.json.tmp-0123456789abcdef");
    writeFileSync(leftover, "partial");
    const damagedBytes = bytesOf(damaged.directory);

    const warnings = recordWarnings();
    const server = await context.start({ home: first.home });
    expect(warnings).toEqual([]);
    expect(existsSync(leftover)).toBe(true);

    expect((await server.jsonGet({ artifactID: kept.artifactID })).body).toEqual({ exists: true, value: { b: 2 } });
    expect(existsSync(leftover)).toBe(false);
    expect((await server.jsonGet({ artifactID: damaged.artifactID })).body).toMatchObject({ code: "unavailable" });
    expect((await server.jsonSet({ artifactID: damaged.artifactID }, "a", 3)).body).toMatchObject({ code: "unavailable" });
    expect(bytesOf(damaged.directory)).toEqual(damagedBytes);
  });

  it("reaches a deleted artifact's store by its resource ID", async () => {
    const server = await context.start();
    const written = await writtenStore(server, { kept: true });
    server.store.deleteArtifact(written.artifactID);
    expect((await server.jsonGet({ resourceID: written.resourceID })).body).toEqual({ exists: true, value: { kept: true } });
    await server.stop();
    const restarted = await context.start({ home: server.home });
    expect((await restarted.jsonGet({ resourceID: written.resourceID })).body).toEqual({ exists: true, value: { kept: true } });
  });

  it("keeps a used store's value in memory after its content file is deleted behind the server's back, until a restart", async () => {
    const server = await context.start();
    const written = await writtenStore(server, { a: 1 });
    rmSync(path.join(written.directory, "content.json"));
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    await server.stop();
    const restarted = await context.start({ home: server.home });
    expect((await restarted.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: false });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-startup
describe("resource startup", () => {
  it("reads no manifest and no bindings file with the flag off", async () => {
    const first = await context.start();
    const written = await writtenStore(first, { a: 1 });
    await first.stop();
    const jsonDir = path.join(first.home, "resources", "json");
    mkdirSync(path.join(jsonDir, "01JBBBBBBBBBBBBBBBBBBBBBBB"));
    writeFileSync(path.join(jsonDir, "01JBBBBBBBBBBBBBBBBBBBBBBB", "manifest.json"), "{ not valid");
    mkdirSync(path.join(jsonDir, "not-a-resource-id"));
    const bindingsFile = path.join(first.home, "state", "resource-bindings.json");
    writeFileSync(bindingsFile, "{ not valid");

    const warnings = recordWarnings();
    const server = await context.start({ home: first.home });
    expect(warnings).toEqual([]);
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.jsonSet({ artifactID: written.artifactID }, "b", 2)).status).toBe(200);
    expect(readFileSync(bindingsFile, "utf8")).toBe("{ not valid");
    expect(existsSync(path.join(jsonDir, "not-a-resource-id"))).toBe(true);
  });

  it("with the flag on reads no manifest, removes leftover temporary files in the state directory, and discards bindings whose artifact or store is gone", async () => {
    const first = await context.start({ resourceBindings: true });
    const kept = await first.createdStore({ value: { a: 1 } });
    const gone = await first.createdStore({ value: { b: 1 } });
    const reader = first.createArtifact("Reader");
    const deleted = first.createArtifact("Deleted");
    await first.bind(kept, reader, "read");
    await first.bind(gone, reader, "read");
    await first.bind(kept, deleted, "read-write");
    await first.stop();
    first.store.deleteArtifact(deleted);
    rmSync(path.join(first.home, "resources", "json", gone), { recursive: true });
    writeFileSync(path.join(first.home, "resources", "json", kept, "manifest.json"), "{ not valid");
    const leftover = path.join(first.home, "state", ".resource-bindings.json.tmp-0123456789abcdef");
    writeFileSync(leftover, "partial");

    const warnings = recordWarnings();
    const server = await context.start({ home: first.home, resourceBindings: true });
    expect(warnings).toEqual([]);
    expect(existsSync(leftover)).toBe(false);
    expect(JSON.parse(readFileSync(path.join(server.home, "state", "resource-bindings.json"), "utf8"))).toEqual({
      version: 1,
      bindings: [{ resourceID: kept, artifactID: reader, access: "read" }],
    });
  });

  it("with the flag on leaves a bindings file that is not valid as it is, refusing binding requests while own stores keep working, and loads it once repaired", async () => {
    const first = await context.start({ resourceBindings: true });
    const created = await first.createdStore({ value: {} });
    const reader = first.createArtifact("Reader");
    await first.bind(created, reader, "read");
    const written = await writtenStore(first, { a: 1 });
    await first.stop();
    const bindingsFile = path.join(first.home, "state", "resource-bindings.json");
    const valid = readFileSync(bindingsFile, "utf8");
    writeFileSync(bindingsFile, "{ not valid");

    recordWarnings();
    const server = await context.start({ home: first.home, resourceBindings: true });
    for (const pending of [server.bind(created, reader, "read-write"), server.unbind(created, reader)]) {
      expect((await pending).body).toMatchObject({ code: "unavailable" });
    }
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.jsonSet({ artifactID: written.artifactID }, "b", 2)).status).toBe(200);
    const page = await server.pageConnection(reader);
    expect(page.opening.bindings).toEqual([]);
    expect(await page.get("", created)).toMatchObject({ type: "error", code: "unavailable" });
    expect(await page.write(1, pageWrite.set("a", 1), created)).toMatchObject({ type: "refused", code: "unavailable" });
    expect(await page.list()).toMatchObject({ type: "error", code: "unavailable" });
    const ownPage = await server.pageConnection(written.artifactID);
    expect(await ownPage.write(1, pageWrite.set("c", 3))).toEqual({ type: "applied", seq: 1 });
    expect((await server.request("GET", "/channels")).status).toBe(200);
    expect((await server.request("GET", `/artifacts/${written.artifactID}`)).status).toBe(200);
    expect(readFileSync(bindingsFile, "utf8")).toBe("{ not valid");
    await server.stop();

    writeFileSync(bindingsFile, valid);
    const repaired = await context.start({ home: first.home, resourceBindings: true });
    expect((await repaired.info(created)).body.resource.bindings).toEqual([{ artifactID: reader, access: "read" }]);
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-list
describe("listing every store", () => {
  it("lists every store ordered by resource ID, with owners, a created store without one, and an unreadable manifest as unavailable, ignoring entries that are not stores", async () => {
    const first = await context.start({ resourceBindings: true });
    const owned = await writtenStore(first, { a: 1 }, "Owned");
    const deleted = await writtenStore(first, { b: 1 }, "Deleted");
    const damaged = await writtenStore(first, { c: 1 }, "Damaged");
    const created = await first.createdStore({ description: "Notes", value: [] });
    await first.bind(created, owned.artifactID, "read");
    first.store.deleteArtifact(deleted.artifactID);
    await first.stop();
    writeFileSync(path.join(damaged.directory, "manifest.json"), "{ not valid");
    const jsonDir = path.join(first.home, "resources", "json");
    mkdirSync(path.join(jsonDir, "not-a-resource-id"));
    writeFileSync(path.join(jsonDir, "todos.json"), "{}");
    // A file named as a resource ID is not a store either: only a directory is.
    writeFileSync(path.join(jsonDir, "01JCCCCCCCCCCCCCCCCCCCCCCC"), "{}");
    mkdirSync(path.join(first.home, "resources", "tables", "01JBBBBBBBBBBBBBBBBBBBBBBB"), { recursive: true });

    recordWarnings();
    const server = await context.start({ home: first.home, resourceBindings: true });
    const own = (store: WrittenStore) => ({
      resourceID: store.resourceID,
      type: "json",
      description: OWN_STORE_DESCRIPTION,
      usage: "",
      status: "available",
      createdAt: expect.any(String),
      ownerArtifactID: store.artifactID,
    });
    const expected = [
      own(owned),
      own(deleted),
      { resourceID: damaged.resourceID, type: "json", description: "", usage: "", status: "unavailable", unavailableReason: expect.any(String) },
      { resourceID: created, type: "json", description: "Notes", usage: "", status: "available", createdAt: expect.any(String) },
    ].sort((left, right) => (left.resourceID < right.resourceID ? -1 : 1));
    expect((await server.list()).body.resources).toEqual(expected);
    expect(existsSync(path.join(jsonDir, "not-a-resource-id"))).toBe(true);
    expect(existsSync(path.join(jsonDir, "todos.json"))).toBe(true);
    expect(readFileSync(path.join(jsonDir, "01JCCCCCCCCCCCCCCCCCCCCCCC"), "utf8")).toBe("{}");
    expect(existsSync(path.join(first.home, "resources", "tables"))).toBe(true);

    expect((await server.list(owned.artifactID)).body.resources).toEqual(
      [
        { ...own(owned), access: "read-write" },
        { resourceID: created, type: "json", description: "Notes", usage: "", status: "available", createdAt: expect.any(String), access: "read" },
      ].sort((left, right) => (left.resourceID < right.resourceID ? -1 : 1)),
    );
    await server.stop();
    const flagOff = await context.start({ home: first.home });
    expect((await flagOff.list(owned.artifactID)).body.resources).toEqual([{ ...own(owned), access: "read-write" }]);
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-unreadable
describe("files and directories that cannot be read", () => {
  it("starts with the flag on when the bindings file and the state directory cannot be read, refusing binding requests while own stores and the other routes keep working", async () => {
    const first = await context.start({ resourceBindings: true });
    const created = await first.createdStore({ value: {} });
    const reader = first.createArtifact("Reader");
    await first.bind(created, reader, "read");
    const written = await writtenStore(first, { a: 1 });
    await first.stop();
    const bindingsFile = path.join(first.home, "state", "resource-bindings.json");
    const bindingsBytes = readFileSync(bindingsFile, "utf8");

    const hook = failingStorage();
    hook.fail("readFile", "resource-bindings.json");
    hook.fail("readDirectory", `${path.sep}state`);
    const warnings = recordWarnings();
    const server = await context.start({ home: first.home, resourceBindings: true, storage: hook.storage });
    for (const pending of [server.bind(created, reader, "read-write"), server.unbind(created, reader)]) {
      expect((await pending).body).toMatchObject({ code: "unavailable", error: expect.stringContaining("resource-bindings.json") });
    }
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.jsonSet({ artifactID: written.artifactID }, "b", 2)).status).toBe(200);
    expect((await server.jsonGet({ resourceID: created })).body).toEqual({ exists: true, value: {} });
    expect((await server.list()).body.resources.map((resource: { status: string }) => resource.status)).toEqual(["available", "available"]);
    expect((await server.request("GET", "/channels")).status).toBe(200);
    expect((await server.request("GET", `/artifacts/${written.artifactID}`)).status).toBe(200);
    expect(warnings.some((warning) => warning.includes("resource-bindings.json"))).toBe(true);
    expect(readFileSync(bindingsFile, "utf8")).toBe(bindingsBytes);
  });

  it("reports a store whose directory cannot be read as unavailable, refusing its reads and its destroy, while the other stores keep working, and refuses a listing when the stores' directory cannot be read", async () => {
    const first = await context.start({ resourceBindings: true });
    const written = await writtenStore(first, { a: 1 });
    const unreadable = await first.createdStore({ description: "Notes", value: ["n"] });
    await first.stop();
    const unreadableDirectory = path.join(first.home, "resources", "json", unreadable);
    const unreadableBytes = bytesOf(unreadableDirectory);

    const hook = failingStorage();
    hook.fail("readDirectory", unreadable);
    recordWarnings();
    const server = await context.start({ home: first.home, resourceBindings: true, storage: hook.storage });
    const unavailable = { resourceID: unreadable, type: "json", description: "", usage: "", status: "unavailable", unavailableReason: expect.stringContaining("cannot be read") };
    expect((await server.list()).body.resources).toEqual(
      [
        { resourceID: written.resourceID, type: "json", description: OWN_STORE_DESCRIPTION, usage: "", status: "available", createdAt: expect.any(String), ownerArtifactID: written.artifactID },
        unavailable,
      ].sort((left, right) => (left.resourceID < right.resourceID ? -1 : 1)),
    );
    expect((await server.info(unreadable)).body.resource).toEqual({ ...unavailable, bindings: [] });
    expect((await server.jsonGet({ resourceID: unreadable })).body).toMatchObject({ code: "unavailable" });
    expect((await server.destroy(unreadable)).body).toMatchObject({ code: "unavailable" });
    expect((await server.info(unreadable)).body.resource.status).toBe("unavailable");
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.jsonSet({ artifactID: written.artifactID }, "b", 2)).status).toBe(200);

    hook.fail("readDirectory", path.join("resources", "json"));
    expect((await server.list()).body).toMatchObject({ code: "unavailable" });
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { a: 1, b: 2 } });
    hook.succeed();
    expect(bytesOf(unreadableDirectory)).toEqual(unreadableBytes);
  });

  it("reports an artifact's store whose directory cannot be checked as unavailable, refusing its reads and writes, and keeps its value for a later start", async () => {
    const first = await context.start();
    const written = await writtenStore(first, { kept: "original" });
    const other = await writtenStore(first, { b: 1 }, "Other");
    await first.stop();
    const writtenBytes = bytesOf(written.directory);

    const hook = failingStorage();
    hook.fail("exists", written.resourceID);
    recordWarnings();
    const server = await context.start({ home: first.home, storage: hook.storage });
    expect((await server.jsonGet({ artifactID: written.artifactID })).body).toMatchObject({ code: "unavailable" });
    expect((await server.jsonSet({ artifactID: written.artifactID }, "added", true)).body).toMatchObject({ code: "unavailable" });
    expect((await server.info(written.resourceID)).body.resource).toMatchObject({ status: "unavailable", unavailableReason: expect.stringContaining("cannot be checked") });
    expect(server.storePointer(written.artifactID)).toBe(written.resourceID);
    expect((await server.jsonSet({ artifactID: other.artifactID }, "c", 2)).status).toBe(200);

    hook.fail("exists", path.join("resources", "json"));
    const fresh = server.createArtifact("Fresh");
    expect((await server.jsonSet({ artifactID: fresh }, "a", 1)).body).toMatchObject({ code: "unavailable" });
    expect(server.storePointer(fresh)).toBeUndefined();
    hook.succeed();
    await server.stop();
    expect(bytesOf(written.directory)).toEqual(writtenBytes);

    const later = await context.start({ home: first.home });
    expect((await later.jsonGet({ artifactID: written.artifactID })).body).toEqual({ exists: true, value: { kept: "original" } });
  });

  it("with the flag on keeps a binding at startup whose store directory cannot be checked, leaving the bindings file as it is", async () => {
    const first = await context.start({ resourceBindings: true });
    const created = await first.createdStore({ value: { a: 1 } });
    const reader = first.createArtifact("Reader");
    await first.bind(created, reader, "read");
    await first.stop();
    const bindingsFile = path.join(first.home, "state", "resource-bindings.json");
    const bindingsBytes = readFileSync(bindingsFile, "utf8");

    const hook = failingStorage();
    hook.fail("exists", created);
    recordWarnings();
    const server = await context.start({ home: first.home, resourceBindings: true, storage: hook.storage });
    expect(readFileSync(bindingsFile, "utf8")).toBe(bindingsBytes);
    expect((await server.info(created)).body.resource).toMatchObject({ status: "unavailable", bindings: [{ artifactID: reader, access: "read" }] });
    hook.succeed();
    await server.stop();

    const later = await context.start({ home: first.home, resourceBindings: true });
    expect((await later.info(created)).body.resource).toMatchObject({ status: "available", bindings: [{ artifactID: reader, access: "read" }] });
    expect(readFileSync(bindingsFile, "utf8")).toBe(bindingsBytes);
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-file-formats
describe("files that do not match their version's format", () => {
  it("makes an artifact's store unavailable when its manifest has a field its format does not have, lacks createdAt or description, has an owner that is not a string or has another version, and writes a manifest with exactly its format's fields", async () => {
    const first = await context.start();
    const written = await writtenStore(first, { a: 1 });
    expect(Object.keys(JSON.parse(readFileSync(path.join(written.directory, "manifest.json"), "utf8"))).sort()).toEqual(["createdAt", "description", "ownerArtifactID", "usage", "version"]);
    await first.stop();
    const manifest = { version: 1, createdAt: "2026-03-01T10:00:00.000Z", description: OWN_STORE_DESCRIPTION, usage: "", ownerArtifactID: written.artifactID };
    const { createdAt: _createdAt, ...withoutCreatedAt } = manifest;
    const { description: _description, ...withoutDescription } = manifest;
    const variants: Array<[string, unknown]> = [
      ["a field its format does not have", { ...manifest, title: "x" }],
      ["no createdAt", withoutCreatedAt],
      ["no description", withoutDescription],
      ["an owner that is not a string", { ...manifest, ownerArtifactID: 7 }],
      ["version 2", { ...manifest, version: 2 }],
    ];
    for (const [label, variant] of variants) {
      writeFileSync(path.join(written.directory, "manifest.json"), JSON.stringify(variant));
      const before = bytesOf(written.directory);
      const server = await context.start({ home: first.home });
      expect((await server.jsonGet({ artifactID: written.artifactID })).body, label).toMatchObject({ code: "unavailable" });
      expect((await server.jsonSet({ artifactID: written.artifactID }, "a", 2)).body, label).toMatchObject({ code: "unavailable" });
      expect(bytesOf(written.directory), label).toEqual(before);
      await server.stop();
    }
  });

  it("with the flag on refuses every binding request while the bindings file has a field its format does not have or another version, leaving it byte-identical, and writes exactly the formats' fields", async () => {
    const first = await context.start({ resourceBindings: true });
    const reader = first.createArtifact("Reader");
    const created = await first.createdStore({ description: "Notes" });
    expect(Object.keys(JSON.parse(readFileSync(path.join(first.home, "resources", "json", created, "manifest.json"), "utf8"))).sort()).toEqual(["createdAt", "description", "usage", "version"]);
    await first.bind(created, reader, "read");
    const bindingsFile = path.join(first.home, "state", "resource-bindings.json");
    const stored = JSON.parse(readFileSync(bindingsFile, "utf8")) as { version: number; bindings: Array<Record<string, unknown>> };
    expect(Object.keys(stored).sort()).toEqual(["bindings", "version"]);
    expect(Object.keys(stored.bindings[0]!).sort()).toEqual(["access", "artifactID", "resourceID"]);
    const written = await writtenStore(first, { a: 1 });
    await first.describe(written.resourceID, { description: "Chores", usage: "Set a." });
    expect(Object.keys(JSON.parse(readFileSync(path.join(written.directory, "manifest.json"), "utf8"))).sort()).toEqual(["createdAt", "description", "ownerArtifactID", "usage", "version"]);
    await first.stop();

    const variants: Array<[string, unknown]> = [
      ["a top-level field its format does not have", { ...stored, title: "x" }],
      ["a binding field a binding does not have", { ...stored, bindings: [{ ...stored.bindings[0], note: "x" }] }],
      ["version 2", { ...stored, version: 2 }],
    ];
    recordWarnings();
    for (const [label, variant] of variants) {
      writeFileSync(bindingsFile, JSON.stringify(variant));
      const before = readFileSync(bindingsFile, "utf8");
      const server = await context.start({ home: first.home, resourceBindings: true });
      expect((await server.bind(created, reader, "read-write")).body, label).toMatchObject({ code: "unavailable" });
      expect((await server.unbind(created, reader)).body, label).toMatchObject({ code: "unavailable" });
      expect(readFileSync(bindingsFile, "utf8"), label).toBe(before);
      await server.stop();
    }
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-flag-off-stored
describe("stores and bindings left by a flag-on server", () => {
  it("keeps a created store an ordinary store with the flag off, never reading or changing the bindings file, which a flag-on server then reads again", async () => {
    const first = await context.start({ resourceBindings: true });
    const a = first.createArtifact("A");
    const b = await writtenStore(first, { b: 1 }, "B");
    const created = await first.createdStore({ description: "Shared", value: { shared: true } });
    await first.bind(created, a, "read-write");
    await first.bind(b.resourceID, a, "read");
    await first.stop();
    const bindingsFile = path.join(first.home, "state", "resource-bindings.json");
    const bindings = readFileSync(bindingsFile, "utf8");

    const flagOff = await context.start({ home: first.home });
    expect((await flagOff.list()).body.resources.map((resource: { resourceID: string }) => resource.resourceID).sort()).toEqual([b.resourceID, created].sort());
    expect((await flagOff.jsonGet({ resourceID: created })).body).toEqual({ exists: true, value: { shared: true } });
    expect((await flagOff.jsonSet({ resourceID: created }, "more", 1)).status).toBe(200);
    expect((await flagOff.info(created)).body.resource.bindings).toEqual([]);
    expect((await flagOff.list(a)).body.resources).toEqual([]);
    expect((await flagOff.jsonSet({ artifactID: b.artifactID }, "b", 2)).status).toBe(200);
    expect((await flagOff.info(b.resourceID)).body.resource.bindings).toEqual([{ artifactID: b.artifactID, access: "read-write" }]);
    const pageA = await flagOff.pageConnection(a);
    expect(pageA.opening.bindings).toEqual([]);
    for (const resourceID of [created, b.resourceID]) {
      expect(await pageA.get("", resourceID)).toMatchObject({ type: "error", code: "not-enabled" });
      expect(await pageA.write(1, pageWrite.set("x", 1), resourceID)).toMatchObject({ type: "refused", code: "not-enabled" });
    }
    const pageB = await flagOff.pageConnection(b.artifactID);
    expect(await pageB.write(1, pageWrite.set("b", 3))).toEqual({ type: "applied", seq: 1 });
    expect(await pageB.get("b")).toMatchObject({ type: "value", result: { exists: true, value: 3 } });
    expect(readFileSync(bindingsFile, "utf8")).toBe(bindings);
    await flagOff.stop();

    const flagOn = await context.start({ home: first.home, resourceBindings: true });
    expect((await flagOn.list(a)).body.resources.map((resource: { resourceID: string; access: string }) => [resource.resourceID, resource.access]).sort()).toEqual(
      [[created, "read-write"], [b.resourceID, "read"]].sort(),
    );
    expect((await flagOn.pageConnection(a)).opening.bindings).toEqual(
      [
        { resourceID: created, type: "json", access: "read-write" },
        { resourceID: b.resourceID, type: "json", access: "read" },
      ].sort((left, right) => (left.resourceID < right.resourceID ? -1 : 1)),
    );
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-content-file
describe("a JSON store's content file", () => {
  it("holds the value as compact JSON, null, {} and [] included, and is deleted with the whole value, leaving the manifest", async () => {
    const server = await context.start();
    const values: JSONValue[] = [null, {}, [], { a: [1, { b: "c" }] }];
    const stores: WrittenStore[] = [];
    for (const value of values) {
      const written = await writtenStore(server, value);
      expect(readFileSync(path.join(written.directory, "content.json"), "utf8"), JSON.stringify(value)).toBe(JSON.stringify(value));
      stores.push(written);
    }
    const emptied = await writtenStore(server, { a: 1 });
    expect((await server.jsonRemove({ artifactID: emptied.artifactID }, "")).status).toBe(200);
    expect(readdirSync(emptied.directory)).toEqual(["manifest.json"]);

    await server.stop();
    const restarted = await context.start({ home: server.home });
    expect((await restarted.jsonGet({ artifactID: emptied.artifactID })).body).toEqual({ exists: false });
    expect((await restarted.jsonGet({ artifactID: stores[0]!.artifactID })).body).toEqual({ exists: true, value: null });
  });

  it("reads back any JSON text, and makes a store unavailable when its content is not valid JSON or its value breaks a limit, leaving the file as it is", async () => {
    const first = await context.start();
    const pretty = await writtenStore(first, { a: 1 }, "Pretty");
    const invalid = await writtenStore(first, { a: 1 }, "Invalid");
    const tooDeep = await writtenStore(first, { a: 1 }, "Too deep");
    await first.stop();
    writeFileSync(path.join(pretty.directory, "content.json"), JSON.stringify({ a: 1, b: [true, null] }, null, 2));
    writeFileSync(path.join(invalid.directory, "content.json"), "{ not valid");
    writeFileSync(path.join(tooDeep.directory, "content.json"), JSON.stringify(nested(40)));
    const before = { invalid: bytesOf(invalid.directory), tooDeep: bytesOf(tooDeep.directory) };

    recordWarnings();
    const server = await context.start({ home: first.home });
    expect((await server.jsonGet({ artifactID: pretty.artifactID })).body).toEqual({ exists: true, value: { a: 1, b: [true, null] } });
    expect((await server.jsonGet({ artifactID: invalid.artifactID })).body).toMatchObject({ code: "unavailable" });
    expect((await server.jsonGet({ artifactID: tooDeep.artifactID })).body).toMatchObject({ code: "unavailable" });
    expect(bytesOf(invalid.directory)).toEqual(before.invalid);
    expect(bytesOf(tooDeep.directory)).toEqual(before.tooDeep);
  });
});
