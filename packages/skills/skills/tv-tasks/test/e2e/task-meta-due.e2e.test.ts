import { expect, test } from "@playwright/test";

const FUTURE_DAYS = 400;

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixtures/fixture.html");
});

async function mountDue(
  page: import("@playwright/test").Page,
  date: string,
): Promise<void> {
  await page.evaluate((iso) => {
    const due = document.createElement("tv-task-meta-due");
    due.setAttribute("date", iso);
    document.body.append(due);
  }, date);
}

test("today's date → [state=\"today\"], text \"Today\"", async ({ page }) => {
  const todayISO = await page.evaluate(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

  await mountDue(page, todayISO);

  const due = page.locator("tv-task-meta-due");
  await expect(due).toHaveAttribute("state", "today");
  await expect(due).toContainText("Today");
});

test('a clearly-past date → [state="overdue"], text "Jan 1, 2000"', async ({
  page,
}) => {
  await mountDue(page, "2000-01-01");

  const due = page.locator("tv-task-meta-due");
  await expect(due).toHaveAttribute("state", "overdue");
  await expect(due).toContainText("Jan 1, 2000");
});

test('a clearly-future date → [state="upcoming"]', async ({ page }) => {
  const futureISO = await page.evaluate((days) => {
    const now = new Date();
    now.setDate(now.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, FUTURE_DAYS);

  await mountDue(page, futureISO);

  await expect(page.locator("tv-task-meta-due")).toHaveAttribute(
    "state",
    "upcoming",
  );
});

test("a malformed date → no state attribute, visible 'Invalid date' label", async ({ page }) => {
  await mountDue(page, "tomorrow");

  const due = page.locator("tv-task-meta-due");
  await expect(due).not.toHaveAttribute("state", /.*/);

  const label = await page.evaluate(
    () =>
      document
        .querySelector("tv-task-meta-due")
        ?.shadowRoot?.querySelector(".label")?.textContent ?? null,
  );
  expect(label).toBe("Invalid date");
});

test("the calendar glyph has a nonzero box inside the shadow root", async ({
  page,
}) => {
  await mountDue(page, "2000-01-01");

  const registeredIconClass = await page.evaluate(() => {
    const iconClass = customElements.get("tv-icon");
    return {
      name: iconClass?.name ?? null,
      baseName: iconClass ? Object.getPrototypeOf(iconClass).name : null,
    };
  });
  expect(registeredIconClass).toEqual({
    name: "IconElement",
    baseName: "HTMLElement",
  });

  const box = await page.evaluate(() => {
    const glyph = document
      .querySelector("tv-task-meta-due")
      ?.shadowRoot?.querySelector("tv-icon")
      ?.shadowRoot?.querySelector("svg");
    return glyph?.getBoundingClientRect().toJSON() ?? null;
  });

  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
});
