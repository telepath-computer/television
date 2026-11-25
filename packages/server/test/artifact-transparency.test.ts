/** Artifact transparency across authenticated HTTP, WebSocket events, and saved records. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Artifact } from "@telepath-computer/television-artifact";
import { DEFAULT_PAGE_SIZE, type ServerEvent } from "@telepath-computer/television-shared";
import { ResourceTestContext, type EventsClient, type RunningServer } from "./resources/harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

function recordPath(server: RunningServer, id: string): string {
  return path.join(server.home, "state", "artifacts", `${id}.json`);
}

function targetFile(home: string, name = "content.html"): string {
  const target = path.join(home, name);
  writeFileSync(target, "<!doctype html><title>Transparent artifact</title>");
  return target;
}

async function channel(server: RunningServer): Promise<string> {
  const result = await server.request("POST", "/channels", { name: "Transparency" });
  expect(result.status).toBe(201);
  return result.body.channel.id as string;
}

async function expectRecord(server: RunningServer, channelID: string, expected: Artifact): Promise<void> {
  expect(JSON.parse(readFileSync(recordPath(server, expected.id), "utf8"))).toEqual(expected);
  const individual = await server.request("GET", `/artifacts/${expected.id}`);
  expect(individual.status).toBe(200);
  expect(individual.body.artifact).toEqual(expected);
  for (const route of ["/artifacts", `/artifacts?channelID=${channelID}`, `/channels/${channelID}`]) {
    const response = await server.request("GET", route);
    expect(response.status).toBe(200);
    expect(response.body.artifacts.find((artifact: Artifact) => artifact.id === expected.id)).toEqual(expected);
  }
}

async function expectEvent(
  events: EventsClient,
  from: number,
  type: "artifact-created" | "artifact-updated",
  expected: Artifact,
): Promise<void> {
  const message = await events.log.waitFor((raw) => {
    const event = raw as ServerEvent;
    return event.type === type && event.artifact.id === expected.id;
  }, from);
  expect(message).toMatchObject({ type, artifact: expected });
  expect((message as Extract<ServerEvent, { type: typeof type }>).artifact).toEqual(expected);
}

describe("artifact transparency", () => {
  // proofs/arch/artifacts/index.md#^ar-t-transparent-roundtrip
  it.each(["path", "url"] as const)("round-trips %s transparency through records, HTTP, events, and restart", async (kind) => {
    let server = await context.start();
    const channelID = await channel(server);
    const events = await server.eventsClient();
    const pointer = kind === "path"
      ? { kind, path: targetFile(server.home) }
      : { kind, url: "https://example.com/transparent" };
    const from = events.log.messages.length;
    const created = await server.request("POST", "/artifacts", {
      ...pointer, title: "Transparent", channelID, display: { transparent: true },
    });
    expect(created.status).toBe(201);
    let expected: Artifact = { ...pointer, id: created.body.artifact.id, title: "Transparent", transparent: true };
    expect(created.body.artifact).toEqual(expected);
    await expectRecord(server, channelID, expected);
    await expectEvent(events, from, "artifact-created", expected);

    if (expected.kind === "path") {
      expect((await server.jsonSet({ artifactID: expected.id }, "", { count: 1 })).status).toBe(200);
      const shareID = await server.sharedAt(expected.id, "read");
      expected = { ...expected, store: server.storePointer(expected.id)!, share: { id: shareID, access: "read" } };
      await expectRecord(server, channelID, expected);
    }

    for (const transparent of [false, true]) {
      const start = events.log.messages.length;
      const updated = await server.request("PATCH", `/artifacts/${expected.id}`, { transparent });
      expect(updated.status).toBe(200);
      const { transparent: _transparent, ...opaque } = expected;
      expected = transparent ? { ...opaque, transparent: true } : opaque;
      expect(updated.body.artifact).toEqual(expected);
      await expectEvent(events, start, "artifact-updated", expected);
      await expectRecord(server, channelID, expected);
    }
    for (const fields of [
      { title: "Renamed" },
      kind === "path" ? { path: targetFile(server.home, "repointed.html") } : { url: "http://example.com/repointed" },
    ]) {
      const start = events.log.messages.length;
      const updated = await server.request("PATCH", `/artifacts/${expected.id}`, fields);
      expect(updated.status).toBe(200);
      expected = { ...expected, ...fields };
      expect(updated.body.artifact).toEqual(expected);
      await expectEvent(events, start, "artifact-updated", expected);
      await expectRecord(server, channelID, expected);
    }
    if (expected.kind === "path") {
      expect((await server.share(expected.id, "read-write")).status).toBe(200);
      expected = { ...expected, share: { ...expected.share!, access: "read-write" } };
      await expectRecord(server, channelID, expected);
    }
    await server.stop();
    server = await context.start({ home: server.home });
    await expectRecord(server, channelID, expected);
  });

  // proofs/arch/layout/index.md#^ly-ac-create-transparent
  it.each(["path", "url"] as const)("creates opaque %s records for false or omitted transparency independently of page options", async (kind) => {
    let server = await context.start();
    const channelID = await channel(server);
    const events = await server.eventsClient();
    const pointer = kind === "path"
      ? { kind, path: targetFile(server.home) }
      : { kind, url: "https://example.com/opaque" };
    const records: Artifact[] = [];
    const pages = [];
    for (const display of [{}, { transparent: false, width: 612.5, fullScreen: true }]) {
      const start = events.log.messages.length;
      const response = await server.request("POST", "/artifacts", { ...pointer, title: "Opaque", channelID, display });
      expect(response.status).toBe(201);
      const expected: Artifact = { ...pointer, id: response.body.artifact.id, title: "Opaque" };
      records.push(expected);
      expect(response.body.artifact).toEqual(expected);
      await expectRecord(server, channelID, expected);
      await expectEvent(events, start, "artifact-created", expected);
      pages.push({
        artifactIds: [expected.id],
        geometry: { kind: "single", full_screen: display.fullScreen ?? false },
        size: { width: display.width ?? DEFAULT_PAGE_SIZE.width, height: DEFAULT_PAGE_SIZE.height },
      });
    }
    expect((await server.request("GET", `/channels/${channelID}`)).body.channel.layout).toEqual(pages);
    const diskChannel = JSON.parse(readFileSync(path.join(server.home, "state", "channels", `${channelID}.json`), "utf8"));
    expect(diskChannel.layout).toEqual(pages);
    await server.stop();
    server = await context.start({ home: server.home });
    for (const record of records) await expectRecord(server, channelID, record);
    expect((await server.request("GET", `/channels/${channelID}`)).body.channel.layout).toEqual(pages);
  });

  // proofs/arch/artifacts/index.md#^ar-t-transparent-load
  it("loads authored path and URL records with true or absent transparency", async () => {
    const home = context.home();
    const directory = path.join(home, "state", "artifacts");
    mkdirSync(directory, { recursive: true });
    const records: Artifact[] = [];
    for (const pointer of [
      { kind: "path" as const, path: targetFile(home) },
      { kind: "url" as const, url: "https://example.com/saved" },
    ]) {
      for (const enabled of [false, true]) {
        const record: Artifact = {
          ...pointer, id: `${pointer.kind}-${enabled}`, title: "Saved",
          ...(enabled ? { transparent: true } : {}),
        };
        records.push(record);
        writeFileSync(path.join(directory, `${record.id}.json`), JSON.stringify(record));
      }
    }
    const server = await context.start({ home });
    for (const record of records) {
      const response = await server.request("GET", `/artifacts/${record.id}`);
      expect(response.status).toBe(200);
      expect(response.body.artifact).toEqual(record);
    }
  });

  // proofs/arch/artifacts/index.md#^ar-t-patch-validation
  it.each(["path", "url"] as const)("rejects invalid whole %s patches without changing records or protected fields", async (kind) => {
    const server = await context.start();
    const channelID = await channel(server);
    const file = targetFile(server.home);
    const pointer = kind === "path" ? { kind, path: file } : { kind, url: "https://example.com/" };
    const created = await server.request("POST", "/artifacts", { ...pointer, title: "Original", channelID });
    expect(created.status).toBe(201);
    const artifact: Artifact = created.body.artifact;
    const before = readFileSync(recordPath(server, artifact.id), "utf8");
    const invalid = [
      {},
      ...["title", "path", "url", "transparent"].flatMap((field) =>
        [null, 1, field === "transparent" ? "true" : false].map((value) => ({
          title: "Must not change", transparent: true, [field]: value,
        }))),
      { title: "Must not change", path: file, url: "https://example.com/both", transparent: true },
      { title: "Must not change", transparent: true, ...(kind === "path" ? { url: "https://example.com/wrong" } : { path: file }) },
    ];
    for (const fields of invalid) {
      expect((await server.request("PATCH", `/artifacts/${artifact.id}`, fields)).status, JSON.stringify(fields)).toBe(400);
      await expectRecord(server, channelID, artifact);
      expect(readFileSync(recordPath(server, artifact.id), "utf8")).toBe(before);
    }
    const protectedPatch = await server.request("PATCH", `/artifacts/${artifact.id}`, {
      id: "replacement", kind: kind === "path" ? "url" : "path",
      store: "replacement-store", share: { id: "replacement-share", access: "read-write" },
    });
    expect([200, 400]).toContain(protectedPatch.status);
    await expectRecord(server, channelID, artifact);
    expect(readFileSync(recordPath(server, artifact.id), "utf8")).toBe(before);
  });
});
