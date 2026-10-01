import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

const FONT_BYTES = Buffer.from([1, 2, 3, 4]);

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-themes-routes-"));
}

function seedTheme(storagePath: string, name: string, css = "/* theme */"): void {
  const themeDir = seedThemePackage(storagePath, name, css);
  mkdirSync(path.join(themeDir, "fonts"), { recursive: true });
  writeFileSync(path.join(themeDir, "fonts", "Demo.woff2"), FONT_BYTES);
}

let storagePath: string;
let server: Server;

beforeEach(async () => {
  storagePath = tempDir();
  seedTheme(
    storagePath,
    "Test Theme.v2",
    "@font-face { src: url(fonts/Demo.woff2) format('woff2'); }\n.hero { background-image: url(images/hero.png); }\n",
  );

  const store = createServingStore(storagePath);
  server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  await server.start();
});

afterEach(async () => {
  await server?.dispose();
  rmSync(storagePath, { recursive: true, force: true });
});

describe("/themes routes", () => {
  it("authenticates registry routes and returns completed list and refresh snapshots", async () => {
    const auth = { Authorization: `Bearer ${server.getAuthToken()}` };

    await request(server.httpServer).get("/themes").expect(401);
    await request(server.httpServer).post("/themes/refresh").expect(401);
    for (const route of ["/themes", "/themes/refresh"]) {
      const options = await request(server.httpServer).options(route).expect(204);
      expect(options.headers["access-control-allow-origin"]).toBe("*");
      expect(options.headers["access-control-allow-methods"]).toContain("POST");
      expect(options.headers["access-control-allow-headers"]).toContain("Authorization");
    }

    const initial = await request(server.httpServer).get("/themes").set(auth).expect(200);
    expect(initial.headers["access-control-allow-origin"]).toBe("*");
    expect(initial.body).toEqual({
      themes: [{
        id: "Test Theme.v2",
        name: "Test Theme.v2",
        version: "1.0.0",
        colorScheme: "light dark",
      }],
      errors: [],
    });

    seedThemePackage(storagePath, "Alpha Theme", "/* alpha */", {
      name: "Alpha",
      authoredForAppVersion: "0.1.210",
    });
    const brokenDir = seedThemePackage(storagePath, "broken");
    writeFileSync(
      path.join(brokenDir, "manifest.json"),
      `${JSON.stringify({ name: "Broken", version: "invalid" })}\n`,
      "utf8",
    );
    await request(server.httpServer).get("/themes").set(auth).expect(200).expect(({ body }) => {
      expect(body.themes.map((theme: { id: string }) => theme.id)).toEqual(["Test Theme.v2"]);
      expect(body.errors).toEqual([]);
    });

    const refreshed = await request(server.httpServer).post("/themes/refresh").set(auth).expect(200);
    expect(refreshed.headers["access-control-allow-origin"]).toBe("*");
    expect(refreshed.body.themes).toEqual([
      {
        id: "Alpha Theme",
        name: "Alpha",
        version: "1.0.0",
        colorScheme: "light dark",
        authoredForAppVersion: "0.1.210",
      },
      {
        id: "Test Theme.v2",
        name: "Test Theme.v2",
        version: "1.0.0",
        colorScheme: "light dark",
      },
    ]);
    expect(refreshed.body.errors).toEqual([{
      folder: "broken",
      error: expect.stringContaining("Semantic Version"),
    }]);
  });

  // proofs/arch/themes/index.md#^themes-t-color-scheme-http
  it("returns only normalized color schemes through list and refresh", async () => {
    const auth = { Authorization: `Bearer ${server.getAuthToken()}` };
    seedThemePackage(storagePath, "Fixed Light", "/* light */", {
      colorScheme: " LIGHT ",
    });
    seedThemePackage(storagePath, "Fixed Dark", "/* dark */", {
      colorScheme: "dark",
    });

    const refreshed = await request(server.httpServer)
      .post("/themes/refresh")
      .set(auth)
      .expect(200);
    expect(Object.fromEntries(
      refreshed.body.themes.map((theme: { id: string; colorScheme: string }) => [
        theme.id,
        theme.colorScheme,
      ]),
    )).toEqual({
      "Fixed Dark": "dark",
      "Fixed Light": "light",
      "Test Theme.v2": "light dark",
    });

    const listed = await request(server.httpServer)
      .get("/themes")
      .set(auth)
      .expect(200);
    expect(listed.body).toEqual(refreshed.body);
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-http
  it("preserves true, false, and absent values for all JavaScript declarations through registry HTTP", async () => {
    const auth = { Authorization: `Bearer ${server.getAuthToken()}` };
    seedThemePackage(storagePath, "first-combination", "/* first */", {
      enableMainJS: true,
      enableIframeBackgroundJS: false,
      mainJS: "globalThis.main = true;",
      iframeBackgroundJS: "globalThis.background = false;",
      iframeOverlayJS: "globalThis.unflaggedOverlay = true;",
    });
    seedThemePackage(storagePath, "second-combination", "/* second */", {
      enableMainJS: false,
      enableIframeOverlayJS: true,
      mainJS: "globalThis.main = false;",
      iframeBackgroundJS: "globalThis.unflaggedBackground = true;",
      iframeOverlayJS: "globalThis.overlay = true;",
    });
    seedThemePackage(storagePath, "third-combination", "/* third */", {
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: false,
      mainJS: "globalThis.unflaggedMain = true;",
      iframeBackgroundJS: "globalThis.background = true;",
      iframeOverlayJS: "globalThis.overlay = false;",
    });

    const expected = {
      "first-combination": {
        id: "first-combination",
        name: "first-combination",
        version: "1.0.0",
        colorScheme: "light dark",
        enableMainJS: true,
        enableIframeBackgroundJS: false,
      },
      "second-combination": {
        id: "second-combination",
        name: "second-combination",
        version: "1.0.0",
        colorScheme: "light dark",
        enableMainJS: false,
        enableIframeOverlayJS: true,
      },
      "third-combination": {
        id: "third-combination",
        name: "third-combination",
        version: "1.0.0",
        colorScheme: "light dark",
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: false,
      },
    };
    const selectFixtures = (body: { themes: Array<{ id: string }> }) =>
      Object.fromEntries(
        body.themes
          .filter((theme) => theme.id in expected)
          .map((theme) => [theme.id, theme]),
      );

    const refreshed = await request(server.httpServer)
      .post("/themes/refresh")
      .set(auth)
      .expect(200);
    expect(selectFixtures(refreshed.body)).toEqual(expected);

    const listed = await request(server.httpServer)
      .get("/themes")
      .set(auth)
      .expect(200);
    expect(selectFixtures(listed.body)).toEqual(expected);
  });

  it("selects only scanned themes and persists fallback after refresh", async () => {
    const auth = { Authorization: `Bearer ${server.getAuthToken()}` };
    const lateDir = seedThemePackage(storagePath, "Late Theme.v2", "/* theme */", {
      authoredForAppVersion: "current",
    });

    await request(server.httpServer)
      .patch("/display")
      .set(auth)
      .send({ activeThemeName: "Late Theme.v2" })
      .expect(404);
    await request(server.httpServer).post("/themes/refresh").set(auth).expect(200).expect(({ body }) => {
      expect(body.themes).toContainEqual({
        id: "Late Theme.v2",
        name: "Late Theme.v2",
        version: "1.0.0",
        colorScheme: "light dark",
      });
      expect(body.errors).toEqual([]);
    });
    await request(server.httpServer)
      .patch("/display")
      .set(auth)
      .send({ activeThemeName: "late theme.v2" })
      .expect(404);
    await request(server.httpServer)
      .patch("/display")
      .set(auth)
      .send({ activeThemeName: "Late Theme.v2" })
      .expect(204);

    writeFileSync(
      path.join(lateDir, "manifest.json"),
      `${JSON.stringify({ name: "Late", version: "invalid" })}\n`,
      "utf8",
    );
    const refreshed = await request(server.httpServer).post("/themes/refresh").set(auth).expect(200);
    expect(refreshed.body.errors[0]).toMatchObject({ folder: "Late Theme.v2" });
    await request(server.httpServer).get("/display").set(auth).expect(200).expect(({ body }) => {
      expect(body.activeThemeName).toBeNull();
    });
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "display.json"), "utf8"))).toMatchObject({
      activeThemeName: null,
    });
  });

});
