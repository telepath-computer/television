import { expect, test } from "@playwright/test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startConnectTestServer, type ConnectTestServer } from "./connect-server.ts";
import {
  createUserDataDir,
  expectConnectForm,
  expectConnectedPage,
  launchDesktopConnectScreen,
  openConnectScreenFromMenu,
} from "./helpers.ts";

let testServer: ConnectTestServer;



test.describe(() => {
test.beforeEach(async () => {
  testServer = await startConnectTestServer();
});

test.afterEach(async () => {
  await testServer.dispose();
});

test.describe("connected-screen transitions", () => {

test("failed connect shows an error, keeps entered values on screen, and does not overwrite a saved connection", async () => {
  const userDataDir = createUserDataDir();
  writeFileSync(
    path.join(userDataDir, "connection.json"),
    JSON.stringify({ serverURL: testServer.serverURL, token: testServer.token }, null, 2),
  );
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expectConnectedPage(page);
    await openConnectScreenFromMenu(app);
    await expectConnectForm(page);
    await page.locator("#serverURL").fill(testServer.serverURL);
    await page.locator("#token").fill("wrong-token");
    await page.locator("#serverURL").press("Enter");

    await expect(page.locator("#error")).toHaveText("Token rejected", { timeout: 5_000 });
    await expect(page.locator("#serverURL")).toHaveValue(testServer.serverURL);
    await expect(page.locator("#token")).toHaveValue("wrong-token");
    await expect(page.locator("#connect-form")).toBeVisible();
    await expect(page.locator("#submit")).toBeEnabled();

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

test("bootstrap reconnects automatically when a saved connection exists on app open", async () => {
  const userDataDir = createUserDataDir();
  writeFileSync(
    path.join(userDataDir, "connection.json"),
    JSON.stringify({ serverURL: testServer.serverURL, token: testServer.token }, null, 2),
  );

  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expectConnectedPage(page);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("menu reopen shows prefilled connect screen without auto-submitting", async () => {
  const userDataDir = createUserDataDir();
  writeFileSync(
    path.join(userDataDir, "connection.json"),
    JSON.stringify({ serverURL: testServer.serverURL, token: testServer.token }, null, 2),
  );

  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expectConnectedPage(page);

    await openConnectScreenFromMenu(app);
    await expectConnectForm(page);

    await expect(page.locator("#serverURL")).toHaveValue(testServer.serverURL);
    await expect(page.locator("#token")).toHaveValue(testServer.token);
    await expect(page.locator("#connect-form")).toBeVisible();
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

})

test("bootstrap connect screen tolerates a saved connection with a missing token", async () => {
  const userDataDir = createUserDataDir();
  writeFileSync(
    path.join(userDataDir, "connection.json"),
    JSON.stringify({ serverURL: testServer.serverURL }, null, 2),
  );

  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expectConnectForm(page);
    await expect(page.locator("#serverURL")).toHaveValue(testServer.serverURL);
    await expect(page.locator("#token")).toHaveValue("");
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test.describe("connected restart persistence", () => {

test("app restart after failed connect keeps the previously persisted credentials", async () => {
  const userDataDir = createUserDataDir();
  writeFileSync(
    path.join(userDataDir, "connection.json"),
    JSON.stringify({ serverURL: testServer.serverURL, token: testServer.token }, null, 2),
  );

  {
    const { app, page } = await launchDesktopConnectScreen({ userDataDir });
    try {
      await expectConnectedPage(page);
      await openConnectScreenFromMenu(app);
      await expectConnectForm(page);
      await page.locator("#serverURL").fill(testServer.serverURL);
      await page.locator("#token").fill("wrong-token");
      await page.locator("#serverURL").press("Enter");
      await expect(page.locator("#error")).toHaveText("Token rejected", { timeout: 5_000 });
      await expect(page.locator("#serverURL")).toHaveValue(testServer.serverURL);
      await expect(page.locator("#token")).toHaveValue("wrong-token");
    } finally {
      await app.close();
    }
  }

  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await expectConnectedPage(page);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
})
});
