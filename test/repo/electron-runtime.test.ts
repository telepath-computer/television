import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readJSON(relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as Record<string, any>;
}

describe("Electron runtime declarations", () => {
  // proofs/arch/desktop/runtime.md#^desktop-t-runtime-declarations
  test("keeps both development declarations and the installed package on one exact version", () => {
    const rootManifest = readJSON("package.json");
    const desktopManifest = readJSON("packages/desktop/package.json");
    const installedManifest = readJSON("node_modules/electron/package.json");
    const lockfile = readJSON("package-lock.json");
    const target = rootManifest.devDependencies?.electron;

    expect(target).toBe("43.7.6");
    expect(desktopManifest.devDependencies?.electron).toBe(target);
    expect(desktopManifest.dependencies ?? {}).not.toHaveProperty("electron");
    expect(installedManifest.version).toBe(target);
    expect(lockfile.packages?.["node_modules/electron"]?.version).toBe(target);
    expect(lockfile.packages).not.toHaveProperty("node_modules/yauzl");
    expect(lockfile.packages).not.toHaveProperty("node_modules/fd-slicer");
  });
});
