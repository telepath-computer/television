import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@telepath-computer/television-server";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function createStoragePath(): string {
  const parent = path.join(REPO_ROOT, "tmp", "platform-marker-e2e");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, "run-"));
}

test.describe("application platform marker (^ui-t-platform-marker)", () => {
  test("marks only the exact Electron mode on the production document", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Browser application base URL is unavailable");
    const storagePath = createStoragePath();
    const server = new Server({
      store: createServingStore(storagePath),
      host: "127.0.0.1",
      port: 0,
      auth: false,
    });

    try {
      await server.start();
      const rows = [
        { name: "exact Electron mode", mode: "electron", platform: "electron" },
        { name: "absent mode", mode: null, platform: null },
        { name: "browser mode", mode: "browser", platform: null },
        { name: "case-different mode", mode: "Electron", platform: null },
        { name: "empty mode", mode: "", platform: null },
      ] as const;

      for (const row of rows) {
        const url = new URL("/packages/web/src/index.html", baseURL);
        url.searchParams.set("serverURL", server.getBaseURL());
        if (row.mode !== null) url.searchParams.set("mode", row.mode);

        await page.goto(url.href);
        await configureTestMotion(page);
        await expect(page.locator("#app")).toHaveAttribute("data-app-state", /.+/);
        const root = page.locator("html");
        if (row.platform === null) {
          expect(await root.getAttribute("data-platform"), row.name).toBeNull();
        } else {
          await expect(root, row.name).toHaveAttribute("data-platform", row.platform);
        }
      }
    } finally {
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
