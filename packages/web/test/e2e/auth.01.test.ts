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
  type ApplicationPresentationRecord,
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

      await expect(page.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(page);
      await expect(page).toHaveURL(productAppCleanURL(appURL));

      await page.reload();
      await expect(page.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(page);
      await expect(page).toHaveURL(productAppCleanURL(appURL));

      await page.close();
      const reopened = await context.newPage();
      await reopened.goto(productAppCleanURL(appURL));
      await expect(reopened.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(reopened);
      await expect(reopened).toHaveURL(productAppCleanURL(appURL));
    } finally {
      await product.dispose();
    }
  });
})

const SHELL_STATES = new Set(["connected", "no-channel", "empty-channel"]);

function applicationRecords(
  records: readonly ApplicationPresentationRecord[],
): readonly ApplicationPresentationRecord[] {
  return records.filter((record) => record.appState !== null);
}

function expectSoleUnauthorizedSettlement(
  records: readonly ApplicationPresentationRecord[],
  allowedBeforeUnauthorized: ReadonlySet<string>,
): void {
  const presentations = applicationRecords(records);
  const firstUnauthorized = presentations.findIndex((record) =>
    record.appState === "unauthorized"
  );
  expect(firstUnauthorized).toBeGreaterThanOrEqual(0);

  for (const record of presentations.slice(0, firstUnauthorized)) {
    expect(allowedBeforeUnauthorized.has(record.appState!)).toBe(true);
  }
  for (const record of presentations.slice(firstUnauthorized)) {
    expect(record).toMatchObject({
      appState: "unauthorized",
      shellRegionCount: 0,
      sidebarCount: 0,
      mainCount: 0,
      modalHostCount: 1,
      authFormCount: 1,
      gateCount: 0,
      connectingCount: 0,
      disconnectedCount: 0,
      errorCount: 0,
    });
  }
}

function expectSuccessfulAuthenticationHandoff(
  records: readonly ApplicationPresentationRecord[],
): void {
  const presentations = applicationRecords(records);
  expect(presentations[0]).toMatchObject({
    appState: "unauthorized",
    shellRegionCount: 0,
    modalHostCount: 1,
    authFormCount: 1,
  });
  expect(SHELL_STATES.has(presentations.at(-1)?.appState ?? "")).toBe(true);

  for (const record of presentations) {
    expect(
      record.appState === "unauthorized" ||
      record.appState === "connecting" ||
      SHELL_STATES.has(record.appState!),
    ).toBe(true);
    if (record.appState === "unauthorized") {
      expect(record).toMatchObject({
        shellRegionCount: 0,
        modalHostCount: 1,
        authFormCount: 1,
        gateCount: 0,
        connectingCount: 0,
        disconnectedCount: 0,
        errorCount: 0,
      });
    }
    if (SHELL_STATES.has(record.appState!)) {
      expect(record).toMatchObject({
        shellRegionCount: 2,
        sidebarCount: 1,
        mainCount: 1,
        modalHostCount: 0,
        authFormCount: 0,
        gateCount: 0,
      });
    }
  }
}

test.describe("product browser token flow", () => {
  test("auth modal stores the token without writing it to the URL", async ({ page, baseURL }) => {
    const product = await launchProductServer({ auth: true });
    try {
      const appURL = await product.appURL(baseURL!);
      await page.goto(productAppCleanURL(appURL));

      const tokenInput = page.getByLabel("Access token");
      await expect(tokenInput).toBeVisible();
      await configureTestMotion(page);
      const presentation = await observeApplicationPresentations(page);
      await tokenInput.fill(product.token);
      await page.locator(".auth-form button", { hasText: "Connect" }).click();

      await expect(page.locator(".auth-form")).toHaveCount(0);
      await waitForApplicationShell(page);
      await presentation.settle();
      await presentation.stop();
      expectSuccessfulAuthenticationHandoff(presentation.records());
      await expect(page).toHaveURL(productAppCleanURL(appURL));
      const stored = await page.evaluate((origin) => {
        const raw = window.localStorage.getItem("store-television-browser");
        return raw ? JSON.parse(raw).authTokens?.[origin] : null;
      }, appURL);
      expect(stored).toBe(product.token);
    } finally {
      await product.dispose();
    }
  });

  test("stored-token HTTP 401 clears localStorage and returns to the auth modal", async ({ page, baseURL }) => {
    const product = await launchProductServer({ auth: true });
    try {
      const appURL = await product.appURL(baseURL!);
      await page.goto(productAppIndexURL(appURL, product.token));
      await waitForApplicationShell(page);
      await configureTestMotion(page);
      const presentation = await observeApplicationPresentations(page);

      await page.route(`${appURL}/channels`, async (route) => {
        const request = route.request();
        if (request.method() !== "POST") {
          await route.continue();
          return;
        }
        await route.continue({
          headers: {
            ...request.headers(),
            authorization: "Bearer wrong-token",
          },
        });
      });
      await page.evaluate(async () => {
        const application = (window as unknown as {
          __telepath: { applicationService: { createChannel(name: string): Promise<unknown> } };
        }).__telepath.applicationService;
        await application.createChannel("Rejected write").catch(() => undefined);
      });

      await expect(page.getByLabel("Access token")).toBeVisible();
      await presentation.settle();
      await presentation.stop();
      expectSoleUnauthorizedSettlement(presentation.records(), SHELL_STATES);
      const stored = await page.evaluate((origin) => {
        const raw = window.localStorage.getItem("store-television-browser");
        return raw ? JSON.parse(raw).authTokens?.[origin] ?? null : null;
      }, appURL);
      expect(stored).toBeNull();
    } finally {
      await product.dispose();
    }
  });

  test("stored-token WebSocket 4401 clears localStorage and returns to the auth modal", async ({ page, baseURL }) => {
    const product = await launchProductServer({ auth: true });
    try {
      const appURL = await product.appURL(baseURL!);
      const presentation = await observeApplicationPresentations(page);
      await page.addInitScript(({ origin, token }) => {
        if (window.location.origin !== origin) return;
        const key = "store-television-browser";
        const state = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        state.authTokens = { ...(state.authTokens ?? {}), [origin]: token };
        window.localStorage.setItem(key, JSON.stringify(state));
      }, { origin: appURL, token: "wrong-token" });

      await page.goto(productAppCleanURL(appURL));
      await expect(page.getByLabel("Access token")).toBeVisible();
      await presentation.settle();
      await presentation.stop();
      expectSoleUnauthorizedSettlement(
        presentation.records(),
        new Set(["connecting"]),
      );
      const stored = await page.evaluate((origin) => {
        const raw = window.localStorage.getItem("store-television-browser");
        return raw ? JSON.parse(raw).authTokens?.[origin] ?? null : null;
      }, appURL);
      expect(stored).toBeNull();
    } finally {
      await product.dispose();
    }
  });
});
