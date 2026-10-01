import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { DAEMON_TEST_HOST_ENV, POSTHOG_TEST_READ_KEY_ENV, readPostHogTestReadKey, requiredPreflights, runPreflights } from "../../scripts/test/preflight.mjs";

describe("test runner preflight selection", () => {
  test("uses surface preflights only for local runs", () => {
    const surfaces = [{
      preflight: [
        "electron",
        "playwright-chromium",
        "playwright-firefox",
        "posthog-test-key",
      ],
    }];

    expect(requiredPreflights(surfaces, "local")).toEqual([
      "node",
      "process-lifecycle",
      "electron",
      "playwright-chromium",
      "playwright-firefox",
      "posthog-test-key",
    ]);
    expect(requiredPreflights(surfaces, "blaxel")).toEqual(["node", "blaxel-github-token", "blaxel-auth"]);
  });

  test("checks Electron package presence and consumes every planner state without installing", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-electron-preflight-"));
    writeFileSync(path.join(root, "package.json"), "{}\n");
    const absent = electronPlan({ state: "absent" });

    expect(runPreflights(["electron"], { provider: "local", electron: { root, plan: absent } })).toEqual([
      expect.objectContaining({ name: "electron", status: "failed", message: expect.stringContaining("package") }),
    ]);

    const packageRoot = path.join(root, "node_modules", "electron");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, "package.json"), '{"name":"electron","version":"fixture"}\n');

    for (const runtime of [
      { state: "absent" } as const,
      { state: "valid", executablePath: path.join(packageRoot, "dist", "electron") } as const,
    ]) {
      expect(runPreflights(["electron"], {
        provider: "local",
        electron: { root, plan: electronPlan(runtime) },
      })).toEqual([expect.objectContaining({ name: "electron", status: "passed", runtimeState: runtime.state })]);
    }

    const invalid = electronPlan({ state: "invalid", reason: "partial runtime" });
    invalid.failures.push(["Electron runtime is invalid: partial runtime"]);
    expect(runPreflights(["electron"], { provider: "local", electron: { root, plan: invalid } })).toEqual([
      expect.objectContaining({ name: "electron", status: "failed", runtimeState: "invalid" }),
    ]);
  });

  test("skips Electron preflight only through the documented environment switch", () => {
    const previous = process.env.SKIP_ELECTRON_E2E;
    try {
      process.env.SKIP_ELECTRON_E2E = "1";
      expect(runPreflights(["electron"], { provider: "local" })).toEqual([
        expect.objectContaining({ name: "electron", status: "passed", skipped: true }),
      ]);
    } finally {
      if (previous === undefined) delete process.env.SKIP_ELECTRON_E2E;
      else process.env.SKIP_ELECTRON_E2E = previous;
    }
  });

  test("hands the real installed Electron package to the shared planner without mutation", () => {
    const packageRoot = path.dirname(createRequire(import.meta.url).resolve("electron/package.json"));
    const before = treeSnapshot(packageRoot);
    const results = runPreflights(["electron"], { provider: "local" });

    expect(results).toEqual([
      expect.objectContaining({
        name: "electron",
        status: "passed",
        runtimeState: expect.stringMatching(/^(absent|valid)$/),
      }),
    ]);
    expect(treeSnapshot(packageRoot)).toEqual(before);
  });

  test("requires explicit host acknowledgement for daemon acceptance", () => {
    const previous = process.env[DAEMON_TEST_HOST_ENV];
    try {
      delete process.env[DAEMON_TEST_HOST_ENV];
      expect(runPreflights(["daemon-test-host"], { provider: "local" })).toEqual([
        expect.objectContaining({
          name: "daemon-test-host",
          status: "failed",
          message: expect.stringContaining(`${DAEMON_TEST_HOST_ENV}=1`),
        }),
      ]);

      process.env[DAEMON_TEST_HOST_ENV] = "1";
      expect(runPreflights(["daemon-test-host"], { provider: "local" })).toEqual([
        expect.objectContaining({
          name: "daemon-test-host",
          status: "passed",
          envVar: DAEMON_TEST_HOST_ENV,
        }),
      ]);
    } finally {
      if (previous === undefined) delete process.env[DAEMON_TEST_HOST_ENV];
      else process.env[DAEMON_TEST_HOST_ENV] = previous;
    }
  });

  test("prepares the Linux inspection backend in the Blaxel worker setup", () => {
    const worker = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");

    expect(worker).toContain("command -v python3");
    expect(worker).toContain("command -v ss");
    expect(worker).toContain("python3 xauth libgtk-3-0 libxtst6 iproute2");
    expect(worker).not.toContain("psmisc");
    expect(worker).not.toContain("fuser");
  });

  test("attributes a real disposable child and listener through the execution host backend", () => {
    const results = runPreflights(["process-lifecycle"], { provider: "local" });

    expect(results).toEqual([
      expect.objectContaining({
        name: "process-lifecycle",
        status: "passed",
        backend: process.platform === "linux" ? "linux-procfs-ss" : "macos-ps-lsof",
        attributedProcessCount: 1,
        attributedListenerCount: 1,
        finalOwnerCount: 0,
      }),
    ]);
  }, 15_000);

  test("finds the PostHog test read key from env or repo-root .env", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-posthog-preflight-"));

    expect(readPostHogTestReadKey({ env: { [POSTHOG_TEST_READ_KEY_ENV]: " phx_env " }, root })).toEqual({
      value: "phx_env",
      source: POSTHOG_TEST_READ_KEY_ENV,
    });

    writeFileSync(path.join(root, ".env"), `${POSTHOG_TEST_READ_KEY_ENV}='phx_dotenv'\n`, "utf8");
    expect(readPostHogTestReadKey({ env: {}, root })).toEqual({ value: "phx_dotenv", source: ".env" });
  });

  test("reports no PostHog test read key when env and .env are absent", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-posthog-preflight-missing-"));
    mkdirSync(root, { recursive: true });

    expect(readPostHogTestReadKey({ env: {}, root })).toBeNull();
  });
});

function electronPlan(runtime: { state: "absent" } | { state: "valid"; executablePath: string } | { state: "invalid"; reason: string }) {
  return {
    failures: [] as string[][],
    notes: [] as string[],
    runtime,
    useXvfb: false,
    disableSandbox: false,
    platform: "fixture",
  };
}

function treeSnapshot(root: string, relative = ""): Array<[string, string, number, number]> {
  if (!existsSync(root)) return [];
  const result: Array<[string, string, number, number]> = [];
  for (const entry of readdirSync(path.join(root, relative)).sort()) {
    const child = path.join(relative, entry);
    const stat = statSync(path.join(root, child));
    result.push([child, stat.isDirectory() ? "directory" : "file", stat.size, stat.mtimeMs]);
    if (stat.isDirectory()) result.push(...treeSnapshot(root, child));
  }
  return result;
}
