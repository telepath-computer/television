import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __cleanup: () => void;
    __refresh: () => void;
    __removed: HTMLElement;
    __writes: number;
    __observer: MutationObserver;
  }
}

const FIXTURE = "/packages/web/test/e2e/fixtures/item-edge-fade.html";

async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
  });
}

async function state(page: Page) {
  return page.locator(".item").evaluateAll((items) => items.map((item) => {
    const element = item as HTMLElement;
    return {
      faded: element.hasAttribute("data-item-edge-fade"),
      start: element.style.getPropertyValue("--item-fade-start"),
      end: element.style.getPropertyValue("--item-fade-end"),
      left: element.style.getPropertyValue("--item-fade-left"),
      right: element.style.getPropertyValue("--item-fade-right"),
    };
  }));
}

for (const edges of ["right", "both"] as const) {
  test(`positions ${edges} edge masks inside borders and clears exhausted edges`, async ({ page }) => {
    await page.goto(`${FIXTURE}?edges=${edges}&distance=200`);
    await settle(page);
    let items = await state(page);
    expect(items[0]!.faded).toBe(false);
    expect(items[2]).toEqual({ faded: true, start: "-200px", end: "100px", left: "0px", right: "150px" });
    await page.locator("#strip").evaluate((strip) => { strip.scrollLeft = 150; });
    await settle(page);
    items = await state(page);
    expect(items[1]!.faded).toBe(edges === "both");
    expect(items[4]!.right).toBe("150px");
    await page.locator("#strip").evaluate((strip) => { strip.scrollLeft = strip.scrollWidth; });
    await settle(page);
    items = await state(page);
    expect(items.at(-1)!.faded).toBe(false);
    expect(items.some((item) => item.right !== "" && item.right !== "0px")).toBe(false);
    await page.locator("#strip").evaluate((strip) => { (strip as HTMLElement).style.width = "700px"; });
    await settle(page);
    expect((await state(page)).every((item) => !item.faded && item.start === "")).toBe(true);
  });
}

test("updates after item, label, class and scrollport changes without recurring writes", async ({ page }) => {
  await page.goto(FIXTURE);
  await settle(page);
  await page.locator("#strip").evaluate((strip) => {
    const removed = strip.querySelector<HTMLElement>("[data-item-edge-fade]")!;
    removed.remove();
    window.__removed = removed;
    strip.querySelector(".item")!.textContent = "A much longer label that changes the item's width";
    strip.querySelector(".item")!.classList.add("natural");
  });
  await settle(page);
  expect(await page.evaluate(() => window.__removed.hasAttribute("data-item-edge-fade"))).toBe(false);
  expect((await state(page))[0]!.faded).toBe(true);
  expect(await page.evaluate(() => window.__removed.style.cssText)).toBe("");
  await page.locator("#strip").evaluate((strip) => {
    window.__writes = 0;
    const observer = new MutationObserver((records) => { window.__writes += records.length; });
    observer.observe(strip, { subtree: true, attributes: true });
    window.__observer = observer;
  });
  await settle(page);
  expect(await page.evaluate(() => window.__writes)).toBe(0);
  await page.locator("#strip").evaluate((strip) => { strip.replaceChildren(); });
  await settle(page);
  await page.locator("#strip").evaluate((strip) => {
    for (let i = 0; i < 7; i++) {
      const item = document.createElement("div");
      item.className = "item";
      strip.append(item);
    }
  });
  await settle(page);
  expect((await state(page)).some((item) => item.faded)).toBe(true);
});

test("cleanup cancels pending work and prevents subsequent writes", async ({ page }) => {
  await page.goto(FIXTURE);
  await settle(page);
  expect((await state(page)).some((item) => item.faded)).toBe(true);
  await page.locator("#strip").evaluate((strip) => {
    strip.dispatchEvent(new Event("scroll"));
    window.__cleanup();
    strip.scrollLeft = 100;
    strip.firstElementChild!.classList.add("natural");
    strip.append(document.createElement("div"));
  });
  await settle(page);
  expect((await state(page)).every((item) => !item.faded && item.start === "" && item.end === "" && item.left === "" && item.right === "")).toBe(true);
});


test("zero distance leaves overflowing content unmasked", async ({ page }) => {
  await page.goto(`${FIXTURE}?edges=both&distance=0`);
  await page.locator("#strip").evaluate((strip) => { strip.scrollLeft = 150; });
  await settle(page);
  expect((await state(page)).every((item) => !item.faded && item.start === "")).toBe(true);
});

// proofs/arch/ui/overflow-fade.md#^of-ac-explicit-refresh
test("explicit refresh updates position-only geometry and stays disposed", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.addStyleTag({ content: ":root { --fixture-gap: 4px; } #strip { gap: var(--fixture-gap); }" });
  await page.evaluate(() => window.__refresh());
  await settle(page);
  expect((await state(page))[2]!.end).toBe("92px");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--fixture-gap", "24px");
    window.__refresh();
    window.__refresh();
  });
  await settle(page);
  expect((await state(page))[2]!.end).toBe("52px");
  expect(await page.locator("#strip").evaluate(el => el.scrollLeft)).toBe(0);
  await page.evaluate(() => {
    window.__writes = 0;
    window.__observer = new MutationObserver(records => { window.__writes += records.length; });
    window.__observer.observe(document.querySelector("#strip")!, { attributes: true, subtree: true });
  });
  await settle(page);
  expect(await page.evaluate(() => window.__writes)).toBe(0);
  await page.evaluate(() => {
    window.__refresh();
    window.__cleanup();
    window.__cleanup();
    window.__refresh();
    document.documentElement.style.setProperty("--fixture-gap", "44px");
  });
  await settle(page);
  expect((await state(page)).every(item => !item.faded && item.end === "")).toBe(true);
});
