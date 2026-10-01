import { afterEach, describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { disposeAllOwnedProcesses, spawnOwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const REPO_ROOT = path.resolve(process.cwd());
const START_TIMEOUT_MS = 30_000;
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// Spec refs: [[product/cli.md#^c7f9f202|spawned serve]], [[arch/cli/index.md#^fd17f122|spawned serve]], [[arch/cli/index.md#^cli-acp-missing-command|missing ACP command]].

function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
  output: () => string,
): Promise<number | null> {
  return Promise.race([
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    }),
    new Promise<number | null>((_, reject) => {
      setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Timed out waiting for CLI to exit\n${output()}`));
      }, timeoutMs);
    }),
  ]);
}

function createChildEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITEST: "",
  };
  delete env.TELEVISION_ACP_AGENT;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }
    env[key] = value;
  }

  return env;
}

describe("server startup smoke", () => {
  const storageDirs: string[] = [];

  afterEach(async () => {
    await disposeAllOwnedProcesses();
    for (const dir of storageDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts via CLI serve and reports a health URL", async () => {
    // Use an isolated tempdir so the test never touches the user's real
    // ~/.television/ storage (which may contain legacy metadata that fails
    // the strict loader).
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-smoke-"));
    storageDirs.push(storagePath);

    writeHomeConfig(storagePath, { port: 0, auth: false });
    const owned = spawnOwnedProcess(process.execPath, [TSX_CLI, "packages/cli/src/index.ts", "--home", storagePath, "serve"], {
      cwd: REPO_ROOT,
      env: createChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const child = owned.child;

    let output = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const serverURL = await Promise.race([
      new Promise<string>((resolve, reject) => {
        const onData = (chunk: Buffer | string) => {
          output += chunk.toString();
          const match = output.match(/https?:\/\/[^\s\u001B]+/);
          if (match) {
            child.stdout?.off("data", onData);
            resolve(match[0]);
          }
        };

        child.stdout?.on("data", onData);
        child.once("exit", (code) => reject(new Error(`CLI exited early (${code})\n${output}`)));
      }),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for startup\n${output}`)), START_TIMEOUT_MS);
      }),
    ]);

    try {
      const healthResponse = await fetch(new URL("/health", serverURL));
      expect(healthResponse.ok).toBe(true);
    } finally {
      await owned.dispose();
    }
  }, START_TIMEOUT_MS);

  it("fails via CLI serve before startup when the ACP binary is missing from PATH", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-smoke-missing-binary-"));
    storageDirs.push(storagePath);
    const emptyBinDir = path.join(storagePath, "empty-bin");
    mkdirSync(emptyBinDir, { recursive: true });

    writeHomeConfig(storagePath, { port: 0, auth: false });
    const owned = spawnOwnedProcess(process.execPath, [TSX_CLI, "packages/cli/src/index.ts", "--home", storagePath, "serve"], {
      cwd: REPO_ROOT,
      env: createChildEnv({ PATH: emptyBinDir, TELEVISION_ACP_AGENT: "openclaw" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const child = owned.child;

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const exitCode = await waitForExit(child, START_TIMEOUT_MS, () => `${stdout}${stderr}`);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Could not find ACP agent command `openclaw` for `TELEVISION_ACP_AGENT=openclaw` on PATH.");
  }, START_TIMEOUT_MS);


});
