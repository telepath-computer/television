import { expect, test } from "@playwright/test";

// Regression for the code-owned task kit: SPEC.md (Headers) and src/task.css.
// A page header is spaced from the list's first section by the page's one
// gap, whatever the header ends with and whether or not the page is a prose
// region. Each case is its own page, the header and the list children of its
// body. Production canonical and task CSS run in Chromium.
/** The gap SPEC.md names, `--space-12`, as canonical v2 resolves it. */
const HEADER_GAP_PX = 12;
const CASES = [
  "title", "subtitle", "hidden-message", "message",
  "prose-title", "prose-subtitle", "prose-hidden-message", "prose-message",
];

test("a header before the list is spaced from it by one gap, whatever it ends with", async ({ page }) => {
  for (const id of CASES) {
    await page.goto(`/test/e2e/fixtures/header.html?case=${id}`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const measured = await page.evaluate(() => {
      const space = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-12"));
      const shown = [...document.querySelectorAll("body > header > *")].filter((child) => !(child as HTMLElement).hidden);
      const section = document.querySelector("tv-task-section")!;
      return { space, gap: section.getBoundingClientRect().top - shown.at(-1)!.getBoundingClientRect().bottom };
    });
    expect(measured.space).toBe(HEADER_GAP_PX);
    expect.soft(measured.gap, id).toBeCloseTo(measured.space, 1);
  }
});
