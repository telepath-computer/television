import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

// Packaging contracts for the onboarding content tree
// (proofs/arch/cli/index.md#^t-valid-tree-ships and #^t-resolution, plus the
// broken-tree half of specs/arch/onboarding/content.md#^build-validation).
// This file runs on the e2e:node
// surface, whose preCommand runs the full package build — so dist/ here is
// always fresh, never stale.

const REPO_ROOT = path.resolve(process.cwd());
const ASSETS_TREE = path.join(REPO_ROOT, "packages/server/assets/onboarding-channels");
const SERVER_DIST_TREE = path.join(REPO_ROOT, "packages/server/dist/onboarding");
const CLI_DIST_TREE = path.join(REPO_ROOT, "packages/cli/dist/onboarding");
const BUILT_CLI = path.join(REPO_ROOT, "packages/cli/dist/cli.cjs");
const VALIDATION_SCRIPT = path.join(REPO_ROOT, "packages/server/scripts/validate-onboarding.mjs");
const START_TIMEOUT_MS = 30_000;

function listFilesRecursive(root: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, entry);
    if (statSync(path.join(root, relative)).isDirectory()) {
      files.push(...listFilesRecursive(root, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

describe("onboarding packaging", () => {
  it("Production onboarding tree ships byte-identical in server and CLI dist", () => {
    for (const packaged of [SERVER_DIST_TREE, CLI_DIST_TREE]) {
      expect(existsSync(packaged), packaged).toBe(true);
      const sourceFiles = listFilesRecursive(ASSETS_TREE);
      expect(listFilesRecursive(packaged), packaged).toEqual(sourceFiles);
      for (const file of sourceFiles) {
        const sourceBytes = readFileSync(path.join(ASSETS_TREE, file));
        const packagedBytes = readFileSync(path.join(packaged, file));
        expect(packagedBytes.equals(sourceBytes), `${packaged}/${file}`).toBe(true);
      }
    }
  });

  it("Built CLI resolves onboarding sibling directory", async () => {
    // The seam crossing: a built binary beside an `./onboarding`
    // sibling. The fixture content is distinct from the production bundle, so
    // installing it proves the sibling (not a dev fallback) was resolved.
    const runDir = mkdtempSync(path.join(os.tmpdir(), "television-onboarding-resolution-"));
    const cliEntry = path.join(runDir, "cli.cjs");
    cpSync(BUILT_CLI, cliEntry);
    cpSync(path.join(REPO_ROOT, "test/node/fixtures/onboarding-bundles/resolution"), path.join(runDir, "onboarding"), { recursive: true });
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-onboarding-resolution-storage-"));

    const child = spawnServe(cliEntry, storagePath);
    try {
      const port = await waitForPort(child.child as ServeChild);
      const { channels } = runCLIJSON(cliEntry, ["list-channels"], storagePath, port);
      expect(channels).toHaveLength(1);
      expect(channels[0].name).toBe("Sibling Proof");
      expect(channels[0].onboarding).toEqual({ slug: "sibling-proof" });
    } finally {
      await stopServe(child);
    }
  }, START_TIMEOUT_MS * 2);

  it("Broken onboarding tree fails the real build validation step with a non-zero exit", () => {
    // Invoke the validation step exactly as packages/server/scripts/build.sh
    // does (which runs under `set -euo pipefail`, so a non-zero exit fails
    // the build).
    const broken = mkdtempSync(path.join(os.tmpdir(), "television-broken-onboarding-"));
    mkdirSync(path.join(broken, "one"));
    writeFileSync(path.join(broken, "onboarding-channels.json"), JSON.stringify({
      version: 3,
      focusChannel: "one",
      channels: [{
        slug: "one",
        name: "One",
        artifacts: [{ slug: "a", title: "A" }],
      }],
    }));
    writeFileSync(path.join(broken, "one", "a.html"), "<!doctype html>a");
    writeFileSync(path.join(broken, "one", "orphan.html"), "<!doctype html>orphan");

    const failing = spawnSync(process.execPath, [VALIDATION_SCRIPT, broken], { encoding: "utf8" });
    expect(failing.status).not.toBe(0);
    expect(failing.stderr).toContain("unreferenced");

    const passing = spawnSync(process.execPath, [VALIDATION_SCRIPT, ASSETS_TREE], { encoding: "utf8" });
    expect(passing.status, passing.stderr).toBe(0);
  });
});

type ServeChild = ChildProcessByStdio<null, Readable, Readable>;

function serveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "" };
  delete env.TELEVISION_ACP_AGENT;
  return env;
}

function spawnServe(cliEntry: string, storagePath: string): OwnedProcess {
  writeHomeConfig(storagePath, { port: 0, auth: false });
  return spawnOwnedProcess(process.execPath, [cliEntry, "--home", storagePath, "serve"], {
    cwd: path.dirname(cliEntry),
    env: serveEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCLIJSON(cliEntry: string, args: string[], storagePath: string, port: number): any {
  const stdout = execFileSync(process.execPath, [cliEntry, "--home", storagePath, ...args, "--port", String(port)], {
    cwd: path.dirname(cliEntry),
    env: serveEnv(),
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

async function waitForPort(child: ServeChild): Promise<number> {
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for tv serve startup. stderr:\n${stderr}`));
    }, START_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const url = stdout.match(/https?:\/\/[^\s]+/)?.[0];
      if (url) {
        clearTimeout(timeout);
        resolve(Number.parseInt(new URL(url).port, 10));
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`tv serve exited before startup (code ${code}, signal ${signal}). stdout:\n${stdout}\nstderr:\n${stderr}`));
    });
    child.once("error", reject);
  });
}

async function stopServe(child: OwnedProcess): Promise<void> {
  const cleanup = await child.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Onboarding packaging server ${child.pid} survived cleanup`);
}
