import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@telepath-computer/television-server";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

const FIXTURE = "/packages/web/test/e2e/fixtures/token-only-persistence.html";
const STORAGE_KEY = "store-television-browser";

function recordVariants(locallySelectedChannelID: string) {
  return [
    {
      name: "screen spelling",
      fields: {
        activeScreenID: locallySelectedChannelID,
        screens: {
          [locallySelectedChannelID]: { scrollPosition: 400, lastActivatedAt: 9_999 },
          "server-focused": { scrollPosition: 800, lastActivatedAt: 1 },
        },
        promotedOnboardingScreens: { retired: ["calendar"] },
      },
    },
    {
      name: "channel spelling",
      fields: {
        focusedChannelId: locallySelectedChannelID,
        channels: {
          [locallySelectedChannelID]: { scrollPosition: 400, lastActivatedAt: 9_999 },
          "server-focused": { scrollPosition: 800, lastActivatedAt: 1 },
        },
        promotedOnboardingChannels: { retired: ["calendar"] },
      },
    },
  ] as const;
}

test("pre-redesign records carry only auth while real server state controls landing", async ({ browser, baseURL }) => {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-token-persistence-e2e-"));
  const store = createServingStore(storagePath);
  const locallySelected = store.listChannels()[0]!;
  store.updateChannel({
    channelID: locallySelected.id,
    fields: { name: "Locally selected first" },
  });
  const serverFocused = store.createChannel({ id: "server-focused", name: "Server focused" });
  const third = store.createChannel({ id: "server-third", name: "Server third" });
  store.createArtifact({
    id: "server-first-page",
    channelID: serverFocused.id,
    kind: "url",
    title: "First page",
    url: "https://example.com/first",
  });
  store.createArtifact({
    id: "server-second-page",
    channelID: serverFocused.id,
    kind: "url",
    title: "Second page",
    url: "https://example.com/second",
  });
  store.patchDisplay({ focusedChannelId: serverFocused.id });

  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  try {
    await server.start();
    const serverURL = server.getBaseURL();
    const expectedChannels = [locallySelected.id, serverFocused.id, third.id];
    const expectedTokenState = { authTokens: { [serverURL]: server.getAuthToken() } };

    for (const variant of recordVariants(locallySelected.id)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const retiredRecord = {
        servers: [
          { url: "http://retired.invalid", name: "Retired" },
          { url: serverURL, name: "Persisted server" },
        ],
        activeServerURL: serverURL,
        tabs: { [serverURL]: [locallySelected.id] },
        authTokens: expectedTokenState.authTokens,
        ...variant.fields,
      };
      await page.addInitScript(
        ({ key, value }) => window.localStorage.setItem(key, value),
        { key: STORAGE_KEY, value: JSON.stringify(retiredRecord) },
      );

      try {
        await page.goto(`${baseURL}${FIXTURE}?serverURL=${encodeURIComponent(serverURL)}`);

        for (const phase of ["initial load", "reload"] as const) {
          await expect(page.locator("#connection-status"), `${variant.name}, ${phase}`).toHaveText("connected");
          await expect(page.locator("#focused-channel"), `${variant.name}, ${phase}`).toHaveText(serverFocused.id);
          await expect(page.locator("#channels li"), `${variant.name}, ${phase}`).toHaveText(expectedChannels);
          await expect(page.locator("#first-page"), `${variant.name}, ${phase}`).toHaveText("server-first-page");
          await expect(page.locator("#persisted-state"), `${variant.name}, ${phase}`).toHaveText(JSON.stringify(expectedTokenState));
          await expect(page.locator("auth-modal"), `${variant.name}, ${phase}`).toHaveCount(0);

          if (phase === "initial load") await page.reload();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});
