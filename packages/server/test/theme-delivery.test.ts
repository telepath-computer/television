import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

const THEME_CSS = [
  '@import "./nested/palette.css";',
  '.probe { background-image: url("./images/probe.svg"); }',
  "",
].join("\n");
const PALETTE_CSS = ":root { --probe: rgb(1, 2, 3); }\n";
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n');
const README_BYTES = "# Active theme authoring context\n";
const SIBLING_CSS = ".sibling { color: red; }\n";
const INVALID_SCRIPT_BYTES = "this is not valid JavaScript {\n";
const UPDATED_SCRIPT_BYTES = "globalThis.themeUpdated = true;\n";
const BACKGROUND_SCRIPT_BYTES = "globalThis.themeBackground = true;\n";
const OVERLAY_SCRIPT_BYTES = "globalThis.themeOverlay = true;\n";
const SIBLING_SCRIPT_BYTES = "export const sibling = true;\n";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedTheme(storagePath: string, themeID: string, css = THEME_CSS): string {
  const themeDir = seedThemePackage(storagePath, themeID, css);
  mkdirSync(path.join(themeDir, "nested"), { recursive: true });
  mkdirSync(path.join(themeDir, "images"), { recursive: true });
  writeFileSync(path.join(themeDir, "nested", "palette.css"), PALETTE_CSS);
  writeFileSync(path.join(themeDir, "images", "probe.svg"), SVG_BYTES);
  return themeDir;
}

let storagePath: string;
let outsidePath: string;
let activeThemeDir: string;
let token: string;
let server: Server;

beforeEach(async () => {
  storagePath = tempDir("television-theme-delivery-");
  outsidePath = path.join(tempDir("television-theme-outside-"), "secret.css");
  writeFileSync(outsidePath, "secret\n");
  activeThemeDir = seedTheme(storagePath, "active-theme");
  seedTheme(storagePath, "other-theme");
  const inactiveDir = seedTheme(storagePath, "inactive-theme");
  writeFileSync(path.join(inactiveDir, "inactive-only.css"), "inactive\n");
  symlinkSync(outsidePath, path.join(activeThemeDir, "escape.css"));

  const store = createServingStore(storagePath);
  token = store.authToken;
  server = new Server({ store, host: "127.0.0.1", port: 0 });
  await server.start();
});

afterEach(async () => {
  await server?.dispose();
  rmSync(storagePath, { recursive: true, force: true });
  rmSync(path.dirname(outsidePath), { recursive: true, force: true });
});

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function patchDisplay(
  patch: {
    activeThemeName?: string | null;
    appearanceMode?: "system" | "light" | "dark";
    themeJavaScriptConsentIds?: string[];
  },
): Promise<void> {
  await request(server.httpServer)
    .patch("/display")
    .set(authHeader())
    .send(patch)
    .expect(204);
}

describe("GET /theme/*", () => {
  it("serves an empty public CORS stylesheet for the null theme", async () => {
    const response = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/css/);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers.etag).toBeTruthy();
    expect(response.text).toBe("");

    await request(server.httpServer).get("/theme/images/probe.svg").expect(404);

    const options = await request(server.httpServer).options("/theme/theme.css").expect(204);
    expect(options.headers["access-control-allow-origin"]).toBe("*");
    expect(options.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("returns exact active-package bytes and lets relative references resolve", async () => {
    await patchDisplay({ activeThemeName: "active-theme" });

    const entry = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    expect(entry.text).toBe(THEME_CSS);
    expect(entry.text).toContain('@import "./nested/palette.css";');
    expect(entry.text).toContain('url("./images/probe.svg")');

    const nested = await request(server.httpServer)
      .get("/theme/nested/palette.css")
      .expect(200);
    expect(nested.text).toBe(PALETTE_CSS);

    const image = await request(server.httpServer)
      .get("/theme/images/probe.svg")
      .expect(200);
    expect(image.body).toEqual(SVG_BYTES);
  });

  // spec: proofs/arch/themes/delivery.md#^theme-delivery-t-readme
  it("keeps package-root authoring context private while serving runtime assets", async () => {
    writeFileSync(path.join(activeThemeDir, "README.md"), README_BYTES);
    writeFileSync(path.join(activeThemeDir, "sibling.css"), SIBLING_CSS);
    await patchDisplay({ activeThemeName: "active-theme" });

    await request(server.httpServer)
      .get("/theme/README.md")
      .expect(404);
    await request(server.httpServer)
      .get("/theme/.%2FREADME.md")
      .expect(404);

    const entry = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    expect(entry.text).toBe(THEME_CSS);

    const sibling = await request(server.httpServer)
      .get("/theme/sibling.css")
      .expect(200);
    expect(sibling.text).toBe(SIBLING_CSS);
    expect(readFileSync(path.join(activeThemeDir, "README.md"), "utf8"))
      .toBe(README_BYTES);
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-script-route
  it("gates the exact main.js entry from registered enableMainJS and exact-ID consent", async () => {
    const enabledDir = seedThemePackage(storagePath, "enabled-script", "/* enabled */", {
      enableMainJS: true,
      mainJS: INVALID_SCRIPT_BYTES,
    });
    writeFileSync(path.join(enabledDir, "sibling.js"), SIBLING_SCRIPT_BYTES);
    const disabledDir = seedThemePackage(storagePath, "disabled-script", "/* disabled */", {
      enableMainJS: false,
      mainJS: "globalThis.disabledRan = true;\n",
    });
    writeFileSync(path.join(disabledDir, "sibling.js"), SIBLING_SCRIPT_BYTES);
    const unflaggedDir = seedThemePackage(storagePath, "unflagged-script", "/* unflagged */", {
      mainJS: "globalThis.unflaggedRan = true;\n",
    });
    writeFileSync(path.join(unflaggedDir, "sibling.js"), SIBLING_SCRIPT_BYTES);
    await request(server.httpServer)
      .post("/themes/refresh")
      .set(authHeader())
      .expect(200);

    const nullEntry = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(nullEntry.headers["content-type"]).toMatch(/javascript/);
    expect(nullEntry.headers["cache-control"]).toBe("no-cache");
    expect(nullEntry.headers["access-control-allow-origin"]).toBe("*");
    expect(nullEntry.headers.etag).toBeTruthy();
    expect(nullEntry.text).toBe("");
    const options = await request(server.httpServer)
      .options("/theme/main.js")
      .expect(204);
    expect(options.headers["access-control-allow-origin"]).toBe("*");

    await patchDisplay({ activeThemeName: "enabled-script" });
    const unconsented = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(unconsented.headers["content-type"]).toMatch(/javascript/);
    expect(unconsented.text).toBe("");
    const unconsentedSibling = await request(server.httpServer)
      .get("/theme/sibling.js")
      .expect(200);
    expect(unconsentedSibling.text).toBe(SIBLING_SCRIPT_BYTES);

    await patchDisplay({ themeJavaScriptConsentIds: ["Enabled-Script"] });
    expect((await request(server.httpServer).get("/theme/main.js").expect(200)).text)
      .toBe("");

    await patchDisplay({
      themeJavaScriptConsentIds: [
        "Enabled-Script",
        "enabled-script",
        "disabled-script",
        "unflagged-script",
      ],
    });
    const enabled = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(enabled.text).toBe(INVALID_SCRIPT_BYTES);
    expect(enabled.headers["content-type"]).toMatch(/javascript/);
    expect(enabled.headers.etag).not.toBe(nullEntry.headers.etag);
    await request(server.httpServer)
      .get("/theme/main.js")
      .set("If-None-Match", enabled.headers.etag as string)
      .expect(304);
    await patchDisplay({ appearanceMode: "dark" });
    await request(server.httpServer)
      .get("/theme/main.js")
      .set("If-None-Match", enabled.headers.etag as string)
      .expect(304);
    const sibling = await request(server.httpServer)
      .get("/theme/sibling.js")
      .expect(200);
    expect(sibling.text).toBe(SIBLING_SCRIPT_BYTES);

    writeFileSync(path.join(enabledDir, "main.js"), UPDATED_SCRIPT_BYTES);
    const updated = await request(server.httpServer)
      .get("/theme/main.js")
      .set("If-None-Match", enabled.headers.etag as string)
      .expect(200);
    expect(updated.text).toBe(UPDATED_SCRIPT_BYTES);
    expect(updated.headers.etag).not.toBe(enabled.headers.etag);

    const hiddenEtags: string[] = [];
    for (const [themeID, hiddenBytes] of [
      ["disabled-script", "globalThis.disabledRan = true;\n"],
      ["unflagged-script", "globalThis.unflaggedRan = true;\n"],
    ] as const) {
      await patchDisplay({ activeThemeName: themeID });
      const hidden = await request(server.httpServer)
        .get("/theme/main.js")
        .expect(200);
      expect(hidden.headers["content-type"]).toMatch(/javascript/);
      expect(hidden.text).toBe("");
      expect(hidden.text).not.toBe(hiddenBytes);
      expect(hidden.headers.etag).not.toBe(nullEntry.headers.etag);
      hiddenEtags.push(hidden.headers.etag as string);
      const ordinarySibling = await request(server.httpServer)
        .get("/theme/sibling.js")
        .expect(200);
      expect(ordinarySibling.text).toBe(SIBLING_SCRIPT_BYTES);
    }
    expect(new Set(hiddenEtags).size).toBe(2);

    await patchDisplay({ activeThemeName: "enabled-script" });
    unlinkSync(path.join(enabledDir, "main.js"));
    const missingEntry = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(missingEntry.headers["content-type"]).toMatch(/javascript/);
    expect(missingEntry.text).toBe("");
    mkdirSync(path.join(enabledDir, "main.js"));
    const nonFileEntry = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(nonFileEntry.headers["content-type"]).toMatch(/javascript/);
    expect(nonFileEntry.text).toBe("");
    rmSync(path.join(enabledDir, "main.js"), { recursive: true });
    writeFileSync(path.join(enabledDir, "main.js"), UPDATED_SCRIPT_BYTES);

    const movedEnabledDir = path.join(storagePath, "temporarily-moved-enabled-script");
    renameSync(enabledDir, movedEnabledDir);
    const missingRoot = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(missingRoot.headers["content-type"]).toMatch(/javascript/);
    expect(missingRoot.text).toBe("");
    await request(server.httpServer).get("/theme/sibling.js").expect(404);
    renameSync(movedEnabledDir, enabledDir);

    const restored = await request(server.httpServer)
      .get("/theme/main.js")
      .expect(200);
    expect(restored.text).toBe(UPDATED_SCRIPT_BYTES);
    expect(restored.headers.etag).toBe(updated.headers.etag);
    await request(server.httpServer)
      .get("/theme/main.js")
      .set("If-None-Match", updated.headers.etag as string)
      .expect(304);

    writeFileSync(
      path.join(enabledDir, "manifest.json"),
      `${JSON.stringify({
        name: "enabled-script",
        version: "1.0.0",
        colorScheme: "light dark",
        enableMainJS: false,
      }, null, 2)}\n`,
    );
    expect((await request(server.httpServer).get("/theme/main.js").expect(200)).text)
      .toBe(UPDATED_SCRIPT_BYTES);
    await request(server.httpServer)
      .post("/themes/refresh")
      .set(authHeader())
      .expect(200);
    expect((await request(server.httpServer).get("/theme/main.js").expect(200)).text)
      .toBe("");

    writeFileSync(
      path.join(enabledDir, "manifest.json"),
      `${JSON.stringify({
        name: "enabled-script",
        version: "1.0.0",
        colorScheme: "light dark",
        enableMainJS: true,
      }, null, 2)}\n`,
    );
    expect((await request(server.httpServer).get("/theme/main.js").expect(200)).text)
      .toBe("");
    await request(server.httpServer)
      .post("/themes/refresh")
      .set(authHeader())
      .expect(200);
    expect((await request(server.httpServer).get("/theme/main.js").expect(200)).text)
      .toBe(UPDATED_SCRIPT_BYTES);
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-script-route
  it("gates iframe entries independently from their registered declarations without consent", async () => {
    const backgroundDir = seedThemePackage(storagePath, "background-script", "/* background */", {
      enableIframeBackgroundJS: true,
      iframeBackgroundJS: BACKGROUND_SCRIPT_BYTES,
      iframeOverlayJS: OVERLAY_SCRIPT_BYTES,
    });
    const overlayDir = seedThemePackage(storagePath, "overlay-script", "/* overlay */", {
      enableIframeOverlayJS: true,
      iframeBackgroundJS: BACKGROUND_SCRIPT_BYTES,
      iframeOverlayJS: OVERLAY_SCRIPT_BYTES,
    });
    seedThemePackage(storagePath, "both-frame-scripts", "/* both */", {
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
      iframeBackgroundJS: BACKGROUND_SCRIPT_BYTES,
      iframeOverlayJS: OVERLAY_SCRIPT_BYTES,
    });
    seedThemePackage(storagePath, "disabled-frame-scripts", "/* disabled */", {
      enableIframeBackgroundJS: false,
      enableIframeOverlayJS: false,
      iframeBackgroundJS: BACKGROUND_SCRIPT_BYTES,
      iframeOverlayJS: OVERLAY_SCRIPT_BYTES,
    });
    seedThemePackage(storagePath, "unflagged-frame-scripts", "/* unflagged */", {
      iframeBackgroundJS: BACKGROUND_SCRIPT_BYTES,
      iframeOverlayJS: OVERLAY_SCRIPT_BYTES,
    });
    await request(server.httpServer)
      .post("/themes/refresh")
      .set(authHeader())
      .expect(200);

    for (const route of [
      "/theme/iframe-background.js",
      "/theme/iframe-overlay.js",
    ]) {
      const nullEntry = await request(server.httpServer).get(route).expect(200);
      expect(nullEntry.headers["content-type"]).toMatch(/javascript/);
      expect(nullEntry.headers["cache-control"]).toBe("no-cache");
      expect(nullEntry.headers["access-control-allow-origin"]).toBe("*");
      expect(nullEntry.text).toBe("");
      const options = await request(server.httpServer).options(route).expect(204);
      expect(options.headers["access-control-allow-origin"]).toBe("*");
    }

    await patchDisplay({
      activeThemeName: "background-script",
      themeJavaScriptConsentIds: ["different-theme"],
    });
    expect((await request(server.httpServer).get("/theme/iframe-background.js").expect(200)).text)
      .toBe(BACKGROUND_SCRIPT_BYTES);
    expect((await request(server.httpServer).get("/theme/iframe-overlay.js").expect(200)).text)
      .toBe("");

    await patchDisplay({ activeThemeName: "overlay-script" });
    expect((await request(server.httpServer).get("/theme/iframe-background.js").expect(200)).text)
      .toBe("");
    expect((await request(server.httpServer).get("/theme/iframe-overlay.js").expect(200)).text)
      .toBe(OVERLAY_SCRIPT_BYTES);

    await patchDisplay({ activeThemeName: "both-frame-scripts" });
    const background = await request(server.httpServer)
      .get("/theme/iframe-background.js")
      .expect(200);
    const overlay = await request(server.httpServer)
      .get("/theme/iframe-overlay.js")
      .expect(200);
    expect(background.text).toBe(BACKGROUND_SCRIPT_BYTES);
    expect(overlay.text).toBe(OVERLAY_SCRIPT_BYTES);
    await patchDisplay({ appearanceMode: "dark" });
    await request(server.httpServer)
      .get("/theme/iframe-background.js")
      .set("If-None-Match", background.headers.etag as string)
      .expect(304);
    await request(server.httpServer)
      .get("/theme/iframe-overlay.js")
      .set("If-None-Match", overlay.headers.etag as string)
      .expect(304);

    for (const themeID of ["disabled-frame-scripts", "unflagged-frame-scripts"]) {
      await patchDisplay({ activeThemeName: themeID });
      expect((await request(server.httpServer).get("/theme/iframe-background.js").expect(200)).text)
        .toBe("");
      expect((await request(server.httpServer).get("/theme/iframe-overlay.js").expect(200)).text)
        .toBe("");
    }

    for (const {
      themeID,
      themeDir,
      declaration,
      filename,
      route,
      bytes,
    } of [
      {
        themeID: "background-script",
        themeDir: backgroundDir,
        declaration: "enableIframeBackgroundJS",
        filename: "iframe-background.js",
        route: "/theme/iframe-background.js",
        bytes: BACKGROUND_SCRIPT_BYTES,
      },
      {
        themeID: "overlay-script",
        themeDir: overlayDir,
        declaration: "enableIframeOverlayJS",
        filename: "iframe-overlay.js",
        route: "/theme/iframe-overlay.js",
        bytes: OVERLAY_SCRIPT_BYTES,
      },
    ] as const) {
      await patchDisplay({ activeThemeName: themeID });
      unlinkSync(path.join(themeDir, filename));
      expect((await request(server.httpServer).get(route).expect(200)).text).toBe("");
      writeFileSync(path.join(themeDir, filename), bytes);

      const writeDeclaration = (enabled: boolean): void => {
        writeFileSync(
          path.join(themeDir, "manifest.json"),
          `${JSON.stringify({
            name: themeID,
            version: "1.0.0",
            colorScheme: "light dark",
            [declaration]: enabled,
          }, null, 2)}\n`,
        );
      };
      writeDeclaration(false);
      expect((await request(server.httpServer).get(route).expect(200)).text).toBe(bytes);
      await request(server.httpServer)
        .post("/themes/refresh")
        .set(authHeader())
        .expect(200);
      expect((await request(server.httpServer).get(route).expect(200)).text).toBe("");

      writeDeclaration(true);
      expect((await request(server.httpServer).get(route).expect(200)).text).toBe("");
      await request(server.httpServer)
        .post("/themes/refresh")
        .set(authHeader())
        .expect(200);
      expect((await request(server.httpServer).get(route).expect(200)).text).toBe(bytes);
    }
  });

  it("exposes neither inactive-package-only files nor escaping paths", async () => {
    await patchDisplay({ activeThemeName: "active-theme" });

    await request(server.httpServer)
      .get("/theme/inactive-only.css")
      .expect(404);
    await request(server.httpServer).get("/theme/escape.css").expect(404);
    await request(server.httpServer)
      .get("/theme/%2e%2e/%2e%2e/etc/passwd")
      .expect(404);
  });

  it("changes validators for selection and bytes, but not appearance", async () => {
    const nullThemeResponse = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);

    await patchDisplay({ activeThemeName: "active-theme" });
    const selected = await request(server.httpServer)
      .get("/theme/theme.css")
      .set("If-None-Match", nullThemeResponse.headers.etag as string)
      .expect(200);
    expect(selected.headers.etag).not.toBe(nullThemeResponse.headers.etag);

    await patchDisplay({ appearanceMode: "dark" });
    await request(server.httpServer)
      .get("/theme/theme.css")
      .set("If-None-Match", selected.headers.etag as string)
      .expect(304);

    writeFileSync(
      path.join(activeThemeDir, "theme.css"),
      `${THEME_CSS}.changed { color: red; }\n`,
    );
    const changedBytes = await request(server.httpServer)
      .get("/theme/theme.css")
      .set("If-None-Match", selected.headers.etag as string)
      .expect(200);
    expect(changedBytes.headers.etag).not.toBe(selected.headers.etag);

    await patchDisplay({ activeThemeName: "other-theme" });
    const changedSelection = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    expect(changedSelection.text).toBe(THEME_CSS);
    expect(changedSelection.headers.etag).not.toBe(selected.headers.etag);
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-route-recovery
  it("keeps the same active theme through package root loss and restores exact route bytes and validators", async () => {
    const scriptEntries = [
      ["/theme/main.js", "main.js", UPDATED_SCRIPT_BYTES],
      ["/theme/iframe-background.js", "iframe-background.js", BACKGROUND_SCRIPT_BYTES],
      ["/theme/iframe-overlay.js", "iframe-overlay.js", OVERLAY_SCRIPT_BYTES],
    ] as const;
    for (const [, filename, bytes] of scriptEntries) {
      writeFileSync(path.join(activeThemeDir, filename), bytes);
    }
    writeFileSync(
      path.join(activeThemeDir, "manifest.json"),
      `${JSON.stringify({
        name: "active-theme",
        version: "1.0.0",
        colorScheme: "light dark",
        enableMainJS: true,
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }, null, 2)}\n`,
    );
    await request(server.httpServer)
      .post("/themes/refresh")
      .set(authHeader())
      .expect(200);
    await patchDisplay({
      activeThemeName: "active-theme",
      themeJavaScriptConsentIds: ["active-theme"],
    });

    const entry = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    const asset = await request(server.httpServer)
      .get("/theme/nested/palette.css")
      .expect(200);
    const scriptEtags = new Map<string, string>();
    for (const [route, , bytes] of scriptEntries) {
      const response = await request(server.httpServer).get(route).expect(200);
      expect(response.text).toBe(bytes);
      scriptEtags.set(route, response.headers.etag as string);
    }
    const movedThemeDir = path.join(storagePath, "temporarily-moved-active-theme");

    renameSync(activeThemeDir, movedThemeDir);

    const selectedWhileMissing = await request(server.httpServer)
      .get("/display")
      .set(authHeader())
      .expect(200);
    expect(selectedWhileMissing.body.activeThemeName).toBe("active-theme");
    const missingEntry = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    expect(missingEntry.text).toBe("");
    for (const [route] of scriptEntries) {
      const missingScript = await request(server.httpServer).get(route).expect(200);
      expect(missingScript.headers["content-type"]).toMatch(/javascript/);
      expect(missingScript.text).toBe("");
    }
    await request(server.httpServer)
      .get("/theme/nested/palette.css")
      .expect(404);

    renameSync(movedThemeDir, activeThemeDir);

    const restoredEntry = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    const restoredAsset = await request(server.httpServer)
      .get("/theme/nested/palette.css")
      .expect(200);
    expect(restoredEntry.text).toBe(THEME_CSS);
    expect(restoredEntry.headers.etag).toBe(entry.headers.etag);
    expect(restoredAsset.text).toBe(PALETTE_CSS);
    expect(restoredAsset.headers.etag).toBe(asset.headers.etag);
    await request(server.httpServer)
      .get("/theme/theme.css")
      .set("If-None-Match", entry.headers.etag as string)
      .expect(304);
    await request(server.httpServer)
      .get("/theme/nested/palette.css")
      .set("If-None-Match", asset.headers.etag as string)
      .expect(304);
    for (const [route, , bytes] of scriptEntries) {
      const originalEtag = scriptEtags.get(route)!;
      const restored = await request(server.httpServer).get(route).expect(200);
      expect(restored.text).toBe(bytes);
      expect(restored.headers.etag).toBe(originalEtag);
      await request(server.httpServer)
        .get(route)
        .set("If-None-Match", originalEtag)
        .expect(304);
    }

    const selectedAfterRestore = await request(server.httpServer)
      .get("/display")
      .set(authHeader())
      .expect(200);
    expect(selectedAfterRestore.body.activeThemeName).toBe("active-theme");
  });

  it("falls back to the empty entry response if the active entry disappears", async () => {
    await patchDisplay({ activeThemeName: "active-theme" });
    unlinkSync(path.join(activeThemeDir, "theme.css"));

    const response = await request(server.httpServer)
      .get("/theme/theme.css")
      .expect(200);
    expect(response.text).toBe("");
    await request(server.httpServer)
      .get("/theme/nested/palette.css")
      .expect(404);
  });
});
