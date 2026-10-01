import { expect, test } from "@playwright/test";

// The upgrade-property hazard: a `checked` property set on <tv-task-checkbox>
// before its defining module is imported lands as an own instance property that
// shadows the class accessor after upgrade. The fixture sets `el.checked = true`
// and only then dynamic-imports the module; the guard in connectedCallback must
// replay the captured value through the real setter.
test("a checked property set before definition reflects after upgrade", async ({
  page,
}) => {
  await page.goto("/test/e2e/fixtures/checkbox-upgrade.html");
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );

  // The host attribute reflects (this is what row styling keys on).
  await expect(page.locator("tv-task-checkbox")).toHaveAttribute("checked", "");

  const state = await page.evaluate(() => {
    const el = document.getElementById("cb") as HTMLElement & { checked: boolean };
    return {
      checked: el.checked,
      innerChecked: el.shadowRoot?.querySelector("input")?.checked ?? false,
      ownProp: Object.prototype.hasOwnProperty.call(el, "checked"),
      titleDecoration: getComputedStyle(document.getElementById("title")!)
        .textDecorationLine,
    };
  });

  expect(state.checked).toBe(true);
  expect(state.innerChecked).toBe(true);
  // The shadowing own property is gone — reads go through the accessor again.
  expect(state.ownProp).toBe(false);
  // The completed-row style applies (task.css strikes the title through).
  expect(state.titleDecoration).toContain("line-through");
});
