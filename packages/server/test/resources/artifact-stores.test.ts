import fs, { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateArtifactID } from "@telepath-computer/television-artifact";
import { OWN_STORE_DESCRIPTION } from "@telepath-computer/television-shared/resources";
import { nodeResourceStorageOperations, type ResourceStorageOperations } from "../../src/resources/storage.ts";
import { failingStorage, pageWrite, ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

/** Writes an artifact's store through the administrative routes and returns its resource ID. */
async function ownStore(server: RunningServer, artifactID: string, value: unknown = { a: 1 }): Promise<string> {
  expect((await server.jsonSet({ artifactID }, "", value as never)).status).toBe(200);
  return server.storePointer(artifactID)!;
}

const OWN_SUMMARY = (resourceID: string, artifactID: string) => ({
  resourceID,
  type: "json",
  description: OWN_STORE_DESCRIPTION,
  usage: "",
  status: "available",
  createdAt: expect.any(String),
  ownerArtifactID: artifactID,
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-has-store
describe("which artifacts have a store", () => {
  it("gives every local path artifact a store, Markdown included, and none to URL and fixed-ID artifacts, saying so without naming a kind of file", async () => {
    const server = await context.start();
    for (const form of ["html", "htm", "markdown", "folder"] as const) {
      const artifactID = server.createArtifact(`A ${form}`, { form });
      expect((await server.jsonSet({ artifactID }, "a", form)).status, form).toBe(200);
      const page = await server.pageConnection(artifactID);
      expect(page.opening.access, form).toBe("read-write");
      expect(await page.write(1, pageWrite.set("b", form)), form).toEqual({ type: "applied", seq: 1 });
      expect((await server.jsonGet({ artifactID })).body, form).toEqual({ exists: true, value: { a: form, b: form } });
    }
    const withoutStores = [
      server.createArtifact("Link", { form: "url" }),
      server.createArtifact("Onboarding", { id: "onboarding-welcome" }),
    ];
    for (const artifactID of withoutStores) {
      const refused = (await server.jsonGet({ artifactID })).body as { code: string; error: string };
      expect(refused, artifactID).toMatchObject({ code: "no-store" });
      expect(refused.error, artifactID).not.toMatch(/HTML|Markdown|\.html?\b/i);
      expect((await server.jsonSet({ artifactID }, "a", 1)).body, artifactID).toMatchObject({ code: "no-store" });
      expect(server.storePointer(artifactID), artifactID).toBeUndefined();
    }
    const fixedID = await server.pageConnection("onboarding-welcome");
    expect(fixedID.opening).toEqual({ type: "open", serverTime: expect.any(Number), bindings: [] });
    expect(await fixedID.get()).toMatchObject({ type: "error", code: "no-store" });
    expect(await fixedID.write(1, pageWrite.set("a", 1))).toMatchObject({ type: "refused", code: "no-store" });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-own-store
describe("an artifact's own store is an ordinary store", () => {
  it("reports an own store with its fixed description, empty usage and owner, and its owner's binding, and changes its description and usage as any store's", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const resourceID = await ownStore(server, artifactID);
    expect((await server.list()).body.resources).toEqual([OWN_SUMMARY(resourceID, artifactID)]);
    expect((await server.info(resourceID)).body.resource).toEqual({
      ...OWN_SUMMARY(resourceID, artifactID),
      bindings: [{ artifactID, access: "read-write" }],
    });
    expect((await server.list(artifactID)).body.resources).toEqual([{ ...OWN_SUMMARY(resourceID, artifactID), access: "read-write" }]);

    expect((await server.describe(resourceID, { description: "Tasks for the launch", usage: "Content: {a}.\nSet a." })).body.resource).toEqual({
      ...OWN_SUMMARY(resourceID, artifactID),
      description: "Tasks for the launch",
      usage: "Content: {a}.\nSet a.",
    });
    expect((await server.info(resourceID)).body.resource).toMatchObject({ description: "Tasks for the launch", usage: "Content: {a}.\nSet a." });
  });

  it("with the flag on, refuses binding or unbinding the owner, and lets another artifact be bound to an own store", async () => {
    const server = await context.start({ resourceBindings: true });
    const owner = server.createArtifact("Owner");
    const other = server.createArtifact("Other");
    const resourceID = await ownStore(server, owner);
    const bindingsFile = path.join(server.home, "state", "resource-bindings.json");

    expect((await server.bind(resourceID, owner, "read")).body).toMatchObject({ code: "owner-binding" });
    expect((await server.unbind(resourceID, owner)).body).toMatchObject({ code: "owner-binding" });
    expect(existsSync(bindingsFile)).toBe(false);
    expect((await server.bind(resourceID, other, "read")).status).toBe(200);
    const bindings = readFileSync(bindingsFile, "utf8");
    expect((await server.bind(resourceID, owner, "read-write")).body).toMatchObject({ code: "owner-binding" });
    expect(readFileSync(bindingsFile, "utf8")).toBe(bindings);
    expect((await server.info(resourceID)).body.resource.bindings).toEqual(
      [{ artifactID: owner, access: "read-write" }, { artifactID: other, access: "read" }].sort((left, right) => (left.artifactID < right.artifactID ? -1 : 1)),
    );
    expect((await server.list(other)).body.resources).toEqual([{ ...OWN_SUMMARY(resourceID, owner), access: "read" }]);
  });

  it("with the flag on, lets the owner's page reach its own store by resource ID at the level of the page's ID, and a bound artifact's page at its binding's level without learning the owner's ID", async () => {
    const server = await context.start({ resourceBindings: true });
    const owner = server.createArtifact("Owner");
    const other = server.createArtifact("Other");
    const resourceID = await ownStore(server, owner, { n: 1 });
    await server.bind(resourceID, other, "read");

    const ownerPage = await server.pageConnection(owner);
    expect(ownerPage.opening).toMatchObject({ access: "read-write", bindings: [] });
    expect(await ownerPage.write(1, pageWrite.set("n", 2), resourceID)).toEqual({ type: "applied", seq: 1 });
    expect(await ownerPage.get("n")).toMatchObject({ type: "value", result: { exists: true, value: 2 } });
    expect(await ownerPage.list()).toEqual({ type: "resources", id: expect.any(String), resources: [{ resourceID, type: "json", access: "read-write" }] });
    expect(await ownerPage.info(resourceID)).toEqual({ type: "resource", id: expect.any(String), resource: { resourceID, type: "json", access: "read-write" } });

    const sharedPage = await server.pageConnection(await server.sharedAt(owner, "read"));
    expect(await sharedPage.write(1, pageWrite.set("n", 3), resourceID)).toMatchObject({ type: "refused", code: "read-only" });
    expect(await sharedPage.get("n", resourceID)).toMatchObject({ type: "value", result: { exists: true, value: 2 } });
    expect(await sharedPage.list()).toMatchObject({ resources: [{ resourceID, type: "json", access: "read" }] });

    const otherPage = await server.pageConnection(other);
    expect(otherPage.opening.bindings).toEqual([{ resourceID, type: "json", access: "read" }]);
    expect(await otherPage.get("n", resourceID)).toMatchObject({ type: "value", result: { exists: true, value: 2 } });
    expect(await otherPage.write(1, pageWrite.set("n", 4), resourceID)).toMatchObject({ type: "refused", code: "read-only" });
    expect(await otherPage.info(resourceID)).toMatchObject({ resource: { resourceID, type: "json", access: "read" } });
    expect(JSON.stringify(otherPage.messages)).not.toContain(owner);
  });

  it("with the flag on, ends a bound artifact's subscriptions with not-bound on a forced destroy, while the owner's page's subscriptions to its own store hear no value and stay", async () => {
    const server = await context.start({ resourceBindings: true });
    const owner = server.createArtifact("Owner");
    const other = server.createArtifact("Other");
    const resourceID = await ownStore(server, owner, { n: 1 });
    await server.bind(resourceID, other, "read");
    const ownerPage = await server.pageConnection(owner);
    const ownSubscription = await ownerPage.subscribe("n");
    const otherPage = await server.pageConnection(other);
    const boundSubscription = await otherPage.subscribe("n", resourceID);

    expect((await server.destroy(resourceID, true)).status).toBe(200);
    await otherPage.waitForEvent((event) => event.event === "destroyed");
    expect(otherPage.replies(boundSubscription).at(-1)).toMatchObject({ type: "error", code: "not-bound" });
    await ownerPage.log.waitFor((message) => message.type === "value" && message.id === ownSubscription && !message.result.exists);
    expect(await ownerPage.write(1, pageWrite.set("n", 5))).toEqual({ type: "applied", seq: 1 });
    expect(ownerPage.values(ownSubscription).map(({ result }) => result)).toEqual([{ exists: true, value: 1 }, { exists: false }, { exists: true, value: 5 }]);
    expect(ownerPage.events).toEqual([{ event: "changed", paths: ["n"] }]);
    expect(server.storePointer(owner)).not.toBe(resourceID);
  });

  it("refuses destroying an own store without force, listing its owner and the artifacts bound to it; a forced destroy removes the owner's pointer, and the owner's next write creates a new store", async () => {
    for (const bindings of [false, true]) {
      const server = await context.start({ resourceBindings: bindings });
      const owner = server.createArtifact("Owner");
      const other = server.createArtifact("Other");
      const resourceID = await ownStore(server, owner, { kept: true });
      if (bindings) await server.bind(resourceID, other, "read");
      const expected = [{ resourceID, artifactID: owner, access: "read-write" }, ...(bindings ? [{ resourceID, artifactID: other, access: "read" }] : [])]
        .sort((left, right) => (left.artifactID < right.artifactID ? -1 : 1));

      const refused = await server.destroy(resourceID);
      expect(refused.body, `bindings ${bindings}`).toMatchObject({ code: "still-bound", bindings: expected });
      expect((await server.jsonGet({ resourceID })).body).toEqual({ exists: true, value: { kept: true } });

      expect((await server.destroy(resourceID, true)).body).toEqual({ removedBindings: expected });
      expect(server.storePointer(owner)).toBeUndefined();
      expect(existsSync(path.join(server.home, "resources", "json", resourceID))).toBe(false);
      expect((await server.jsonGet({ resourceID })).body).toMatchObject({ code: "not-found" });
      expect((await server.info(resourceID)).body).toMatchObject({ code: "not-found" });
      expect((await server.jsonGet({ artifactID: owner })).body).toEqual({ exists: false });
      expect((await server.list(other)).body.resources).toEqual([]);

      expect((await server.jsonSet({ artifactID: owner }, "a", 1)).status).toBe(200);
      const next = server.storePointer(owner)!;
      expect(next).not.toBe(resourceID);
      expect((await server.jsonGet({ resourceID: next })).body).toEqual({ exists: true, value: { a: 1 } });
      expect((await server.jsonGet({ resourceID })).body).toMatchObject({ code: "not-found" });
      await server.stop();
    }
  });

  it("treats a destroy whose file deletion fails after the owner's record is saved as taken effect, and finishes it when retried", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const owner = server.createArtifact("Owner");
    const resourceID = await ownStore(server, owner, { kept: true });
    const directory = path.join(server.home, "resources", "json", resourceID);
    const events = await server.eventsClient();
    const page = await server.pageConnection(owner);
    const subscription = await page.subscribe();

    hook.fail("deleteFile", "content.json");
    const refused = await server.destroy(resourceID, true);
    hook.succeed();
    await page.log.waitFor((message) => message.type === "value" && message.id === subscription && !message.result.exists);
    expect(page.replies(subscription).filter((message) => message.type === "error")).toEqual([]);
    expect(await page.get()).toMatchObject({ type: "value", result: { exists: false } });
    expect(refused.body).toMatchObject({ code: "unavailable", error: expect.stringMatching(/destroy it again/) });
    expect(server.storePointer(owner)).toBeUndefined();
    expect(existsSync(directory)).toBe(true);
    await events.waitForEvent((event) => event.event === "destroyed");
    expect(events.events).toEqual([{ event: "destroyed", resourceID, artifactID: owner }]);
    expect((await server.jsonGet({ artifactID: owner })).body).toEqual({ exists: false });
    expect((await server.jsonGet({ resourceID })).body).toMatchObject({ code: "not-found" });
    expect((await server.list()).body.resources).toEqual([]);

    // A server restarted before the retry finds the files as a store that no pointer reaches.
    await server.stop();
    const restarted = await context.start({ home: server.home });
    expect((await restarted.list()).body.resources).toEqual([{ ...OWN_SUMMARY(resourceID, owner) }]);
    expect((await restarted.info(resourceID)).body.resource.bindings).toEqual([]);
    expect((await restarted.jsonGet({ artifactID: owner })).body).toEqual({ exists: false });

    expect((await restarted.destroy(resourceID)).body).toEqual({ removedBindings: [] });
    expect(existsSync(directory)).toBe(false);
  });

  it("finishes an incomplete deletion when the destroy is retried on the same server", async () => {
    const hook = failingStorage();
    const server = await context.start({ storage: hook.storage });
    const owner = server.createArtifact("Owner");
    const resourceID = await ownStore(server, owner);
    hook.fail("deleteFile", "manifest.json");
    expect((await server.destroy(resourceID, true)).body).toMatchObject({ code: "unavailable" });
    hook.succeed();
    const directory = path.join(server.home, "resources", "json", resourceID);
    expect(existsSync(path.join(directory, "manifest.json"))).toBe(true);
    expect((await server.destroy(resourceID)).body).toEqual({ removedBindings: [] });
    expect(existsSync(directory)).toBe(false);
    expect((await server.destroy(resourceID)).body).toMatchObject({ code: "not-found" });
  });

  it("with the flag off, destroys a deleted artifact's store without force", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const resourceID = await ownStore(server, artifactID);
    server.store.deleteArtifact(artifactID);
    expect((await server.destroy(resourceID)).body).toEqual({ removedBindings: [] });
    expect((await server.jsonGet({ resourceID })).body).toMatchObject({ code: "not-found" });
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-artifact-record
describe("the artifact record's store and share", () => {
  it("saves the store pointer at the first write, keeps it through a title change, returns it from the artifact API, and loads a record without it", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).not.toHaveProperty("store");
    expect((await server.request("GET", `/artifacts/${artifactID}`)).body.artifact).not.toHaveProperty("store");
    const resourceID = await ownStore(server, artifactID);
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).toMatchObject({ store: resourceID });

    expect((await server.request("PATCH", `/artifacts/${artifactID}`, { title: "Renamed" })).status).toBe(200);
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).toMatchObject({ title: "Renamed", store: resourceID });
    expect((await server.request("GET", `/artifacts/${artifactID}`)).body.artifact).toMatchObject({ title: "Renamed", store: resourceID });
    expect((await server.request("GET", "/artifacts")).body.artifacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: artifactID, store: resourceID })]),
    );

    const shareID = await server.sharedAt(artifactID, "read");
    const share = { id: shareID, access: "read" };
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).toMatchObject({ store: resourceID, share });
    expect((await server.request("PATCH", `/artifacts/${artifactID}`, { title: "Renamed again" })).status).toBe(200);
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).toMatchObject({ title: "Renamed again", store: resourceID, share });
    expect((await server.request("GET", `/artifacts/${artifactID}`)).body.artifact).toMatchObject({ store: resourceID, share });

    const plain = server.createArtifact("Plain");
    await server.stop();
    const record = JSON.parse(readFileSync(server.recordFile(plain), "utf8")) as Record<string, unknown>;
    writeFileSync(server.recordFile(plain), JSON.stringify({ id: record.id, kind: record.kind, title: record.title, path: record.path }));
    const restarted = await context.start({ home: server.home });
    expect((await restarted.jsonGet({ artifactID: plain })).body).toEqual({ exists: false });
    expect((await restarted.pageConnection(plain)).opening.access).toBe("read-write");
    expect((await restarted.unshare(plain)).body).toMatchObject({ code: "not-shared" });
    expect((await restarted.jsonGet({ artifactID })).body).toEqual({ exists: true, value: { a: 1 } });
  });

  it("keeps both a share change and a title change sent at once", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const [titled, shared] = await Promise.all([
      server.request("PATCH", `/artifacts/${artifactID}`, { title: "Both" }),
      server.share(artifactID, "read-write"),
    ]);
    expect([titled.status, shared.status]).toEqual([200, 200]);
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).toMatchObject({
      title: "Both",
      share: { id: shared.body.shareID, access: "read-write" },
    });
  });
});

/** The ID-generator hook: returns the IDs it is given, in order, and then generates them as production does. */
function chosenIDs(): { generate: () => string; next: (...ids: string[]) => void } {
  const queue: string[] = [];
  return { generate: () => queue.shift() ?? generateArtifactID(), next: (...ids) => void queue.push(...ids) };
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-share-ids
describe("share IDs never equal another ID", () => {
  it("draws a new share ID again when it equals an existing artifact ID or share ID, and a new artifact ID when it equals a share ID", async () => {
    const ids = chosenIDs();
    const server = await context.start({ generateID: ids.generate });
    const first = server.createArtifact("First");
    const second = server.createArtifact("Second");
    ids.next(first);
    const firstShare = await server.sharedAt(second, "read");
    expect(firstShare).not.toBe(first);
    ids.next(firstShare);
    const third = server.createArtifact("Third");
    expect(third).not.toBe(firstShare);
    ids.next(firstShare, first);
    const thirdShare = await server.sharedAt(third, "read-write");
    expect([first, second, third, firstShare]).not.toContain(thirdShare);

    expect((await server.pageConnection(firstShare)).opening.access).toBe("read");
    expect((await server.pageConnection(thirdShare)).opening.access).toBe("read-write");
    expect((await server.pageConnection(first)).opening.access).toBe("read-write");
  });

  it("resolves a share link made before a restart after it, from the records the server loads", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await ownStore(server, artifactID, { n: 1 });
    const shareID = await server.sharedAt(artifactID, "read");
    await server.stop();
    const restarted = await context.start({ home: server.home });
    const page = await restarted.pageConnection(shareID);
    expect(page.opening.access).toBe("read");
    expect(await page.get("n")).toMatchObject({ type: "value", result: { exists: true, value: 1 } });
    const served = await fetch(`${restarted.baseURL}/artifact/${shareID}/`, { redirect: "manual" });
    expect(served.status).toBe(200);
    expect(await served.text()).toContain("<title>artifact</title>");
  });
});

/** The recording storage-operations hook: each record operation, with paths relative to the home. */
function recordingRecords(home: () => string): { storage: ResourceStorageOperations; log: string[] } {
  const log: string[] = [];
  const name = (file: string) => path.relative(home(), file).split(path.sep).join("/").replace(/\/\.([^/]+)\.tmp-[0-9a-f]+$/, "/<tmp:$1>");
  const record = (operation: string, ...files: string[]) => {
    if (files.some((file) => file.includes(`${path.sep}artifacts`))) log.push(`${operation} ${files.map(name).join(" -> ")}`);
  };
  const storage: ResourceStorageOperations = {
    ...nodeResourceStorageOperations,
    writeTemporaryFile: (file, contents) => {
      record("writeTemporaryFile", file);
      nodeResourceStorageOperations.writeTemporaryFile(file, contents);
    },
    flushFile: (file) => {
      record("flushFile", file);
      nodeResourceStorageOperations.flushFile(file);
    },
    rename: (from, to) => {
      record("rename", from, to);
      nodeResourceStorageOperations.rename(from, to);
    },
    flushDirectory: (directory) => {
      record("flushDirectory", directory);
      nodeResourceStorageOperations.flushDirectory(directory);
    },
  };
  return { storage, log };
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-share-change
describe("changing a share link", () => {
  it("answers creating, changing and revoking a link only after the record's last flush, and sharing again at the same level changes nothing", async () => {
    let home = "";
    const { storage, log } = recordingRecords(() => home);
    const server = await context.start({ storage });
    home = server.home;
    const artifactID = server.createArtifact();
    const record = `state/artifacts/${artifactID}.json`;
    const rewrite = [
      `writeTemporaryFile state/artifacts/<tmp:${artifactID}.json>`,
      `flushFile state/artifacts/<tmp:${artifactID}.json>`,
      `rename state/artifacts/<tmp:${artifactID}.json> -> ${record}`,
      "flushDirectory state/artifacts",
    ];
    for (const [change, send] of [
      ["create", () => server.share(artifactID, "read")],
      ["change", () => server.share(artifactID, "read-write")],
      ["revoke", () => server.unshare(artifactID)],
    ] as const) {
      log.length = 0;
      expect((await send()).status, change).toBe(200);
      expect(log, change).toEqual(rewrite);
    }
    const shared = await server.share(artifactID, "read");
    log.length = 0;
    const again = await server.share(artifactID, "read");
    expect(again.body).toEqual(shared.body);
    expect(log).toEqual([]);
  });

  it("answers creating a link and changing its level with the link's path and the server's origins, as /health reports them", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const origins = ((await server.request("GET", "/health", undefined, { token: null })).body as { origins: string[] }).origins;
    expect(origins).toEqual([`http://${server.host}`]);
    for (const access of ["read", "read-write", "read"] as const) {
      const shared = await server.share(artifactID, access);
      const { shareID } = shared.body as { shareID: string };
      expect(shared.body, access).toEqual({ shareID, access, path: `/artifact/${shareID}/`, origins });
    }
  });

  it("shares at read when a request gives no level, answers with an existing read link writing nothing, and refuses with access-required while the link is read-write, changing nothing", async () => {
    let home = "";
    const { storage, log } = recordingRecords(() => home);
    const server = await context.start({ storage });
    home = server.home;
    const artifactID = server.createArtifact();
    const created = await server.share(artifactID);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ shareID: expect.any(String), access: "read" });
    const { shareID } = created.body as { shareID: string };
    log.length = 0;
    expect((await server.share(artifactID)).body).toMatchObject({ shareID, access: "read" });
    expect(log).toEqual([]);

    expect((await server.share(artifactID, "read-write")).body).toMatchObject({ shareID, access: "read-write" });
    log.length = 0;
    const refused = await server.share(artifactID);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ code: "access-required", error: expect.stringContaining("read-write share link") });
    const message = (refused.body as { error: string }).error;
    expect(message).toContain(artifactID);
    expect(message).toMatch(/--access read-write\b/);
    expect(message).toMatch(/--access read\b(?!-)/);
    expect(log).toEqual([]);
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8")).share).toEqual({ id: shareID, access: "read-write" });
  });

  it("sends the new level to connections opened under the share ID, refusing their next write, while a connection under the artifact's ID receives nothing and keeps writing", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await ownStore(server, artifactID, { n: 1 });
    const shareID = await server.sharedAt(artifactID, "read-write");
    const shared = await server.pageConnection(shareID);
    const own = await server.pageConnection(artifactID);
    expect(await shared.write(1, pageWrite.set("n", 2))).toEqual({ type: "applied", seq: 1 });

    expect((await server.share(artifactID, "read")).body).toMatchObject({ shareID, access: "read" });
    await shared.log.waitFor((message) => message.type === "access");
    expect(shared.accessChanges).toEqual(["read"]);
    expect(await shared.write(2, pageWrite.set("n", 3))).toMatchObject({ type: "refused", code: "read-only" });
    expect(await own.write(1, pageWrite.set("n", 4))).toEqual({ type: "applied", seq: 1 });
    expect(own.accessChanges).toEqual([]);
    expect((await server.jsonGet({ artifactID }, "n")).body).toEqual({ exists: true, value: 4 });
  });

  it("closes the connections opened under a revoked share ID and not those under the artifact's ID, and a new connection under the revoked ID has no store", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await ownStore(server, artifactID, { n: 1 });
    const shareID = await server.sharedAt(artifactID, "read");
    const shared = await server.pageConnection(shareID);
    const own = await server.pageConnection(artifactID);

    expect((await server.unshare(artifactID)).status).toBe(200);
    await shared.closed;
    expect(await own.get("n")).toMatchObject({ type: "value", result: { exists: true, value: 1 } });
    const revoked = await server.pageConnection(shareID);
    expect(revoked.opening).toEqual({ type: "open", serverTime: expect.any(Number), bindings: [] });
    expect(await revoked.get()).toMatchObject({ type: "error", code: "no-store" });
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).not.toHaveProperty("share");
    const again = await server.sharedAt(artifactID, "read");
    expect(again).not.toBe(shareID);
  });

  it("refuses creating or changing a link on a tokenless server with tokenless while revoking works there, a URL artifact with not-shareable, an ID that names no artifact with no-artifact, and revoking an artifact without a link with not-shared, each changing nothing", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    const url = server.createArtifact("Link", { form: "url" });
    const plain = server.createArtifact("Plain");
    const shareID = await server.sharedAt(artifactID, "read");
    const refusals = [
      ["not-shareable", await server.share(url, "read")],
      ["no-artifact", await server.share("01NOSUCHARTIFACT0000000000", "read")],
      ["no-artifact", await server.unshare("01NOSUCHARTIFACT0000000000")],
      ["not-shared", await server.unshare(plain)],
    ] as const;
    for (const [code, result] of refusals) {
      expect(result.status, code).toBeGreaterThanOrEqual(400);
      expect(result.body, code).toEqual({ error: expect.any(String), code });
    }
    for (const id of [url, plain]) expect(JSON.parse(readFileSync(server.recordFile(id), "utf8"))).not.toHaveProperty("share");
    await server.stop();

    const tokenless = await context.start({ home: server.home, auth: false });
    for (const access of ["read", "read-write", undefined] as const) {
      for (const id of [artifactID, plain]) expect((await tokenless.share(id, access, { token: null })).body, `${id} ${access}`).toMatchObject({ code: "tokenless" });
    }
    expect(JSON.parse(readFileSync(tokenless.recordFile(artifactID), "utf8")).share).toEqual({ id: shareID, access: "read" });
    expect(JSON.parse(readFileSync(tokenless.recordFile(plain), "utf8"))).not.toHaveProperty("share");
    expect((await tokenless.unshare(artifactID, { token: null })).status).toBe(200);
    expect(JSON.parse(readFileSync(tokenless.recordFile(artifactID), "utf8"))).not.toHaveProperty("share");
  });

  it("refuses read-write sharing of a Markdown artifact with read-write-unsupported, creating or changing nothing, while a read link to it works and an artifact without a store is shared read-write, after tokenless on a tokenless server", async () => {
    let home = "";
    const { storage, log } = recordingRecords(() => home);
    const server = await context.start({ storage });
    home = server.home;
    const notes = server.createArtifact("Notes", { form: "markdown" });
    log.length = 0;
    const refused = await server.share(notes, "read-write");
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ code: "read-write-unsupported", error: expect.stringContaining("Read-write sharing is not supported") });
    const message = (refused.body as { error: string }).error;
    expect(message).toContain(notes);
    expect(message).toMatch(/Markdown/);
    expect(message).toMatch(/--access read\b(?!-)/);
    expect(log).toEqual([]);
    expect(JSON.parse(readFileSync(server.recordFile(notes), "utf8"))).not.toHaveProperty("share");

    // A read link works, and changing it to read-write is refused the same way.
    const shared = await server.share(notes, "read");
    expect(shared.status).toBe(200);
    const { shareID } = shared.body as { shareID: string };
    log.length = 0;
    expect((await server.share(notes, "read-write")).body).toMatchObject({ code: "read-write-unsupported" });
    expect(log).toEqual([]);
    expect(JSON.parse(readFileSync(server.recordFile(notes), "utf8")).share).toEqual({ id: shareID, access: "read" });

    // Whether an artifact has a store decides nothing: one without a store, by a fixed ID, is shared read-write.
    const storeless = server.createArtifact("Storeless", { id: "page-without-a-store" });
    expect((await server.share(storeless, "read-write")).body).toMatchObject({ access: "read-write" });
    await server.stop();

    const tokenless = await context.start({ home, auth: false });
    expect((await tokenless.share(notes, "read-write", { token: null })).body).toMatchObject({ code: "tokenless" });
  });
});

/** A response's status, headers and body, read whole. */
async function fetched(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const response = await fetch(url, { redirect: "manual", headers });
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() };
}

/**
 * A server with an artifact stored under its own ID, as
 * `<home>/artifacts/<artifact-id>/` for a folder and
 * `<home>/artifacts/<artifact-id>.<extension>` for a file, so that the path
 * of each of its files contains its ID.
 */
async function storedUnderItsID(
  form: "folder" | "html" | "htm" | "markdown",
  options: { sdkDir?: string } = {},
): Promise<{ server: RunningServer; artifactID: string; folder: string }> {
  const ids = chosenIDs();
  const server = await context.start({ generateID: ids.generate, ...options });
  const artifactID = generateArtifactID();
  ids.next(artifactID);
  const folder = path.join(server.home, "artifacts", artifactID);
  expect(server.createArtifact("Site", { form, at: folder })).toBe(artifactID);
  return { server, artifactID, folder };
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-share-serving
describe("serving under a share ID", () => {
  it("builds every redirect, error document and header from the share ID, never the artifact's ID, and serves a revoked share ID as an ID that names no artifact", async () => {
    const { server, artifactID, folder } = await storedUnderItsID("folder");
    mkdirSync(path.join(folder, "sub"));
    writeFileSync(path.join(folder, "sub", "index.html"), "<!doctype html><title>sub</title>");
    const shareID = await server.sharedAt(artifactID, "read");
    const base = `${server.baseURL}/artifact/${shareID}`;

    const responses = {
      root: await fetched(base),
      index: await fetched(`${base}/`),
      subfolder: await fetched(`${base}/sub`),
      subIndex: await fetched(`${base}/sub/`),
      missing: await fetched(`${base}/missing.html`),
    };
    expect(responses.root).toMatchObject({ status: 301, headers: { location: `/artifact/${shareID}/` } });
    expect(responses.index.status).toBe(200);
    expect(responses.subfolder).toMatchObject({ status: 301, headers: { location: `/artifact/${shareID}/sub/` } });
    expect(responses.subIndex.status).toBe(200);
    expect(responses.subIndex.body).toContain("<title>sub</title>");
    const viaOwnID = await fetched(`${server.baseURL}/artifact/${artifactID}/missing.html`);
    expect(responses.missing.status).toBe(viaOwnID.status);
    expect(responses.missing.body).toBe(viaOwnID.body);
    for (const [name, response] of Object.entries(responses)) {
      expect(JSON.stringify(response), name).not.toContain(artifactID);
    }

    expect((await server.unshare(artifactID)).status).toBe(200);
    const nothing = await fetched(`${server.baseURL}/artifact/01NOSUCHARTIFACT0000000000/`);
    for (const address of [base, `${base}/`, `${base}/sub/`]) {
      const revoked = await fetched(address);
      expect(revoked.status, address).toBe(nothing.status);
      expect(revoked.body, address).toBe(nothing.body);
    }
  });

  it("serves a single-file HTML or Markdown artifact whose file is named for its ID at the link's address itself, with nothing derived from the file's name, while its own ID still redirects to the file's name", async () => {
    for (const [form, extension, content] of [["html", "html", "<title>artifact</title>"], ["markdown", "md", "Artifact</h1>"]] as const) {
      const { server, artifactID } = await storedUnderItsID(form);
      if (form === "html") await ownStore(server, artifactID, { n: 1 });
      const fileName = `${artifactID}.${extension}`;
      const shareID = await server.sharedAt(artifactID, "read");
      const base = `${server.baseURL}/artifact/${shareID}`;
      const responses = {
        root: await fetched(base),
        entry: await fetched(`${base}/`),
        fileName: await fetched(`${base}/${fileName}`),
        other: await fetched(`${base}/other.${extension}`),
      };
      expect(responses.root, form).toMatchObject({ status: 301, headers: { location: `/artifact/${shareID}/` } });
      expect(responses.entry.status, form).toBe(200);
      expect(responses.entry.body, form).toContain(content);
      for (const name of ["fileName", "other"] as const) {
        expect({ status: responses[name].status, body: responses[name].body }, `${form} ${name}`).toEqual({ status: 404, body: "Not found" });
      }
      for (const [name, response] of Object.entries(responses)) expect(JSON.stringify(response), `${form} ${name}`).not.toContain(artifactID);
      expect((await fetched(`${server.baseURL}/artifact/${artifactID}/`)).headers.location, form).toBe(`/artifact/${artifactID}/${fileName}`);

      expect((await server.unshare(artifactID)).status).toBe(200);
      const received = JSON.stringify(responses).match(/[0-9A-HJKMNP-TV-Z]{26}/g) ?? [];
      for (const id of [shareID, ...received]) {
        const page = await server.pageConnection(id);
        expect(page.opening.access, `${form} ${id}`).toBeUndefined();
      }
    }
  });

  it("answers a single file replaced by a folder between the proxy's check and the streaming library's with nothing built from its name", async () => {
    for (const [form, extension] of [["html", "html"], ["markdown", "md"]] as const) {
      const { server, artifactID, folder } = await storedUnderItsID(form);
      const file = `${folder}.${extension}`;
      const shareID = await server.sharedAt(artifactID, "read");
      // The race hook (proofs/arch/resources/index.md, Test hooks): the real
      // check runs, then the file becomes a folder before the next look at it.
      const realStatSync = fs.statSync;
      let replaced = false;
      const hook = vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, options?: fs.StatSyncOptions) => {
        const stat = realStatSync(target, options);
        if (target === file && !replaced) {
          replaced = true;
          rmSync(file);
          mkdirSync(file);
        }
        return stat;
      }) as unknown as typeof fs.statSync);
      try {
        const response = await fetched(`${server.baseURL}/artifact/${shareID}/`);
        expect(replaced, form).toBe(true);
        expect({ status: response.status, body: response.body }, form).toEqual({ status: 404, body: "Not found" });
        expect(`${response.status} ${JSON.stringify(response)}`, form).not.toContain(artifactID);
      } finally {
        hook.mockRestore();
      }
    }
  });

  it("sends nothing carrying the artifact's ID in any status line, header or body under a share ID, whatever the shape of the artifact's files named for its ID and whatever is asked", async () => {
    type Shape = { form: "html" | "htm" | "markdown" | "folder"; change?: (stored: string, home: string, artifactID: string) => void };
    const shapes: Record<string, Shape> = {
      "an HTML file": { form: "html" },
      "an .htm file": { form: "htm" },
      "a Markdown file": { form: "markdown" },
      "a folder": {
        form: "folder",
        change: (stored, home, artifactID) => {
          mkdirSync(path.join(stored, "sub"));
          writeFileSync(path.join(stored, "sub", "index.html"), "<!doctype html><title>sub</title>");
          mkdirSync(path.join(stored, "empty"));
          writeFileSync(path.join(stored, "data.txt"), "data");
          mkdirSync(path.join(home, `elsewhere-${artifactID}`));
          symlinkSync(path.join(home, `elsewhere-${artifactID}`), path.join(stored, "link"));
        },
      },
      "a missing HTML file": { form: "html", change: (stored) => rmSync(`${stored}.html`) },
      "a missing Markdown file": { form: "markdown", change: (stored) => rmSync(`${stored}.md`) },
      "a missing folder": { form: "folder", change: (stored) => rmSync(stored, { recursive: true }) },
      "an HTML file replaced by a folder": { form: "html", change: (stored) => (rmSync(`${stored}.html`), mkdirSync(`${stored}.html`)) },
      "a Markdown file replaced by a folder": { form: "markdown", change: (stored) => (rmSync(`${stored}.md`), mkdirSync(`${stored}.md`)) },
      "a folder replaced by a file": { form: "folder", change: (stored) => (rmSync(stored, { recursive: true }), writeFileSync(stored, "a file now")) },
      "an HTML file linked to another named for the ID": {
        form: "html",
        change: (stored, home, artifactID) => {
          writeFileSync(path.join(home, `target-${artifactID}.html`), "<!doctype html><title>linked</title>");
          rmSync(`${stored}.html`);
          symlinkSync(path.join(home, `target-${artifactID}.html`), `${stored}.html`);
        },
      },
    };
    for (const [name, shape] of Object.entries(shapes)) {
      const { server, artifactID, folder } = await storedUnderItsID(shape.form);
      const shareID = await server.sharedAt(artifactID, "read");
      shape.change?.(folder, server.home, artifactID);
      const base = `${server.baseURL}/artifact/${shareID}`;
      const asked: Array<[string, string, Record<string, string>, string?]> = [
        ["the address without its slash", base, {}],
        ["the link's address", `${base}/`, {}],
        ["the link's address by HEAD", `${base}/`, {}, "HEAD"],
        ["the link's address, revalidated", `${base}/`, { "If-None-Match": '"stale"', "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT" }],
        ["the link's address, a range past the end", `${base}/`, { Range: "bytes=999999-" }],
        ["the HTML file's name", `${base}/${artifactID}.html`, {}],
        ["the Markdown file's name", `${base}/${artifactID}.md`, {}],
        ["a missing file", `${base}/missing.js`, {}],
        ["a subfolder without its slash", `${base}/sub`, {}],
        ["a subfolder", `${base}/sub/`, {}],
        ["a folder without an index", `${base}/empty/`, {}],
        ["a linked folder without its slash", `${base}/link`, {}],
        ["a linked folder", `${base}/link/`, {}],
        ["a file", `${base}/data.txt`, {}],
        ["a path below a file", `${base}/data.txt/x`, {}],
        ["a path that climbs out", `${base}/..%2f..%2fx`, {}],
        ["an escape that does not decode", `${base}/%E0`, {}],
      ];
      for (const [request, url, headers, method] of asked) {
        const response = await fetch(url, { redirect: "manual", headers, method: method ?? "GET" });
        const received = `${response.status} ${response.statusText}\n${JSON.stringify([...response.headers.entries()])}\n${await response.text()}`;
        for (const forbidden of [artifactID, server.home]) expect(received, `${name}: ${request}`).not.toContain(forbidden);
      }
    }
  });

  it("answers every error with fixed text for its status, never a file's path or the server's own text, for an artifact stored in a folder named for its ID, and leaves no ID that reaches its store once a read-only link is revoked", async () => {
    const { server, artifactID, folder } = await storedUnderItsID("folder", { sdkDir: path.join(context.home(), "no-sdk-built") });
    mkdirSync(path.join(folder, "empty"));
    writeFileSync(path.join(folder, "data.txt"), "data");
    symlinkSync("loop", path.join(folder, "loop"));
    await ownStore(server, artifactID, { n: 1 });
    const shareID = await server.sharedAt(artifactID, "read");
    const base = `${server.baseURL}/artifact/${shareID}`;
    const cases: Array<[name: string, url: string, headers: Record<string, string>, status: number, body: string]> = [
      ["a missing file", `${base}/missing.js`, {}, 404, "Not found"],
      ["a path below a file", `${base}/index.html/x`, {}, 404, "Not found"],
      ["a folder without an index", `${base}/empty/`, {}, 404, "Not found"],
      ["a symbolic link loop", `${base}/loop`, {}, 500, "Internal Server Error"],
      ["a path that climbs out", `${base}/..%2fx`, {}, 403, "Forbidden"],
      ["a null byte", `${base}/%00`, {}, 400, "Bad Request"],
      ["a failed precondition", `${base}/data.txt`, { "If-Match": '"other"' }, 412, "Precondition Failed"],
      ["a range past the end", `${base}/data.txt`, { Range: "bytes=100-200" }, 416, "Range Not Satisfiable"],
      ["an escape that does not decode", `${base}/%E0`, {}, 400, "Bad Request"],
      ["the SDK, not built", `${server.baseURL}/sdk/v1/resources.js`, {}, 404, "Not Found"],
    ];
    const received: string[] = [];
    for (const [name, url, headers, status, body] of cases) {
      const response = await fetched(url, headers);
      received.push(JSON.stringify(response));
      expect({ status: response.status, body: response.body }, name).toEqual({ status, body });
      for (const forbidden of [artifactID, server.home]) expect(JSON.stringify(response.headers), name).not.toContain(forbidden);
    }

    expect((await server.unshare(artifactID)).status).toBe(200);
    // Neither the share ID nor any ID a viewer received reaches the store any more.
    const ids = received.join("").match(/[0-9A-HJKMNP-TV-Z]{26}/g) ?? [];
    for (const id of [shareID, ...ids]) {
      const page = await server.pageConnection(id);
      expect(page.opening.access, id).toBeUndefined();
      expect(await page.write(1, pageWrite.set("n", 2))).toMatchObject({ type: "refused", code: "no-store" });
    }
    expect((await server.jsonGet({ artifactID }, "n")).body).toEqual({ exists: true, value: 1 });
  });
});
