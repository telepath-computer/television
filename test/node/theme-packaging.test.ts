import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { parse } from "yaml";
import path from "node:path";
import { type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(process.cwd());
const BUILT_CLI = path.join(REPO_ROOT, "packages/cli/dist/cli.cjs");
const START_TIMEOUT_MS = 30_000;

type ServeChild = ChildProcessByStdio<null, Readable, Readable>;

function serveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "" };
  delete env.TELEVISION_ACP_AGENT;
  return env;
}

function filesUnder(root: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, relative));
    else files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function spawnServe(cliEntry: string, storagePath: string): OwnedProcess {
  writeHomeConfig(storagePath, { port: 0, auth: false });
  return spawnOwnedProcess(process.execPath, [cliEntry, "--home", storagePath, "serve"], {
    cwd: path.dirname(cliEntry),
    env: serveEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForURL(child: ServeChild): Promise<string> {
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for tv serve. stderr:\n${stderr}`)), START_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const url = stdout.match(/https?:\/\/[^\s\u001b]+/)?.[0];
      if (url) {
        clearTimeout(timeout);
        resolve(url);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`tv serve exited before startup (code ${code}, signal ${signal}). stdout:\n${stdout}\nstderr:\n${stderr}`));
    });
    child.once("error", reject);
  });
}

describe("bundled theme packaging", () => {
  it("Built CLI resolves a complete sibling bundled-theme tree before serving the registry", async () => {
    const runDir = mkdtempSync(path.join(os.tmpdir(), "television-theme-resolution-"));
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-theme-resolution-storage-"));
    const cliEntry = path.join(runDir, "cli.cjs");
    cpSync(BUILT_CLI, cliEntry);
    const siblingThemes = path.join(runDir, "themes");
    const authoredThemes = path.join(REPO_ROOT, "packages/server/assets/themes");
    cpSync(authoredThemes, siblingThemes, { recursive: true });
    const distinctiveAsset = path.join(siblingThemes, "clouds", "resolver-proof.txt");
    writeFileSync(distinctiveAsset, "sibling resolver proof\n");

    const child = spawnServe(cliEntry, storagePath);
    try {
      const baseURL = await waitForURL(child.child as ServeChild);
      const response = await fetch(new URL("/themes", baseURL));
      expect(response.status).toBe(200);
      const themeIDs = readdirSync(siblingThemes, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "en"));
      const expectedThemes = themeIDs.map((id) => ({
        id,
        ...JSON.parse(readFileSync(path.join(siblingThemes, id, "manifest.json"), "utf8")),
      })).sort((left, right) =>
        left.name.localeCompare(right.name, "en") || left.id.localeCompare(right.id, "en")
      );
      expect(await response.json()).toEqual({ themes: expectedThemes, errors: [] });

      for (const themeID of themeIDs) {
        const sourcePath = path.join(siblingThemes, themeID);
        const installedPath = path.join(storagePath, "themes", themeID);
        expect(filesUnder(installedPath)).toEqual(filesUnder(sourcePath));
        for (const relative of filesUnder(sourcePath)) {
          expect(readFileSync(path.join(installedPath, relative)).equals(
            readFileSync(path.join(sourcePath, relative)),
          ), `${installedPath}/${relative}`).toBe(true);
        }
      }
      expect(readFileSync(path.join(storagePath, "themes", "clouds", "resolver-proof.txt"), "utf8"))
        .toBe("sibling resolver proof\n");
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "bundled-themes.json"), "utf8"))).toEqual({
        version: 2,
        installedThemeIDs: themeIDs,
        initialThemeSelectionComplete: true,
      });
    } finally {
      const cleanup = await child.dispose();
      rmSync(runDir, { recursive: true, force: true });
      rmSync(storagePath, { recursive: true, force: true });
      if (cleanup.outcome === "survived") throw new Error(`Theme packaging server ${child.pid} survived cleanup`);
    }
  }, START_TIMEOUT_MS * 2);

  it("Built CLI installs every packaged theme and initially selects Clouds", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-packaged-clouds-storage-"));
    const child = spawnServe(BUILT_CLI, storagePath);
    try {
      const baseURL = await waitForURL(child.child as ServeChild);
      const registry = await fetch(new URL("/themes", baseURL));
      expect(registry.status).toBe(200);
      const themesRoot = path.join(REPO_ROOT, "packages/server/assets/themes");
      const inventory: { id: string; minimumVersion: string }[] = parse(readFileSync(path.join(REPO_ROOT, "specs/ui/themes/bundled.yml"), "utf8"));
      const themeIDs = inventory.map(({ id }) => id);
      themeIDs.sort((left, right) => left.localeCompare(right, "en"));
      const registryBody = await registry.json();
      expect(registryBody.errors).toEqual([]);
      expect(registryBody.themes).toEqual(themeIDs.map(id => ({
        id,
        ...JSON.parse(readFileSync(path.join(themesRoot, id, "manifest.json"), "utf8")),
      })).sort((left, right) => left.name.localeCompare(right.name, "en")));

      const display = await fetch(new URL("/display", baseURL));
      expect(display.status).toBe(200);
      expect(await display.json()).toMatchObject({ activeThemeName: "clouds" });
      for (const relative of ["theme.css", "wallpaper.webp"]) {
        const served = await fetch(new URL(`/theme/${relative}`, baseURL));
        expect(served.status).toBe(200);
        expect(Buffer.from(await served.arrayBuffer()).equals(
          readFileSync(path.join(themesRoot, "clouds", relative)),
        ), `/theme/${relative}`).toBe(true);
      }

      for (const themeID of themeIDs) {
        const source = path.join(themesRoot, themeID);
        const copies = [
          path.join(REPO_ROOT, "packages/server/dist/themes", themeID),
          path.join(REPO_ROOT, "packages/cli/dist/themes", themeID),
          path.join(storagePath, "themes", themeID),
        ];
        const sourceFiles = filesUnder(source);
        for (const copy of copies) {
          expect(filesUnder(copy)).toEqual(sourceFiles);
          for (const relative of sourceFiles) {
            const copiedBytes = readFileSync(path.join(copy, relative));
            const sourceBytes = readFileSync(path.join(source, relative));
            expect(copiedBytes.equals(sourceBytes), `${copy}/${relative}`).toBe(true);
          }
        }
      }
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "bundled-themes.json"), "utf8"))).toEqual({
        version: 2,
        installedThemeIDs: themeIDs,
        initialThemeSelectionComplete: true,
      });
    } finally {
      const cleanup = await child.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      if (cleanup.outcome === "survived") throw new Error(`Clouds packaging server ${child.pid} survived cleanup`);
    }
  }, START_TIMEOUT_MS * 2);

  it("Built CLI backs up and replaces a below-minimum packaged Clouds theme", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-packaged-clouds-upgrade-"));
    const themesPath = path.join(storagePath, "themes");
    const cloudsPath = path.join(themesPath, "clouds");
    mkdirSync(path.join(cloudsPath, "wallpapers"), { recursive: true });
    writeFileSync(path.join(cloudsPath, "manifest.json"), `${JSON.stringify({
      name: "Clouds",
      version: "1.99.0",
      colorScheme: "light dark",
      authoredForAppVersion: "1.3.1",
    }, null, 2)}\n`);
    writeFileSync(path.join(cloudsPath, "theme.css"), "/* prior Clouds */\n");
    writeFileSync(path.join(cloudsPath, "wallpapers", "prior.txt"), "prior wallpaper asset\n");
    writeFileSync(path.join(cloudsPath, "extra.txt"), "prior extra file\n");
    const priorFiles = filesUnder(cloudsPath);
    const priorBytes = new Map(priorFiles.map((relative) => [relative, readFileSync(path.join(cloudsPath, relative))]));
    mkdirSync(path.join(storagePath, "state"), { recursive: true });
    writeFileSync(path.join(storagePath, "state", "bundled-themes.json"), `${JSON.stringify({
      version: 2,
      installedThemeIDs: ["clouds"],
      initialThemeSelectionComplete: true,
    }, null, 2)}\n`);
    writeFileSync(path.join(storagePath, "state", "display.json"), JSON.stringify({
      focusedChannelId: null,
      pinnedChannelIds: [],
      activeThemeName: "clouds",
      appearanceMode: "system",
      themeJavaScriptConsentIds: ["clouds", "private-theme"],
    }, null, 2));

    const child = spawnServe(BUILT_CLI, storagePath);
    try {
      const baseURL = await waitForURL(child.child as ServeChild);
      const packagedClouds = path.join(REPO_ROOT, "packages/cli/dist/themes/clouds");
      expect(filesUnder(cloudsPath)).toEqual(filesUnder(packagedClouds));
      for (const relative of filesUnder(packagedClouds)) {
        expect(readFileSync(path.join(cloudsPath, relative)).equals(
          readFileSync(path.join(packagedClouds, relative)),
        ), `${cloudsPath}/${relative}`).toBe(true);
      }
      expect(JSON.parse(readFileSync(path.join(cloudsPath, "manifest.json"), "utf8"))).toMatchObject({
        version: "2.1.0",
        colorScheme: "light dark",
        authoredForAppVersion: "1.3.1",
      });
      expect(filesUnder(cloudsPath)).not.toContain("extra.txt");

      const backupNames = readdirSync(themesPath)
        .filter((name) => /^\.clouds\.backup\.\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(name));
      expect(backupNames).toHaveLength(1);
      const backupPath = path.join(themesPath, backupNames[0]!);
      expect(filesUnder(backupPath)).toEqual(priorFiles);
      for (const [relative, bytes] of priorBytes) {
        expect(readFileSync(path.join(backupPath, relative)).equals(bytes), `${backupPath}/${relative}`).toBe(true);
      }

      const registry = await fetch(new URL("/themes", baseURL));
      const registryBody = await registry.json();
      expect(registryBody.errors).toEqual([]);
      expect(registryBody.themes.some(({ id }: { id: string }) => id.startsWith("."))).toBe(false);
      const display = await fetch(new URL("/display", baseURL));
      expect(await display.json()).toMatchObject({
        activeThemeName: "clouds",
        themeJavaScriptConsentIds: ["clouds", "private-theme"],
      });
    } finally {
      const cleanup = await child.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      if (cleanup.outcome === "survived") throw new Error(`Clouds upgrade server ${child.pid} survived cleanup`);
    }
  }, START_TIMEOUT_MS * 2);
});
