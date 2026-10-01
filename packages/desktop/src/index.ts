import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { classifyLinkTarget } from "@telepath-computer/television-artifact/link-target";
import todesktop from "@todesktop/runtime";
import path from "node:path";
import { buildRemoteURL, ConnectURLError, parseDesktopConnectURL, resolveDesktopAppVersion } from "./connect-url.ts";
import { preflightConnection } from "./connect-preflight.ts";
import { loadConnection, saveConnection, type Connection } from "./connection-store.ts";
import type { ConnectResult } from "./connect-error.ts";
import {
  GET_CONNECT_SCREEN_INTENT_CHANNEL,
  type ConnectScreenIntent,
} from "./connect-screen.ts";
import {
  handleNativeNavigationKey,
  NATIVE_NAVIGATION_KEY_CHANNEL,
} from "./native-navigation-key.ts";
import { WINDOW_MIN_HEIGHT_PX, WINDOW_MIN_WIDTH_PX } from "./window-measures.ts";
import {
  isDesktopAppearanceMode,
  SET_APPEARANCE_MODE_CHANNEL,
} from "./appearance-mode.ts";
import { OPEN_APPLICATION_LINK_CHANNEL } from "./application-link.ts";
import {
  DESKTOP_UPDATE_DOWNLOADED_CHANNEL,
  GET_DESKTOP_UPDATE_CHANNEL,
  isDesktopUpdateVersion,
  RESTART_TO_INSTALL_UPDATE_CHANNEL,
} from "./desktop-update.ts";

// The name comes first so the user-data path follows it; the update runtime
// starts straight after, with its system notification off: the served
// interface tells the user (specs/arch/desktop/updates.md#^desktop-updates-start).
app.setName("Television");
todesktop.init({ updateReadyAction: { showNotification: "never" } });

// The downloaded update's version, for the life of the process
// (specs/arch/desktop/updates.md#^desktop-updates-record). The runtime emits
// the event again after every later check while the update waits, so only a
// new version is reported to the window.
let downloadedUpdateVersion: string | null = null;
todesktop.autoUpdater?.on("update-downloaded", ({ updateInfo }) => {
  const version = updateInfo?.version;
  if (!isDesktopUpdateVersion(version) || version === downloadedUpdateVersion) return;
  downloadedUpdateVersion = version;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(DESKTOP_UPDATE_DOWNLOADED_CHANNEL, version);
  }
});

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 1000;
const TRAFFIC_LIGHT_POSITION = { x: 15, y: 15 };
const GET_CONNECTION_CHANNEL = "television:get-connection";
const CONNECT_CHANNEL = "television:connect";
const TEST_EXTERNAL_OPEN_CHANNEL = "television:test:external-open";
const TEST_FIXTURE_FLAG = "--test-fixture";
const ERR_ABORTED = -3;

if (process.env.TV_ELECTRON_CHROMIUM_LOGS !== "1") {
  app.commandLine?.appendSwitch("log-level", "3");
}

function readTestFixtureURL(argv: readonly string[]): string | null {
  const idx = argv.indexOf(TEST_FIXTURE_FLAG);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1] ?? null;
}

function isExternalOpenURL(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function sharesNonOpaqueWebOrigin(leftValue: string, rightValue: string): boolean {
  try {
    const left = new URL(leftValue);
    const right = new URL(rightValue);
    if (left.protocol !== "http:" && left.protocol !== "https:") return false;
    if (right.protocol !== "http:" && right.protocol !== "https:") return false;
    return left.origin !== "null" && left.origin === right.origin;
  } catch {
    return false;
  }
}

function recordExternalOpenForTest(url: string): void {
  const globalState = globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] };
  const log = (globalState.__televisionExternalOpenLog ??= []);
  log.push(url);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(TEST_EXTERNAL_OPEN_CHANNEL, url);
  }
}

function openExternal(url: string): void {
  if (process.env.TV_TEST_MODE === "true") {
    recordExternalOpenForTest(url);
  } else {
    void shell.openExternal(url);
  }
}

// The runtime refuses to restart without a downloaded update, so a request
// before the record is ignored. Test mode records the request instead: the
// runtime's restart would relaunch the app outside the test harness.
function restartToInstallUpdate(): void {
  if (downloadedUpdateVersion === null) return;
  if (process.env.TV_TEST_MODE === "true") {
    const globalState = globalThis as typeof globalThis & { __televisionRestartToInstallLog?: string[] };
    (globalState.__televisionRestartToInstallLog ??= []).push(downloadedUpdateVersion);
  } else {
    todesktop.autoUpdater?.restartAndInstall();
  }
}

export class App {
  private window: BrowserWindow | null = null;
  private connectScreenIntent: ConnectScreenIntent = "manual";

  async start(): Promise<void> {
    await app.whenReady();
    if (process.platform === "darwin") {
      app.setAboutPanelOptions({
        applicationVersion: app.getVersion(),
        version: "",
      });
      app.dock?.setIcon(path.join(__dirname, "..", "assets", "icon.png"));
    }
    nativeTheme.themeSource = "system";
    this.installMenu();
    this.installWindowOpenHandler();
    ipcMain.on(SET_APPEARANCE_MODE_CHANNEL, (_event, mode: unknown) => {
      if (isDesktopAppearanceMode(mode)) nativeTheme.themeSource = mode;
    });
    ipcMain.handle(GET_DESKTOP_UPDATE_CHANNEL, async () => downloadedUpdateVersion);
    ipcMain.on(RESTART_TO_INSTALL_UPDATE_CHANNEL, () => restartToInstallUpdate());
    ipcMain.handle(GET_CONNECTION_CHANNEL, async () => loadConnection());
    ipcMain.handle(GET_CONNECT_SCREEN_INTENT_CHANNEL, async () => this.connectScreenIntent);
    ipcMain.handle(CONNECT_CHANNEL, async (_event, connection: Connection) => this.tryConnect(connection));
    await this.createWindow();

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void this.createWindow();
    });
  }

  private async createWindow(): Promise<void> {
    this.window = new BrowserWindow({
      title: "Television",
      icon: path.join(__dirname, "..", "assets", "icon.png"),
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: WINDOW_MIN_WIDTH_PX,
      minHeight: WINDOW_MIN_HEIGHT_PX,
      show: false,
      backgroundColor: "#000000",
      titleBarStyle: "hidden",
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, "connect-preload.cjs"),
        webviewTag: true,
      },
    });
    this.window.webContents.on("will-attach-webview", (_event, webPreferences) => {
      webPreferences.preload = path.join(__dirname, "webview-bridge-preload.cjs");
      webPreferences.contextIsolation = false;
    });
    this.window.webContents.on("did-fail-load", (_event, code, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (code === ERR_ABORTED) return;
      if (validatedURL.startsWith("file:")) return;
      void this.loadConnectScreen("manual");
    });
    this.window.once("ready-to-show", () => this.window?.show());
    this.window.on("closed", () => {
      this.window = null;
    });

    const testFixtureURL = readTestFixtureURL(process.argv);
    if (testFixtureURL) {
      await this.window.loadURL(testFixtureURL);
      return;
    }

    await this.loadConnectScreen("bootstrap");
  }

  /** @param intent bootstrap = app open / retry saved connection; manual = user chose connect screen */
  async loadConnectScreen(intent: ConnectScreenIntent = "manual"): Promise<void> {
    if (!this.window) return;
    this.connectScreenIntent = intent;
    await this.window.loadFile(path.join(__dirname, "connect.html"));
  }

  private async tryConnect(raw: Connection): Promise<ConnectResult> {
    let connection: Connection;
    try {
      const parsed = parseDesktopConnectURL(raw.serverURL);
      connection = { serverURL: parsed.serverURL, token: parsed.token ?? raw.token ?? "" };
    } catch (error) {
      const message = error instanceof ConnectURLError ? error.message : new ConnectURLError().message;
      return { ok: false, message };
    }

    try {
      const desktopAppVersion = resolveDesktopAppVersion(app.getVersion(), process.env);
      const preflight = await preflightConnection({
        serverURL: connection.serverURL,
        token: connection.token,
        desktopAppVersion,
      });
      if (!preflight.ok) {
        return { ok: false, message: preflight.message };
      }

      saveConnection(connection);
      await this.loadRemote(connection, desktopAppVersion);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to connect";
      return { ok: false, message };
    }
  }

  private async loadRemote(connection: Connection, desktopAppVersion: string): Promise<void> {
    if (!this.window) return;
    await this.window.loadURL(buildRemoteURL(connection.serverURL, connection.token, desktopAppVersion));
  }

  private installWindowOpenHandler(): void {
    ipcMain.on(OPEN_APPLICATION_LINK_CHANNEL, (event, value: unknown) => {
      if (event.sender.getType() !== "webview" || typeof value !== "string") return;
      const host = event.sender.hostWebContents;
      // Electron supplies the sender's current committed URL. Authorize that
      // document at handler time; no origin asserted by the page is trusted.
      if (!host || !sharesNonOpaqueWebOrigin(event.sender.getURL(), host.getURL())) return;
      const target = classifyLinkTarget(value, "https://television.invalid/");
      if (target.kind === "application") openExternal(target.url);
    });

    app.on("web-contents-created", (_event, contents) => {
      if (contents.getType() === "webview") {
        contents.on("will-frame-navigate", (event) => {
          const target = classifyLinkTarget(event.url, "https://television.invalid/");
          if (target.kind === "application" || (event.isMainFrame && target.kind !== "web")) {
            event.preventDefault();
          }
        });
        const host = contents.hostWebContents;
        if (host) {
          contents.on("before-input-event", (event, input) => {
            handleNativeNavigationKey(event, input, process.platform, (key) => {
              host.send(NATIVE_NAVIGATION_KEY_CHANNEL, key);
            });
          });
        }
      }
      contents.setWindowOpenHandler(({ url }) => {
        if (isExternalOpenURL(url)) openExternal(url);
        return { action: "deny" };
      });
    });
  }

  private installMenu(): void {
    const isMac = process.platform === "darwin";
    const connectItem: MenuItemConstructorOptions = {
      label: "Connect to server…",
      accelerator: "CmdOrCtrl+,",
      click: () => void this.loadConnectScreen("manual"),
    };
    const template: MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" },
                { type: "separator" },
                connectItem,
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            } satisfies MenuItemConstructorOptions,
          ]
        : []),
      {
        label: "File",
        submenu: [
          ...(isMac ? [] : [connectItem]),
          isMac ? { role: "close" } : { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

if (process.env.VITEST !== "true") {
  void new App().start();
}
