import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — repository build script has no declaration file
import { buildCanonicalVersions } from "../../canonical/scripts/build-canonical.mjs";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { Server } from "../src/server.ts";

const CANONICAL_VERSIONS = ["v1", "v2"] as const;
type CanonicalVersion = (typeof CANONICAL_VERSIONS)[number];

let storagePath: string;
let canonicalWork: string;
let canonicalDir: string;
let fontPaths: Record<CanonicalVersion, string>;
let server: Server;

beforeEach(async () => {
  storagePath = mkdtempSync(
    path.join(os.tmpdir(), "television-canonical-cache-storage-"),
  );
  canonicalWork = mkdtempSync(
    path.join(os.tmpdir(), "television-canonical-cache-build-"),
  );
  canonicalDir = path.join(canonicalWork, "canonical");
  const builds = await buildCanonicalVersions({ outDir: canonicalDir });
  expect(existsSync(path.join(canonicalDir, "v1", "frozen.json"))).toBe(true);
  expect(existsSync(path.join(canonicalDir, "v2", "frozen.json"))).toBe(false);
  fontPaths = Object.fromEntries(
    CANONICAL_VERSIONS.map((version) => {
      const styles = readFileSync(builds[version].stylesheetPath, "utf8");
      const match = new RegExp(
        `url\\((/canonical/${version}/fonts/[a-zA-Z0-9._-]+)\\)`,
      ).exec(styles);
      if (!match) {
        throw new Error(
          `fresh canonical ${version} build emitted no font URL`,
        );
      }
      return [version, match[1]];
    }),
  ) as Record<CanonicalVersion, string>;

  server = new Server({
    store: createServingStore(storagePath),
    host: "127.0.0.1",
    port: 0,
    canonicalDir: path.relative(process.cwd(), canonicalDir),
  });
  await server.start();
});

afterEach(async () => {
  await server?.dispose();
  rmSync(storagePath, { recursive: true, force: true });
  rmSync(canonicalWork, { recursive: true, force: true });
});

describe("production canonical response caching", () => {
  it("serves both canonical cache classes over real HTTP (^cn-t-cache-headers)", async () => {
    for (const version of CANONICAL_VERSIONS) {
      const font = await request(server.httpServer)
        .get(fontPaths[version])
        .expect(200);
      expect(font.headers["cache-control"]).toBe(
        "public, max-age=31536000, immutable",
      );
      expect(font.headers.etag).toBeDefined();

      const styles = await request(server.httpServer)
        .get(`/canonical/${version}/styles.css`)
        .expect(200);
      expect(styles.headers["cache-control"]).toBe("no-cache");
      expect(styles.headers.etag).toBeDefined();

      const base = await request(server.httpServer)
        .get(`/canonical/${version}/base.css`)
        .expect(200);
      expect(base.headers["cache-control"]).toBe("no-cache");
      expect(base.headers.etag).toBeDefined();

      const components = await request(server.httpServer)
        .get(`/canonical/${version}/components.js`)
        .expect(200);
      expect(components.headers["cache-control"]).toBe("no-cache");
      expect(components.headers.etag).toBeDefined();

      const revalidated = await request(server.httpServer)
        .get(`/canonical/${version}/components.js`)
        .set("If-None-Match", components.headers.etag as string)
        .expect(304);
      expect(revalidated.text).toBe("");
      expect(revalidated.headers["cache-control"]).toBe("no-cache");
    }
  });
});
