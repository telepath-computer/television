import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  getElectronE2EInvocation,
  getElectronE2EPlan,
  inspectElectronRuntime,
  prepareElectronE2EEnv,
} from "../../scripts/electron-e2e-env.mjs";

const declaredElectronVersion = JSON.parse(
  await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../package.json", import.meta.url), "utf8")),
).devDependencies.electron as string;

function fixtureRoot(packageVersion = declaredElectronVersion): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-electron-env-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { electron: declaredElectronVersion } }));
  const electronRoot = path.join(root, "node_modules", "electron");
  mkdirSync(electronRoot, { recursive: true });
  writeFileSync(path.join(electronRoot, "package.json"), JSON.stringify({ name: "electron", version: packageVersion }));
  return root;
}

function writeValidNativeRuntime(root: string, executable: "electron" | "electron.exe"): string {
  const electronRoot = path.join(root, "node_modules", "electron");
  const executablePath = path.join(electronRoot, "dist", executable);
  mkdirSync(path.dirname(executablePath), { recursive: true });
  writeFileSync(path.join(electronRoot, "dist", "version"), declaredElectronVersion);
  writeFileSync(path.join(electronRoot, "path.txt"), executable);
  writeFileSync(executablePath, "fixture executable");
  chmodSync(executablePath, 0o755);
  return executablePath;
}

function writeValidLinuxRuntime(root: string): string {
  return writeValidNativeRuntime(root, "electron");
}

function writeValidMacRuntime(root: string, branded: boolean): string {
  const electronRoot = path.join(root, "node_modules", "electron");
  const bundle = branded ? "Television.app" : "Electron.app";
  const executable = branded ? "Television" : "Electron";
  const recordedPath = `${bundle}/Contents/MacOS/${executable}`;
  const contents = path.join(electronRoot, "dist", bundle, "Contents");
  const executablePath = path.join(electronRoot, "dist", recordedPath);
  mkdirSync(path.dirname(executablePath), { recursive: true });
  mkdirSync(path.join(contents, "Frameworks"), { recursive: true });
  writeFileSync(path.join(electronRoot, "dist", "version"), declaredElectronVersion);
  writeFileSync(path.join(electronRoot, "path.txt"), recordedPath);
  writeFileSync(executablePath, "fixture executable");
  chmodSync(executablePath, 0o755);
  writeFileSync(path.join(contents, "Info.plist"), "fixture plist");
  writeFileSync(path.join(contents, "Frameworks", "fixture"), "fixture framework");
  return executablePath;
}

function linuxOptions(root: string, overrides: Record<string, unknown> = {}) {
  return {
    root,
    platform: "linux" as const,
    release: "fixture",
    commandExists: () => true,
    inspectSandbox: () => ({ uid: 0, mode: 0o4755 }),
    ...overrides,
  };
}

describe("Electron runtime inspection", () => {
  test("distinguishes a missing package, absent runtime, and exact valid runtime", () => {
    const missingRoot = mkdtempSync(path.join(os.tmpdir(), "tv-electron-missing-"));
    writeFileSync(path.join(missingRoot, "package.json"), JSON.stringify({ devDependencies: { electron: declaredElectronVersion } }));
    expect(inspectElectronRuntime({ root: missingRoot, platform: "linux" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("package"),
    });

    const root = fixtureRoot();
    expect(inspectElectronRuntime({ root, platform: "linux" })).toEqual({ state: "absent" });
    mkdirSync(path.join(root, "node_modules", "electron", "dist"));
    expect(inspectElectronRuntime({ root, platform: "linux" })).toEqual({ state: "absent" });

    const executablePath = writeValidLinuxRuntime(root);
    expect(inspectElectronRuntime({ root, platform: "linux" })).toEqual({
      state: "valid",
      executablePath: realpathSync(executablePath),
    });
  });

  // proofs/arch/desktop/runtime.md#^desktop-t-runtime-validity
  test("accepts the exact upstream Mac layout and no Windows or branded Mac layout", () => {
    const upstreamMac = fixtureRoot();
    const upstreamExecutable = writeValidMacRuntime(upstreamMac, false);
    expect(inspectElectronRuntime({
      root: upstreamMac,
      platform: "darwin",
      readPlistValue: (_plist, key) => key === "CFBundleExecutable" ? "Electron" : "",
    })).toEqual({ state: "valid", executablePath: realpathSync(upstreamExecutable) });

    const windows = fixtureRoot();
    writeValidNativeRuntime(windows, "electron.exe");
    expect(inspectElectronRuntime({ root: windows, platform: "win32" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("no runtime layout"),
    });

    const brandedMac = fixtureRoot();
    writeValidMacRuntime(brandedMac, true);
    const brandedValues: Record<string, string> = {
      CFBundleName: "Television",
      CFBundleDisplayName: "Television",
      CFBundleExecutable: "Television",
      CFBundleIdentifier: "computer.telepath.television",
    };
    expect(inspectElectronRuntime({
      root: brandedMac,
      platform: "darwin",
      readPlistValue: (_plist, key) => brandedValues[key] ?? "",
    })).toMatchObject({ state: "invalid", reason: expect.stringContaining("path.txt") });
  });

  test("rejects each departure from the exact runtime predicate", () => {
    const distVersion = fixtureRoot();
    writeValidLinuxRuntime(distVersion);
    writeFileSync(path.join(distVersion, "node_modules", "electron", "dist", "version"), "0.0.0");
    expect(inspectElectronRuntime({ root: distVersion, platform: "linux" })).toMatchObject({ state: "invalid" });

    const versionDirectory = fixtureRoot();
    const versionElectronRoot = path.join(versionDirectory, "node_modules", "electron");
    mkdirSync(path.join(versionElectronRoot, "dist", "version"), { recursive: true });
    writeFileSync(path.join(versionElectronRoot, "path.txt"), "electron");
    expect(inspectElectronRuntime({ root: versionDirectory, platform: "linux" })).toMatchObject({ state: "invalid" });

    const pathDirectory = fixtureRoot();
    const pathElectronRoot = path.join(pathDirectory, "node_modules", "electron");
    mkdirSync(path.join(pathElectronRoot, "dist"), { recursive: true });
    writeFileSync(path.join(pathElectronRoot, "dist", "version"), declaredElectronVersion);
    mkdirSync(path.join(pathElectronRoot, "path.txt"));
    expect(inspectElectronRuntime({ root: pathDirectory, platform: "linux" })).toMatchObject({ state: "invalid" });

    const whitespace = fixtureRoot();
    writeValidLinuxRuntime(whitespace);
    writeFileSync(path.join(whitespace, "node_modules", "electron", "path.txt"), "electron\n");
    expect(inspectElectronRuntime({ root: whitespace, platform: "linux" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("path.txt"),
    });

    const notExecutable = fixtureRoot();
    chmodSync(writeValidLinuxRuntime(notExecutable), 0o644);
    expect(inspectElectronRuntime({ root: notExecutable, platform: "linux" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("executable"),
    });

    const plist = fixtureRoot();
    writeValidMacRuntime(plist, false);
    expect(inspectElectronRuntime({
      root: plist,
      platform: "darwin",
      readPlistValue: (_plist, key) => key === "CFBundleExecutable" ? "Television" : "",
    })).toMatchObject({ state: "invalid", reason: expect.stringContaining("CFBundleExecutable") });

    const frameworks = fixtureRoot();
    writeValidMacRuntime(frameworks, false);
    rmSync(path.join(frameworks, "node_modules", "electron", "dist", "Electron.app", "Contents", "Frameworks"), {
      recursive: true,
    });
    mkdirSync(path.join(frameworks, "node_modules", "electron", "dist", "Electron.app", "Contents", "Frameworks"));
    expect(inspectElectronRuntime({
      root: frameworks,
      platform: "darwin",
      readPlistValue: (_plist, key) => key === "CFBundleExecutable" ? "Electron" : "",
    })).toMatchObject({ state: "invalid", reason: expect.stringContaining("incomplete") });
  });

  test("rejects version mismatches, partial generated state, and unsupported platforms", () => {
    const mismatch = fixtureRoot("0.0.0");
    expect(inspectElectronRuntime({ root: mismatch, platform: "linux" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("version"),
    });

    const partial = fixtureRoot();
    const electronRoot = path.join(partial, "node_modules", "electron");
    mkdirSync(path.join(electronRoot, "dist"));
    writeFileSync(path.join(electronRoot, "dist", "partial"), "incomplete");
    expect(inspectElectronRuntime({ root: partial, platform: "linux" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("incomplete"),
    });

    const unsupported = fixtureRoot();
    writeValidLinuxRuntime(unsupported);
    expect(inspectElectronRuntime({ root: unsupported, platform: "freebsd" })).toMatchObject({
      state: "invalid",
      reason: expect.stringContaining("no runtime layout"),
    });
  });
});

describe("Electron e2e environment planning", () => {
  test("accepts an absent runtime without inspecting a missing sandbox helper", () => {
    const root = fixtureRoot();
    const inspectSandbox = vi.fn(() => ({ uid: 1000, mode: 0o755 }));
    const plan = getElectronE2EPlan({ DISPLAY: ":1" }, linuxOptions(root, { inspectSandbox }));

    expect(plan.failures).toEqual([]);
    expect(plan.runtime).toEqual({ state: "absent" });
    expect(plan.disableSandbox).toBe(false);
    expect(inspectSandbox).not.toHaveBeenCalled();
  });

  test("rejects an invalid runtime instead of treating it as absent", () => {
    const root = fixtureRoot();
    const electronRoot = path.join(root, "node_modules", "electron");
    writeFileSync(path.join(electronRoot, "path.txt"), "electron");

    const plan = getElectronE2EPlan({ DISPLAY: ":1" }, linuxOptions(root));
    expect(plan.runtime.state).toBe("invalid");
    expect(plan.failures.flat().join("\n")).toContain("invalid");
  });

  test("uses the real Linux sandbox when configured and disables it otherwise", () => {
    const root = fixtureRoot();
    writeValidLinuxRuntime(root);

    const configured = getElectronE2EPlan({ DISPLAY: ":1" }, linuxOptions(root));
    expect(configured.runtime.state).toBe("valid");
    expect(configured.disableSandbox).toBe(false);

    const ordinary = getElectronE2EPlan({ DISPLAY: ":1" }, linuxOptions(root, {
      inspectSandbox: () => ({ uid: 1000, mode: 0o755 }),
    }));
    expect(ordinary.disableSandbox).toBe(true);
    expect(ordinary.notes.join("\n")).toContain("ELECTRON_DISABLE_SANDBOX=1");

    const explicit = getElectronE2EPlan(
      { DISPLAY: ":1", ELECTRON_DISABLE_SANDBOX: "1" },
      linuxOptions(root, { inspectSandbox: () => { throw new Error("must not inspect"); } }),
    );
    expect(explicit.disableSandbox).toBe(true);
    expect(prepareElectronE2EEnv({ ELECTRON_DISABLE_SANDBOX: "1" }, explicit).ELECTRON_DISABLE_SANDBOX).toBe("1");
  });

  test("plans headless Linux through Xvfb or reports installation guidance", () => {
    const root = fixtureRoot();
    const available = getElectronE2EPlan({}, linuxOptions(root));
    expect(available.useXvfb).toBe(true);

    const missing = getElectronE2EPlan({}, linuxOptions(root, { commandExists: () => false }));
    expect(missing.failures.flat().join("\n")).toContain("xvfb-run");
  });

  test("wraps Playwright with Xvfb only when the plan requests it", () => {
    expect(getElectronE2EInvocation({ useXvfb: true }, ["smoke.test.ts"])).toEqual({
      command: "xvfb-run",
      args: ["-a", "npx", "playwright", "test", "--config=packages/desktop/playwright.config.ts", "smoke.test.ts"],
    });
    expect(getElectronE2EInvocation({ useXvfb: false })).toEqual({
      command: "npx",
      args: ["playwright", "test", "--config=packages/desktop/playwright.config.ts"],
    });
  });
});
