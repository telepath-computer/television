import { createRequire } from "node:module";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { spawnOwnedProcess, disposeAllOwnedProcesses } from "../helpers/owned-process.js";
import { startSurfaceServices } from "../../scripts/test/surface-services.mjs";

const require = createRequire(import.meta.url);
const playwrightCLI = require.resolve("@playwright/test/cli");
const fixtureDir = path.resolve("test/runner-fixtures/dynamic-services");
const firstService = {
  id: "first",
  kind: "vite" as const,
  config: "test/runner-fixtures/dynamic-services/first.vite.config.ts",
  publishUrlEnv: "TV_DYNAMIC_FIRST_URL",
};
const secondService = {
  id: "second",
  kind: "vite" as const,
  config: "test/runner-fixtures/dynamic-services/second.vite.config.ts",
  publishUrlEnv: "TV_DYNAMIC_SECOND_URL",
};

const originalFirst = process.env.TV_DYNAMIC_FIRST_URL;
const originalSecond = process.env.TV_DYNAMIC_SECOND_URL;
const originalFailureReport = process.env.TV_DYNAMIC_FAILURE_REPORT;

afterEach(async () => {
  await disposeAllOwnedProcesses();
  restore("TV_DYNAMIC_FIRST_URL", originalFirst);
  restore("TV_DYNAMIC_SECOND_URL", originalSecond);
  restore("TV_DYNAMIC_FAILURE_REPORT", originalFailureReport);
});

describe("registry-declared Vite services", () => {
  test("publishes ordered URLs to a real Playwright child and releases both ports", async () => {
    process.env.TV_DYNAMIC_FIRST_URL = "parent-first";
    delete process.env.TV_DYNAMIC_SECOND_URL;
    const running = await startSurfaceServices([firstService, secondService]);
    const ports = running.services.map((service) => new URL(service.url).port);
    expect(new Set(ports).size).toBe(2);
    expect(running.env.TV_DYNAMIC_FIRST_URL).toBe(running.services[0].url);
    expect(running.env.TV_DYNAMIC_SECOND_URL).toBe(running.services[1].url);

    try {
      const owned = spawnOwnedProcess(process.execPath, [
        playwrightCLI,
        "test",
        "--config",
        path.join(fixtureDir, "playwright.config.ts"),
        "--reporter=line",
      ], { env: running.env, stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      owned.child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      owned.child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      const [exitCode, signal] = await waitForExit(owned.child, 45_000);
      await owned.dispose();
      expect({ exitCode, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }).toMatchObject({ exitCode: 0, signal: null });
    } finally {
      await running.stop();
    }

    expect(process.env.TV_DYNAMIC_FIRST_URL).toBe("parent-first");
    expect(process.env.TV_DYNAMIC_SECOND_URL).toBeUndefined();
    for (const port of ports) await expectPortCanRebind(Number(port));
  }, 60_000);

  test("closes earlier services and restores parent values when a later config fails", async () => {
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-dynamic-services-"));
    const reportPath = path.join(reportDir, "first-url.txt");
    process.env.TV_DYNAMIC_FIRST_URL = "parent-first";
    process.env.TV_DYNAMIC_SECOND_URL = "parent-second";
    process.env.TV_DYNAMIC_FAILURE_REPORT = reportPath;

    await expect(startSurfaceServices([firstService, {
      id: "failure",
      kind: "vite",
      config: "test/runner-fixtures/dynamic-services/failing.vite.config.ts",
      publishUrlEnv: "TV_DYNAMIC_SECOND_URL",
    }])).rejects.toThrow("intentional later-service config failure");

    expect(process.env.TV_DYNAMIC_FIRST_URL).toBe("parent-first");
    expect(process.env.TV_DYNAMIC_SECOND_URL).toBe("parent-second");
    const failedFirstURL = fs.readFileSync(reportPath, "utf8").trim();
    await expectPortCanRebind(Number(new URL(failedFirstURL).port));
  }, 30_000);
});

async function waitForExit(child: import("node:child_process").ChildProcess, timeoutMs: number): Promise<[number | null, NodeJS.Signals | null]> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Playwright service fixture timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function expectPortCanRebind(port: number): Promise<void> {
  const server = net.createServer();
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
