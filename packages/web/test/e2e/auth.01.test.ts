import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import {
  configureTestMotion,
  waitForApplicationShell,
} from "./helpers.ts";
import {
  observeApplicationPresentations,
} from "./application-presentation.helpers.ts";

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-auth-e2e-"));
}

test.describe("markdown endpoint auth integration", () => {
  test("authenticates markdown path artifact editing with bearer headers only", async ({ page }) => {
    const storagePath = createDataDir();
    const target = path.join(storagePath, "note.md");
    writeFileSync(target, "# auth");
    const store = createServingStore(storagePath);
    const channel = store.createChannel({ name: "Auth" });
    const artifact = store.createArtifact({ kind: "path", title: "Note", path: target, channelID: channel.id });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });

    try {
      await server.start();
      const serverURL = server.getBaseURL();
      const token = server.getAuthToken();
      const results = await page.evaluate(
        async ({ serverURL, token, artifactID }) => {
          const path = `/markdown/${encodeURIComponent(artifactID)}`;
          const missing = await fetch(`${serverURL}${path}`);
          const queryOnly = await fetch(`${serverURL}${path}?token=${encodeURIComponent(token)}`);
          const bearerGet = await fetch(`${serverURL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
          const bearerPut = await fetch(`${serverURL}${path}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "content-type": "text/markdown" },
            body: "# saved",
          });
          return {
            missing: missing.status,
            queryOnly: queryOnly.status,
            bearerGet: { status: bearerGet.status, text: await bearerGet.text() },
            bearerPut: bearerPut.status,
          };
        },
        { serverURL, token, artifactID: artifact.id },
      );

      expect(results).toEqual({
        missing: 401,
        queryOnly: 401,
        bearerGet: { status: 200, text: "# auth" },
        bearerPut: 204,
      });
      expect(readFileSync(target, "utf8")).toBe("# saved");
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});

function productAppIndexURL(appURL: string, token?: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function productAppCleanURL(appURL: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  return url.toString();
}


test.describe("product browser token flow", () => {
  test("consumes a connect URL token, strips it, and reconnects from localStorage", async ({ page, context, baseURL }) => {
    const product = await launchProductServer({ auth: true });
    try {
      const appURL = await product.appURL(baseURL!);
      await page.goto(productAppIndexURL(appURL, product.token));

      await waitForApplicationShell(page);
      await expect(page).toHaveURL(productAppCleanURL(appURL));

      await page.reload();
      await waitForApplicationShell(page);
      await expect(page).toHaveURL(productAppCleanURL(appURL));

      await page.close();
      const reopened = await context.newPage();
      await reopened.goto(productAppCleanURL(appURL));
      await waitForApplicationShell(reopened);
      await expect(reopened).toHaveURL(productAppCleanURL(appURL));
    } finally {
      await product.dispose();
    }
  });
})

// Acceptance (^ap-ac-signin-first): real token rejection and current-link
// recovery. Stored tokens and the restarted server's token file are fixtures;
// no authentication response or request header is replaced.
test("rejected tokens at boot and after a session clear credentials and recover with a current link", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const product = await launchProductServer({ auth: true });
  try {
    const appURL = await product.appURL(baseURL);
    await page.addInitScript((origin) => {
      if (location.origin !== origin || localStorage.getItem("seeded-auth-fixture")) return;
      localStorage.setItem("store-television-browser", JSON.stringify({ authTokens: { [origin]: "wrong-token" } }));
      localStorage.setItem("seeded-auth-fixture", "true");
    }, appURL);
    const presentation = await observeApplicationPresentations(page);
    const socketURLs: string[] = [];
    page.on("websocket", (socket) => socketURLs.push(socket.url()));
    await page.goto(productAppCleanURL(appURL));
    await configureTestMotion(page);

    const expectRejected = async (): Promise<void> => {
      await expect(page.getByRole("heading", { name: "Access token required" })).toBeVisible();
      await expect(page.locator(".app-sidebar, .app-main, .desktop-upgrade-gate")).toHaveCount(0);
      await expect(page.locator("dialog")).toHaveCount(1);
      await expect(page.locator(".system-modal")).toContainText("paste the whole link into the address bar");
      expect(await page.evaluate((origin) => {
        const state = JSON.parse(localStorage.getItem("store-television-browser") ?? "{}");
        return state.authTokens?.[origin] ?? null;
      }, appURL)).toBeNull();
      // Observe the real owner; the scheduler contract proves the indefinite
      // no-retry promise without an arbitrary quiet-period sleep here.
      expect(await page.evaluate(() => {
        const { connection } = (window as unknown as { __telepath: { connectionOwner: { connection: { status: string; nextRetryAt: number | null; attempting: boolean } } } }).__telepath.connectionOwner;
        return { status: connection.status, nextRetryAt: connection.nextRetryAt, attempting: connection.attempting };
      })).toEqual({ status: "unauthorized", nextRetryAt: null, attempting: false });
      await presentation.settle();
      const records = presentation.records().filter((record) => record.appState === "unauthorized");
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) expect(record).toMatchObject({
        shellRegionCount: 0, modalHostCount: 1, unauthorizedCount: 1,
        gateCount: 0, connectingCount: 0, disconnectedCount: 0, errorCount: 0,
      });
    };
    await expectRejected();
    expect(socketURLs.some((url) => new URL(url).searchParams.get("token") === "wrong-token")).toBe(true);
    await page.goto(productAppIndexURL(appURL, product.token));
    await waitForApplicationShell(page);
    const replacementToken = "a".repeat(64);
    writeFileSync(path.join(product.home, "state", "token"), replacementToken);
    await product.restart();
    await expectRejected();
    expect(socketURLs.filter((url) => new URL(url).searchParams.get("token") === product.token).length).toBeGreaterThanOrEqual(2);
    await page.goto(productAppIndexURL(appURL, replacementToken));
    await waitForApplicationShell(page);
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(productAppCleanURL(appURL));
    await presentation.stop();
  } finally {
    await product.dispose();
  }
});
