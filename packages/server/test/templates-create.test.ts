import { afterEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { DEFAULT_PAGE_SIZE, TelevisionClient } from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
import { telemetryVersion, type BuiltTelemetryEvent } from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const homes: string[] = [];
const servers: Server[] = [];

function home(): string {
  const created = mkdtempSync(path.join(os.tmpdir(), "tv-templates-create-"));
  homes.push(created);
  return created;
}

function template(root: string, id = "sample", data?: unknown): string {
  const folder = path.join(root, "templates", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: "Sample page", description: "A page", version: "1.0.0" }));
  writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>Sample</title>");
  writeFileSync(path.join(folder, "README.md"), "Adapt this page.");
  writeFileSync(path.join(folder, "helper.js"), "export const answer = 42;");
  writeFileSync(path.join(folder, "thumbnail.png"), "image");
  if (data !== undefined) writeFileSync(path.join(folder, "data.json"), JSON.stringify(data));
  return folder;
}

async function start(root: string, recordTelemetry = true) {
  const store = createServingStore(root);
  const events: BuiltTelemetryEvent[] = [];
  const server = new Server({
    store, host: "127.0.0.1", port: 0, auth: true,
    ...(recordTelemetry ? { telemetry: {
      env: { TV_TELEMETRY_TEST: "1" }, version: telemetryVersion("0.1.170"),
      sink: { enqueue: (event) => { events.push(event); } },
    } } : {}),
  });
  servers.push(server);
  await server.start();
  const channelID = store.listChannels()[0]!.id;
  return { store, server, channelID, events, client: new TelevisionClient(server.getBaseURL(), { token: store.authToken }) };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("template artifact creation", () => {
  // proofs/arch/templates/index.md#^templates-t-request-validation
  it("rejects malformed HTTP fields before it creates files, records, or stores", async () => {
    const root = home();
    template(root);
    const { store, server, channelID, events } = await start(root);
    const base = { templateID: "sample", channelID, source: "cli" };
    const malformed: Record<string, unknown>[] = [
      { ...base, source: "private-source" },
      { ...base, source: undefined },
      { ...base, templateID: undefined },
      { ...base, channelID: undefined },
      { ...base, templateID: 1 },
      { ...base, channelID: 1 },
      { ...base, title: 1 },
      { ...base, before: 1 },
      { ...base, after: 1 },
      { ...base, extra: "invalid" },
      { ...base, data: { ["x".repeat(769)]: true } },
    ];
    for (const body of malformed) {
      const result = await request(server.httpServer).post("/templates/artifacts")
        .set("Authorization", `Bearer ${store.authToken}`).send(body).expect(400);
      expect(result.body).toEqual({ error: expect.any(String) });
    }
    expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
    expect(store.listArtifacts()).toEqual([]);
    expect(existsSync(path.join(root, "resources"))).toBe(false);
    expect(events.filter(({ name }) => name === "artifact_created" || name === "artifact_template_used")).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("private-source");
  });

  // proofs/arch/telemetry/emitters.md#^t-template-emit
  // proofs/product/telemetry.md#^ac-artifact-template
  it("emits ordinary creation and one classified template-use event after successful creation", async () => {
    const root = home();
    template(root, "example", { message: "private starting value" });
    const custom = template(root, "private-custom-id");
    const privateName = "Private catalog name QX7";
    const privateImage = "Private thumbnail bytes YZ9";
    writeFileSync(path.join(custom, "manifest.json"), JSON.stringify({
      name: privateName, description: "A private template", version: "1.0.0",
    }));
    writeFileSync(path.join(custom, "thumbnail.png"), privateImage);
    const { channelID, client, events } = await start(root);
    await client.templates.create({ templateID: "example", channelID, source: "cli" });
    await client.templates.create({ templateID: "private-custom-id", channelID, source: "ui", title: "Private display title" });
    expect(events.filter(({ name }) => name === "artifact_created")).toHaveLength(2);
    const uses = events.filter(({ name }) => name === "artifact_template_used");
    expect(uses.map(({ properties }) => ({ source: properties.source, template: properties.template }))).toEqual([
      { source: "cli", template: "example" }, { source: "ui", template: "custom" },
    ]);
    const serialized = JSON.stringify(events);
    for (const privateText of ["private-custom-id", "private starting value", "Private display title", privateName, privateImage, root]) {
      expect(serialized).not.toContain(privateText);
    }
  });

  // proofs/arch/templates/index.md#^templates-t-preflight
  it("preflights channel, placement, and data before copying; explicit null replaces template data", async () => {
    const root = home();
    template(root, "sample", { template: true });
    const { store, channelID, client } = await start(root);
    const other = store.createChannel({ name: "Other" });
    const otherArtifact = store.createArtifact({ kind: "url", title: "Other", channelID: other.id, url: "https://example.com" });
    for (const change of [
      { channelID: "missing" },
      { before: otherArtifact.id },
      { before: otherArtifact.id, after: otherArtifact.id },
      { data: { ["x".repeat(769)]: true } },
    ]) {
      await expect(client.templates.create({ templateID: "sample", channelID, source: "cli", ...change })).rejects.toThrow();
      expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
      expect(store.listArtifacts().map(({ id }) => id)).toEqual([otherArtifact.id]);
    }
    const result = await client.templates.create({ templateID: "sample", channelID, source: "cli", data: null });
    expect(store.resources.json.get({ artifactID: result.artifactID }, "")).toEqual({ exists: true, value: null });
  });

  // proofs/arch/templates/index.md#^templates-t-display-resolution
  it("chooses request, manifest, then default display values independently and keeps them after restart", async () => {
    const root = home();
    const complete = template(root, "complete");
    writeFileSync(path.join(complete, "manifest.json"), JSON.stringify({
      name: "Complete", description: "A page", version: "1.0.0",
      display: { width: 360, height: 420, fullScreen: true },
    }));
    const partial = template(root, "partial");
    writeFileSync(path.join(partial, "manifest.json"), JSON.stringify({
      name: "Partial", description: "A page", version: "1.0.0", display: { width: 240 },
    }));
    const { server, channelID, client } = await start(root, false);

    const fromCommand = await client.templates.create({
      templateID: "complete", channelID, source: "cli", display: { width: 500.5 },
    });
    const explicitFalse = await client.templates.create({
      templateID: "complete", channelID, source: "cli", display: { fullScreen: false },
    });
    const fromDefaults = await client.templates.create({ templateID: "partial", channelID, source: "ui" });
    const expected = [
      { artifactIds: [fromCommand.artifactID], geometry: { kind: "single", full_screen: true }, size: { width: 500.5, height: 420 } },
      { artifactIds: [explicitFalse.artifactID], geometry: { kind: "single", full_screen: false }, size: { width: 360, height: 420 } },
      { artifactIds: [fromDefaults.artifactID], geometry: { kind: "single", full_screen: false }, size: { width: 240, height: DEFAULT_PAGE_SIZE.height } },
    ];
    expect((await client.channels.get({ channelID })).channel.layout).toEqual(expected);

    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await start(root, false);
    expect((await restarted.client.channels.get({ channelID })).channel.layout).toEqual(expected);
  });

  // proofs/arch/templates/index.md#^templates-t-display-request-invalid
  it("rejects malformed request display before copying or registering", async () => {
    const root = home();
    template(root);
    const { store, server, channelID } = await start(root, false);
    const base = { templateID: "sample", channelID, source: "cli" };
    const invalid = [
      { ...base, display: [] },
      { ...base, display: { width: 0 } },
      { ...base, display: { height: -1 } },
      { ...base, display: { fullScreen: "yes" } },
    ];
    for (const body of invalid) {
      const result = await request(server.httpServer).post("/templates/artifacts")
        .set("Authorization", `Bearer ${store.authToken}`).send(body).expect(400);
      expect(result.body.error).toBeTruthy();
    }
    const nonfinite = await request(server.httpServer).post("/templates/artifacts")
      .set("Authorization", `Bearer ${store.authToken}`)
      .set("Content-Type", "application/json")
      .send(`{"templateID":"sample","channelID":"${channelID}","source":"cli","display":{"width":1e400}}`)
      .expect(400);
    expect(nonfinite.body.error).toBeTruthy();
    expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
    expect(store.listArtifacts()).toEqual([]);
    expect(store.getChannel(channelID)?.channel.layout).toEqual([]);
    expect(existsSync(path.join(root, "resources"))).toBe(false);
  });

  // proofs/arch/templates/index.md#^templates-t-copy
  it("copies supporting files, places an ordinary artifact, and durably seeds only when data exists", async () => {
    const root = home();
    template(root, "with-data", { fromTemplate: true });
    template(root, "no-data");
    const { store, server, channelID, client } = await start(root);
    const anchor = store.createArtifact({ kind: "url", title: "Anchor", channelID, url: "https://example.com" });
    const result = await client.templates.create({ templateID: "with-data", channelID, title: "My Copy", source: "ui", before: anchor.id });
    expect(result.path).toMatch(new RegExp(`^${root}/artifacts/my-copy-[0-9a-z]{5}$`));
    expect(readFileSync(path.join(result.path, "index.html"), "utf8")).toContain("Sample");
    expect(readFileSync(path.join(result.path, "README.md"), "utf8")).toBe("Adapt this page.");
    expect(readFileSync(path.join(result.path, "helper.js"), "utf8")).toContain("answer");
    for (const omitted of ["manifest.json", "data.json", "thumbnail.png"]) {
      expect(existsSync(path.join(result.path, omitted))).toBe(false);
    }
    expect(store.getArtifact(result.artifactID)).toMatchObject({ kind: "path", title: "My Copy" });
    expect(store.getArtifact(result.artifactID)).not.toHaveProperty("templateID");
    expect(store.getChannel(channelID)?.channel.layout.map(({ artifactIds }) => artifactIds)).toEqual([[result.artifactID], [anchor.id]]);
    expect(store.resources.json.get({ artifactID: result.artifactID }, "")).toEqual({ exists: true, value: { fromTemplate: true } });
    const empty = await client.templates.create({ templateID: "no-data", channelID, source: "cli" });
    expect(store.resources.json.get({ artifactID: empty.artifactID }, "")).toEqual({ exists: false });
    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    const reopened = createServingStore(root);
    try {
      expect(reopened.resources.json.get({ artifactID: result.artifactID }, "")).toEqual({ exists: true, value: { fromTemplate: true } });
    } finally {
      reopened.dispose();
    }
  });

  // proofs/arch/templates/index.md#^templates-t-copy
  it("keeps relative and absolute in-folder links inside the copy and outside links beyond the artifact boundary", async () => {
    const root = home();
    const folder = template(root);
    writeFileSync(path.join(folder, "page.html"), "<!doctype html><title>Linked page</title>");
    rmSync(path.join(folder, "index.html"));
    symlinkSync(path.join(folder, "page.html"), path.join(folder, "index.html"));
    symlinkSync("helper.js", path.join(folder, "helper-link.js"));
    symlinkSync(path.join(folder, "helper.js"), path.join(folder, "absolute-helper-link.js"));
    symlinkSync(path.join(folder, "helper-link.js"), path.join(folder, "absolute-alias-link.js"));
    const outside = path.join(root, "private-outside.txt");
    writeFileSync(outside, "private outside content");
    symlinkSync(outside, path.join(folder, "outside-link.txt"));
    const { server, channelID, client } = await start(root);

    const created = await client.templates.create({ templateID: "sample", channelID, source: "cli" });
    const internal = path.join(created.path, "helper-link.js");
    const absoluteInternal = path.join(created.path, "absolute-helper-link.js");
    const aliasInternal = path.join(created.path, "absolute-alias-link.js");
    const copiedIndex = path.join(created.path, "index.html");
    const external = path.join(created.path, "outside-link.txt");
    expect(lstatSync(copiedIndex).isSymbolicLink()).toBe(true);
    expect(readlinkSync(copiedIndex)).toBe("page.html");
    expect(lstatSync(internal).isSymbolicLink()).toBe(true);
    expect(readlinkSync(internal)).toBe("helper.js");
    expect(readFileSync(internal, "utf8")).toContain("answer = 42");
    expect(lstatSync(absoluteInternal).isSymbolicLink()).toBe(true);
    expect(readlinkSync(absoluteInternal)).toBe("helper.js");
    expect(lstatSync(aliasInternal).isSymbolicLink()).toBe(true);
    expect(readlinkSync(aliasInternal)).toBe("helper-link.js");
    expect(lstatSync(external).isSymbolicLink()).toBe(true);
    expect(readlinkSync(external)).toBe(outside);
    rmSync(folder, { recursive: true });
    expect(readFileSync(copiedIndex, "utf8")).toContain("Linked page");
    expect(readFileSync(absoluteInternal, "utf8")).toContain("answer = 42");
    expect(readFileSync(aliasInternal, "utf8")).toContain("answer = 42");
    await request(server.httpServer).get(`/artifact/${created.artifactID}/`).expect(200);
    await request(server.httpServer).get(`/artifact/${created.artifactID}/helper-link.js`).expect(200);
    await request(server.httpServer).get(`/artifact/${created.artifactID}/absolute-helper-link.js`).expect(200);
    await request(server.httpServer).get(`/artifact/${created.artifactID}/outside-link.txt`).expect(404);
  });

  // proofs/arch/templates/index.md#^templates-t-folder-name
  it("uses the ASCII slug limit, empty fallback, and another suffix after collision", async () => {
    const root = home();
    template(root);
    const suffixes = ["abcde", "abcde", "fghij", "klmno", "pqrst"];
    const store = createServingStore(root, { generateTemplateSuffix: () => suffixes.shift()! });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    const channelID = store.listChannels()[0]!.id;
    const client = new TelevisionClient(server.getBaseURL(), { token: store.authToken });
    const first = await client.templates.create({ templateID: "sample", channelID, source: "cli", title: " Héllo... WORLD! " });
    const second = await client.templates.create({ templateID: "sample", channelID, source: "cli", title: " Héllo... WORLD! " });
    const empty = await client.templates.create({ templateID: "sample", channelID, source: "cli", title: "!!!" });
    const longTitle = `${"a".repeat(30)}-${"b".repeat(35)}`;
    const limited = await client.templates.create({ templateID: "sample", channelID, source: "cli", title: longTitle });
    expect(path.basename(first.path)).toBe("h-llo-world-abcde");
    expect(path.basename(second.path)).toBe("h-llo-world-fghij");
    expect(path.basename(empty.path)).toBe("artifact-klmno");
    expect(path.basename(limited.path)).toBe(`${"a".repeat(30)}-pqrst`);
    expect(store.getArtifact(first.artifactID)?.title).toBe(" Héllo... WORLD! ");
  });
});
