import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWN_STORE_DESCRIPTION, isResourceID, type ResourceEvent } from "@telepath-computer/television-shared/resources";
import { nodeResourceStorageOperations, type ResourceStorageOperations } from "../../src/resources/storage.ts";
import type { ServerStore } from "../../src/server-store.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { failingStorage, pageWrite, ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();

afterEach(async () => {
  vi.useRealTimers();
  await context.cleanup();
});

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Every file under a directory, relative to it, with `/` separators. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

function temporaryFiles(home: string): string[] {
  return [...filesUnder(path.join(home, "resources")), ...filesUnder(path.join(home, "state"))].filter((file) => file.includes(".tmp-"));
}

/** An HTML artifact on a serving store's first channel. */
function htmlArtifact(store: ServerStore, home: string, title = "Artifact"): string {
  const file = path.join(home, `${title.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(file, "<!doctype html><title>artifact</title>");
  return store.createArtifact({ kind: "path", title, channelID: store.listChannels()[0]!.id, path: file }).id;
}

function recordOf(home: string, artifactID: string): Record<string, unknown> {
  return readJson(path.join(home, "state", "artifacts", `${artifactID}.json`)) as Record<string, unknown>;
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-files
describe("store directories, manifests and the bindings file", () => {
  it("gives an artifact's store no files until its first write, which saves the pointer, then the manifest and the content; later writes touch only the content", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    const home = context.home();
    const store = createServingStore(home);
    const artifactID = htmlArtifact(store, home);
    expect(filesUnder(path.join(home, "resources"))).toEqual([]);
    expect(recordOf(home, artifactID)).not.toHaveProperty("store");

    store.resources.json.write({ artifactID }, { kind: "set", path: "", value: { items: { a: { done: false } } } });
    const resourceID = recordOf(home, artifactID).store;
    expect(isResourceID(resourceID)).toBe(true);
    const directory = path.join(home, "resources", "json", resourceID as string);
    expect(filesUnder(path.join(home, "resources"))).toEqual([`json/${resourceID}/content.json`, `json/${resourceID}/manifest.json`]);
    expect(readJson(path.join(directory, "manifest.json"))).toEqual({
      version: 1,
      createdAt: "2026-03-01T10:00:00.000Z",
      description: OWN_STORE_DESCRIPTION,
      usage: "",
      ownerArtifactID: artifactID,
    });
    expect(readFileSync(path.join(directory, "content.json"), "utf8")).toBe('{"items":{"a":{"done":false}}}');

    const manifest = readFileSync(path.join(directory, "manifest.json"), "utf8");
    vi.setSystemTime(new Date("2026-03-02T11:30:00.000Z"));
    store.resources.json.write({ artifactID }, { kind: "set", path: "items/a/done", value: true });
    expect(readFileSync(path.join(directory, "manifest.json"), "utf8")).toBe(manifest);
    expect(readFileSync(path.join(directory, "content.json"), "utf8")).toBe('{"items":{"a":{"done":true}}}');

    store.resources.json.write({ artifactID }, { kind: "remove", path: "" });
    expect(filesUnder(path.join(home, "resources"))).toEqual([`json/${resourceID}/manifest.json`]);
    expect(recordOf(home, artifactID).store).toBe(resourceID);
    expect(temporaryFiles(home)).toEqual([]);
  });

  it("rewrites only the manifest for a description or usage change, and with the flag on writes a created store's files, the bindings file and one binding per store and artifact, and deletes what a destroy removes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    const home = context.home();
    const store = createServingStore(home);
    const artifactID = htmlArtifact(store, home);
    store.resources.json.write({ artifactID }, { kind: "set", path: "", value: { a: 1 } });
    const own = recordOf(home, artifactID).store as string;
    const ownDir = path.join(home, "resources", "json", own);
    const content = readFileSync(path.join(ownDir, "content.json"), "utf8");
    store.resources.describe(own, { description: "Chores", usage: "Content: {a}.\nSet a." });
    expect(readJson(path.join(ownDir, "manifest.json"))).toEqual({
      version: 1,
      createdAt: "2026-03-01T10:00:00.000Z",
      description: "Chores",
      usage: "Content: {a}.\nSet a.",
      ownerArtifactID: artifactID,
    });
    expect(readFileSync(path.join(ownDir, "content.json"), "utf8")).toBe(content);

    store.resources.enableBindings();
    vi.setSystemTime(new Date("2026-03-02T11:30:00.000Z"));
    const created = store.resources.json.create({ description: "Shared notes", usage: "Notes.", value: ["n"] }).resourceID;
    const createdDir = path.join(home, "resources", "json", created);
    expect(readJson(path.join(createdDir, "manifest.json"))).toEqual({ version: 1, createdAt: "2026-03-02T11:30:00.000Z", description: "Shared notes", usage: "Notes." });
    expect(readFileSync(path.join(createdDir, "content.json"), "utf8")).toBe('["n"]');

    const bindingsFile = path.join(home, "state", "resource-bindings.json");
    store.resources.bind(created, artifactID, "read");
    expect(readJson(bindingsFile)).toEqual({ version: 1, bindings: [{ resourceID: created, artifactID, access: "read" }] });
    store.resources.bind(created, artifactID, "read-write");
    expect(readJson(bindingsFile)).toEqual({ version: 1, bindings: [{ resourceID: created, artifactID, access: "read-write" }] });

    expect(store.resources.destroy(created, { force: true })).toEqual([{ resourceID: created, artifactID, access: "read-write" }]);
    expect(readJson(bindingsFile)).toEqual({ version: 1, bindings: [] });
    expect(existsSync(createdDir)).toBe(false);
    expect(temporaryFiles(home)).toEqual([]);
  });
});

type Operation = keyof ResourceStorageOperations;

/** The recording storage-operations hook: logs each operation with paths relative to the home, and fails one on request. */
function recordingStorage(home: string, log: string[]) {
  const control: { fail: { operation: Operation; file: string } | null } = { fail: null };
  const name = (file: string) => {
    const relative = path.relative(home, file).split(path.sep).join("/") || ".";
    return relative.replace(/\/\.([^/]+)\.tmp-[0-9a-f]+$/, "/<tmp:$1>");
  };
  const wrap = <K extends Operation>(operation: K) =>
    ((...args: string[]) => {
      const paths = (operation === "writeTemporaryFile" ? args.slice(0, 1) : args).map(name);
      log.push(`${operation} ${paths.join(" -> ")}`);
      const fail = control.fail;
      if (fail && fail.operation === operation && paths.some((file) => file.includes(fail.file))) {
        throw new Error(`injected ${operation} failure`);
      }
      return (nodeResourceStorageOperations[operation] as (...a: string[]) => void)(...args);
    }) as ResourceStorageOperations[K];
  const storage: ResourceStorageOperations = {
    writeTemporaryFile: wrap("writeTemporaryFile"),
    flushFile: wrap("flushFile"),
    rename: wrap("rename"),
    flushDirectory: wrap("flushDirectory"),
    deleteFile: wrap("deleteFile"),
    createDirectory: wrap("createDirectory"),
    removeDirectory: wrap("removeDirectory"),
    readFile: nodeResourceStorageOperations.readFile,
    readDirectory: nodeResourceStorageOperations.readDirectory,
    exists: nodeResourceStorageOperations.exists,
  };
  return { storage, control };
}

function rewriteSequence(file: string): string[] {
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file);
  return [
    `writeTemporaryFile ${dir}/<tmp:${base}>`,
    `flushFile ${dir}/<tmp:${base}>`,
    `rename ${dir}/<tmp:${base}> -> ${file}`,
    `flushDirectory ${dir}`,
  ];
}

/** A serving store whose resource and record files go through the recording hook. */
function recordedStore(log: string[]) {
  const home = context.home();
  const { storage, control } = recordingStorage(home, log);
  const store = createServingStore(home, { resourceStorageOperations: storage });
  return { home, store, control };
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-write-order
describe("the order of file writes", () => {
  it("saves the record's pointer, creates the directory and writes the manifest and then the content, each flushed before the write is reported", () => {
    const log: string[] = [];
    const { store, home } = recordedStore(log);
    const artifactID = htmlArtifact(store, home);
    store.resources.onEvent((event: ResourceEvent) => log.push(`event ${event.event}`));
    const change = (label: string, run: () => unknown) => {
      log.length = 0;
      run();
      log.push(`returned ${label}`);
      return [...log];
    };
    const record = `state/artifacts/${artifactID}.json`;

    const first = change("first write", () => store.resources.json.write({ artifactID }, { kind: "set", path: "a", value: 1 }));
    const resourceID = recordOf(home, artifactID).store as string;
    const directory = `resources/json/${resourceID}`;
    expect(first).toEqual([
      ...rewriteSequence(record),
      "createDirectory resources",
      "flushDirectory .",
      "createDirectory resources/json",
      "flushDirectory resources",
      `createDirectory ${directory}`,
      "flushDirectory resources/json",
      ...rewriteSequence(`${directory}/manifest.json`),
      ...rewriteSequence(`${directory}/content.json`),
      "event changed",
      "returned first write",
    ]);
    expect(change("set", () => store.resources.json.write({ artifactID }, { kind: "set", path: "a", value: 2 }))).toEqual([
      ...rewriteSequence(`${directory}/content.json`),
      "event changed",
      "returned set",
    ]);
    expect(change("remove", () => store.resources.json.write({ resourceID }, { kind: "remove", path: "" }))).toEqual([
      `deleteFile ${directory}/content.json`,
      `flushDirectory ${directory}`,
      "event changed",
      "returned remove",
    ]);
    expect(change("title", () => store.updateArtifact({ artifactID, fields: { title: "Renamed" } }))).toEqual([...rewriteSequence(record), "returned title"]);
  });

  it("deletes an artifact's record and then flushes its directory", () => {
    const log: string[] = [];
    const { store, home } = recordedStore(log);
    const artifactID = htmlArtifact(store, home);
    log.length = 0;
    store.deleteArtifact(artifactID);
    expect(log).toEqual([`deleteFile state/artifacts/${artifactID}.json`, "flushDirectory state/artifacts"]);
  });

  it("leaves the original file's bytes in place and reports the change as failed when a step before the rename fails", () => {
    for (const operation of ["writeTemporaryFile", "flushFile", "rename"] as const) {
      const log: string[] = [];
      const { store, home, control } = recordedStore(log);
      const artifactID = htmlArtifact(store, home);
      store.resources.json.write({ artifactID }, { kind: "set", path: "", value: { a: 1 } });
      const resourceID = recordOf(home, artifactID).store as string;
      const events: ResourceEvent[] = [];
      store.resources.onEvent((event) => events.push(event));
      const recordFile = path.join(home, "state", "artifacts", `${artifactID}.json`);
      const contentFile = path.join(home, "resources", "json", resourceID, "content.json");
      const recordBefore = readFileSync(recordFile, "utf8");
      const contentBefore = readFileSync(contentFile, "utf8");

      control.fail = { operation, file: "content.json" };
      expect(() => store.resources.json.write({ artifactID }, { kind: "set", path: "a", value: 2 }), operation).toThrow();
      control.fail = { operation, file: `${artifactID}.json` };
      expect(() => store.updateArtifact({ artifactID, fields: { title: "Renamed" } }), operation).toThrow();
      control.fail = null;

      expect(readFileSync(recordFile, "utf8")).toBe(recordBefore);
      expect(readFileSync(contentFile, "utf8")).toBe(contentBefore);
      expect(events).toEqual([]);
      expect(store.resources.json.get({ artifactID }, "a")).toEqual({ exists: true, value: 1 });
      expect(store.getArtifact(artifactID)?.title).toBe("Artifact");
      expect(temporaryFiles(home)).toEqual([]);
    }
  });

  it("leaves an artifact's store with no files and no pointer when a first write's record save fails before its rename", () => {
    const log: string[] = [];
    const { store, home, control } = recordedStore(log);
    const artifactID = htmlArtifact(store, home);
    const recordBefore = readFileSync(path.join(home, "state", "artifacts", `${artifactID}.json`), "utf8");
    control.fail = { operation: "rename", file: `${artifactID}.json` };
    expect(() => store.resources.json.write({ artifactID }, { kind: "set", path: "a", value: 1 })).toThrow();
    control.fail = null;
    expect(readFileSync(path.join(home, "state", "artifacts", `${artifactID}.json`), "utf8")).toBe(recordBefore);
    expect(filesUnder(path.join(home, "resources"))).toEqual([]);
    expect(store.resources.json.get({ artifactID }, "")).toEqual({ exists: false });
  });

  it("creates a store's directory, then its manifest and content; destroys an own store's pointer first and a bound store's bindings before its files and directory", () => {
    const log: string[] = [];
    const { store, home } = recordedStore(log);
    store.resources.enableBindings();
    const artifactID = htmlArtifact(store, home);
    const reader = htmlArtifact(store, home, "Reader");
    store.resources.onEvent((event: ResourceEvent) => log.push(`event ${event.event}`));
    const change = (label: string, run: () => unknown) => {
      log.length = 0;
      run();
      log.push(`returned ${label}`);
      return [...log];
    };
    const removal = (directory: string) => [
      `deleteFile ${directory}/content.json`,
      `flushDirectory ${directory}`,
      `deleteFile ${directory}/manifest.json`,
      `flushDirectory ${directory}`,
      `removeDirectory ${directory}`,
      "flushDirectory resources/json",
    ];

    let created = "";
    const creation = change("create", () => {
      created = store.resources.json.create({ description: "Notes", value: { n: 1 } }).resourceID;
    });
    const createdDir = `resources/json/${created}`;
    expect(creation).toEqual([
      "createDirectory resources",
      "flushDirectory .",
      "createDirectory resources/json",
      "flushDirectory resources",
      `createDirectory ${createdDir}`,
      "flushDirectory resources/json",
      ...rewriteSequence(`${createdDir}/manifest.json`),
      ...rewriteSequence(`${createdDir}/content.json`),
      "event created",
      "returned create",
    ]);
    store.resources.bind(created, reader, "read");
    expect(change("destroy a bound store", () => store.resources.destroy(created, { force: true }))).toEqual([
      ...rewriteSequence("state/resource-bindings.json"),
      "event destroyed",
      ...removal(createdDir),
      "returned destroy a bound store",
    ]);

    store.resources.json.write({ artifactID }, { kind: "set", path: "", value: { a: 1 } });
    const own = recordOf(home, artifactID).store as string;
    store.resources.bind(own, reader, "read");
    expect(change("destroy an own store", () => store.resources.destroy(own, { force: true }))).toEqual([
      ...rewriteSequence(`state/artifacts/${artifactID}.json`),
      "event destroyed",
      ...rewriteSequence("state/resource-bindings.json"),
      ...removal(`resources/json/${own}`),
      "returned destroy an own store",
    ]);
  });
});

/** Writes an artifact record's `store` pointer directly, as a crash after the pointer's save leaves it. */
function setPointer(server: RunningServer, artifactID: string, resourceID: string): void {
  const record = readJson(server.recordFile(artifactID)) as Record<string, unknown>;
  writeFileSync(server.recordFile(artifactID), JSON.stringify({ ...record, store: resourceID }, null, 2));
}

const AUTHORED_ID = "01JAAAAAAAAAAAAAAAAAAAAAAA";

// spec: proofs/arch/resources/index.md#^rs-arch-t-first-write
describe("first writes, interrupted and concurrent", () => {
  async function serverWithArtifact(prepare?: (server: RunningServer, artifactID: string) => void, options: { storage?: ResourceStorageOperations } = {}) {
    let server = await context.start();
    const artifactID = server.createArtifact();
    if (prepare) {
      await context.stop(server);
      prepare(server, artifactID);
      server = await context.start({ home: server.home, ...options });
    }
    return { server, artifactID };
  }
  const storeDir = (server: RunningServer, resourceID: string) => path.join(server.home, "resources", "json", resourceID);

  it("reads an interrupted first write as having no value, and completes it at the next write", async () => {
    const cases: Array<[string, (server: RunningServer, resourceID: string) => void]> = [
      ["a pointer with no directory", () => undefined],
      ["a directory with neither manifest nor content", (server, resourceID) => mkdirSync(storeDir(server, resourceID), { recursive: true })],
      ["a manifest with no content", (server, resourceID) => {
        mkdirSync(storeDir(server, resourceID), { recursive: true });
        writeFileSync(path.join(storeDir(server, resourceID), "manifest.json"), JSON.stringify({ version: 1, createdAt: "2026-03-01T10:00:00.000Z", description: "A store", usage: "", ownerArtifactID: "x" }));
      }],
    ];
    for (const [label, damage] of cases) {
      const { server, artifactID } = await serverWithArtifact((stopped, id) => {
        setPointer(stopped, id, AUTHORED_ID);
        damage(stopped, AUTHORED_ID);
      });
      expect((await server.jsonGet({ artifactID })).body, label).toEqual({ exists: false });
      expect((await server.jsonGet({ resourceID: AUTHORED_ID })).body, label).toEqual({ exists: false });
      expect((await server.jsonSet({ artifactID }, "a", 1)).status, label).toBe(200);
      expect(filesUnder(storeDir(server, AUTHORED_ID)), label).toEqual(["content.json", "manifest.json"]);
      expect(readJson(path.join(storeDir(server, AUTHORED_ID), "content.json")), label).toEqual({ a: 1 });
      expect(readJson(server.recordFile(artifactID)), label).toMatchObject({ store: AUTHORED_ID });
      await context.stop(server);
    }
  });

  it("makes a store whose content has no valid manifest unavailable, leaving its files byte-identical", async () => {
    const cases: Array<[string, string | null]> = [
      ["content with no manifest", null],
      ["content with a manifest that is not valid JSON", "{ not valid"],
    ];
    for (const [label, manifest] of cases) {
      const { server, artifactID } = await serverWithArtifact((stopped, id) => {
        setPointer(stopped, id, AUTHORED_ID);
        mkdirSync(storeDir(stopped, AUTHORED_ID), { recursive: true });
        writeFileSync(path.join(storeDir(stopped, AUTHORED_ID), "content.json"), '{"a":1}');
        if (manifest !== null) writeFileSync(path.join(storeDir(stopped, AUTHORED_ID), "manifest.json"), manifest);
      });
      const before = filesUnder(storeDir(server, AUTHORED_ID)).map((file) => readFileSync(path.join(storeDir(server, AUTHORED_ID), file), "utf8"));
      expect((await server.jsonGet({ artifactID })).body, label).toMatchObject({ code: "unavailable" });
      expect((await server.jsonSet({ artifactID }, "a", 2)).body, label).toMatchObject({ code: "unavailable" });
      expect(filesUnder(storeDir(server, AUTHORED_ID)).map((file) => readFileSync(path.join(storeDir(server, AUTHORED_ID), file), "utf8")), label).toEqual(before);
      await context.stop(server);
    }
  });

  it("refuses a first write that fails at any step, leaving a state the next write completes", async () => {
    const steps: Array<[keyof ResourceStorageOperations, string]> = [
      ["rename", ".json"],
      ["createDirectory", "resources/json/"],
      ["rename", "manifest.json"],
      ["rename", "content.json"],
    ];
    for (const [operation, file] of steps) {
      const hook = failingStorage();
      const server = await context.start({ storage: hook.storage });
      const artifactID = server.createArtifact();
      hook.fail(operation, operation === "rename" && file === ".json" ? `${artifactID}.json` : file);
      const refused = await server.jsonSet({ artifactID }, "a", 1);
      hook.succeed();
      expect(refused.status, `${operation} ${file}`).not.toBe(200);
      expect((await server.jsonGet({ artifactID })).body, `${operation} ${file}`).toEqual({ exists: false });
      expect((await server.jsonSet({ artifactID }, "b", 2)).status, `${operation} ${file}`).toBe(200);
      const resourceID = (readJson(server.recordFile(artifactID)) as { store: string }).store;
      expect(filesUnder(storeDir(server, resourceID)), `${operation} ${file}`).toEqual(["content.json", "manifest.json"]);
      expect((await server.jsonGet({ artifactID })).body, `${operation} ${file}`).toEqual({ exists: true, value: { b: 2 } });
      await context.stop(server);
    }
  });

  it("applies two first writes sent at once under one resource ID and one directory", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const [first, second] = await Promise.all([server.jsonSet({ artifactID }, "a", 1), server.jsonSet({ artifactID }, "b", 2)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(readdirSync(path.join(server.home, "resources", "json"))).toHaveLength(1);
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: 1, b: 2 } });
  });
});

/**
 * Node's storage operations, except that the directory flush right after a
 * rename onto a file named `name`, or a deletion of one or removal of a
 * directory so named, fails once armed.
 */
function failingFlushAfter(name: string) {
  const state = { armed: false, pending: false };
  const storage: ResourceStorageOperations = {
    ...nodeResourceStorageOperations,
    rename: (from, to) => {
      nodeResourceStorageOperations.rename(from, to);
      if (state.armed && path.basename(to) === name) state.pending = true;
    },
    deleteFile: (file) => {
      nodeResourceStorageOperations.deleteFile(file);
      if (state.armed && path.basename(file) === name) state.pending = true;
    },
    removeDirectory: (directory) => {
      nodeResourceStorageOperations.removeDirectory(directory);
      if (state.armed && path.basename(directory) === name) state.pending = true;
    },
    flushDirectory: (directory) => {
      if (state.pending) {
        state.pending = false;
        state.armed = false;
        throw new Error("injected flushDirectory failure");
      }
      nodeResourceStorageOperations.flushDirectory(directory);
    },
  };
  return { storage, arm: () => void (state.armed = true) };
}

/**
 * `failingFlushAfter(name)`, whose failing flush also makes every check of
 * whether a path named `unchecked` exists fail, until `check` is called.
 */
function uncheckedAfterFailedFlush(name: string, unchecked: string) {
  const flush = failingFlushAfter(name);
  const state = { failing: false };
  const storage: ResourceStorageOperations = {
    ...flush.storage,
    flushDirectory: (directory) => {
      try {
        flush.storage.flushDirectory(directory);
      } catch (error) {
        state.failing = true;
        throw error;
      }
    },
    exists: (target) => {
      if (state.failing && path.basename(target) === unchecked) throw new Error("injected exists failure");
      return nodeResourceStorageOperations.exists(target);
    },
  };
  return { storage, arm: flush.arm, check: () => void (state.failing = false) };
}

const UNKNOWN_OUTCOME = { error: expect.stringMatching(/outcome is unknown/), code: "unavailable" };

// spec: proofs/arch/resources/index.md#^rs-arch-t-uncertain-save
describe("saves whose outcome is uncertain", () => {
  it("leaves a first write's pointer in effect when its record's save is uncertain, and creates the store's files under it at the next write", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    const events = await server.eventsClient();
    hook.fail("flushDirectory", "state/artifacts");
    expect((await server.jsonSet({ artifactID }, "a", 1)).body).toEqual(UNKNOWN_OUTCOME);
    hook.succeed();
    const resourceID = (readJson(server.recordFile(artifactID)) as { store: string }).store;
    expect(isResourceID(resourceID)).toBe(true);
    expect(existsSync(path.join(server.home, "resources", "json", resourceID))).toBe(false);
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: false });

    expect((await server.jsonSet({ artifactID }, "a", 2)).status).toBe(200);
    expect(filesUnder(path.join(server.home, "resources", "json", resourceID))).toEqual(["content.json", "manifest.json"]);
    expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { a: 2 } });
    await events.waitForEvent((event) => event.event === "changed");
    expect(events.events).toEqual([{ event: "changed", resourceID, artifactID, paths: ["a"] }]);
  });

  it("keeps the record from before a first write whose record cannot be read back, and saves the record whole at the next write", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    hook.fail("flushDirectory", "state/artifacts", { corrupt: true });
    expect((await server.jsonSet({ artifactID }, "a", 1)).body).toEqual(UNKNOWN_OUTCOME);
    hook.succeed();
    expect(readFileSync(server.recordFile(artifactID), "utf8")).toBe("{ not valid");
    expect(filesUnder(path.join(server.home, "resources"))).toEqual([]);

    expect((await server.jsonSet({ artifactID }, "a", 2)).status).toBe(200);
    expect(readJson(server.recordFile(artifactID))).toMatchObject({ id: artifactID, kind: "path", title: "Artifact", store: expect.any(String) });
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: 2 } });
  });

  it("puts a description change in effect, emitting updated, when its flush fails, and the retry succeeds; a manifest that cannot be read back keeps the description before", async () => {
    const hook = failingFlushAfter("manifest.json");
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    const events = await server.eventsClient();
    hook.arm();
    expect((await server.describe(resourceID, { description: "Chores" })).body).toEqual(UNKNOWN_OUTCOME);
    expect((await server.info(resourceID)).body.resource.description).toBe("Chores");
    expect(await events.waitForEvent((event) => event.event === "updated")).toMatchObject({ event: "updated", resource: { resourceID, description: "Chores" } });
    expect((await server.describe(resourceID, { description: "Chores" })).status).toBe(200);

    const corrupting = failingStorage();
    const second = await context.start({ storage: corrupting.storage });
    const other = second.createArtifact();
    await second.jsonSet({ artifactID: other }, "a", 1);
    const otherStore = second.storePointer(other)!;
    const otherEvents = await second.eventsClient();
    corrupting.fail("flushDirectory", `resources/json/${otherStore}`, { corrupt: true });
    expect((await second.describe(otherStore, { description: "Lost" })).body).toEqual(UNKNOWN_OUTCOME);
    corrupting.succeed();
    expect((await second.info(otherStore)).body.resource.description).toBe(OWN_STORE_DESCRIPTION);
    expect((await second.describe(otherStore, { usage: "Kept." })).status).toBe(200);
    expect(readJson(path.join(second.home, "resources", "json", otherStore, "manifest.json"))).toMatchObject({ description: OWN_STORE_DESCRIPTION, usage: "Kept." });
    expect(otherEvents.events.map((event) => event.event)).toEqual(["updated"]);
  });

  it("treats a destroy as taken effect when its first deletion's flush fails: destroyed is emitted, the store is gone, and a retry finishes the deletion", async () => {
    const hook = failingFlushAfter("content.json");
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    server.store.deleteArtifact(artifactID);
    const events = await server.eventsClient();
    hook.arm();
    expect((await server.destroy(resourceID)).body).toEqual(UNKNOWN_OUTCOME);
    expect(await events.waitForEvent((event) => event.event === "destroyed")).toEqual({ event: "destroyed", resourceID, artifactID });
    expect((await server.info(resourceID)).body).toMatchObject({ code: "not-found" });
    expect((await server.list()).body.resources).toEqual([]);
    expect((await server.destroy(resourceID)).status).toBe(200);
    expect(existsSync(path.join(server.home, "resources", "json", resourceID))).toBe(false);
    expect((await server.destroy(resourceID)).body).toMatchObject({ code: "not-found" });
    expect(events.events.map((event) => event.event)).toEqual(["destroyed"]);
  });

  it("takes a destroy whose last flush fails, after its directory is gone, as complete, so a retry is refused with not-found", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    server.store.deleteArtifact(artifactID);
    await server.stop();
    const hook = failingFlushAfter(resourceID);
    const restarted = await context.start({ home: server.home, storage: hook.storage });
    const events = await restarted.eventsClient();
    hook.arm();
    expect((await restarted.destroy(resourceID)).body).toEqual(UNKNOWN_OUTCOME);
    expect(existsSync(path.join(restarted.home, "resources", "json", resourceID))).toBe(false);
    expect(await events.waitForEvent((event) => event.event === "destroyed")).toEqual({ event: "destroyed", resourceID, artifactID });
    expect((await restarted.destroy(resourceID)).body).toMatchObject({ code: "not-found" });
  });

  it("does not take a destroy's first deletion as done when its flush fails and the file's absence cannot be confirmed: nothing is emitted, the store stands, and a retry completes", async () => {
    const hook = uncheckedAfterFailedFlush("content.json", "content.json");
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    server.store.deleteArtifact(artifactID);
    const events = await server.eventsClient();
    hook.arm();
    expect((await server.destroy(resourceID)).body).toEqual(UNKNOWN_OUTCOME);
    hook.check();
    expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.list()).body.resources.map((resource: { resourceID: string }) => resource.resourceID)).toEqual([resourceID]);
    expect((await server.destroy(resourceID)).status).toBe(200);
    expect(existsSync(path.join(server.home, "resources", "json", resourceID))).toBe(false);
    await events.waitForEvent((event) => event.event === "destroyed");
    expect(events.events).toEqual([{ event: "destroyed", resourceID, artifactID }]);
  });

  it("keeps a destroy whose last flush fails unfinished when its directory's absence cannot be confirmed, so a retry finishes it", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    server.store.deleteArtifact(artifactID);
    await server.stop();
    const hook = uncheckedAfterFailedFlush(resourceID, resourceID);
    const restarted = await context.start({ home: server.home, storage: hook.storage });
    hook.arm();
    expect((await restarted.destroy(resourceID)).body).toEqual(UNKNOWN_OUTCOME);
    hook.check();
    expect((await restarted.info(resourceID)).body).toMatchObject({ code: "not-found" });
    expect((await restarted.destroy(resourceID)).status).toBe(200);
    expect((await restarted.destroy(resourceID)).body).toMatchObject({ code: "not-found" });
  });

  it("clears the pointer of an own store whose owner's record save is uncertain, giving its observers what a completed destroy gives them", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    await server.stop();

    // The owner's record is renamed into place before its directory's flush fails.
    const flush = failingFlushAfter(`${artifactID}.json`);
    const restarted = await context.start({ home: server.home, storage: flush.storage });
    const events = await restarted.eventsClient();
    const page = await restarted.pageConnection(artifactID);
    const subscription = await page.subscribe("a");
    flush.arm();
    expect((await restarted.destroy(resourceID, true)).body).toEqual(UNKNOWN_OUTCOME);
    await page.log.waitFor((message) => message.type === "value" && message.id === subscription && !message.result.exists);
    expect(page.replies(subscription).filter((message) => message.type === "error")).toEqual([]);
    expect(restarted.storePointer(artifactID)).toBeUndefined();
    expect(existsSync(path.join(restarted.home, "resources", "json", resourceID))).toBe(true);
    expect(await events.waitForEvent((event) => event.event === "destroyed")).toEqual({ event: "destroyed", resourceID, artifactID });
    expect((await restarted.jsonGet({ artifactID })).body).toEqual({ exists: false });
    expect((await restarted.list()).body.resources).toEqual([]);
    expect((await restarted.jsonGet({ resourceID })).body).toMatchObject({ code: "not-found" });

    expect((await restarted.destroy(resourceID)).body).toEqual({ removedBindings: [] });
    expect(existsSync(path.join(restarted.home, "resources", "json", resourceID))).toBe(false);
    expect((await restarted.jsonSet({ artifactID }, "b", 2)).status).toBe(200);
    expect(restarted.storePointer(artifactID)).not.toBe(resourceID);
    await events.waitForEvent((event) => event.event === "changed");
    expect(events.events.map((event) => event.event)).toEqual(["destroyed", "changed"]);
  });

  it("puts a share link's creation, level change and revocation in effect when the record's flush fails, and deletes an artifact whose deletion's flush fails, each refused as of unknown outcome; retries succeed, and a retried revocation is refused with not-shared", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    await server.stop();
    const flush = failingFlushAfter(`${artifactID}.json`);
    const restarted = await context.start({ home: server.home, storage: flush.storage });
    const serves = async (id: string) => (await fetch(`${restarted.baseURL}/artifact/${id}/`, { redirect: "manual" })).status !== 404;

    flush.arm();
    expect((await restarted.share(artifactID, "read")).body).toEqual(UNKNOWN_OUTCOME);
    const shareID = (JSON.parse(readFileSync(restarted.recordFile(artifactID), "utf8")) as { share: { id: string } }).share.id;
    expect(await serves(shareID)).toBe(true);
    const page = await restarted.pageConnection(shareID);
    expect(page.opening.access).toBe("read");
    expect((await restarted.share(artifactID, "read")).body).toMatchObject({ shareID, access: "read" });

    flush.arm();
    expect((await restarted.share(artifactID, "read-write")).body).toEqual(UNKNOWN_OUTCOME);
    await page.log.waitFor((message) => message.type === "access");
    expect(page.accessChanges).toEqual(["read-write"]);
    expect(await page.write(1, pageWrite.set("a", 2))).toEqual({ type: "applied", seq: 1 });
    expect((await restarted.share(artifactID, "read-write")).body).toMatchObject({ shareID, access: "read-write" });

    flush.arm();
    expect((await restarted.unshare(artifactID)).body).toEqual(UNKNOWN_OUTCOME);
    await page.closed;
    expect(await serves(shareID)).toBe(false);
    expect((await restarted.unshare(artifactID)).body).toMatchObject({ code: "not-shared" });

    const again = await restarted.sharedAt(artifactID, "read");
    flush.arm();
    const deleted = await restarted.request("DELETE", `/artifacts/${artifactID}`);
    expect(deleted.status).toBe(503);
    expect(deleted.body).toMatchObject({ error: expect.stringMatching(/outcome is unknown/) });
    expect((await restarted.request("GET", `/artifacts/${artifactID}`)).status).toBe(404);
    expect(await serves(again)).toBe(false);
    expect((await restarted.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { a: 2 } });
  });

  it("keeps the share link from before a change whose record cannot be read back, and the next change saves the record whole", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    hook.fail("flushDirectory", "state/artifacts", { corrupt: true });
    expect((await server.share(artifactID, "read")).body).toEqual(UNKNOWN_OUTCOME);
    hook.succeed();
    expect((await server.request("GET", `/artifacts/${artifactID}`)).body.artifact).not.toHaveProperty("share");
    expect((await server.unshare(artifactID)).body).toMatchObject({ code: "not-shared" });
    const shareID = await server.sharedAt(artifactID, "read-write");
    expect(readJson(server.recordFile(artifactID))).toMatchObject({ id: artifactID, store: server.storePointer(artifactID), share: { id: shareID, access: "read-write" } });
  });

  it("with the flag on, leaves a created store available with its starting value, and a binding or unbinding in effect, when their flush fails, and a retried binding succeeds", async () => {
    const content = failingFlushAfter("content.json");
    const server = await context.start({ storage: content.storage, resourceBindings: true });
    const artifactID = server.createArtifact();
    const events = await server.eventsClient();
    content.arm();
    const created = await server.createJsonStore({ description: "Notes", value: { n: 1 } });
    expect(created.body).toEqual(UNKNOWN_OUTCOME);
    const [createdEvent] = [await events.waitForEvent((event) => event.event === "created")] as Array<Extract<ResourceEvent, { event: "created" }>>;
    const resourceID = createdEvent!.resource.resourceID;
    expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { n: 1 } });
    expect((await server.info(resourceID)).body.resource).toMatchObject({ status: "available", description: "Notes" });
    await server.stop();

    const bindings = failingFlushAfter("resource-bindings.json");
    const restarted = await context.start({ home: server.home, storage: bindings.storage, resourceBindings: true });
    const restartedEvents = await restarted.eventsClient();
    bindings.arm();
    expect((await restarted.bind(resourceID, artifactID, "read")).body).toEqual(UNKNOWN_OUTCOME);
    expect((await restarted.info(resourceID)).body.resource.bindings).toEqual([{ artifactID, access: "read" }]);
    const page = await restarted.pageConnection(artifactID);
    expect(await page.get("n", resourceID)).toMatchObject({ type: "value", result: { exists: true, value: 1 } });
    await page.close();
    expect((await restarted.bind(resourceID, artifactID, "read")).status).toBe(200);
    bindings.arm();
    expect((await restarted.unbind(resourceID, artifactID)).body).toEqual(UNKNOWN_OUTCOME);
    expect((await restarted.info(resourceID)).body.resource.bindings).toEqual([]);
    await restartedEvents.log.waitFor(() => restartedEvents.events.length === 2);
    expect(restartedEvents.events).toEqual([
      { event: "bound", resourceID, artifactID, access: "read" },
      { event: "unbound", resourceID, artifactID },
    ]);
  });

  it("with the flag on, keeps the bindings from before a binding whose file cannot be read back, and the next binding saves a file without it", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage, resourceBindings: true });
    const first = server.createArtifact("First");
    const second = server.createArtifact("Second");
    const resourceID = await server.createdStore({ value: {} });
    const events = await server.eventsClient();
    hook.fail("flushDirectory", `${path.sep}state`, { corrupt: true });
    expect((await server.bind(resourceID, first, "read")).body).toEqual(UNKNOWN_OUTCOME);
    hook.succeed();
    expect((await server.info(resourceID)).body.resource.bindings).toEqual([]);
    expect((await server.bind(resourceID, second, "read")).status).toBe(200);
    expect(readJson(path.join(server.home, "state", "resource-bindings.json"))).toEqual({ version: 1, bindings: [{ resourceID, artifactID: second, access: "read" }] });
    await events.waitForEvent((event) => event.event === "bound");
    expect(events.events).toEqual([{ event: "bound", resourceID, artifactID: second, access: "read" }]);
  });

  it("with the flag on, keeps a bound store with no owner whose destroy's bindings file cannot be read back, emitting nothing, and a retried destroy completes", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage, resourceBindings: true });
    const reader = server.createArtifact("Reader");
    const resourceID = await server.createdStore({ value: { a: 1 } });
    await server.bind(resourceID, reader, "read");
    const events = await server.eventsClient();
    hook.fail("flushDirectory", `${path.sep}state`, { corrupt: true });
    expect((await server.destroy(resourceID, true)).body).toEqual(UNKNOWN_OUTCOME);
    hook.succeed();
    expect((await server.info(resourceID)).body.resource.bindings).toEqual([{ artifactID: reader, access: "read" }]);
    expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { a: 1 } });
    expect((await server.list()).body.resources.map((resource: { resourceID: string }) => resource.resourceID)).toEqual([resourceID]);

    expect((await server.destroy(resourceID, true)).status).toBe(200);
    expect(existsSync(path.join(server.home, "resources", "json", resourceID))).toBe(false);
    expect(readJson(path.join(server.home, "state", "resource-bindings.json"))).toEqual({ version: 1, bindings: [] });
    await events.waitForEvent((event) => event.event === "destroyed");
    expect(events.events).toEqual([{ event: "destroyed", resourceID }]);
  });

  it("keeps an artifact whose record's deletion is uncertain and whose absence cannot be confirmed, refusing the deletion as of unknown outcome", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    hook.fail("flushDirectory", "state/artifacts");
    hook.fail("exists", `${artifactID}.json`);
    const refused = await server.request("DELETE", `/artifacts/${artifactID}`);
    hook.succeed();
    expect(refused.status).toBe(503);
    expect(refused.body).toMatchObject({ error: expect.stringMatching(/outcome is unknown/) });
    expect((await server.request("GET", `/artifacts/${artifactID}`)).status).toBe(200);
    expect((await server.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
  });

  it("keeps the description from before a change whose manifest cannot be read back, refusing it as of unknown outcome", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "a", 1);
    const resourceID = server.storePointer(artifactID)!;
    const events = await server.eventsClient();
    hook.fail("flushDirectory", `resources/json/${resourceID}`);
    hook.fail("readFile", "manifest.json");
    expect((await server.describe(resourceID, { description: "Lost" })).body).toEqual(UNKNOWN_OUTCOME);
    hook.succeed();
    expect((await server.info(resourceID)).body.resource).toMatchObject({ description: OWN_STORE_DESCRIPTION, status: "available" });
    expect((await server.describe(resourceID, { usage: "Kept." })).status).toBe(200);
    expect(readJson(path.join(server.home, "resources", "json", resourceID, "manifest.json"))).toMatchObject({ description: OWN_STORE_DESCRIPTION, usage: "Kept." });
    await events.waitForEvent((event) => event.event === "updated");
    expect(events.events.map((event) => event.event)).toEqual(["updated"]);
  });
});
