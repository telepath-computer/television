import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startConnectTestServer } from "./connect-server.ts";
import { startStableFrontProxy } from "../../../../test/helpers/stable-front-proxy.ts";
import { createUserDataDir, expectConnectedPage, launchDesktopConnectScreen, disconnectFromServerMenu, disconnectEnabled, waitForConnectScreen } from "./helpers.ts";

// ^desktop-ac-saved-recovery: the front keeps its real bound address while the
// actual Television backend stops and restarts on a new port. It generates a
// 502 when forwarding fails; it never supplies a Television identity or status.
test("saved startup retries an unavailable server and recovers without setup", async () => {
  const server = await startConnectTestServer();
  let releaseCheck!: () => void;
  const checkBarrier = new Promise<void>(resolve => { releaseCheck = resolve; });
  const front = await startStableFrontProxy(server.serverURL, () => checkBarrier);
  const userDataDir = createUserDataDir();
  writeFileSync(path.join(userDataDir, "connection.json"), JSON.stringify({ serverURL: front.url, token: server.token }));
  await server.stop();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expect(page.getByRole("heading", { name: "Connecting", exact: true })).toBeVisible();
    await expect(page.locator(".setup-screen")).toHaveCount(0);
    releaseCheck();
    await expect(page.getByRole("heading", { name: "Can’t connect with server" })).toBeVisible();
    await expect(page.locator(".server-url")).toHaveText(front.url);
    await expect(page.locator(".setup-screen")).toHaveCount(0);
    await page.evaluate(() => {
      const observations: string[] = [];
      (window as unknown as { retryObservations: string[] }).retryObservations = observations;
      new MutationObserver(() => observations.push(document.querySelector(".system-modal")?.textContent ?? ""))
        .observe(document.getElementById("app")!, { subtree: true, childList: true, characterData: true });
    });
    await expect.poll(() => page.evaluate(() => {
      const entries = (window as unknown as { retryObservations: string[] }).retryObservations;
      return entries.some(text => text.includes("Reconnecting in 2s")) && entries.some(text => text.includes("Reconnecting in 1s")) && entries.some(text => text.includes("Reconnecting now"));
    })).toBe(true);
    await server.restart();
    front.setTarget(server.serverURL);
    await expectConnectedPage(page);
    expect(new URL(page.url()).origin).toBe(front.url);
  } finally {
    releaseCheck();
    await app.close();
    await front.dispose();
    await server.dispose();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ^desktop-ac-saved-auth: observe actual server traffic through an interval
// longer than the initial retry delay, then cross the local disconnect IPC.
test("a rejected saved token stops checks and the local Disconnect button forgets it", async () => {
  const server = await startConnectTestServer();
  const requests: number[] = [];
  server.server.httpServer.on("request", req => { if (req.url?.startsWith("/desktop/connect-check")) requests.push(Date.now()); });
  let releaseCheck!: () => void;
  const checkBarrier = new Promise<void>(resolve => { releaseCheck = resolve; });
  const front = await startStableFrontProxy(server.serverURL, () => checkBarrier);
  const userDataDir = createUserDataDir();
  const record = path.join(userDataDir, "connection.json");
  writeFileSync(record, JSON.stringify({ serverURL: front.url, token: "wrong" }));
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expect(page.getByRole("heading", { name: "Connecting", exact: true })).toBeVisible();
    await expect(page.locator(".setup-screen")).toHaveCount(0);
    releaseCheck();
    await expect(page.getByRole("heading", { name: "Access token required" })).toBeVisible();
    await expect(page.locator(".setup-screen")).toHaveCount(0);
    await expect.poll(() => Date.now() - requests[0]!, { timeout: 5000 }).toBeGreaterThan(1500);
    expect(requests).toHaveLength(1);
    await page.getByRole("button", { name: "Disconnect from Server", exact: true }).click();
    await waitForConnectScreen(page);
    expect(existsSync(record)).toBe(false);
    expect(await disconnectEnabled(app)).toBe(false);
    await expect(page.getByRole("textbox", { name: "Link from your agent" })).toBeEditable();
  } finally {
    releaseCheck();
    await app.close();
    await front.dispose();
    await server.dispose();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ^desktop-ac-gate-disconnect: real identity check and served gate; version
// fixtures select an older shell. Menu callback activation forfeits Mac input.
test("Disconnect from Server leaves the served upgrade gate", async () => {
  const names = ["TV_TEST_VERSION", "TV_TEST_REQUIRED_DESKTOP_VERSION", "TV_UPDATE_CHANNEL_URL"];
  const before = names.map(name => process.env[name]);
  process.env.TV_TEST_VERSION = "1.0.0";
  process.env.TV_TEST_REQUIRED_DESKTOP_VERSION = "2.0.0";
  process.env.TV_UPDATE_CHANNEL_URL = "http://127.0.0.1:9/update-channel.json";
  const server = await startConnectTestServer({ auth: false });
  const userDataDir = createUserDataDir();
  const record = path.join(userDataDir, "connection.json");
  writeFileSync(record, JSON.stringify({ serverURL: server.serverURL, token: server.token }));
  const { app, page } = await launchDesktopConnectScreen({ userDataDir, env: { TV_TEST_DESKTOP_APP_VERSION: "1.0.0" } });
  try {
    await expect(page.locator(".desktop-upgrade-gate")).toBeVisible();
    expect(await disconnectEnabled(app)).toBe(true);
    expect(await page.evaluate(() => typeof window.television)).toBe("undefined");
    await disconnectFromServerMenu(app);
    await waitForConnectScreen(page);
    expect(existsSync(record)).toBe(false);
    expect(await disconnectEnabled(app)).toBe(false);
    // Execute the staging runbook's replacement setup steps against the real
    // authless server, with dynamic ports and an isolated profile.
    await page.getByRole("textbox", { name: "Link from your agent" }).fill(server.serverURL);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.locator(".desktop-upgrade-gate")).toBeVisible();
    await expect(page.locator(".update-popover, .update-bell")).toHaveCount(0);
    expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({ serverURL: server.serverURL, token: "" });
  } finally {
    await app.close();
    await server.dispose();
    rmSync(userDataDir, { recursive: true, force: true });
    names.forEach((name, index) => { if (before[index] === undefined) delete process.env[name]; else process.env[name] = before[index]; });
  }
});
