import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { ELECTRON_E2E_EXECUTABLE_PATH_ENV } from "../../../../scripts/electron-e2e-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
// The package DIRECTORY, matching how the built app starts (Electron resolves
// the app's package.json `main`): with a bare entry file Electron finds no app
// package.json and app.getVersion() degrades, diverging from production.
const DESKTOP_ENTRY = path.join(REPO_ROOT, "packages", "desktop");
const PUBLISHED_DESKTOP_URL = requiredDesktopE2EURL();
const DESKTOP_LAUNCH_PHASE_TIMEOUT_MS = 8_000;

export type DesktopE2EHostname = "127.0.0.1" | "localhost";

export function desktopE2EOrigin(hostname: DesktopE2EHostname = "127.0.0.1"): string {
  const url = new URL(PUBLISHED_DESKTOP_URL);
  url.hostname = hostname;
  return url.origin;
}

export function desktopE2EURL(
  pathname: string,
  options: { hostname?: DesktopE2EHostname } = {},
): string {
  return new URL(pathname, `${desktopE2EOrigin(options.hostname)}/`).href;
}

export interface LaunchDesktopOptions {
  /**
   * Fixture URL to load. Strings beginning with `/` are resolved against the
   * runner-published desktop Vite service; absolute URLs (`http://`, `file://`,
   * etc.) pass through unchanged. Mutually exclusive with `connectTo`.
   */
  fixture?: string;
  /**
   * Drive the real connect flow to this server instead of loading a fixture
   * page: the connection is seeded into an isolated user-data dir and the app
   * bootstraps into it, exercising preflight → `buildRemoteURL()` →
   * `loadURL()` against a real server.
   */
  connectTo?: { serverURL: string; token: string };
  /**
   * Optional caller-owned Electron profile directory. Pass the same directory
   * to consecutive launches when a test covers state across a real relaunch.
   */
  userDataDir?: string;
  /**
   * Environment overrides for the Electron main process, applied on top of
   * the inherited environment (which always carries TV_TEST_MODE=true). A
   * value of `undefined` removes the variable.
   */
  env?: Record<string, string | undefined>;
  /** Extra Electron command-line arguments, appended after the harness's own. */
  args?: readonly string[];
}

export interface LaunchConnectScreenOptions {
  /** Isolated Electron profile directory (connection.json lives here). */
  userDataDir: string;
  /** Environment overrides for the Electron main process. */
  env?: Record<string, string | undefined>;
  /** Extra Electron command-line arguments, appended after the harness's own. */
  args?: readonly string[];
}

/**
 * The update runtime's own simulation mode: a few seconds after launch it
 * reports a downloaded update with the version `<app version>-simulated`,
 * with no network or ToDesktop build (specs/arch/desktop/updates.md#Testing).
 */
export const SIMULATE_UPDATE_AVAILABLE = "--runtime-simulate-updates=update-available";

export interface LaunchedDesktop {
  app: ElectronApplication;
  page: Page;
  /** Set when the helper created an isolated profile dir (`connectTo`); callers remove it. */
  userDataDir?: string;
}

function desktopLaunchEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TV_TEST_MODE = "true";
  // Default the declared shell version above any published desktop
  // requirement (the ^hook-shell-version mock of app.getVersion()). The
  // server's baked REQUIRED_DESKTOP_VERSION can name the NEXT release
  // (desktop-upgrade-gate.md ^ops-first-gate), so a stamped-from-source
  // server built at the current workspace version would gate the real
  // package version — a pairing that cannot exist in production, where the
  // publish workflow bumps the version before stamping. Tests about the gate
  // or the real version path override or remove this explicitly.
  env.TV_TEST_DESKTOP_APP_VERSION = "9.9.9";
  if (env.CURSOR_AGENT === "1") {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * Launch the built Television desktop binary, either with `--test-fixture
 * <url>` so the main process bypasses the connect screen and loads `<url>`
 * directly, or with `connectTo` to bootstrap the real connect flow against a
 * running server. Returns the Electron app handle and the BrowserWindow's
 * first page.
 *
 * Tests are responsible for `await app.close()` (typically in `try/finally`
 * or via `test.afterEach`) and for removing any returned or caller-supplied
 * `userDataDir`; this helper does not auto-close.
 *
 * See specs/arch/desktop/e2e-harness.md for the full harness specification.
 */
async function runDesktopLaunchPhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw new Error(
      `launchDesktop ${phase} phase failed within ${DESKTOP_LAUNCH_PHASE_TIMEOUT_MS}ms`,
      { cause },
    );
  }
}

async function launchAndWaitForDesktop(args: string[], env: Record<string, string>): Promise<LaunchedDesktop> {
  const executablePath = requiredElectronExecutablePath();
  const app = await runDesktopLaunchPhase("electron.launch", () => electron.launch({
    executablePath,
    args,
    env,
    // Playwright otherwise emulates light mode on every attached renderer,
    // masking Electron's nativeTheme propagation into webview guests.
    colorScheme: null,
    timeout: DESKTOP_LAUNCH_PHASE_TIMEOUT_MS,
  }));
  try {
    const page = await runDesktopLaunchPhase("firstWindow", () => app.firstWindow({
      timeout: DESKTOP_LAUNCH_PHASE_TIMEOUT_MS,
    }));
    await runDesktopLaunchPhase("domcontentloaded", () => page.waitForLoadState("domcontentloaded", {
      timeout: DESKTOP_LAUNCH_PHASE_TIMEOUT_MS,
    }));
    return { app, page };
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

export async function launchDesktop(options: LaunchDesktopOptions): Promise<LaunchedDesktop> {
  if (options.fixture !== undefined && options.connectTo !== undefined) {
    throw new Error("launchDesktop: fixture and connectTo are mutually exclusive");
  }

  if (options.connectTo !== undefined) {
    const userDataDir = options.userDataDir ?? createUserDataDir();
    writeFileSync(
      path.join(userDataDir, "connection.json"),
      JSON.stringify({ serverURL: options.connectTo.serverURL, token: options.connectTo.token }, null, 2),
    );
    const launched = await launchAndWaitForDesktop(
      [DESKTOP_ENTRY, `--user-data-dir=${userDataDir}`, ...(options.args ?? [])],
      desktopLaunchEnv(options.env),
    );
    return { ...launched, userDataDir };
  }

  if (options.fixture === undefined) {
    throw new Error("launchDesktop: one of fixture or connectTo is required");
  }
  const fixtureURL = resolveFixtureURL(options.fixture);
  const profileArg = options.userDataDir ? [`--user-data-dir=${options.userDataDir}`] : [];
  return launchAndWaitForDesktop(
    [DESKTOP_ENTRY, ...profileArg, "--test-fixture", fixtureURL, ...(options.args ?? [])],
    desktopLaunchEnv(options.env),
  );
}

/**
 * Launch the real desktop app through the connect screen (no `--test-fixture`).
 * Uses an isolated `--user-data-dir` so saved connections do not leak between tests.
 */
export async function launchDesktopConnectScreen(options: LaunchConnectScreenOptions): Promise<LaunchedDesktop> {
  return launchAndWaitForDesktop(
    [DESKTOP_ENTRY, `--user-data-dir=${options.userDataDir}`, ...(options.args ?? [])],
    desktopLaunchEnv(options.env),
  );
}

export function createUserDataDir(prefix = "television-connect-e2e-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function waitForConnectScreen(page: Page): Promise<void> {
  await expectConnectForm(page);
  await page.waitForFunction(() => typeof (window as Window & { television?: unknown }).television !== "undefined");
}

export async function openConnectScreenFromMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) throw new Error("application menu missing");
    const stack = [...menu.items];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (item.label === "Connect to server…") {
        item.click();
        return;
      }
      if (item.submenu) stack.push(...item.submenu.items);
    }
    throw new Error("Connect to server… menu item missing");
  });
}

export async function expectConnectForm(page: Page): Promise<void> {
  await page.locator("#connect-form").waitFor({ state: "visible", timeout: 15_000 });
}

export async function expectConnectedPage(page: Page): Promise<void> {
  try {
    await expect.poll(() => page.url(), { timeout: 15_000 }).toContain("mode=electron");
  } catch (cause) {
    const connectError = await page.locator("#error").textContent().catch(() => null);
    throw new Error(`Desktop did not leave the connect screen${connectError ? `: ${connectError}` : ""}`, { cause });
  }
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
}

/** Wait for and assert the permanent connected application-shell composition. */
export async function expectPermanentApplicationShell(page: Page): Promise<void> {
  await expectConnectedPage(page);
  const root = page.locator("#app");
  await expect(root).toHaveAttribute("data-app-state", /^(connected|no-channel|empty-channel)$/);
  await expect(root.locator(":scope > .app-sidebar")).toHaveCount(1);
  await expect(root.locator(":scope > .app-main")).toHaveCount(1);
  await expect(root.locator(":scope > .system-modal-host")).toHaveCount(0);
  await expect(root.locator(".desktop-upgrade-gate")).toHaveCount(0);
}

export async function getBrowserWindowURL(app: ElectronApplication): Promise<string> {
  return await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? "");
}

function resolveFixtureURL(fixture: string): string {
  if (fixture.startsWith("/")) return desktopE2EURL(fixture);
  return fixture;
}

function requiredElectronExecutablePath(): string {
  const value = process.env[ELECTRON_E2E_EXECUTABLE_PATH_ENV];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${ELECTRON_E2E_EXECUTABLE_PATH_ENV} must be published as an absolute path by desktop global setup`);
  }
  return value;
}

function requiredDesktopE2EURL(): string {
  const value = process.env.TV_DESKTOP_E2E_URL;
  if (!value) throw new Error("TV_DESKTOP_E2E_URL must be published by the test runner");
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`TV_DESKTOP_E2E_URL must be a loopback HTTP URL; received ${JSON.stringify(value)}`);
  }
  return url.origin;
}
