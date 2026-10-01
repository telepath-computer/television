import { expect, test } from "@playwright/test";

const TASK_MARKUP = `
  <tv-task>
    <tv-task-checkbox></tv-task-checkbox>
    <tv-task-body>
      <tv-task-title>Some title</tv-task-title>
    </tv-task-body>
  </tv-task>
`;

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixtures/fixture.html");
});

test("clicking toggles and reflects host [checked]", async ({ page }) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
  }, TASK_MARKUP);

  const host = page.locator("tv-task-checkbox");

  await expect(host).not.toHaveAttribute("checked", /.*/);

  // Click the inner input (shadow DOM is pierced by Playwright locators).
  await host.locator("input").click();
  await expect(host).toHaveAttribute("checked", "");

  await host.locator("input").click();
  await expect(host).not.toHaveAttribute("checked", /.*/);
});

test("inner input accessible name equals the sibling tv-task-title text", async ({
  page,
}) => {
  const accessibleName = await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    const input = document
      .querySelector("tv-task-checkbox")
      ?.shadowRoot?.querySelector("input");
    return input?.getAttribute("aria-label") ?? null;
  }, TASK_MARKUP);

  expect(accessibleName).toBe("Some title");
});

test("disabled blocks toggling", async ({ page }) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    document
      .querySelector("tv-task-checkbox")
      ?.setAttribute("disabled", "");
  }, TASK_MARKUP);

  const host = page.locator("tv-task-checkbox");

  // A disabled input can't be clicked into a checked state.
  await host.locator("input").click({ force: true });
  await expect(host).not.toHaveAttribute("checked", /.*/);
});

test("the input is focusable and shows the focus ring", async ({ page }) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
  }, TASK_MARKUP);

  // Keyboard-focus the inner input and confirm :focus-visible matches (the ring).
  const focused = await page.evaluate(() => {
    const input = document
      .querySelector("tv-task-checkbox")
      ?.shadowRoot?.querySelector("input") as HTMLInputElement | undefined;
    input?.focus();
    return {
      isActive:
        document.querySelector("tv-task-checkbox")?.shadowRoot
          ?.activeElement === input,
      focusVisible: input?.matches(":focus-visible") ?? false,
    };
  });

  expect(focused.isActive).toBe(true);
  expect(focused.focusVisible).toBe(true);
});
