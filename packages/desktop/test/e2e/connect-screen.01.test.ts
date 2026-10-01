import { expect, test, type Page } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { startConnectTestServer, type ConnectTestServer } from "./connect-server.ts";
import {
  createUserDataDir,
  expectConnectedPage,
  getBrowserWindowURL,
  launchDesktopConnectScreen,
  waitForConnectScreen,
} from "./helpers.ts";

let testServer: ConnectTestServer;

async function pasteServerURL(page: Page, text: string): Promise<void> {
  await page.locator("#serverURL").focus();
  await page.locator("#serverURL").evaluate((input, pastedText) => {
    const data = new DataTransfer();
    data.setData("text/plain", pastedText);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}


test.describe(() => {
test.beforeEach(async () => {
  testServer = await startConnectTestServer();
});

test.afterEach(async () => {
  await testServer.dispose();
});

test("connect screen loads with working preload bridge and external connect-page script", async () => {
  const userDataDir = createUserDataDir();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    const hasBridge = await page.evaluate(() => {
      return typeof window.television?.getConnectScreenIntent === "function" &&
        typeof window.television?.getConnection === "function" &&
        typeof window.television?.connect === "function";
    });
    expect(hasBridge).toBe(true);
    await expect(page.locator("#serverURL")).toBeVisible();
    await expect(page.locator("#token")).toBeVisible();
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test.describe("successful connect navigation", () => {

test("manual connect submits the form, checks the server, and navigates to the remote URL", async () => {
  const userDataDir = createUserDataDir();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    await page.locator("#serverURL").fill(testServer.serverURL);
    await page.locator("#token").fill(testServer.token);
    await page.locator("#serverURL").press("Enter");

    await expectConnectedPage(page);
    const url = new URL(await getBrowserWindowURL(app));
    expect(url.origin).toBe(testServer.serverURL);
    expect(url.searchParams.get("mode")).toBe("electron");
    expect(url.searchParams.has("token")).toBe(false);

    await page.reload();
    await expectConnectedPage(page);
    const reloadedURL = new URL(await getBrowserWindowURL(app));
    expect(reloadedURL.origin).toBe(testServer.serverURL);
    expect(reloadedURL.searchParams.get("mode")).toBe("electron");
    expect(reloadedURL.searchParams.has("token")).toBe(false);

    const saved = JSON.parse(readFileSync(path.join(userDataDir, "connection.json"), "utf8")) as {
      serverURL: string;
      token: string;
    };
    expect(saved.serverURL).toBe(testServer.serverURL);
    expect(saved.token).toBe(testServer.token);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("pasting a connect URL extracts the token and saves only the clean origin", async () => {
  const userDataDir = createUserDataDir();
  const connectURL = `${testServer.serverURL}/?token=${encodeURIComponent(testServer.token)}`;
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    await page.locator("#token").fill("stale-token");
    await pasteServerURL(page, connectURL);

    await expect(page.locator("#serverURL")).toHaveValue(testServer.serverURL);
    await expect(page.locator("#token")).toHaveValue(testServer.token);
    await page.locator("#serverURL").press("Enter");

    await expectConnectedPage(page);
    const saved = JSON.parse(readFileSync(path.join(userDataDir, "connection.json"), "utf8")) as {
      serverURL: string;
      token: string;
    };
    expect(saved.serverURL).toBe(testServer.serverURL);
    expect(saved.token).toBe(testServer.token);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("submitting a connect URL extracts the token without relying on paste", async () => {
  const userDataDir = createUserDataDir();
  const connectURL = `${testServer.serverURL}/?token=${encodeURIComponent(testServer.token)}`;
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    await page.locator("#serverURL").fill(connectURL);
    await page.locator("#token").fill("");
    await page.locator("#serverURL").press("Enter");

    await expectConnectedPage(page);
    const saved = JSON.parse(readFileSync(path.join(userDataDir, "connection.json"), "utf8")) as {
      serverURL: string;
      token: string;
    };
    expect(saved.serverURL).toBe(testServer.serverURL);
    expect(saved.token).toBe(testServer.token);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

})

test("pasting a URL without a token leaves the existing token field untouched", async () => {
  const userDataDir = createUserDataDir();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    await page.locator("#token").fill(testServer.token);
    await pasteServerURL(page, `${testServer.serverURL}/?channel=abc`);

    await expect(page.locator("#serverURL")).toHaveValue(testServer.serverURL);
    await expect(page.locator("#token")).toHaveValue(testServer.token);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
});
