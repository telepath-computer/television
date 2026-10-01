import { expect, test } from "@playwright/test";

const TASK_MARKUP = `
  <tv-task-list>
    <tv-task id="t1">
      <tv-task-checkbox></tv-task-checkbox>
      <tv-task-body>
        <tv-task-title>Some title</tv-task-title>
      </tv-task-body>
    </tv-task>
  </tv-task-list>
`;

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixtures/fixture.html");
});

test("clicking dispatches a toggle event whose checked flips true then false", async ({
  page,
}) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    (window as unknown as { __toggles: boolean[] }).__toggles = [];
    document
      .querySelector("tv-task-checkbox")!
      .addEventListener("toggle", (e) => {
        (window as unknown as { __toggles: boolean[] }).__toggles.push(
          (e as Event & { checked: boolean }).checked,
        );
      });
  }, TASK_MARKUP);

  const host = page.locator("tv-task-checkbox");

  await host.locator("input").click();
  await host.locator("input").click();

  const toggles = await page.evaluate(
    () => (window as unknown as { __toggles: boolean[] }).__toggles,
  );
  expect(toggles).toEqual([true, false]);
});

test("the toggle event bubbles to an ancestor and exposes e.checked", async ({
  page,
}) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    (window as unknown as { __bubbled: boolean | null }).__bubbled = null;
    document
      .querySelector("tv-task-list")!
      .addEventListener("toggle", (e) => {
        (window as unknown as { __bubbled: boolean | null }).__bubbled = (
          e as Event & { checked: boolean }
        ).checked;
      });
  }, TASK_MARKUP);

  await page.locator("tv-task-checkbox input").click();

  const bubbled = await page.evaluate(
    () => (window as unknown as { __bubbled: boolean | null }).__bubbled,
  );
  expect(bubbled).toBe(true);
});

test("Space on the focused inner input fires toggle with checked=true and reflects [checked]", async ({
  page,
}) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    (window as unknown as { __toggles: boolean[] }).__toggles = [];
    document
      .querySelector("tv-task-checkbox")!
      .addEventListener("toggle", (e) => {
        (window as unknown as { __toggles: boolean[] }).__toggles.push(
          (e as Event & { checked: boolean }).checked,
        );
      });
  }, TASK_MARKUP);

  const host = page.locator("tv-task-checkbox");

  await host.locator("input").focus();
  await page.keyboard.press("Space");

  await expect(host).toHaveAttribute("checked", "");
  const toggles = await page.evaluate(
    () => (window as unknown as { __toggles: boolean[] }).__toggles,
  );
  expect(toggles).toEqual([true]);
});

test("setting .checked reflects the attribute, completes the row, and emits no toggle", async ({
  page,
}) => {
  await page.evaluate((markup) => {
    document.body.innerHTML = markup;
    (window as unknown as { __toggles: boolean[] }).__toggles = [];
    document
      .querySelector("tv-task-checkbox")!
      .addEventListener("toggle", (e) => {
        (window as unknown as { __toggles: boolean[] }).__toggles.push(
          (e as Event & { checked: boolean }).checked,
        );
      });
  }, TASK_MARKUP);

  const reflected = await page.evaluate(() => {
    const el = document.querySelector(
      "tv-task-checkbox",
    ) as HTMLElement & { checked: boolean };
    el.checked = true;
    return {
      hasAttr: el.hasAttribute("checked"),
      innerChecked: el.shadowRoot?.querySelector("input")?.checked ?? false,
    };
  });

  expect(reflected.hasAttr).toBe(true);
  expect(reflected.innerChecked).toBe(true);

  const toggles = await page.evaluate(
    () => (window as unknown as { __toggles: boolean[] }).__toggles,
  );
  expect(toggles).toEqual([]);
});
