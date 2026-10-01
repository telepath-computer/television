import { expect as playwrightExpect, test, type Page } from "@playwright/test";

// Regression for the code-owned task kit: SPEC.md (Look & feel; States),
// src/task.css and src/task.ts. Shared token inheritance follows the existing
// specs/ui/foundation/index.md#overriding contract. Production CSS/components
// run in Chromium; this does not test server theme selection or delivery.
const expect = playwrightExpect.configure({ timeout: 1000 });
const MIN_CHECKMARK_CONTRAST = 3;
const appearances = [
  { theme: "none", mode: "light" },
  { theme: "none", mode: "dark" },
  { theme: "overrides", mode: "light" },
  { theme: "overrides", mode: "dark" },
  { theme: "nord", mode: "dark" },
] as const;

for (const { theme, mode } of appearances) {
  test(`task appearance inherits ${theme} in ${mode}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.goto(`/test/e2e/fixtures/appearance.html?theme=${theme}`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);

    const baseline = await sharedColors(page);
    expect(baseline.scheme).toBe(mode);
    if (theme === "overrides") {
      expect(baseline.muted).toBe(await resolveColor(page, `var(--cyan-${mode === "light" ? "800" : "300"})`));
      expect(baseline.primary).toBe(await resolveColor(page, `var(--${mode === "light" ? "yellow-200" : "blue-800"})`));
    }
    await page.locator("#tasks").evaluate((style) => style.removeAttribute("media"));
    expect.soft(await sharedColors(page)).toEqual(baseline);

    const metadata = await resolveColor(page, `color-mix(in srgb, ${baseline.muted} 85%, transparent)`);
    const highlight = await resolveColor(page, `color-mix(in srgb, ${baseline.alert} 10%, transparent)`);
    await expect.soft(page.locator("tv-task-note")).toHaveCSS("color", baseline.muted);
    await expect.soft(page.locator("tv-task-placeholder")).toHaveCSS("color", baseline.muted);
    await expect.soft(page.locator("#disabled tv-task-title")).toHaveCSS("color", baseline.muted);
    await expect.soft(page.locator("tv-task-count")).toHaveCSS("color", metadata);
    await expect.soft(page.locator("tv-task-meta-tag")).toHaveCSS("color", metadata);
    await expect.soft(page.locator("tv-task-meta-tag")).toHaveCSS("background-color", baseline.surfaceMuted);
    await expect.soft(page.locator("#today tv-task-meta-due")).toHaveAttribute("state", "today");
    await expect.soft(page.locator("#today tv-task-meta-due")).toHaveCSS("color", baseline.alert);
    await expect.soft(page.locator("#overdue tv-task-meta-due")).toHaveCSS("color", baseline.danger);
    await expect.soft(page.locator("#upcoming tv-task-meta-due")).toHaveCSS("color", metadata);
    await expect.soft(page.locator("#today")).toHaveCSS("background-color", highlight);

    const checkbox = page.locator("#today tv-task-checkbox");
    await checkbox.getByRole("checkbox").check();
    await expect(checkbox).toHaveAttribute("checked", "");
    await expect(checkbox.locator(".mark")).toHaveCSS("border-color", baseline.primary);
    const mark = await checkbox.locator(".mark").evaluate((element) => ({
      fill: getComputedStyle(element, "::before").backgroundColor,
      ink: getComputedStyle(element, "::after").borderBottomColor,
    }));
    expect.soft(mark.fill).toBe(baseline.primary);
    expect.soft(mark.ink).toBe(baseline.primaryText);
    expect.soft(await contrastRatio(page, mark.fill, mark.ink)).toBeGreaterThanOrEqual(MIN_CHECKMARK_CONTRAST);
    await expect.soft(page.locator("#today tv-task-title")).toHaveCSS("color", baseline.muted);
    await expect.soft(page.locator("#today tv-task-meta-due")).toHaveCSS("color", metadata);
    await expect.soft(page.locator("#today")).toHaveCSS("background-color", highlight);
    await page.locator("#overdue").getByRole("checkbox").check();
    await expect.soft(page.locator("#overdue tv-task-meta-due")).toHaveCSS("color", metadata);

    // Keep the existing author customization properties usable.
    await checkbox.getByRole("checkbox").uncheck();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--task-due-today", "var(--color-success)");
      document.documentElement.style.setProperty("--task-meta-text", "var(--color-text)");
      document.querySelector<HTMLElement>("#today")!.style.setProperty("--task-highlight", "var(--color-primary)");
    });
    await expect(page.locator("#today tv-task-meta-due")).toHaveCSS("color", await resolveColor(page, "var(--color-success)"));
    await expect(page.locator("#upcoming tv-task-meta-due")).toHaveCSS("color", baseline.text);
    await expect(page.locator("#today")).toHaveCSS("background-color", await resolveColor(page, `color-mix(in srgb, ${baseline.primary} 10%, transparent)`));
  });
}

async function resolveColor(page: Page, value: string): Promise<string> {
  return page.evaluate((css) => {
    const probe = document.createElement("span");
    probe.style.color = css;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, value);
}

async function sharedColors(page: Page) {
  const names = {
    surface: "--color-surface", surfaceMuted: "--color-surface-muted",
    text: "--color-text", muted: "--color-text-muted", border: "--color-border",
    primary: "--color-primary", primaryText: "--color-primary-text",
    alert: "--color-alert", danger: "--color-danger",
  };
  const colors: Record<string, string> = {};
  for (const [name, token] of Object.entries(names)) colors[name] = await resolveColor(page, `var(${token})`);
  colors.scheme = await page.locator("html").evaluate((root) => getComputedStyle(root).colorScheme);
  return colors;
}

async function contrastRatio(page: Page, fill: string, ink: string): Promise<number> {
  /* eslint-disable @typescript-eslint/no-magic-numbers -- Standard sRGB channel conversion and relative-luminance coefficients. */
  return page.evaluate(([background, foreground]) => {
    // Canvas converts supported browser color spaces to sRGB for luminance.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const luminance = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        .map((value) => value / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const a = luminance(background);
    const b = luminance(foreground);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, [fill, ink]);
  /* eslint-enable @typescript-eslint/no-magic-numbers */
}
