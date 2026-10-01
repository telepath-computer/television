import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkToolchain } from "../../scripts/check-toolchain.mjs";
import { runPreflights } from "../../scripts/test/preflight.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ["scripts/test/cli.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    timeout: 10_000,
  });
}

function fakeNpmBin(version: string): string {
  const bin = mkdtempSync(path.join(os.tmpdir(), "tv-toolchain-npm-"));
  const fakeNpm = path.join(bin, "npm");
  writeFileSync(fakeNpm, `#!/bin/sh\nprintf '${version}\\n'\n`, "utf8");
  chmodSync(fakeNpm, 0o755);
  return bin;
}

describe("repository toolchain declarations", () => {
  test("selects Node 24 and wires the shared checker into install and preflight", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      engines?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(readFileSync(path.join(repoRoot, ".nvmrc"), "utf8")).toBe("24\n");
    expect(manifest.engines).toEqual({ node: "24.x", npm: ">=11.5 <12" });
    expect(manifest.scripts?.["toolchain:check"]).toBe("node scripts/check-toolchain.mjs");
    expect(manifest.scripts?.preinstall).toBe("npm run toolchain:check");
  });

  test("the install hook's checker process exits nonzero with its single diagnostic", () => {
    const bin = fakeNpmBin("10.9.4");
    const result = spawnSync(process.execPath, ["scripts/check-toolchain.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });

    expect(result.status).toBe(1);
    expect(result.stderr.match(/Unsupported Television toolchain/g)).toHaveLength(1);
    expect(result.stderr).toContain("Node 24.x and npm >=11.5 <12");
    expect(result.stderr).toContain("npm 10.9.4");
  });
});

describe("published Node boundary declarations", () => {
  // proofs/arch/node-versions.md#^node-versions-t-declarations
  test("keeps the published consumer floor advisory while emitting Node 18-compatible syntax", () => {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    const cliManifest = JSON.parse(readFileSync(path.join(repoRoot, "packages/cli/package.json"), "utf8")) as {
      engines?: Record<string, string>;
    };
    const cliBuild = readFileSync(path.join(repoRoot, "packages/cli/build.mjs"), "utf8");
    const desktopBuild = readFileSync(path.join(repoRoot, "packages/desktop/build.mjs"), "utf8");
    const targetsFor = (source: string, platform: "node" | "browser") =>
      [...source.matchAll(new RegExp(`platform: "${platform}",\\s+target: "([^"]+)"`, "g"))].map((match) => match[1]);

    expect(cliManifest.engines?.node).toBe(">=22.12.0");
    expect(targetsFor(cliBuild, "node")).toEqual(["node18"]);
    expect(targetsFor(desktopBuild, "node")).toEqual(["node18", "node18", "node18"]);
    expect(targetsFor(desktopBuild, "browser")).toEqual(["es2022"]);
    expect(rootManifest.devDependencies?.["@types/node"]).toMatch(/^22\./);
  });
});

describe("toolchain checker", () => {
  test.each([
    ["24.0.0", "11.5.0"],
    ["v24.19.0", "11.17.0"],
    ["24.99.99", "11.99.99"],
  ])("accepts Node %s with npm %s", (nodeVersion, npmVersion) => {
    expect(checkToolchain({ root: repoRoot, nodeVersion, npmVersion })).toMatchObject({
      ok: true,
      nodeVersion,
      npmVersion,
    });
  });

  test.each([
    ["23.99.0", "11.5.0"],
    ["25.0.0", "11.5.0"],
    ["24.0.0", "11.4.9"],
    ["24.0.0", "12.0.0"],
  ])("rejects Node %s with npm %s", (nodeVersion, npmVersion) => {
    expect(checkToolchain({ root: repoRoot, nodeVersion, npmVersion }).ok).toBe(false);
  });

  test("reads the selector and engine ranges instead of carrying version constants", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-toolchain-policy-"));
    writeFileSync(path.join(root, ".nvmrc"), "25\n", "utf8");
    writeFileSync(path.join(root, "package.json"), '{"engines":{"node":"25.x","npm":">=12.1 <13"}}\n', "utf8");

    expect(checkToolchain({ root, nodeVersion: "25.2.0", npmVersion: "12.1.0" }).ok).toBe(true);
    expect(checkToolchain({ root, nodeVersion: "24.9.0", npmVersion: "12.1.0" }).ok).toBe(false);
  });

  test("reports declaration disagreement instead of recommending a runtime switch", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-toolchain-policy-mismatch-"));
    writeFileSync(path.join(root, ".nvmrc"), "25\n", "utf8");
    writeFileSync(path.join(root, "package.json"), '{"engines":{"node":"24.x","npm":">=11.5 <12"}}\n', "utf8");

    const result = checkToolchain({ root, nodeVersion: "v24.19.0", npmVersion: "11.17.0" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("toolchain declarations disagree");
    expect(result.message).toContain(".nvmrc selects Node 25");
    expect(result.message).toContain("engines.node requires 24.x");
    expect(result.message).toContain("found Node v24.19.0 and npm 11.17.0");
    expect(result.message).not.toContain("nvm use");
    expect(result.message?.split("\n")).toHaveLength(1);
  });

  test("uses one diagnostic containing expected and actual versions plus .nvmrc guidance", () => {
    const result = checkToolchain({ root: repoRoot, nodeVersion: "22.18.0", npmVersion: "10.9.4" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Node 24.x and npm >=11.5 <12");
    expect(result.message).toContain("Node 22.18.0 and npm 10.9.4");
    expect(result.message).toContain(".nvmrc");
    expect(result.message?.split("\n")).toHaveLength(1);
  });
});

describe("canonical node preflight", () => {
  test("keeps the node identity and reports both selected versions", () => {
    expect(runPreflights(["node"], { provider: "local" })).toEqual([
      expect.objectContaining({
        name: "node",
        status: "passed",
        version: process.version,
        npmVersion: expect.stringMatching(/^11\./),
      }),
    ]);
  });

  test("stops before a selected test when the toolchain is unsupported", () => {
    const fixture = fakeNpmBin("10.9.4");
    const sentinel = path.join(fixture, "selected-test-ran");

    const result = runCli(
      ["local", "--file", "test/repo/node-toolchain.test.ts", "--grep", "writes the selected-test sentinel", "--no-publish"],
      {
        PATH: `${fixture}:${process.env.PATH ?? ""}`,
        TV_TOOLCHAIN_SELECTED_TEST_SENTINEL: sentinel,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr.match(/Unsupported Television toolchain/g)).toHaveLength(1);
    expect(result.stderr).toContain("Node 24.x and npm >=11.5 <12");
    expect(result.stderr).toContain("npm 10.9.4");
    expect(existsSync(sentinel)).toBe(false);
  });

  test("writes the selected-test sentinel", () => {
    const sentinel = process.env.TV_TOOLCHAIN_SELECTED_TEST_SENTINEL;
    if (sentinel) writeFileSync(sentinel, "ran\n", "utf8");
    expect(true).toBe(true);
  });
});
