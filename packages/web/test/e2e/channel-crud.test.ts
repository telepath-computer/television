import { TelevisionClient } from "@telepath-computer/television-shared";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";
import {
  APPLICATION_SHELL_STATES,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion } from "./helpers.ts";

function appIndexURL(appURL: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  return url.toString();
}

test.describe("channel deletion walk", () => {
  test("deleting a channel through the permanent sidebar removes it from server storage", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Expected Playwright baseURL");
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      const { channel: doomed } = await client.channels.create({ name: "Doomed" });
      await client.display.patch({ focusedChannelId: doomed.id });
      const appURL = await product.appURL(baseURL);

      await page.goto(appIndexURL(appURL));
      await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
      await configureTestMotion(page);
      await expect(page.getByRole("listbox", { name: "Channels" })).toBeVisible();

      const doomedRow = page.locator(`.channel-row[data-channel-id="${doomed.id}"]`);
      await doomedRow.getByTitle("Doomed menu", { exact: true }).click();
      await page.locator("tv-menu[open] tv-menu-item").filter({ hasText: /^Delete$/ }).click();
      await page
        .getByRole("alertdialog", { name: "Delete “Doomed”?" })
        .getByRole("button", { name: "Delete", exact: true })
        .click();

      await expect.poll(async () =>
        (await client.channels.list()).channels.map((channel) => channel.name)
      ).toEqual(["Default"]);
      await expect(doomedRow).toHaveCount(0);
    } finally {
      await product.dispose();
    }
  });
});
