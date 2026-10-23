import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { DEFAULT_PAGE_SIZE, TelevisionClient } from "@telepath-computer/television-shared";
import type { Artifact } from "@telepath-computer/television-artifact";
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
  vi.restoreAllMocks();
  syncBuiltinESMExports();
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
      dataSchema: { description: "Private schema content AB9", type: "object" },
    }));
    writeFileSync(path.join(custom, "thumbnail.png"), privateImage);
    const { channelID, client, events } = await start(root);
    await client.templates.create({ templateID: "example", channelID, source: "cli", data: { message: "private starting value" } });
    await client.templates.create({ templateID: "private-custom-id", channelID, source: "ui", title: "Private display title" });
    const urlFolder = template(root, "private-url-id");
    const privateURL = "https://example.com/private-manifest-url";
    writeFileSync(path.join(urlFolder, "manifest.json"), JSON.stringify({ name: "Private site name", description: "Site", version: "1.0.0", url: privateURL }));
    await client.templates.create({ templateID: "private-url-id", channelID, source: "cli" });
    expect(events.filter(({ name }) => name === "artifact_created")).toHaveLength(3);
    const uses = events.filter(({ name }) => name === "artifact_template_used");
    expect(uses.map(({ properties }) => ({ source: properties.source, template: properties.template }))).toEqual([
      { source: "cli", template: "example" }, { source: "ui", template: "custom" }, { source: "cli", template: "custom" },
    ]);
    const serialized = JSON.stringify(events);
    for (const privateText of ["private-custom-id", "private starting value", "Private display title", privateName, privateImage, root, privateURL, "private-url-id", "Private site name", "Private schema content AB9"]) {
      expect(serialized).not.toContain(privateText);
    }
  });

  // proofs/arch/templates/index.md#^templates-t-preflight
  it("preflights channel, placement, and caller data before effects; omission and null remain distinct", async () => {
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
    const empty = await client.templates.create({ templateID: "sample", channelID, source: "cli" });
    expect(store.resources.json.get({ artifactID: empty.artifactID }, "")).toEqual({ exists: true, value: { template: true } });
    const result = await client.templates.create({ templateID: "sample", channelID, source: "cli", data: null });
    expect(store.resources.json.get({ artifactID: result.artifactID }, "")).toEqual({ exists: true, value: null });
  });

  // proofs/arch/templates/index.md#^templates-t-display-resolution
  // proofs/arch/templates/index.md#^templates-t-transparent-resolution
  it("chooses request, manifest, then default display values independently and keeps them after restart", async () => {
    const root = home();
    const complete = template(root, "complete", { seeded: true });
    writeFileSync(path.join(complete, "manifest.json"), JSON.stringify({
      name: "Complete", description: "A page", version: "1.0.0",
      display: { width: 360, height: 420, fullScreen: true, transparent: true },
    }));
    const partial = template(root, "partial", { seeded: true });
    writeFileSync(path.join(partial, "manifest.json"), JSON.stringify({
      name: "Partial", description: "A page", version: "1.0.0", display: { width: 240 },
    }));
    const opaque = template(root, "opaque", { seeded: true });
    writeFileSync(path.join(opaque, "manifest.json"), JSON.stringify({
      name: "Opaque", description: "A page", version: "1.0.0", display: { transparent: false },
    }));
    const { server, channelID, client } = await start(root, false);
    const scan = await client.templates.list();
    expect(scan.errors).toEqual([]);
    expect(scan.templates.find(({ id }) => id === "complete")?.display).toEqual({
      width: 360, height: 420, fullScreen: true, transparent: true,
    });
    expect(scan.templates.find(({ id }) => id === "opaque")?.display).toEqual({ transparent: false });

    const fromCommand = await client.templates.create({
      templateID: "complete", channelID, source: "cli", data: { seeded: true }, display: { width: 500.5 },
    });
    const explicitFalse = await client.templates.create({
      templateID: "complete", channelID, source: "cli", data: { seeded: true }, display: { height: 333, fullScreen: false, transparent: false },
    });
    const fromDefaults = await client.templates.create({ templateID: "partial", channelID, source: "ui", data: { seeded: true } });
    const fromFalse = await client.templates.create({ templateID: "opaque", channelID, source: "ui", data: { seeded: true } });
    const explicitTrue = await client.templates.create({
      templateID: "opaque", channelID, source: "cli", data: { seeded: true }, display: { transparent: true },
    });
    const urlFolder = template(root, "url");
    writeFileSync(path.join(urlFolder, "manifest.json"), JSON.stringify({
      name: "Site", description: "Site", version: "1.0.0", url: "https://example.com/page",
      display: { width: 360, height: 420, fullScreen: true, transparent: true },
    }));
    const fromURL = await client.templates.create({ templateID: "url", channelID, source: "cli", display: { fullScreen: false } });
    const expected = [
      { artifactIds: [fromCommand.artifactID], geometry: { kind: "single", full_screen: true }, size: { width: 500.5, height: 420 } },
      { artifactIds: [explicitFalse.artifactID], geometry: { kind: "single", full_screen: false }, size: { width: 360, height: 333 } },
      { artifactIds: [fromDefaults.artifactID], geometry: { kind: "single", full_screen: false }, size: { width: 240, height: DEFAULT_PAGE_SIZE.height } },
      { artifactIds: [fromFalse.artifactID], geometry: { kind: "single", full_screen: false }, size: DEFAULT_PAGE_SIZE },
      { artifactIds: [explicitTrue.artifactID], geometry: { kind: "single", full_screen: false }, size: DEFAULT_PAGE_SIZE },
      { artifactIds: [fromURL.artifactID], geometry: { kind: "single", full_screen: false }, size: { width: 360, height: 420 } },
    ];
    expect((await client.channels.get({ channelID })).channel.layout).toEqual(expected);
    const records: Artifact[] = [];
    for (const [created, title, enabled] of [
      [fromCommand, "Complete", true], [explicitFalse, "Complete", false],
      [fromDefaults, "Partial", false], [fromFalse, "Opaque", false], [explicitTrue, "Opaque", true],
    ] as const) {
      const { artifact } = await client.artifacts.get({ artifactID: created.artifactID });
      expect(artifact).toEqual({
        id: created.artifactID, kind: "path", path: `${created.path}${path.sep}`, title,
        store: expect.any(String), ...(enabled ? { transparent: true } : {}),
      });
      records.push(artifact);
    }
    const urlRecord = (await client.artifacts.get({ artifactID: fromURL.artifactID })).artifact;
    expect(urlRecord).toEqual({ id: fromURL.artifactID, kind: "url", url: "https://example.com/page", title: "Site", transparent: true });
    records.push(urlRecord);
    // Later manifest edits do not rewrite persisted display values.
    writeFileSync(path.join(complete, "manifest.json"), JSON.stringify({ name: "Changed", description: "Page", version: "1.0.0" }));
    const checkRecords = async (current: TelevisionClient) => {
      const snapshot = await current.channels.get({ channelID });
      expect(snapshot.channel.layout).toEqual(expected);
      expect(snapshot.artifacts).toEqual(records);
      expect((await current.artifacts.list({ channelID })).artifacts).toEqual(records);
      for (const record of records) {
        expect((await current.artifacts.get({ artifactID: record.id })).artifact).toEqual(record);
        expect((await current.artifacts.list()).artifacts).toContainEqual(record);
        expect(JSON.parse(readFileSync(path.join(root, "state", "artifacts", `${record.id}.json`), "utf8"))).toEqual(record);
      }
      expect(JSON.parse(readFileSync(path.join(root, "state", "channels", `${channelID}.json`), "utf8")).layout).toEqual(expected);
    };
    await checkRecords(client);

    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    const restarted = await start(root, false);
    await checkRecords(restarted.client);
    for (const record of records.filter((record) => record.kind === "path")) {
      expect(restarted.store.resources.json.get({ artifactID: record.id }, "")).toEqual({ exists: true, value: { seeded: true } });
    }
  });

  // proofs/arch/templates/index.md#^templates-t-display-request-invalid
  // proofs/arch/templates/index.md#^templates-t-transparent-request-invalid
  it("rejects malformed request display before copying or registering", async () => {
    const root = home();
    const folder = template(root);
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
      name: "Sample", description: "A page", version: "1.0.0", display: { transparent: true },
    }));
    const { store, server, channelID } = await start(root, false);
    const artifactRecordsDir = path.join(root, "state", "artifacts");
    const base = { templateID: "sample", channelID, source: "cli" };
    const invalid = [
      { ...base, display: [] },
      { ...base, display: { width: 0 } },
      { ...base, display: { height: -1 } },
      { ...base, display: { fullScreen: "yes" } },
      ...["true", 1, null].map((transparent) => ({ ...base, display: { transparent } })),
    ];
    for (const body of invalid) {
      const beforeRecords = readdirSync(artifactRecordsDir).sort();
      const result = await request(server.httpServer).post("/templates/artifacts")
        .set("Authorization", `Bearer ${store.authToken}`).send(body).expect(400);
      expect(readdirSync(artifactRecordsDir).sort()).toEqual(beforeRecords);
      expect(result.body.error).toBeTruthy();
    }
    const beforeRecords = readdirSync(artifactRecordsDir).sort();
    const nonfinite = await request(server.httpServer).post("/templates/artifacts")
      .set("Authorization", `Bearer ${store.authToken}`)
      .set("Content-Type", "application/json")
      .send(`{"templateID":"sample","channelID":"${channelID}","source":"cli","display":{"width":1e400}}`)
      .expect(400);
    expect(readdirSync(artifactRecordsDir).sort()).toEqual(beforeRecords);
    expect(nonfinite.body.error).toBeTruthy();
    expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
    expect(store.listArtifacts()).toEqual([]);
    expect(store.getChannel(channelID)?.channel.layout).toEqual([]);
    expect(existsSync(path.join(root, "resources"))).toBe(false);
  });

  // proofs/arch/templates/index.md#^templates-t-package
  it("copies the exact installed folder when its ID ends in whitespace", async () => {
    const root = home();
    template(root, "sample");
    const folder = template(root, "sample ");
    writeFileSync(path.join(folder, "index.html"), "Exact folder");
    const { store, channelID, client } = await start(root, false);
    const result = await client.templates.create({ templateID: "sample ", channelID, source: "cli" });
    expect(result.path).not.toBe(folder);
    expect(readFileSync(path.join(result.path!, "index.html"), "utf8")).toBe("Exact folder");
    expect(store.getArtifact(result.artifactID)).toMatchObject({ kind: "path", path: `${result.path}${path.sep}` });
  });

  // proofs/arch/templates/index.md#^templates-t-copy
  it("copies every folder independently and persists template or replacement caller data", async () => {
    const root = home();
    const folder = template(root, "sample", { fromTemplate: true, nested: { keep: false } });
    mkdirSync(path.join(folder, "nested"));
    writeFileSync(path.join(folder, "nested", "data.json"), "supporting content");
    writeFileSync(path.join(folder, "nested", "manifest.json"), "supporting manifest");
    const { store, server, channelID, client } = await start(root);
    const seeded = await client.templates.create({ templateID: "sample", channelID, source: "ui" });
    const replaced = await client.templates.create({ templateID: "sample", channelID, source: "cli", data: { caller: true } });
    const explicitNull = await client.templates.create({ templateID: "sample", channelID, title: "My Copy", source: "cli", data: null, before: seeded.artifactID });
    expect(explicitNull.path).toMatch(new RegExp(`^${root}/artifacts/my-copy-[0-9a-z]{5}$`));
    expect(new Set([seeded.path, replaced.path, explicitNull.path]).size).toBe(3);
    const values = [
      [seeded, { fromTemplate: true, nested: { keep: false } }], [replaced, { caller: true }], [explicitNull, null],
    ] as const;
    for (const [created, value] of values) {
      expect(created).toEqual({ artifactID: expect.any(String), path: expect.stringMatching(`${root}/artifacts/`) });
      for (const filename of ["index.html", "README.md", "helper.js", "thumbnail.png", "nested/data.json", "nested/manifest.json"]) {
        expect(readFileSync(path.join(created.path!, filename))).toEqual(readFileSync(path.join(folder, filename)));
      }
      for (const filename of ["manifest.json", "data.json"]) expect(existsSync(path.join(created.path!, filename))).toBe(false);
      expect(store.getArtifact(created.artifactID)).toEqual({
        id: created.artifactID, kind: "path", title: created === explicitNull ? "My Copy" : "Sample page",
        path: `${created.path}${path.sep}`, store: expect.any(String),
      });
      expect(store.resources.json.get({ artifactID: created.artifactID }, "")).toEqual({ exists: true, value });
    }
    expect(store.getChannel(channelID)?.channel.layout.map(({ artifactIds }) => artifactIds))
      .toEqual([[explicitNull.artifactID], [seeded.artifactID], [replaced.artifactID]]);
    writeFileSync(path.join(folder, "index.html"), "edited template");
    writeFileSync(path.join(folder, "data.json"), "null");
    const newer = await client.templates.create({ templateID: "sample", channelID, source: "ui" });
    expect(readFileSync(path.join(newer.path!, "index.html"), "utf8")).toBe("edited template");
    expect(store.resources.json.get({ artifactID: newer.artifactID }, "")).toEqual({ exists: true, value: null });
    rmSync(folder, { recursive: true });
    for (const [created] of values) expect(readFileSync(path.join(created.path!, "index.html"), "utf8")).toContain("Sample");
    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    const reopened = createServingStore(root);
    try {
      for (const [created, value] of values) expect(reopened.resources.json.get({ artifactID: created.artifactID }, "")).toEqual({ exists: true, value });
    } finally { reopened.dispose(); }
  });

  // proofs/arch/templates/index.md#^templates-t-clone
  it("requests filesystem cloning with Node's ordinary-copy fallback", async () => {
    const root = home();
    const folder = template(root);
    const { channelID, client } = await start(root, false);
    const copy = vi.spyOn(fs, "cpSync");
    syncBuiltinESMExports();
    const created = await client.templates.create({ templateID: "sample", channelID, source: "cli" });
    const calls = copy.mock.calls.filter(([source]) => String(source).startsWith(`${folder}${path.sep}`));
    expect(calls.length).toBeGreaterThan(0);
    for (const [, , options] of calls) expect(options?.mode).toBe(fs.constants.COPYFILE_FICLONE);
    expect(readFileSync(path.join(created.path!, "index.html"))).toEqual(readFileSync(path.join(folder, "index.html")));
  });

  // proofs/arch/templates/index.md#^templates-t-preflight-seam
  // proofs/arch/templates/index.md#^templates-t-preflight
  it("validates caller data against the fresh schema before effects and leaves later resource writes unrestricted", async () => {
    const root = home();
    const folder = template(root);
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
      name: "Schema", description: "Page", version: "1.0.0",
      dataSchema: { type: "object", properties: { message: { type: "string", default: "never seeded" } }, required: ["message"] },
    }));
    const { store, server, channelID, client, events } = await start(root);
    for (const data of [{}, { message: 4 }, null, "x".repeat(1_048_577)]) {
      const response = await request(server.httpServer).post("/templates/artifacts")
        .set("Authorization", `Bearer ${store.authToken}`).send({ templateID: "sample", channelID, source: "cli", data }).expect(400);
      if (data && typeof data === "object") {
        expect(response.body.error).toContain("message");
        expect(response.body.error).toContain("tv templates show");
      }
      expect(store.listArtifacts()).toEqual([]);
      expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
      expect(store.getChannel(channelID)?.channel.layout).toEqual([]);
      expect(existsSync(path.join(root, "resources"))).toBe(false);
    }
    expect(events.filter(({ name }) => name === "artifact_template_used" || name === "artifact_created")).toEqual([]);
    const empty = await client.templates.create({ templateID: "sample", channelID, source: "cli" });
    expect(store.resources.json.get({ artifactID: empty.artifactID }, "")).toEqual({ exists: false });
    const supplied = { message: "Caller".repeat(30_000), extra: true };
    const seeded = await client.templates.create({ templateID: "sample", channelID, source: "cli", data: supplied });
    expect(store.resources.json.get({ artifactID: seeded.artifactID }, "")).toEqual({ exists: true, value: supplied });
    store.resources.json.write({ artifactID: seeded.artifactID }, { kind: "set", path: "", value: { message: 42 } });
    expect(store.resources.json.get({ artifactID: seeded.artifactID }, "")).toEqual({ exists: true, value: { message: 42 } });
  });

  // proofs/arch/templates/index.md#^templates-t-copy
  // proofs/arch/templates/index.md#^templates-t-preflight
  it("creates an ordinary URL record and rejects even null data before effects", async () => {
    const root = home();
    const folder = template(root);
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: "Site", description: "A site", version: "1.0.0", url: " https://example.com/page " }));
    const { store, server, channelID, client } = await start(root);
    for (const extra of [{ data: null }, { data: {} }]) {
      const response = await request(server.httpServer).post("/templates/artifacts")
        .set("Authorization", `Bearer ${store.authToken}`).send({ templateID: "sample", channelID, source: "cli", ...extra }).expect(400);
      expect(response.body.error).toMatch(/URL.*data/);
      expect(store.listArtifacts()).toEqual([]);
    }
    const result = await client.templates.create({ templateID: "sample", channelID, source: "cli", title: "My site" });
    expect(result).toEqual({ artifactID: expect.any(String), url: "https://example.com/page" });
    expect(store.getArtifact(result.artifactID)).toEqual({ id: result.artifactID, kind: "url", title: "My site", url: "https://example.com/page" });
    expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
    expect(existsSync(path.join(root, "resources"))).toBe(false);
  });

  // proofs/arch/templates/index.md#^templates-t-preflight-seam
  it("rechecks placement when a registered-artifact observer moves the neighbor before layout saving", async () => {
    const root = home();
    template(root);
    const { store, server, channelID, events } = await start(root);
    const neighbor = store.createArtifact({ kind: "url", title: "Neighbor", channelID, url: "https://example.com" });
    const other = store.createChannel({ name: "Other" });
    store.addEventListener("artifact-created", () => {
      store.moveArtifact({ artifactID: neighbor.id, channelID: other.id });
    }, { once: true });
    const response = await request(server.httpServer).post("/templates/artifacts")
      .set("Authorization", `Bearer ${store.authToken}`)
      .send({ templateID: "sample", channelID, source: "cli", after: neighbor.id }).expect(500);
    expect(response.body.error).toContain("channel layout");
    expect(response.body.error).toContain(path.join(root, "artifacts"));
    expect(response.body.error).toContain("not on channel");
    const created = store.listArtifacts().find(({ id }) => id !== neighbor.id)!;
    expect(response.body.error).toContain(created.id);
    expect(store.getChannel(channelID)?.channel.layout).toEqual([]);
    expect(events.filter(({ name }) => name === "artifact_template_used")).toEqual([]);
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
    const internal = path.join(created.path!, "helper-link.js");
    const absoluteInternal = path.join(created.path!, "absolute-helper-link.js");
    const aliasInternal = path.join(created.path!, "absolute-alias-link.js");
    const copiedIndex = path.join(created.path!, "index.html");
    const external = path.join(created.path!, "outside-link.txt");
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
    expect(path.basename(first.path!)).toBe("h-llo-world-abcde");
    expect(path.basename(second.path!)).toBe("h-llo-world-fghij");
    expect(path.basename(empty.path!)).toBe("artifact-klmno");
    expect(path.basename(limited.path!)).toBe(`${"a".repeat(30)}-pqrst`);
    expect(store.getArtifact(first.artifactID)?.title).toBe(" Héllo... WORLD! ");
  });
});
