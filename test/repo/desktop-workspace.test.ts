import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const exactVersion = /^\d+\.\d+\.\d+$/;

type Manifest = {
  private?: boolean;
  bin?: unknown;
  files?: unknown;
  engines?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("desktop workspace", () => {
  // proofs/arch/desktop/distribution.md#^desktop-dist-t-workspace
  test("is private and declares the packages ToDesktop installs at exact versions", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "packages/desktop/package.json"), "utf8")) as Manifest;

    expect(manifest.private).toBe(true);
    expect(manifest).not.toHaveProperty("bin");
    expect(manifest).not.toHaveProperty("files");
    expect(manifest).not.toHaveProperty("engines");

    const dependencies = manifest.dependencies ?? {};
    expect(Object.keys(dependencies)).toContain("@todesktop/runtime");
    for (const [name, version] of Object.entries(dependencies)) {
      expect(version, name).toMatch(exactVersion);
    }
    expect(manifest.devDependencies?.["@todesktop/cli"]).toMatch(exactVersion);
  });
});
