import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { Server } from "../src/server.ts";
import { telemetryVersion, type BuiltTelemetryEvent } from "../src/telemetry/index.ts";
import { nodeResourceStorageOperations, type ResourceStorageOperations } from "../src/resources/storage.ts";
import { createServingStore, type ServingStoreOverrides } from "../../../test/helpers/serving-store.ts";

const homes: string[] = [];
const servers: Server[] = [];

function home(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-template-failure-"));
  homes.push(root);
  return root;
}

function template(root: string, withData = false): string {
  const folder = path.join(root, "templates", "sample");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: "Sample", description: "A page", version: "1.0.0" }));
  writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>Sample</title>");
  if (withData) writeFileSync(path.join(folder, "data.json"), JSON.stringify({ seeded: true }));
  return folder;
}

async function start(root: string, overrides: ServingStoreOverrides = {}) {
  const store = createServingStore(root, overrides);
  const events: BuiltTelemetryEvent[] = [];
  const server = new Server({
    store, host: "127.0.0.1", port: 0, auth: true,
    telemetry: {
      env: { TV_TELEMETRY_TEST: "1" }, version: telemetryVersion("0.1.170"),
      sink: { enqueue: (event) => { events.push(event); } },
    },
  });
  servers.push(server);
  await server.start();
  const channelID = store.listChannels()[0]!.id;
  return { store, server, channelID, events };
}

function create(server: Server, token: string, channelID: string) {
  return request(server.httpServer).post("/templates/artifacts")
    .set("Authorization", `Bearer ${token}`).send({ templateID: "sample", channelID, source: "cli" });
}

function destination(error: string): string {
  const match = error.match(/(\/[^\s]+\/artifacts\/sample-[0-9a-z]{5})/);
  expect(match).not.toBeNull();
  return match![1]!;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("template creation keeps partial results", () => {
  // proofs/arch/templates/index.md#^templates-t-failure
  it("keeps a destination and earlier copied files when a socket stops copying", async () => {
    const root = home();
    const folder = template(root);
    const { store, server, channelID } = await start(root);
    const socket = net.createServer();
    const socketPath = path.join(folder, "zz.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    try {
      const response = await create(server, store.authToken, channelID).expect(500);
      expect(response.body.error).toMatch(/copy/i);
      const copied = destination(response.body.error);
      expect(existsSync(copied)).toBe(true);
      expect(readFileSync(path.join(copied, "index.html"), "utf8")).toContain("Sample");
      expect(store.listArtifacts()).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  });

  // proofs/arch/templates/index.md#^templates-t-failure
  it("keeps the copy and reports the attempted ID when artifact record writing is obstructed", async () => {
    const root = home();
    template(root);
    const { store, server, channelID } = await start(root);
    const records = path.join(root, "state", "artifacts");
    rmSync(records, { recursive: true });
    writeFileSync(records, "obstructed");
    const response = await create(server, store.authToken, channelID).expect(500);
    expect(response.body.error).toMatch(/registration/i);
    expect(response.body.error).toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
    expect(existsSync(path.join(destination(response.body.error), "index.html"))).toBe(true);
    expect(store.listArtifacts()).toEqual([]);
  });

  // proofs/arch/templates/index.md#^templates-t-failure
  it("keeps the copy and record when channel layout saving is obstructed", async () => {
    const root = home();
    template(root);
    const { store, server, channelID } = await start(root);
    const record = path.join(root, "state", "channels", `${channelID}.json`);
    rmSync(record);
    mkdirSync(record);
    const response = await create(server, store.authToken, channelID).expect(500);
    expect(response.body.error).toMatch(/channel layout/i);
    const artifact = store.listArtifacts()[0]!;
    expect(response.body.error).toContain(artifact.id);
    expect(existsSync(path.join(destination(response.body.error), "index.html"))).toBe(true);
    expect(existsSync(path.join(root, "state", "artifacts", `${artifact.id}.json`))).toBe(true);
  });

  // proofs/arch/templates/index.md#^templates-t-failure
  it("keeps the copy, record, and channel placement when the first store write is obstructed", async () => {
    const root = home();
    template(root, true);
    const { store, server, channelID, events } = await start(root);
    writeFileSync(path.join(root, "resources"), "obstructed");
    const response = await create(server, store.authToken, channelID).expect(500);
    expect(response.body.error).toMatch(/store write/i);
    const artifact = store.listArtifacts()[0]!;
    expect(response.body.error).toContain(artifact.id);
    expect(existsSync(path.join(destination(response.body.error), "index.html"))).toBe(true);
    expect(store.getChannel(channelID)?.channel.layout.flatMap(({ artifactIds }) => artifactIds)).toContain(artifact.id);
    // proofs/arch/telemetry/emitters.md#^t-template-emit
    expect(events.filter(({ name }) => name === "artifact_created")).toHaveLength(1);
    expect(events.filter(({ name }) => name === "artifact_template_used")).toEqual([]);
  });

  // proofs/arch/templates/index.md#^templates-t-uncertain-seed
  it("reports an uncertain post-rename seed without removing the copy or registered artifact", async () => {
    const root = home();
    template(root, true);
    let contentRenamed = false;
    const storage: ResourceStorageOperations = {
      ...nodeResourceStorageOperations,
      rename(from, to) {
        nodeResourceStorageOperations.rename(from, to);
        if (to.endsWith("content.json")) contentRenamed = true;
      },
      flushDirectory(directory) {
        if (contentRenamed) {
          contentRenamed = false;
          throw new Error("flush outcome unknown");
        }
        nodeResourceStorageOperations.flushDirectory(directory);
      },
    };
    const { store, server, channelID, events } = await start(root, { resourceStorageOperations: storage });
    const response = await create(server, store.authToken, channelID).expect(500);
    expect(response.body.error).toMatch(/store write/i);
    const artifact = store.listArtifacts()[0]!;
    expect(response.body.error).toContain(artifact.id);
    expect(existsSync(path.join(destination(response.body.error), "index.html"))).toBe(true);
    expect(readdirSync(path.join(root, "state", "artifacts"))).toContain(`${artifact.id}.json`);
    // proofs/arch/telemetry/emitters.md#^t-template-emit
    expect(events.filter(({ name }) => name === "artifact_created")).toHaveLength(1);
    expect(events.filter(({ name }) => name === "artifact_template_used")).toEqual([]);
  });
  // proofs/arch/templates/index.md#^templates-t-failure
  it("reports the URL target and attempted ID on registration and layout failure", async () => {
    for (const step of ["registration", "channel layout"]) {
      const root = home();
      const folder = template(root);
      const target = "https://example.com/private-target";
      writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: "Site", description: "Site", version: "1.0.0", url: target }));
      const { store, server, channelID, events } = await start(root);
      const obstruction = step === "registration" ? path.join(root, "state", "artifacts") : path.join(root, "state", "channels", `${channelID}.json`);
      rmSync(obstruction, { recursive: true });
      if (step === "registration") writeFileSync(obstruction, "obstructed");
      else mkdirSync(obstruction);
      const response = await create(server, store.authToken, channelID).expect(500);
      expect(response.body.error).toContain(target);
      expect(response.body.error).toContain(step);
      expect(response.body.error).toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
      expect(readFileSync(path.join(folder, "index.html"), "utf8")).toContain("Sample");
      expect(store.listArtifacts()).toHaveLength(step === "registration" ? 0 : 1);
      if (step === "channel layout") expect(response.body.error).toContain(store.listArtifacts()[0]!.id);
      expect(events.filter(({ name }) => name === "artifact_template_used")).toEqual([]);
    }
  });

});
