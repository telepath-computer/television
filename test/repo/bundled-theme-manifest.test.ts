import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { generateBundledThemes } from "../../scripts/bundled-theme-manifest.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-theme-manifest-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// ^bundled-t-manifest-generation: real YAML and output files; no mocks.
describe("bundled theme manifest generation", () => {
  test("the committed runtime module matches the authoritative inventory", () => {
    const outputPath = path.join(tempRoot(), "bundled-theme-ids.ts");
    generateBundledThemes({ outputPath });
    expect(readFileSync(outputPath, "utf8")).toBe(readFileSync(path.join(repoRoot, "packages/server/src/bundled-theme-ids.ts"), "utf8"));
  });

  test("changed inventory membership, order, and minimum versions reach runtime data", () => {
    const root = tempRoot();
    const fixtureManifest = path.join(root, "bundled.yml");
    const outputPath = path.join(root, "bundled-theme-ids.ts");
    writeFileSync(fixtureManifest, "- id: swiss\n  minimumVersion: 3.0.0\n- id: clouds\n  minimumVersion: 4.0.0\n");
    generateBundledThemes({ manifestPath: fixtureManifest, outputPath });
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "import { BUNDLED_THEMES, BUNDLED_THEME_IDS } from './bundled-theme-ids.ts'; console.log(JSON.stringify({ themes: BUNDLED_THEMES, ids: BUNDLED_THEME_IDS }));"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ themes: [{ id: "swiss", minimumVersion: "3.0.0" }, { id: "clouds", minimumVersion: "4.0.0" }], ids: ["swiss", "clouds"] });
  });
});
