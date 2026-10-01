import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Real-browser coverage for the native copy-button surface
// (specs/ui/app/copy-button/index.md). The production view owns the clipboard
// chain, optimistic copied mark, in-place done content, and 1.4-second timer.

const FIXTURE = "/packages/web/test/e2e/fixtures/copy-button.html";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function setup(page: Page, query = ""): Promise<void> {
  await page.goto(`${FIXTURE}${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
}

test.describe("copy button", () => {
  test("^cb-copy: clicking the inner button copies the prompt to the system clipboard", async ({ page }) => {
    await setup(page);
    await page.locator("#cb").click();

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("THE PROMPT TEXT");
    // The primary (navigator.clipboard) path really carried it.
    expect(await page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites)).toEqual([
      "THE PROMPT TEXT",
    ]);
  });

  test("^cb-copy: confirms in place — copied attribute reflects and the done state shows", async ({ page }) => {
    await setup(page);
    const button = page.locator("#cb");

    await button.click();
    await expect(button).toHaveAttribute("copied", "");
    await expect(button.locator(".copy-button-done")).toBeVisible();
    await expect(button.locator(".copy-button-idle")).toBeHidden();
  });

  test("^cb-dwell: copied is removed after the ~1.4s dwell and reverts to idle", async ({ page }) => {
    await setup(page);
    const button = page.locator("#cb");

    await button.click();
    await expect(button).toHaveAttribute("copied", "");

    // The exact boundary is covered with the injected scheduler; this crosses
    // the production browser timer once with generous scheduling headroom.
    await expect(button).not.toHaveAttribute("copied", "", { timeout: 5000 });
    await expect(button.locator(".copy-button-idle")).toBeVisible();
    await expect(button.locator(".copy-button-done")).toBeHidden();
  });

  test("fallback path (?no-clipboard): execCommand still lands the prompt on the system clipboard", async ({ page }) => {
    await setup(page, "?no-clipboard");
    expect(await page.evaluate(() => navigator.clipboard === undefined)).toBe(true);

    await page.locator("#cb").click();

    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __realClipboard: { readText(): Promise<string> } }).__realClipboard.readText(),
        ),
      )
      .toBe("THE PROMPT TEXT");
    await expect(page.locator("#cb")).toHaveAttribute("copied", "");
  });
});
