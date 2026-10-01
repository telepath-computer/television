import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

const V1_BASE = "/* canonical v1 */\n";
const V2_BASE = "/* canonical v2 */\n";
const COMPONENTS = "customElements.define('fixture-component', class extends HTMLElement {});\n";
const FONT_BYTES = Buffer.from([1, 2, 3, 4]);
const THEME_CSS = ":root { --loud-theme-probe: rgb(250, 0, 200); }\n";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedCanonicalVersion(
  root: string,
  version: string,
  base: string,
  frozen = false,
): void {
  const versionDir = path.join(root, version);
  mkdirSync(path.join(versionDir, "fonts"), { recursive: true });
  writeFileSync(path.join(versionDir, "styles.css"), base);
  writeFileSync(path.join(versionDir, "components.js"), COMPONENTS);
  writeFileSync(path.join(versionDir, "fonts", "Demo.12345678.woff2"), FONT_BYTES);
  if (frozen) {
    writeFileSync(path.join(versionDir, "frozen.json"), "{}\n");
  }
}

function expectedBaseOnlyWrapper(version: string, query = ""): string {
  return `@import url("/canonical/${version}/base.css${query}");\n`;
}

function expectedThemedWrapper(version: string, query = ""): string {
  return `${expectedBaseOnlyWrapper(version, query)}@import url("/theme/theme.css${query}");\n`;
}

let storagePath: string;
let canonicalRoot: string;
let server: Server;

beforeEach(async () => {
  storagePath = tempDir("television-canonical-styles-");
  canonicalRoot = tempDir("television-canonical-root-");
  seedCanonicalVersion(canonicalRoot, "v1", V1_BASE, true);
  seedCanonicalVersion(canonicalRoot, "v2", V2_BASE);
  seedThemePackage(storagePath, "loud", THEME_CSS);

  const store = createServingStore(storagePath);
  store.patchDisplay({ activeThemeName: "loud" });
  server = new Server({
    store,
    host: "127.0.0.1",
    port: 0,
    canonicalDir: canonicalRoot,
  });
  await server.start();
});

afterEach(async () => {
  await server?.dispose();
  rmSync(storagePath, { recursive: true, force: true });
  rmSync(canonicalRoot, { recursive: true, force: true });
});

describe("versioned canonical delivery", () => {
  it("serves frozen versions with only their base import", async () => {
    const response = await request(server.httpServer)
      .get("/canonical/v1/styles.css")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/css/);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers.etag).toBeTruthy();
    expect(response.text).toBe(expectedBaseOnlyWrapper("v1"));
  });

  // spec: proofs/arch/themes/delivery.md#^theme-delivery-t-canonical
  // spec: proofs/arch/canonical.md#^cn-t-theme-layer
  it("serves live versions with base then theme and nothing after", async () => {
    const response = await request(server.httpServer)
      .get("/canonical/v2/styles.css")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/css/);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers.etag).toBeTruthy();
    expect(response.text).toBe(expectedThemedWrapper("v2"));
  });

  // spec: proofs/arch/themes/delivery.md#^theme-delivery-t-wrapper-query
  it("copies the exact wrapper query onto every canonical import", async () => {
    for (const query of [
      "?authoredForAppVersion=0.1.210",
      "?first=alpha%2Fbeta&first=again&encoded=%7ekeep%2fcase",
    ]) {
      const frozen = await request(server.httpServer)
        .get(`/canonical/v1/styles.css${query}`)
        .expect(200);
      const live = await request(server.httpServer)
        .get(`/canonical/v2/styles.css${query}`)
        .expect(200);

      expect(frozen.text).toBe(expectedBaseOnlyWrapper("v1", query));
      expect(live.text).toBe(expectedThemedWrapper("v2", query));
    }
  });

  // spec: proofs/arch/themes/delivery.md#^theme-delivery-t-import-query
  it("keeps imported stylesheet bytes and validators independent of wrapper queries", async () => {
    for (const resource of [
      "/canonical/v1/base.css",
      "/canonical/v2/base.css",
      "/theme/theme.css",
    ]) {
      const queryFree = await request(server.httpServer)
        .get(resource)
        .expect(200);

      for (const query of [
        "?authoredForAppVersion=0.1.210",
        "?first=alpha%2Fbeta&first=again&encoded=%7ekeep%2fcase",
      ]) {
        const queried = await request(server.httpServer)
          .get(`${resource}${query}`)
          .expect(200);

        expect(queried.text).toBe(queryFree.text);
        expect(queried.headers.etag).toBe(queryFree.headers.etag);
        await request(server.httpServer)
          .get(`${resource}${query}`)
          .set("If-None-Match", queryFree.headers.etag as string)
          .expect(304);
      }
    }
  });

  it("keeps each base separate from the live version's active theme resource", async () => {
    const v1 = await request(server.httpServer)
      .get("/canonical/v1/base.css")
      .expect(200);
    const v2 = await request(server.httpServer)
      .get("/canonical/v2/base.css")
      .expect(200);
    const theme = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);

    expect(v1.text).toBe(V1_BASE);
    expect(v2.text).toBe(V2_BASE);
    expect(theme.text).toBe(THEME_CSS);
    expect(v1.headers.etag).not.toBe(v2.headers.etag);
    expect(v1.headers.etag).not.toBe(theme.headers.etag);
    expect(v1.headers["cache-control"]).toBe("no-cache");
  });

  it("returns 304 when frozen or live wrapper and base validators match", async () => {
    for (const resource of [
      "/canonical/v1/styles.css",
      "/canonical/v1/base.css",
      "/canonical/v2/styles.css",
      "/canonical/v2/base.css",
    ]) {
      const initial = await request(server.httpServer).get(resource).expect(200);
      await request(server.httpServer)
        .get(resource)
        .set("If-None-Match", initial.headers.etag as string)
        .expect(304);
    }
  });

  it("serves immutable content-addressed fonts and CORS-open components", async () => {
    const font = await request(server.httpServer)
      .get("/canonical/v1/fonts/Demo.12345678.woff2")
      .expect(200);
    expect(font.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(font.headers["access-control-allow-origin"]).toBe("*");
    expect(font.body).toEqual(FONT_BYTES);

    const components = await request(server.httpServer)
      .get("/canonical/v2/components.js")
      .expect(200);
    expect(components.headers["cache-control"]).toBe("no-cache");
    expect(components.headers["access-control-allow-origin"]).toBe("*");
    expect(components.text).toBe(COMPONENTS);
  });

  it("does not mount non-version directories", async () => {
    mkdirSync(path.join(canonicalRoot, "draft"), { recursive: true });
    writeFileSync(path.join(canonicalRoot, "draft", "styles.css"), "draft");
    await request(server.httpServer)
      .get("/canonical/draft/base.css")
      .expect(404);
  });
});
