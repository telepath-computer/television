import type { ElectronApplication } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { SET_APPEARANCE_MODE_CHANNEL } from "../../src/appearance-mode.ts";
import { OPEN_APPLICATION_LINK_CHANNEL } from "../../src/application-link.ts";
import { COMPLETE_CONNECT_CHANNEL, DISCONNECT_CHANNEL, GET_CONNECT_STATE_CHANNEL } from "../../src/connect-screen.ts";
import { GET_DESKTOP_UPDATE_CHANNEL, RESTART_TO_INSTALL_UPDATE_CHANNEL } from "../../src/desktop-update.ts";
import { startConnectTestServer, type ConnectTestServer } from "./connect-server.ts";
import { expectConnectedPage, launchDesktop, SIMULATE_UPDATE_AVAILABLE } from "./helpers.ts";

// IPC from an artifact webview's own renderer, in the real Electron app
// connected to a really-running server (proofs/arch/desktop/index.md
// ^desktop-t-ipc-senders-seam). Artifact code runs behind the preload's
// context isolation and cannot reach IPC, so a preload the test registers on
// the session stands in for a compromised renderer: it gives the artifact page
// Electron's renderer IPC. The window's page gets it too, to start a
// connection as the connect screen would. It replaces no production mechanism.

const CONNECT_CHANNEL = "television:connect";

const RENDERER_IPC_PRELOAD = `
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("__rendererIPC", {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
`;

interface RendererIPC {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

async function inArtifactWebview(app: ElectronApplication, source: string): Promise<unknown> {
  return app.evaluate(async ({ webContents }, script) => {
    const guest = webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes("/artifact/"));
    return guest ? await guest.executeJavaScript(script) : null;
  }, source);
}

/**
 * Invokes a channel from the artifact webview without awaiting the answer
 * there: from the window, the request replaces the page that shows the
 * webview, and the answer would never arrive. Resolves to the answer, or
 * null once the webview is gone.
 */
async function invokeFromWebviewUnawaited(app: ElectronApplication, channel: string, ...args: unknown[]): Promise<unknown> {
  await inArtifactWebview(app, `(() => {
    window.__answer = "pending";
    void window.__rendererIPC.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)}).then((value) => {
      window.__answer = value === undefined ? "nothing" : value;
    });
  })()`);
  let answer: unknown = "pending";
  await expect.poll(async () => (answer = await inArtifactWebview(app, `window.__answer`)), { timeout: 10_000 })
    .not.toBe("pending");
  return answer;
}

// spec: proofs/arch/desktop/index.md#^desktop-t-ipc-senders-seam
test("IPC from an artifact webview's renderer changes nothing on any channel the main process handles", async () => {
  const servers: ConnectTestServer[] = [];
  const scratch = mkdtempSync(path.join(os.tmpdir(), "television-ipc-senders-"));
  let app: ElectronApplication | null = null;
  let userDataDir: string | undefined;
  try {
    const first = await startConnectTestServer();
    servers.push(first);
    const second = await startConnectTestServer();
    servers.push(second);
    const secondLink = `${second.serverURL}/?token=${second.token}`;

    const folder = path.join(scratch, "artifact");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), "<!doctype html><h1>Artifact</h1>");
    const client = new TelevisionClient(first.serverURL, { token: first.token });
    const channelID = (await client.display.get()).focusedChannelId ?? (await client.channels.list()).channels[0]!.id;
    await client.artifacts.create({ channelID, kind: "path", title: "Artifact", path: `${folder}${path.sep}` });

    const launched = await launchDesktop({
      connectTo: { serverURL: first.serverURL, token: first.token },
      args: [SIMULATE_UPDATE_AVAILABLE],
    });
    ({ app, userDataDir } = launched);
    const { page } = launched;
    await expectConnectedPage(page);
    const connectionFile = path.join(userDataDir!, "connection.json");
    const firstConnection = readFileSync(connectionFile, "utf8");

    // The update runtime's simulation records a downloaded update.
    const downloaded = await page.evaluate(() => new Promise<string>((resolve, reject) => {
      const bridge = (window as unknown as {
        __televisionNativeBridge: { onDesktopUpdateDownloaded(callback: (version: string) => void): void };
      }).__televisionNativeBridge;
      bridge.onDesktopUpdateDownloaded(resolve);
      setTimeout(() => reject(new Error("No downloaded update was recorded")), 30_000);
    }));
    expect(downloaded).toMatch(/-simulated$/);

    const appearance = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
    const otherAppearance = appearance === "dark" ? "light" : "dark";

    const preloadPath = path.join(scratch, "renderer-ipc-preload.js");
    writeFileSync(preloadPath, RENDERER_IPC_PRELOAD);
    // The window's session and the artifact webview's partition, which the
    // same artifact's webview uses again after the reload.
    await app.evaluate(({ session, webContents }, filePath) => {
      session.defaultSession.registerPreloadScript({ type: "frame", filePath });
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview");
      if (!guest) throw new Error("No artifact webview");
      guest.session.registerPreloadScript({ type: "frame", filePath });
    }, preloadPath);
    await page.reload();
    await expectConnectedPage(page);
    await expect.poll(() => inArtifactWebview(app!, `typeof window.__rendererIPC`), { timeout: 15_000 }).toBe("object");
    expect(await page.evaluate(() => typeof (window as unknown as { __rendererIPC?: unknown }).__rendererIPC)).toBe("object");

    // Each value is one the main process acts on from the window in this state.
    const answers = await inArtifactWebview(app, `(async () => {
      const ipc = window.__rendererIPC;
      ipc.send(${JSON.stringify(SET_APPEARANCE_MODE_CHANNEL)}, ${JSON.stringify(otherAppearance)});
      ipc.send(${JSON.stringify(RESTART_TO_INSTALL_UPDATE_CHANNEL)});
      ipc.send(${JSON.stringify(OPEN_APPLICATION_LINK_CHANNEL)}, "example-app://open/item");
      const answers = {
        update: await ipc.invoke(${JSON.stringify(GET_DESKTOP_UPDATE_CHANNEL)}),
        connectState: await ipc.invoke(${JSON.stringify(GET_CONNECT_STATE_CHANNEL)}),
        connect: await ipc.invoke(${JSON.stringify(CONNECT_CHANNEL)}, ${JSON.stringify(secondLink)}),
      };
      return JSON.stringify(answers, (_key, value) => value === undefined ? "nothing" : value);
    })()`);
    expect(JSON.parse(String(answers))).toEqual({ update: "nothing", connectState: "nothing", connect: "nothing" });
    expect(readFileSync(connectionFile, "utf8")).toBe(firstConnection);

    // The window starts connecting to the second server, as the connect
    // screen would: it saves the connection and waits for completion.
    const started = await page.evaluate(
      (link) => (window as unknown as { __rendererIPC: RendererIPC }).__rendererIPC.invoke("television:connect", link),
      secondLink,
    ) as { ok: boolean; attempt: number };
    expect(started).toMatchObject({ ok: true, attempt: expect.any(Number) });
    const secondConnection = readFileSync(connectionFile, "utf8");
    expect(JSON.parse(secondConnection)).toMatchObject({ serverURL: second.serverURL });

    expect(await invokeFromWebviewUnawaited(app, COMPLETE_CONNECT_CHANNEL, started.attempt), {
      message: "the webview's completion of the pending connection is answered with nothing, and the first server's page remains",
    }).toBe("nothing");
    expect(await invokeFromWebviewUnawaited(app, DISCONNECT_CHANNEL), {
      message: "the webview's disconnect is answered with nothing, and the first server's page remains",
    }).toBe("nothing");

    // Every channel the main process listens on was sent to; Electron's own
    // `error` listener is not a channel.
    const sent = [
      SET_APPEARANCE_MODE_CHANNEL, RESTART_TO_INSTALL_UPDATE_CHANNEL, OPEN_APPLICATION_LINK_CHANNEL,
      GET_DESKTOP_UPDATE_CHANNEL, GET_CONNECT_STATE_CHANNEL, CONNECT_CHANNEL, COMPLETE_CONNECT_CHANNEL, DISCONNECT_CHANNEL,
    ];
    const listened = await app.evaluate(({ ipcMain }) => ipcMain.eventNames().map(String));
    expect(listened.filter((channel) => channel !== "error" && !sent.includes(channel))).toEqual([]);

    await expectConnectedPage(page);
    expect(new URL(page.url()).origin).toBe(new URL(first.serverURL).origin);
    expect(readFileSync(connectionFile, "utf8")).toBe(secondConnection);
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(appearance);
    expect(await app.evaluate(() => {
      const record = globalThis as typeof globalThis & {
        __televisionRestartToInstallLog?: string[];
        __televisionExternalOpenLog?: string[];
      };
      return { restarts: record.__televisionRestartToInstallLog ?? [], externalOpens: record.__televisionExternalOpenLog ?? [] };
    })).toEqual({ restarts: [], externalOpens: [] });

    // The attempt the webview sent was live: the window completing it loads
    // the second server, replacing this page before the answer arrives.
    await page.evaluate((attempt) => {
      void (window as unknown as { __rendererIPC: RendererIPC }).__rendererIPC.invoke("television:complete-connect", attempt);
    }, started.attempt);
    await expect.poll(() => new URL(page.url()).origin, { timeout: 15_000 }).toBe(new URL(second.serverURL).origin);
  } finally {
    await app?.close().catch(() => undefined);
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    for (const server of servers) await server.dispose();
  }
});
