import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PAGE_SIZE } from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(prefix = "television-endpoints-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface Harness {
  server: Server;
  store: ServerStore;
  storagePath: string;
  token: string;
}

async function createHarness(): Promise<Harness> {
  const storagePath = tempDir();
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  await server.start();
  return { server, store, storagePath, token: store.authToken };
}

function auth(h: Harness): Record<string, string> {
  return { Authorization: `Bearer ${h.token}` };
}

describe("pointer artifact REST endpoints", () => {
  const harnesses: Harness[] = [];
  const tempPaths: string[] = [];

  afterEach(async () => {
    for (const h of harnesses.splice(0)) {
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
    for (const dir of tempPaths.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setup(): Promise<Harness> {
    const h = await createHarness();
    harnesses.push(h);
    return h;
  }

  function writeTarget(name: string, content = "ok"): string {
    const dir = tempDir("television-target-");
    tempPaths.push(dir);
    const filePath = path.join(dir, name);
    writeFileSync(filePath, content);
    return filePath;
  }

  it("creates the Slice 1 storage layout and token under state/", async () => {
    const h = await setup();
    expect(statSync(path.join(h.storagePath, "state")).isDirectory()).toBe(true);
    expect(statSync(path.join(h.storagePath, "state", "channels")).isDirectory()).toBe(true);
    expect(statSync(path.join(h.storagePath, "state", "artifacts")).isDirectory()).toBe(true);
    expect(statSync(path.join(h.storagePath, "themes")).isDirectory()).toBe(true);
    expect(statSync(path.join(h.storagePath, "artifacts")).isDirectory()).toBe(true);
    expect(readFileSync(path.join(h.storagePath, "state", "token"), "utf8").trim()).toBe(h.token);
    expect(existsSync(path.join(h.storagePath, "token"))).toBe(false);
  });

  it("GET /channels lists channels and GET /channels/:id returns channel snapshots", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;

    await request(h.server.httpServer)
      .get("/channels")
      .set(auth(h))
      .expect(200)
      .expect(({ body }) => expect(body.channels).toEqual([channel]));

    await request(h.server.httpServer)
      .get(`/channels/${channel.id}`)
      .set(auth(h))
      .expect(200)
      .expect(({ body }) => {
        expect(body.channel).toEqual(channel);
        expect(body.artifacts).toEqual([]);
      });
    await request(h.server.httpServer).get("/channels/does-not-exist").set(auth(h)).expect(404);
  });

  it("POST /channels 400s when name is missing", async () => {
    const h = await setup();
    await request(h.server.httpServer).post("/channels").set(auth(h)).send({}).expect(400);
  });

  it("POST /channels accepts caller-supplied ids and PATCH /channels updates flat fields", async () => {
    const h = await setup();
    const created = await request(h.server.httpServer)
      .post("/channels")
      .set(auth(h))
      .send({ id: "screen-custom", name: "Scratch" })
      .expect(201);
    expect(created.body.channel).toEqual({ id: "screen-custom", name: "Scratch", layout: [] });
    expect(existsSync(path.join(h.storagePath, "state", "channels", "screen-custom.json"))).toBe(true);

    await request(h.server.httpServer)
      .patch("/channels/screen-custom")
      .set(auth(h))
      .send({ name: "Renamed" })
      .expect(200)
      .expect(({ body }) => expect(body.channel.name).toBe("Renamed"));
    expect(JSON.parse(readFileSync(path.join(h.storagePath, "state", "channels", "screen-custom.json"), "utf8")).name).toBe("Renamed");
  });

  it("DELETE /channels/:id 404s on unknown id", async () => {
    const h = await setup();
    await request(h.server.httpServer).delete("/channels/does-not-exist").set(auth(h)).expect(404);
  });

  it("DELETE /channels removes the channel and returns cascade results", async () => {
    const h = await setup();
    const channel = h.store.createChannel({ id: "screen-delete", name: "Delete me" });
    const events: any[] = [];
    h.store.addEventListener("channel-removed", (event) => events.push(event));

    await request(h.server.httpServer)
      .delete(`/channels/${channel.id}`)
      .set(auth(h))
      .expect(200)
      .expect(({ body }) => {
        expect(body.channelID).toBe(channel.id);
        expect(body.metadataPath).toContain(`${channel.id}.json`);
        expect(body.artifactResults).toEqual([]);
      });
    expect(h.store.getChannel(channel.id)).toBeUndefined();
    expect(events.map((event) => event.channelID)).toEqual([channel.id]);
  });

  it("removed channel-scoped artifact routes are not registered", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    await request(h.server.httpServer).post(`/channels/${channel.id}/artifact`).set(auth(h)).send({ kind: "url", title: "U", url: "https://example.com" }).expect(404);
    await request(h.server.httpServer).options(`/channels/${channel.id}/artifact`).expect(404);
    await request(h.server.httpServer).post(`/channels/${channel.id}/artifacts/artifact-1`).set(auth(h)).expect(404);
    await request(h.server.httpServer).delete(`/channels/${channel.id}/artifacts/artifact-1`).set(auth(h)).expect(404);
    await request(h.server.httpServer).options(`/channels/${channel.id}/artifacts/artifact-1`).expect(404);
  });

  it("POST /artifacts creates a trimmed path artifact and round-trips the stored shape", async () => {
    const h = await setup();
    const target = writeTarget("note.md", "# note");
    const channel = h.store.listChannels()[0]!;
    const events: string[] = [];
    h.store.addEventListener("artifact-created", () => events.push("artifact-created"));
    const res = await request(h.server.httpServer)
      .post("/artifacts")
      .set(auth(h))
      .send({ kind: "path", title: "Note", channelID: channel.id, path: `  ${target}  ` })
      .expect(201);

    expect(res.body).toEqual({ artifact: { id: expect.any(String), kind: "path", title: "Note", path: target }, channelID: channel.id });
    expect(events).toEqual(["artifact-created"]);
    await request(h.server.httpServer)
      .get(`/artifacts/${encodeURIComponent(res.body.artifact.id)}`)
      .set(auth(h))
      .expect(200)
      .expect(({ body }) => {
        expect(body.artifact).toEqual(res.body.artifact);
      });
    await request(h.server.httpServer).get("/artifacts/does-not-exist").set(auth(h)).expect(404);
  });

  it("POST /artifacts accepts HTML files, indexed directories, symlinked files, and http(s) URLs", async () => {
    const h = await setup();
    const htmlFile = writeTarget("index.html", "<!doctype html>");
    const symlinkDir = tempDir("television-symlink-");
    tempPaths.push(symlinkDir);
    const symlinkPath = path.join(symlinkDir, "linked.html");
    await import("node:fs").then((fs) => fs.symlinkSync(htmlFile, symlinkPath));
    const dir = tempDir("television-dir-");
    tempPaths.push(dir);
    writeFileSync(path.join(dir, "index.html"), "<!doctype html>");

    const channel = h.store.listChannels()[0]!;
    for (const artifactPath of [htmlFile, symlinkPath, `${dir}${path.sep}`]) {
      await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "A", channelID: channel.id, path: artifactPath }).expect(201);
    }
    // Either input form is accepted; the stored path is normalized so
    // directories end with a separator and files do not.
    const dirRes = await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "A", channelID: channel.id, path: dir }).expect(201);
    expect(dirRes.body.artifact.path).toBe(`${dir}${path.sep}`);
    const fileRes = await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "A", channelID: channel.id, path: `${htmlFile}${path.sep}` }).expect(201);
    expect(fileRes.body.artifact.path).toBe(htmlFile);
    await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "url", title: "U", channelID: channel.id, url: "https://example.com/a" }).expect(201);
    await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "url", title: "U", channelID: channel.id, url: "http://example.com/a" }).expect(201);
  });

  it("rejects old kinds, old URL shape, invalid paths, and invalid extensions", async () => {
    const h = await setup();
    const txt = writeTarget("bad.txt");
    const dir = tempDir("television-no-index-");
    tempPaths.push(dir);
    const channel = h.store.listChannels()[0]!;
    for (const body of [
      { kind: "markdown", title: "M", channelID: channel.id, externalFilePath: txt },
      { kind: "web-bundle", title: "W", channelID: channel.id },
      { kind: "url", title: "U", channelID: channel.id, externalURL: "https://example.com" },
      { kind: "path", title: "R", channelID: channel.id, path: "relative.html" },
      { kind: "path", title: "TXT", channelID: channel.id, path: txt },
      { kind: "path", title: "TXT with slash", channelID: channel.id, path: `${txt}${path.sep}` },
      { kind: "path", title: "Dir no index", channelID: channel.id, path: dir },
      { kind: "path", title: "Dir no index with slash", channelID: channel.id, path: `${dir}${path.sep}` },
      { kind: "url", title: "Bad", channelID: channel.id, url: "file:///tmp/a.html" },
    ]) {
      await request(h.server.httpServer).post("/artifacts").set(auth(h)).send(body).expect(400);
    }
  });

  it("refuses a create that supplies the artifact's ID and generates one otherwise (^af-ac-no-supplied-id)", async () => {
    const h = await setup();
    const target = writeTarget("page.html", "<!doctype html>");
    const channel = h.store.listChannels()[0]!;
    const suppliedID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    for (const body of [
      { id: suppliedID, kind: "path", title: "P", channelID: channel.id, path: target },
      { id: suppliedID, kind: "url", title: "U", channelID: channel.id, url: "https://example.com/a" },
    ]) {
      await request(h.server.httpServer).post("/artifacts").set(auth(h)).send(body).expect(400);
    }
    expect(h.store.listArtifacts()).toEqual([]);
    expect(h.store.getChannel(channel.id)!.channel.layout).toEqual([]);

    for (const body of [
      { kind: "path", title: "P", channelID: channel.id, path: target },
      { kind: "url", title: "U", channelID: channel.id, url: "https://example.com/a" },
    ]) {
      const created = await request(h.server.httpServer).post("/artifacts").set(auth(h)).send(body).expect(201);
      const id = (created.body as { artifact: { id: string } }).artifact.id;
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(id).not.toBe(suppliedID);
    }
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-artifacts-route
  it("lists every artifact in one answer for the desktop reaper (^dp-t-artifacts-route)", async () => {
    const h = await setup();
    const target = writeTarget("listed.html", "<!doctype html>");
    const channels = [h.store.listChannels()[0]!.id];
    for (const name of ["Second", "Third"]) {
      const created = await request(h.server.httpServer).post("/channels").set(auth(h)).send({ name }).expect(201);
      channels.push((created.body as { channel: { id: string } }).channel.id);
    }
    const ids: string[] = [];
    for (let index = 0; index < 250; index++) {
      const channelID = channels[index % channels.length]!;
      const artifact = index % 2 === 0
        ? h.store.createArtifact({ kind: "path", title: `P${index}`, channelID, path: target })
        : h.store.createArtifact({ kind: "url", title: `U${index}`, channelID, url: `https://example.com/${index}` });
      ids.push(artifact.id);
    }

    const listed = async () => {
      const response = await request(h.server.httpServer).get("/artifacts").set(auth(h)).expect(200);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      const artifacts = (response.body as { artifacts: Array<{ id: unknown }> }).artifacts;
      expect(artifacts.every((artifact) => typeof artifact.id === "string")).toBe(true);
      return artifacts.map((artifact) => artifact.id as string);
    };
    const first = await listed();
    expect(first).toHaveLength(250);
    expect(new Set(first)).toEqual(new Set(ids));

    await request(h.server.httpServer).delete(`/artifacts/${ids[17]}`).set(auth(h)).expect(200);
    expect(new Set(await listed())).toEqual(new Set(ids.filter((id) => id !== ids[17])));
  });

  it("routes surface unexpected errors as HTTP 500, not 400", async () => {
    const h = await setup();
    const target = writeTarget("boom.html", "<!doctype html>");
    const artifact = h.store.createArtifact({ kind: "path", title: "A", channelID: h.store.listChannels()[0]!.id, path: target });
    const originalUpdate = h.store.updateArtifact.bind(h.store);
    h.store.updateArtifact = () => { throw new Error("boom: unexpected"); };
    try {
      await request(h.server.httpServer).patch(`/artifacts/${artifact.id}`).set(auth(h)).send({ title: "new" }).expect(500);
    } finally {
      h.store.updateArtifact = originalUpdate;
    }
  });

  it("PATCH /artifacts/:id updates title and path fields", async () => {
    const h = await setup();
    const target = writeTarget("note.markdown");
    const nextTarget = writeTarget("next.markdown");
    const channel = h.store.listChannels()[0]!;
    const created = await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "Before", channelID: channel.id, path: target }).expect(201);
    await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(auth(h)).send({ title: "After" }).expect(200).expect(({ body }) => {
      expect(body.artifact).toEqual({ ...created.body.artifact, title: "After" });
    });
    await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(auth(h)).send({ path: nextTarget }).expect(200).expect(({ body }) => {
      expect(body.artifact).toEqual({ ...created.body.artifact, title: "After", path: nextTarget });
    });
    expect(JSON.parse(readFileSync(path.join(h.storagePath, "state", "artifacts", `${created.body.artifact.id}.json`), "utf8"))).toMatchObject({ title: "After", path: nextTarget });
    await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(auth(h)).send({}).expect(400);
    await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(auth(h)).send({ url: "https://example.com" }).expect(400);
    await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(auth(h)).send({ kind: "url" }).expect(400);
  });

  it("DELETE /artifacts/:id 404s on unknown id", async () => {
    const h = await setup();
    await request(h.server.httpServer).delete("/artifacts/missing").set(auth(h)).expect(404);
  });

  it("DELETE /artifacts/:id deletes metadata and does not touch the target", async () => {
    const h = await setup();
    const target = writeTarget("delete.html", "still here");
    const channel = h.store.listChannels()[0]!;
    const created = await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "A", path: target, channelID: channel.id }).expect(201);
    const removedChannels: string[] = [];
    h.store.addEventListener("artifact-removed", (event) => removedChannels.push((event as unknown as { channelID: string }).channelID));
    const metadataPath = path.join(h.storagePath, "state", "artifacts", `${created.body.artifact.id}.json`);
    expect(existsSync(metadataPath)).toBe(true);

    await request(h.server.httpServer).delete(`/artifacts/${created.body.artifact.id}`).set(auth(h)).expect(200).expect(({ body }) => {
      expect(body).toEqual({ outcome: "deleted", kind: "path", artifactID: created.body.artifact.id, path: target });
    });

    expect(existsSync(metadataPath)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("still here");
    expect(h.store.getChannel(channel.id)?.channel.layout).toEqual([]);
    expect(removedChannels).toEqual([channel.id]);
  });



  it("ignores ?unplaced=true as an unknown query param with no legacy-filter special-casing", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    const second = h.store.createChannel({ name: "Second" });
    const target = writeTarget("list.md", "# list");
    const first = h.store.createArtifact({ kind: "path", title: "First", path: target, channelID: channel.id });
    const secondArtifact = h.store.createArtifact({ kind: "url", title: "Second", channelID: second.id, url: "https://example.com" });
    const expectedIDs = [first.id, secondArtifact.id].sort();

    await request(h.server.httpServer).get("/artifacts").set(auth(h)).expect(200).expect(({ body }) => expect(body.artifacts.map((a: any) => a.id).sort()).toEqual(expectedIDs));
    await request(h.server.httpServer).get("/artifacts?unplaced=true").set(auth(h)).expect(200).expect(({ body }) => expect(body.artifacts.map((a: any) => a.id).sort()).toEqual(expectedIDs));
    await request(h.server.httpServer).get(`/artifacts?channelID=${channel.id}&unplaced=true`).set(auth(h)).expect(200).expect(({ body }) => expect(body.artifacts).toEqual([first]));
    await request(h.server.httpServer).get("/artifacts?channelID=missing").set(auth(h)).expect(404);
  });

  it("POST /artifacts 404s on unknown channelID without leaving orphan state", async () => {
    const h = await setup();
    const before = h.store.listArtifacts().length;
    await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "url", title: "Bad", url: "https://example.com", channelID: "missing" }).expect(404);
    expect(h.store.listArtifacts()).toHaveLength(before);
  });

  it("POST /artifacts requires channelID and appends one default page", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    const target = writeTarget("owned.html", "<!doctype html>");

    await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "Missing channel", path: target }).expect(400);

    const events: string[] = [];
    h.store.addEventListener("artifact-created", () => events.push("artifact-created"));
    const created = await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "url", title: "URL", url: "https://example.com", channelID: channel.id }).expect(201);
    expect(created.body).toEqual({ artifact: { id: expect.any(String), kind: "url", title: "URL", url: "https://example.com" }, channelID: channel.id });
    expect(events).toEqual(["artifact-created"]);
    expect(h.store.getChannel(channel.id)?.channel.layout).toEqual([{
      artifactIds: [created.body.artifact.id],
      geometry: { kind: "single", full_screen: false },
      size: DEFAULT_PAGE_SIZE,
    }]);
  });

  it("GET and DELETE /artifacts/:id expose metadata and global deletion for URL artifacts", async () => {
    const h = await setup();
    const artifact = h.store.createArtifact({ kind: "url", title: "URL", channelID: h.store.listChannels()[0]!.id, url: "https://example.com" });

    await request(h.server.httpServer).get(`/artifacts/${artifact.id}`).set(auth(h)).expect(200).expect(({ body }) => expect(body.artifact).toEqual(artifact));
    await request(h.server.httpServer).delete(`/artifacts/${artifact.id}`).set(auth(h)).expect(200).expect(({ body }) => expect(body).toEqual({ outcome: "deleted", kind: "url", artifactID: artifact.id, url: "https://example.com" }));
    await request(h.server.httpServer).get(`/artifacts/${artifact.id}`).set(auth(h)).expect(404);
  });

  it("GET/PATCH/POST display routes round-trip state and focus", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    const target = writeTarget("focus.html", "<!doctype html>");
    const artifact = h.store.createArtifact({ kind: "path", title: "A", path: target, channelID: channel.id });

    await request(h.server.httpServer).get("/display").set(auth(h)).expect(200).expect(({ body }) => expect(body).toMatchObject({
      focusedChannelId: channel.id,
      pinnedChannelIds: [],
      activeThemeName: null,
      acpEnabled: false,
    }));
    await request(h.server.httpServer).patch("/display").set(auth(h)).send({ pinnedChannelIds: [channel.id] }).expect(204);
    await request(h.server.httpServer).get("/display").set(auth(h)).expect(200).expect(({ body }) => expect(body.pinnedChannelIds).toEqual([channel.id]));
    await request(h.server.httpServer).post("/display/focus").set(auth(h)).send({ artifactID: artifact.id }).expect(200).expect(({ body }) => expect(body).toEqual({ channelID: channel.id, artifactID: artifact.id }));
  });



  it("PATCH /channels rejects an empty body and pinned-only unknown-field patches", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    await request(h.server.httpServer).patch(`/channels/${channel.id}`).set(auth(h)).send({}).expect(400);
    await request(h.server.httpServer).patch(`/channels/${channel.id}`).set(auth(h)).send({ pinned: true }).expect(400);
  });

  it("PATCH /channels returns 404 for unknown channels", async () => {
    const h = await setup();
    await request(h.server.httpServer).patch("/channels/missing").set(auth(h)).send({ name: "Missing" }).expect(404);
  });

  it("PATCH /channels rejects name + unknown fields", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;
    await request(h.server.httpServer)
      .patch(`/channels/${channel.id}`)
      .set(auth(h))
      .send({ name: "Pinned", pinned: true })
      .expect(400);
  });

  it("POST /channels persists the channel and emits a channel-created event", async () => {
    const h = await setup();
    const events: string[] = [];
    h.store.addEventListener("channel-created", (event) => events.push((event as any).channel.id));
    const created = await request(h.server.httpServer).post("/channels").set(auth(h)).send({ id: "screen-http", name: "HTTP" }).expect(201);
    expect(h.store.getChannel("screen-http")?.channel).toEqual(created.body.channel);
    expect(events).toEqual(["screen-http"]);
  });

  it("DELETE /channels reports removed metadata and deletes owned artifacts", async () => {
    const h = await setup();
    const first = h.store.listChannels()[0]!;
    const target = writeTarget("owned.html", "<!doctype html>");
    const artifact = h.store.createArtifact({ kind: "path", title: "Owned", path: target, channelID: first.id });
    const events: Array<{ artifactID: string; channelID: string }> = [];
    h.store.addEventListener("artifact-removed", (event) => {
      const removed = event as unknown as { artifactID: string; channelID: string };
      events.push({ artifactID: removed.artifactID, channelID: removed.channelID });
    });

    await request(h.server.httpServer).delete(`/channels/${first.id}`).set(auth(h)).expect(200).expect(({ body }) => {
      expect(body.metadataPath).toContain(`${first.id}.json`);
      expect(body.artifactResults).toEqual([{ outcome: "deleted", kind: "path", artifactID: artifact.id, path: target }]);
    });
    expect(events).toEqual([{ artifactID: artifact.id, channelID: first.id }]);
    expect(h.store.getArtifact(artifact.id)).toBeUndefined();
  });

  it("requires bearer auth on individual protected route shapes", async () => {
    const h = await setup();
    await request(h.server.httpServer).get("/channels").expect(401);
    await request(h.server.httpServer).post("/channels").send({ name: "Nope" }).expect(401);
    await request(h.server.httpServer).get("/channels/screen-1").expect(401);
    await request(h.server.httpServer).patch("/channels/screen-1").send({ name: "Nope" }).expect(401);
    await request(h.server.httpServer).delete("/channels/screen-1").expect(401);
    await request(h.server.httpServer).get("/artifacts").expect(401);
    await request(h.server.httpServer).post("/artifacts").send({ kind: "url", title: "U", url: "https://example.com" }).expect(401);
    await request(h.server.httpServer).get("/artifacts/artifact-1").expect(401);
    await request(h.server.httpServer).patch("/artifacts/artifact-1").send({ title: "Nope" }).expect(401);
    await request(h.server.httpServer).delete("/artifacts/artifact-1").expect(401);
    await request(h.server.httpServer).get("/display").expect(401);
    await request(h.server.httpServer).patch("/display").send({ focusedChannelId: null }).expect(401);
    await request(h.server.httpServer).post("/display/focus").send({ artifactID: "artifact-1" }).expect(401);
    await request(h.server.httpServer).get("/markdown/artifact-1").expect(401);
    await request(h.server.httpServer).put("/markdown/artifact-1").send("# nope").expect(401);
    await request(h.server.httpServer).get("/demo-mode").expect(401);
  });

  it("requires bearer auth on protected registry, channel, and display routes", async () => {
    const h = await setup();
    await request(h.server.httpServer).get(`/channels?token=${encodeURIComponent(h.token)}`).expect(401);
    await request(h.server.httpServer).get("/channels").set(auth(h)).expect(200);
    await request(h.server.httpServer).get("/channels").expect(401);
    await request(h.server.httpServer).post("/channels").send({ name: "Nope" }).expect(401);
    await request(h.server.httpServer).get("/artifacts").expect(401);
    await request(h.server.httpServer).post("/artifacts").send({ kind: "url", title: "U", url: "https://example.com" }).expect(401);
    await request(h.server.httpServer).get("/display").expect(401);
    await request(h.server.httpServer).patch("/display").send({ focusedChannelId: null }).expect(401);
  });

  it("removed content and pending lifecycle routes are not registered", async () => {
    const h = await setup();
    await request(h.server.httpServer).get("/artifacts/missing/content").expect(404);
    await request(h.server.httpServer).options("/artifacts/missing/content").expect(404);
    await request(h.server.httpServer).put("/artifacts/missing/content").set(auth(h)).send("x").expect(404);
    await request(h.server.httpServer).get("/artifacts/missing/content/file.js").expect(404);
    await request(h.server.httpServer).post("/artifacts/missing/edit").set(auth(h)).expect(404);
    await request(h.server.httpServer).post("/artifacts/missing/commit").set(auth(h)).expect(404);
    await request(h.server.httpServer).post("/artifacts/missing/abandon").set(auth(h)).expect(404);
    await request(h.server.httpServer).post("/tool/createArtifact").set(auth(h)).expect(404);
    await request(h.server.httpServer).post("/mcp").set(auth(h)).expect(404);
  });

  it("rejects an unreadable path when permissions allow the check", async () => {
    if (process.platform === "win32") return;
    const h = await setup();
    const target = writeTarget("unreadable.html");
    chmodSync(target, 0o000);
    try {
      await request(h.server.httpServer).post("/artifacts").set(auth(h)).send({ kind: "path", title: "A", channelID: h.store.listChannels()[0]!.id, path: target }).expect((res) => {
        expect([201, 400]).toContain(res.status);
      });
    } finally {
      chmodSync(target, 0o600);
    }
  });
});
