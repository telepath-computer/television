import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

let storagePath: string;
let canonicalDir: string;
let server: Server;

beforeEach(async () => {
  storagePath = mkdtempSync(path.join(os.tmpdir(), "television-canonical-"));
  canonicalDir = mkdtempSync(path.join(os.tmpdir(), "television-canonical-dist-"));
  const versionDir = path.join(canonicalDir, "v1");
  mkdirSync(versionDir);

  // Canonical construction reads the stylesheet eagerly; mount success is
  // crossed with the fresh production tree in the real-browser suite.
  writeFileSync(path.join(versionDir, "styles.css"), "/* fixture */\n");
  writeFileSync(path.join(versionDir, "frozen.json"), "{}\n");
  const liveVersionDir = path.join(canonicalDir, "v2");
  mkdirSync(liveVersionDir);
  writeFileSync(path.join(liveVersionDir, "styles.css"), "/* live fixture */\n");

  const store = createServingStore(storagePath);
  server = new Server({ store, host: "127.0.0.1", port: 0, canonicalDir });
  await server.start();
});

afterEach(async () => {
  await server?.dispose();
  rmSync(storagePath, { recursive: true, force: true });
  rmSync(canonicalDir, { recursive: true, force: true });
});

describe("/canonical/v1 — canonical artifact mount", () => {
  it("classifies only marked discovered versions as frozen", async () => {
    const frozenWrapper = await request(server.app)
      .get("/canonical/v1/styles.css")
      .expect(200);
    expect(frozenWrapper.text).toBe(
      '@import url("/canonical/v1/base.css");\n',
    );

    const liveWrapper = await request(server.app)
      .get("/canonical/v2/styles.css")
      .expect(200);
    expect(liveWrapper.text).toContain('@import url("/canonical/v2/base.css");');
    expect(liveWrapper.text).toContain('@import url("/theme/theme.css");');

    const base = await request(server.app)
      .get("/canonical/v1/base.css")
      .expect(200);
    expect(base.text).toBe("/* fixture */\n");
  });

  it("returns 404 for files not in the canonical bundle", async () => {
    const res = await request(server.app).get("/canonical/v1/nope.css");
    expect(res.status).toBe(404);
  });

  it("mounts discovered point-version directories", async () => {
    await server.dispose();
    const pointVersionDir = path.join(canonicalDir, "v1.1");
    mkdirSync(pointVersionDir);
    writeFileSync(
      path.join(pointVersionDir, "styles.css"),
      "/* point-version fixture */\n",
    );

    const store = createServingStore(storagePath);
    server = new Server({ store, host: "127.0.0.1", port: 0, canonicalDir });
    await server.start();

    const wrapper = await request(server.app)
      .get("/canonical/v1.1/styles.css")
      .expect(200);
    expect(wrapper.text).toContain('@import url("/canonical/v1.1/base.css");');
    expect(wrapper.text).toContain('@import url("/theme/theme.css");');

    const base = await request(server.app)
      .get("/canonical/v1.1/base.css")
      .expect(200);
    expect(base.text).toBe("/* point-version fixture */\n");
  });

  it("rejects a canonical root with no version directories", async () => {
    await server.dispose();
    const invalidRoot = mkdtempSync(
      path.join(os.tmpdir(), "television-invalid-canonical-root-"),
    );
    writeFileSync(path.join(invalidRoot, "styles.css"), "/* legacy leaf */\n");
    const store = createServingStore(storagePath);
    try {
      expect(() =>
        new Server({
          store,
          host: "127.0.0.1",
          port: 0,
          canonicalDir: invalidRoot,
        })
      ).toThrow(
        `canonical root ${path.resolve(invalidRoot)} contains no version directories matching v<n>`,
      );
    } finally {
      rmSync(invalidRoot, { recursive: true, force: true });
    }
  });
});

describe("/canonical/v1 — when canonicalDir is omitted", () => {
  it("does not register the route", async () => {
    await server.dispose();
    const store = createServingStore(storagePath);
    server = new Server({ store, host: "127.0.0.1", port: 0 });
    await server.start();
    const res = await request(server.app).get("/canonical/v1/styles.css");
    expect(res.status).toBe(404);
  });
});
