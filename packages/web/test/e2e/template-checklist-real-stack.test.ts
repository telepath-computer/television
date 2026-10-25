import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { ChecklistHarness, TEST_HOST_LAUNCH } from "./checklist-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 640, height: 800 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

type Item = { order: number; text: string; done: boolean; [key: string]: JSONValue };
type Checklist = { title: string; items: Record<string, Item>; [key: string]: JSONValue };
const item = (text: string, order: number, done = false): Item => ({ text, order, done });
const fixture = (): Checklist => ({ title: "Groceries", items: { a: item("Apples", 0), b: item("Bread", 1), c: item("Coffee", 2) } });
let h: ChecklistHarness;
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("Checklist page error:", error));
  h = await ChecklistHarness.start();
});
test.afterEach(async () => { await h?.cleanup(); });

async function open(page: Page, value: Checklist = fixture()): Promise<string> {
  const id = await h.createStored(value);
  await h.open(page, id);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveText(value.title);
  return id;
}
const text = (frame: Page | Frame, index: number): Locator => frame.locator(".checklist-text").nth(index);
const add = (frame: Page | Frame): Locator => frame.getByRole("textbox", { name: "Add an item", exact: true });
const title = (frame: Page | Frame): Locator => frame.getByRole("textbox", { name: "Title", exact: true });
async function texts(id: string): Promise<string[]> {
  const value = await h.read<Checklist>(id);
  return Object.entries(value!.items).sort((a, b) => a[1].order - b[1].order).map(([, value]) => value.text);
}
async function caret(field: Locator, offset?: number): Promise<void> {
  await field.focus();
  await field.evaluate((element, position) => {
    const range = document.createRange();
    if (position === undefined) { range.selectNodeContents(element); range.collapse(false); }
    else { range.setStart(element.firstChild ?? element, position); range.collapse(true); }
    const selection = getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  }, offset);
}
async function selection(frame: Page | Frame): Promise<{ text: string | null; offset: number }> {
  return frame.evaluate(() => {
    const selected = getSelection();
    const node = selected?.anchorNode;
    const offset = selected?.anchorOffset ?? -1;
    return {
      text: node?.textContent ?? null,
      offset: node?.nodeType === Node.ELEMENT_NODE
        ? [...node.childNodes].slice(0, offset).reduce((length, child) => length + (child.textContent?.length ?? 0), 0)
        : offset,
    };
  });
}
async function observeStore(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const url = "/sdk/v1/resources.js";
    const sdk = await import(url) as typeof import("../../../shared/src/resources/sdk.ts");
    const observations: { value: unknown; pending: boolean }[] = [];
    const access: (string | null)[] = [];
    Object.assign(window, { checklistValues: observations, checklistAccess: access });
    sdk.onValue(sdk.ref(sdk.getStore()), snapshot => observations.push({ value: snapshot.val(), pending: snapshot.metadata.hasPendingWrites }));
    sdk.onAccessChanged(level => access.push(level));
  });
}
async function observedValues(page: Page): Promise<{ value: Checklist | undefined; pending: boolean }[]> {
  return page.evaluate(() => (window as unknown as { checklistValues: { value: Checklist | undefined; pending: boolean }[] }).checklistValues);
}
function writes(): Record<string, unknown>[] {
  return h.proxy.messages.filter(({ message }) => message.type === "write").map(({ message }) => message.write as Record<string, unknown>);
}

// proofs/ui/templates/checklist.md#^checklist-ui-ac-new
// proofs/arch/templates/checklist.md#^templates-checklist-t-delivery
// proofs/product/templates.md delegates the bundled journey to checklist-ui-ac-new.
test("new Checklist from the Toolbox persists its seed, display, additions and independent assets", async ({ page }) => {
  const responses: { url: string; body: Buffer }[] = [];
  const bodies: Promise<void>[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/styles.css|sdk\/v1\/resources.js|\/styles.css$/.test(response.url())) {
      bodies.push(response.body().then(body => { responses.push({ url: response.url(), body }); }));
    }
  });
  const { artifactID: id, frame } = await h.create(page);
  await expect(title(frame)).toHaveText("Checklist");
  await expect(text(frame, 0)).toHaveCount(0);
  await expect(add(frame)).toBeFocused();
  expect(await h.read(id)).toEqual({ title: "Checklist", items: {} });
  const layout = (await h.client.channels.get({ channelID: h.channelID })).channel.layout;
  expect(layout[0]).toMatchObject({ size: { width: 640, height: 800 }, geometry: { kind: "single", full_screen: false } });
  expect(await frame.evaluate(() => ({ origin: window.origin, secure: isSecureContext }))).toEqual({ origin: "null", secure: false });
  const count = writes().length;
  await add(frame).press("Enter");
  await add(frame).fill("   "); await add(frame).press("Enter");
  await expect(add(frame)).toHaveValue("   ");
  expect(writes()).toHaveLength(count);
  await add(frame).fill("Oat milk"); await add(frame).press("Enter");
  await expect.poll(() => texts(id)).toEqual(["Oat milk"]);
  await expect(add(frame)).toHaveValue(""); await expect(add(frame)).toBeFocused();
  const stored = await h.read<Checklist>(id);
  expect(Object.values(stored!.items)).toEqual([{ text: "Oat milk", order: 0, done: false }]);
  expect(writes().slice(count)).toEqual([{ kind: "push", path: "items", key: Object.keys(stored!.items)[0], value: { value: item("Oat milk", 0) } }]);
  await Promise.all(bodies);
  expect(responses.some(response => response.url.includes("/canonical/v2/styles.css"))).toBe(true);
  expect(responses.some(response => response.url.includes("/sdk/v1/resources.js"))).toBe(true);
  expect(responses.find(response => /\/artifact\/.*\/styles.css$/.test(response.url))?.body)
    .toEqual(readFileSync(path.resolve(import.meta.dirname, "../../../server/assets/templates/checklist/styles.css")));
  renameSync(path.join(h.home, "templates/checklist"), path.join(h.home, "checklist-outside-discovery"));
  await page.reload();
  const reloaded = await h.frame(page, id);
  await expect(text(reloaded, 0)).toHaveText("Oat milk");
  await text(reloaded, 0).fill("Milk after reload");
  await expect.poll(() => texts(id)).toEqual(["Milk after reload"]);
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-title
// proofs/arch/templates/checklist.md#^templates-checklist-t-write-scope
test("title saves before blur, preserves empty title, joins pasted lines and enters the list", async ({ page }) => {
  const id = await open(page);
  const firstWrite = writes().length;
  await title(page).click(); await title(page).fill("Today");
  await expect.poll(() => h.read(id, "title")).toBe("Today");
  await expect(title(page)).toBeFocused();
  expect(writes().slice(firstWrite)).toEqual([{ kind: "set", path: "title", value: { value: "Today" } }]);
  await title(page).fill("");
  await expect.poll(() => h.read(id, "title")).toBe("");
  await expect(title(page)).toHaveAttribute("data-placeholder", "Untitled");
  await h.clipboard(page, "One\nTwo\r\nThree");
  await title(page).focus(); await title(page).press("ControlOrMeta+V");
  await expect.poll(() => h.read(id, "title")).toBe("One Two Three");
  for (const key of ["Enter", "Shift+Enter"]) {
    await title(page).press(key);
    await expect(text(page, 0)).toBeFocused(); await expect(text(page, 0)).toHaveText("");
    await expect.poll(() => texts(id)).toEqual(["", "Apples", "Bread", "Coffee"]);
    await add(page).focus();
    await expect.poll(() => texts(id)).toEqual(["Apples", "Bread", "Coffee"]);
  }
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-title
// proofs/ui/templates/checklist.md#^checklist-ui-ac-items
// proofs/arch/templates/checklist.md#^templates-checklist-t-transaction
test("Return focuses the optimistic row before an ordinary or transaction acknowledgement", async ({ page }) => {
  const id = await open(page);
  h.proxy.holdWrites();
  await title(page).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(text(page, 0)).toBeFocused();
  await page.keyboard.type("First draft");
  await expect(text(page, 0)).toHaveText("First draft");
  await expect(title(page)).toHaveText("Groceries");
  h.proxy.releaseWrites();
  await expect.poll(() => texts(id)).toEqual(["First draft", "Apples", "Bread", "Coffee"]);
  await add(page).focus();
  const tied = fixture(); tied.items.b!.order = 0;
  await h.set(id, tied); await expect(text(page, 0)).toHaveText("Apples");
  h.proxy.holdWrites(); await text(page, 0).press("Enter");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(text(page, 1)).toBeFocused();
  await page.keyboard.type("Middle draft"); await expect(text(page, 1)).toHaveText("Middle draft");
  await h.set(id, { ...item("Concurrent coffee", 2, true), extra: "retained" }, "items/c");
  h.proxy.releaseWrites();
  await expect.poll(() => texts(id)).toEqual(["Apples", "Middle draft", "Bread", "Concurrent coffee"]);
  expect(await h.read(id, "items/c")).toMatchObject({ text: "Concurrent coffee", done: true, extra: "retained" });
  expect(writes().filter(write => write.kind === "compare-and-set").length).toBeGreaterThanOrEqual(2);
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-items
// proofs/arch/templates/checklist.md#^templates-checklist-t-write-scope
test("items save complete objects, retain whitespace and order, insert rows and keep native undo", async ({ page }) => {
  const value = fixture(); value.extra = "root"; value.items.a!.extra = "drop"; value.items.b!.extra = "keep";
  const id = await open(page, value);
  const firstWrite = writes().length;
  await page.getByRole("checkbox", { name: "Apples", exact: true }).click();
  await expect.poll(() => h.read(id, "items/a")).toEqual(item("Apples", 0, true));
  await text(page, 0).fill("  Fresh apples  ");
  await expect.poll(() => h.read(id, "items/a")).toEqual(item("  Fresh apples  ", 0, true));
  await expect(text(page, 0)).toBeFocused();
  expect(writes().slice(firstWrite)).toEqual([
    { kind: "set", path: "items/a", value: { value: item("Apples", 0, true) } },
    { kind: "set", path: "items/a", value: { value: item("  Fresh apples  ", 0, true) } },
  ]);
  expect(await h.read(id, "extra")).toBe("root"); expect(await h.read(id, "items/b/extra")).toBe("keep");
  await expect(page.locator(".checklist-item").first()).toHaveAttribute("data-done", "");
  for (const key of ["Enter", "Shift+Enter"]) {
    await text(page, 0).press(key);
    await expect(text(page, 1)).toBeFocused();
    await expect.poll(() => texts(id)).toEqual(["  Fresh apples  ", "", "Bread", "Coffee"]);
    await text(page, 1).fill("   "); await add(page).focus();
    await expect.poll(() => texts(id)).toEqual(["  Fresh apples  ", "Bread", "Coffee"]);
  }
  await caret(text(page, 1)); await text(page, 1).pressSequentially(" rolls");
  await expect.poll(() => h.read(id, "items/b/text")).toBe("Bread rolls");
  await text(page, 1).press("ControlOrMeta+Z");
  await expect.poll(() => h.read(id, "items/b/text")).toBe("Bread");
  await add(page).focus();
  const count = writes().length;
  await h.set(id, "First\nsecond\r\nthird", "items/c/text");
  await expect(text(page, 2)).toHaveText("First second third");
  expect(writes()).toHaveLength(count);
  await expect(page.locator(".checklist-items .checklist-items")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /clear|nest|indent|restore/i })).toHaveCount(0);
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-navigation
// proofs/ui/templates/checklist.md#^checklist-ui-t-shortcut-delivery
test("real keys navigate visual lines, handle empty Backspace and toggle without moving the caret", async ({ page }) => {
  const value = fixture(); value.items.b!.text = "Wrapped words ".repeat(22);
  const id = await open(page, value);
  await caret(text(page, 1), 0); await text(page, 1).press("ArrowDown");
  await expect(text(page, 1)).toBeFocused(); expect((await selection(page)).offset).toBeGreaterThan(0);
  await text(page, 1).press("ArrowUp"); await expect(text(page, 1)).toBeFocused();
  await caret(text(page, 1), 0); await text(page, 1).press("ArrowUp");
  await expect(text(page, 0)).toBeFocused();
  await caret(text(page, 0), 0); await text(page, 0).press("ArrowUp"); await expect(title(page)).toBeFocused();
  await text(page, 1).focus();
  await text(page, 1).evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(true);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await text(page, 1).press("ArrowUp"); await expect(text(page, 0)).toBeFocused();
  await caret(text(page, 1)); await text(page, 1).press("ArrowUp"); await expect(text(page, 1)).toBeFocused();
  await caret(text(page, 1)); await text(page, 1).press("ArrowDown"); await expect(text(page, 2)).toBeFocused();
  await caret(text(page, 2)); await text(page, 2).press("ArrowDown"); await expect(add(page)).toBeFocused();
  await caret(text(page, 0), 2);
  const before = await selection(page);
  await text(page, 0).press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect.poll(() => h.read(id, "items/a/done")).toBe(true);
  expect(await selection(page)).toEqual(before); await expect(text(page, 0)).toBeFocused();
  await text(page, 0).press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect.poll(() => h.read(id, "items/a/done")).toBe(false);
  expect(await selection(page)).toEqual(before);
  await text(page, 0).press("Enter"); await expect(text(page, 1)).toBeFocused();
  await text(page, 1).press("Backspace"); await expect(text(page, 0)).toBeFocused();
  expect(await selection(page)).toEqual({ text: "Apples", offset: 6 });
  await add(page).focus();
  await h.set(id, { title: "First empty", items: { sole: item("", 0), next: item("Next", 1) } });
  await expect(text(page, 0)).toHaveText(""); await text(page, 0).focus(); await text(page, 0).press("Backspace");
  await expect(text(page, 0)).toBeFocused(); expect(await h.read(id, "items/sole")).toEqual(item("", 0));
  await h.set(id, { title: "Only", items: { sole: item("", 0) } });
  await expect(page.locator(".checklist-text")).toHaveCount(1);
  await text(page, 0).focus(); await text(page, 0).press("Backspace");
  await expect(text(page, 0)).toBeFocused(); expect(await h.read(id, "items/sole")).toEqual(item("", 0));
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-navigation
test("pointer positions on either side of a soft wrap preserve visual-line navigation", async ({ page }) => {
  const value = fixture(); value.items.b!.text = "Wrapped words ".repeat(22);
  await open(page, value);
  await page.evaluate(() => document.fonts.ready);
  const field = text(page, 1);
  for (const direction of ["ArrowUp", "ArrowDown"] as const) {
    const wrap = await field.evaluate((element, key) => {
      const range = document.createRange();
      const node = element.firstChild!;
      const wraps = [];
      for (let offset = 1; offset < node.textContent!.length; offset++) {
        range.setStart(node, offset); range.collapse(true);
        const rects = [...range.getClientRects()];
        if (rects.length === 2 && rects[0]!.top !== rects[1]!.top) {
          wraps.push({ offset, points: rects.map((rect, index) => ({ x: rect.x + (index ? 1 : -1), y: rect.y + rect.height / 2 })) });
        }
      }
      return key === "ArrowUp" ? wraps[0]! : wraps.at(-1)!;
    }, direction);
    expect(wrap).toBeDefined();
    for (const side of [0, 1]) {
      const point = wrap.points[side]!;
      await page.mouse.click(point.x, point.y);
      await expect(field).toBeFocused();
      expect((await selection(page)).offset).toBe(wrap.offset);
      await page.keyboard.press(direction);
      const boundary = direction === "ArrowUp" ? side === 0 : side === 1;
      await expect(boundary ? text(page, direction === "ArrowUp" ? 0 : 2) : field).toBeFocused();
      if (!boundary) {
        const moved = (await selection(page)).offset;
        if (direction === "ArrowUp") expect(moved).toBeLessThan(wrap.offset);
        else expect(moved).toBeGreaterThan(wrap.offset);
      }
    }
  }
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-paste
test("real clipboard paste appends lines and inserts at an item caret in order", async ({ page }) => {
  const id = await open(page);
  await h.clipboard(page, "Tea\n\n  \nMilk\nEggs");
  await add(page).focus(); await add(page).press("ControlOrMeta+V");
  await expect.poll(() => texts(id)).toEqual(["Apples", "Bread", "Coffee", "Tea", "Milk", "Eggs"]);
  await h.clipboard(page, "X\n\nY\nZ");
  await caret(text(page, 0), 2); await text(page, 0).press("ControlOrMeta+V");
  await expect.poll(() => texts(id)).toEqual(["ApXples", "Y", "Z", "Bread", "Coffee", "Tea", "Milk", "Eggs"]);
  await expect(text(page, 2)).toBeFocused(); expect(await selection(page)).toEqual({ text: "Z", offset: 1 });
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-remove
// proofs/arch/templates/checklist.md#^templates-checklist-t-write-scope
test("accessible checkbox and remove controls work by keyboard and preserve removal focus", async ({ page }) => {
  const id = await open(page);
  await expect(page.getByRole("list")).toHaveCount(1); await expect(page.getByRole("listitem")).toHaveCount(3);
  await expect(title(page)).toHaveAccessibleName("Title");
  await expect(add(page)).toHaveAccessibleName("Add an item");
  for (const [index, name] of ["Apples", "Bread", "Coffee"].entries()) {
    await expect(text(page, index)).toHaveRole("textbox");
    await expect(text(page, index)).toHaveAccessibleName(`Item ${index + 1}`);
    await expect(page.getByRole("checkbox").nth(index)).toHaveAccessibleName(name);
    await expect(page.getByRole("button", { name: `Remove ${name}`, exact: true })).toHaveCount(1);
  }
  await title(page).focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "Apples", exact: true })).toBeFocused();
  await page.keyboard.press("Space"); await expect.poll(() => h.read(id, "items/a/done")).toBe(true);
  await page.keyboard.press("Tab"); await expect(text(page, 0)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Remove Apples", exact: true })).toBeFocused();
  for (const index of [1, 2]) {
    await page.keyboard.press("Tab"); await expect(page.getByRole("checkbox").nth(index)).toBeFocused();
    await page.keyboard.press("Tab"); await expect(text(page, index)).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: `Remove ${["Apples", "Bread", "Coffee"][index]}`, exact: true })).toBeFocused();
  }
  await page.locator(".checklist-item").nth(1).hover(); await page.getByRole("button", { name: "Remove Bread", exact: true }).click();
  await expect(text(page, 1)).toBeFocused(); await expect(text(page, 1)).toHaveText("Coffee");
  await expect(text(page, 1)).toHaveAccessibleName("Item 2");
  await expect.poll(() => texts(id)).toEqual(["Apples", "Coffee"]);
  expect(writes().at(-1)).toEqual({ kind: "remove", path: "items/b" });
  await page.getByRole("button", { name: "Remove Coffee", exact: true }).click();
  await expect(text(page, 0)).toBeFocused();
  await page.getByRole("button", { name: "Remove Apples", exact: true }).click(); await expect(add(page)).toBeFocused();
  await expect.poll(() => texts(id)).toEqual([]);
  await h.set(id, { title: "Blank item", items: { empty: item("", 0), next: item("Next", 1) } });
  await expect(text(page, 0)).toHaveText("");
  await title(page).focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "Empty item", exact: true })).toBeFocused();
  await page.getByRole("checkbox", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Remove Empty item", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(text(page, 0)).toBeFocused(); await expect(text(page, 0)).toHaveText("Next");
  await expect(text(page, 0)).toHaveAccessibleName("Item 1");
  await expect.poll(() => texts(id)).toEqual(["Next"]);
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-live
test("spawned agent commands and two viewers update live while preserving active text until blur", async ({ page, context }) => {
  const value = fixture(); value.items.a!.key = "colliding extra field";
  const id = await open(page, value);
  const other = await context.newPage(); await h.open(other, id);
  await caret(text(page, 0));
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "title", '"Shopping"']);
  await expect(title(page)).toHaveText("Shopping"); await expect(text(page, 0)).toBeFocused();
  h.product.runCLI(["resource", "json", "push", "--artifact", id, "items", JSON.stringify(item("Tea", 3))]);
  await expect(text(page, 3)).toHaveText("Tea");
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "items/b", JSON.stringify(item("Rolls", 1))]);
  await expect(text(page, 1)).toHaveText("Rolls");
  h.product.runCLI(["resource", "json", "remove", "--artifact", id, "items/c"]);
  await expect(page.locator(".checklist-text")).toHaveText(["Apples", "Rolls", "Tea"]);
  await text(other, 0).fill("Other viewer");
  await expect.poll(() => h.read(id, "items/a/text")).toBe("Other viewer");
  await expect(text(page, 0)).toHaveText("Apples");
  await text(page, 0).pressSequentially(" locally");
  await expect.poll(() => h.read(id, "items/a/text")).toBe("Apples locally");
  await text(other, 0).fill("Last confirmed");
  await expect.poll(() => h.read(id, "items/a/text")).toBe("Last confirmed");
  await expect(text(page, 0)).toHaveText("Apples locally");
  await add(page).focus(); await expect(text(page, 0)).toHaveText("Last confirmed");
  await other.close();
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-remote-remove
test("remote removal restores active nonempty drafts on typing or blur and leaves empty drafts removed", async ({ page }) => {
  const id = await open(page);
  for (const action of ["type", "blur", "empty"]) {
    const restored = fixture(); restored.items.a = item("Apples", -4, true);
    await h.set(id, restored); await expect(text(page, 0)).toHaveText("Apples");
    await caret(text(page, 0));
    if (action === "empty") { await text(page, 0).fill(""); await expect.poll(() => h.read(id, "items/a/text")).toBe(""); }
    await h.remove(id, "items/a");
    // An unrelated visible delivery establishes that the subscription has received the deletion.
    await h.set(id, action, "title"); await expect(title(page)).toHaveText(action);
    await expect(page.locator(".checklist-text")).toHaveCount(3);
    if (action === "type") await text(page, 0).pressSequentially(" again");
    else await add(page).focus();
    if (action === "empty") {
      await expect(page.locator(".checklist-text")).toHaveCount(2); expect(await h.read(id, "items/a")).toBeUndefined();
    } else await expect.poll(() => h.read(id, "items/a")).toEqual(item(action === "type" ? "Apples again" : "Apples", -4, true));
    expect(await h.read(id, "items/b")).toEqual(item("Bread", 1));
    await add(page).focus();
  }
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-access
test("real share access upgrades, downgrades and revocation retain a read-only view", async ({ page }) => {
  const id = await h.createStored(fixture());
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect(page.locator(".checklist-title-text")).toHaveText("Groceries");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("checkbox").first()).toBeDisabled();
  await h.set(id, { title: "Empty share", items: {} });
  await expect(page.locator(".checklist-empty")).toHaveText("No items");
  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(add(page)).toBeVisible();
  await add(page).fill("Shared item"); await add(page).press("Enter");
  await expect.poll(() => texts(id)).toEqual(["Shared item"]);
  await caret(text(page, 0));
  const saved = await h.read<Checklist>(id);
  await h.set(id, "Remote while editing", `items/${Object.keys(saved!.items)[0]}/text`);
  await h.set(id, "Access changed", "title"); await expect(title(page)).toHaveText("Access changed");
  await expect(text(page, 0)).toHaveText("Shared item");
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const count = writes().length;
  await page.keyboard.type("cannot save"); await page.keyboard.press("Tab");
  expect(writes()).toHaveLength(count); expect(await texts(id)).toEqual(["Remote while editing"]);
  await observeStore(page);
  await h.client.resources.unshare({ artifactID: id });
  await expect.poll(() => page.evaluate(() => (window as unknown as { checklistAccess: (string | null)[] }).checklistAccess.at(-1))).toBe(null);
  await expect(page.locator(".checklist-text")).toHaveText(["Shared item"]);
  await expect(page.getByRole("checkbox").first()).toBeDisabled();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

// proofs/arch/templates/checklist.md#^templates-checklist-t-transaction
for (const removedPredecessor of [false, true]) {
  test(`renumbering retries from concurrent data${removedPredecessor ? " after predecessor deletion" : " with all extra fields"}`, async ({ page }) => {
    const value = fixture(); value.items.b!.order = 0; value.extra = "root";
    const id = await open(page, value);
    await observeStore(page);
    h.proxy.holdWrites();
    await text(page, 0).press("Enter");
    await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
    const changed: Record<string, Item> = { ...value.items, b: { ...item("Changed", 0, true), extra: "retained" }, d: item("Concurrent", 8) };
    if (removedPredecessor) delete changed.a;
    await h.set(id, changed, "items");
    h.proxy.releaseWrites();
    await expect.poll(() => texts(id)).toEqual(removedPredecessor ? ["Changed", "Coffee", "Concurrent", ""] : ["Apples", "", "Changed", "Coffee", "Concurrent"]);
    const result = await h.read<Checklist>(id);
    expect(result!.extra).toBe("root"); expect(result!.items.b).toMatchObject({ text: "Changed", done: true, extra: "retained" });
    expect(Object.values(result!.items).map(value => value.order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, ...(removedPredecessor ? [] : [4])]);
    const attempts = writes().filter(write => write.kind === "compare-and-set");
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.every(write => write.path === "items")).toBe(true);
    const inserted = Object.keys(result!.items).filter(key => !Object.hasOwn(changed, key));
    expect(inserted).toHaveLength(1); expect(inserted[0]).toMatch(/^[-\w]{20}$/);
    expect(Object.keys(attempts[0]!.value as object)).toContain(inserted[0]);
    await expect.poll(async () => (await observedValues(page)).some(snapshot => !snapshot.pending && JSON.stringify(snapshot.value) === JSON.stringify(result))).toBe(true);
    for (const snapshot of await observedValues(page)) {
      if (snapshot.pending || !snapshot.value?.items || !Object.hasOwn(snapshot.value.items, inserted[0]!)) continue;
      const orders = Object.values(snapshot.value.items).map(value => value.order).sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, index) => index));
    }
  });
}

// proofs/arch/templates/checklist.md#^templates-checklist-t-transaction-invalid
for (const missing of [false, true]) {
  test(`renumbering aborts when concurrent items become ${missing ? "missing" : "invalid"}`, async ({ page }) => {
    const value = fixture(); value.items.b!.order = 0;
    const id = await open(page, value);
    await observeStore(page);
    h.proxy.holdWrites(); await text(page, 0).press("Enter");
    await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
    if (missing) await h.remove(id, "items"); else await h.set(id, { broken: { text: "No order" } }, "items");
    h.proxy.releaseWrites();
    await expect.poll(async () => (await observedValues(page)).at(-1)?.pending).toBe(false);
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await h.read(id, "items")).toEqual(missing ? undefined : { broken: { text: "No order" } });
    expect(writes().filter(write => write.kind === "compare-and-set")).toHaveLength(1);
  });
}

// proofs/arch/templates/checklist.md#^templates-checklist-t-invalid-guard
test("invalid subscriptions guard unsent input and blur while an already-sent write remains last-write-wins", async ({ page }) => {
  const id = await open(page);
  await add(page).fill("Unsent draft");
  await h.set(id, { title: "Invalid", items: { broken: { text: "Missing fields" } } });
  await expect(page.getByRole("alert")).toBeVisible();
  const count = writes().length;
  await page.keyboard.type("after invalidation"); await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
  expect(writes()).toHaveLength(count);
  expect(await h.read(id, "items")).toEqual({ broken: { text: "Missing fields" } });
  await h.set(id, fixture()); await expect(title(page)).toHaveText("Groceries");
  await observeStore(page);
  await h.clipboard(page, "First pasted\nDeferred pasted");
  h.proxy.holdWrites(); await add(page).focus(); await add(page).press("ControlOrMeta+V");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, { title: "Invalid", items: { broken: { text: "Missing fields" } } });
  await expect(page.getByRole("alert")).toBeVisible();
  h.proxy.releaseWrites();
  await expect.poll(async () => (await observedValues(page)).at(-1)?.pending).toBe(false);
  const afterPaste = await h.read<{ items: Record<string, Item> }>(id);
  expect(Object.values(afterPaste!.items).map(value => value.text)).toEqual(expect.arrayContaining(["First pasted", "Missing fields"]));
  expect(Object.values(afterPaste!.items).map(value => value.text)).not.toContain("Deferred pasted");
  await h.set(id, fixture()); await expect(title(page)).toHaveText("Groceries");
  h.proxy.holdWrites(); await text(page, 0).fill("Already sent");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, { title: "Invalid", items: { broken: { text: "Missing fields" } } });
  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "items/a/text")).toBe("Already sent");
  expect(await h.read(id, "items/broken")).toEqual({ text: "Missing fields" });
  await h.set(id, fixture()); await expect(title(page)).toHaveText("Groceries");
  await text(page, 0).fill("Repaired"); await expect.poll(() => h.read(id, "items/a/text")).toBe("Repaired");
});

async function observeStatus(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const known = new WeakSet<Node>();
    const observations: boolean[] = [];
    Object.assign(window, { checklistStatusOrder: observations });
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('[role="status"]')) {
            observations.push(node.textContent === ""); known.add(node);
          }
        }
        const region = record.target instanceof Element ? record.target.closest('[role="status"]') : record.target.parentElement?.closest('[role="status"]');
        if (region?.textContent) observations.push(known.has(region));
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}
async function statusOrder(page: Page): Promise<void> {
  const order = await page.evaluate(() => (window as unknown as { checklistStatusOrder: boolean[] }).checklistStatusOrder);
  expect(order.length).toBeGreaterThan(1); expect(order.every(Boolean)).toBe(true);
}

// proofs/ui/templates/checklist.md#^checklist-ui-ac-loading
test("first load stays blank, announces disconnection only after mounting its status and recovers", async ({ page }) => {
  const id = await h.createStored();
  await observeStatus(page); h.proxy.hold("to-browser");
  await h.open(page, id);
  await expect(page.locator(".checklist-page")).toBeVisible();
  await expect(page.locator(".checklist-page")).toHaveText("");
  await expect(page.locator(".checklist-title, .checklist-items, .checklist-add")).toHaveCount(0);
  await h.proxy.waitFor(() => h.proxy.openWebSockets > 0);
  h.proxy.refuse(true); h.proxy.sever();
  await expect(page.getByRole("status")).toHaveText("Reconnecting…");
  await expect(page.locator(".checklist-title, .checklist-items, .checklist-add")).toHaveCount(0);
  await statusOrder(page);
  h.proxy.release("to-browser"); h.proxy.refuse(false);
  await expect(title(page)).toHaveText("Checklist"); await expect(add(page)).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-reconnect
test("disconnect retains valid or unreadable views and reconnect restores current editable data", async ({ page }) => {
  const id = await open(page);
  await caret(text(page, 0));
  await h.set(id, "Remote before disconnect", "items/a/text");
  await h.set(id, "Disconnect ready", "title"); await expect(title(page)).toHaveText("Disconnect ready");
  await expect(text(page, 0)).toHaveText("Apples");
  h.proxy.refuse(true); h.proxy.sever();
  await expect(page.getByRole("status")).toHaveText("Reconnecting…");
  await expect(page.locator(".checklist-text")).toHaveText(["Apples", "Bread", "Coffee"]);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const before = writes().length;
  await page.keyboard.type("ignored"); expect(writes()).toHaveLength(before);
  await h.set(id, "While offline", "items/a/text");
  h.proxy.refuse(false);
  await expect(text(page, 0)).toHaveText("While offline"); await expect(add(page)).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await text(page, 0).fill("Back online"); await expect.poll(() => h.read(id, "items/a/text")).toBe("Back online");
  await h.set(id, null); await expect(page.getByRole("alert")).toBeVisible();
  h.proxy.refuse(true); h.proxy.sever();
  await expect(page.getByRole("status")).toHaveText("Reconnecting…"); await expect(page.getByRole("alert")).toBeVisible();
  h.proxy.refuse(false); await h.set(id, fixture()); await expect(title(page)).toHaveText("Groceries");
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-save-failure
// Selective buffering forfeits production notification order, never authorization or rollback.
test("a genuinely refused save rolls back the focused editor and dismisses its mounted status", async ({ page }) => {
  const id = await h.createStored(fixture());
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await observeStatus(page); await h.open(page, id, share.shareID);
  await expect(text(page, 0)).toHaveText("Apples");
  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdWrites(); h.proxy.holdServerMessages(connection, message => message.type === "access");
  await text(page, 0).fill("Refused draft"); await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(text(page, 0)).toHaveText("Refused draft");
  await h.client.resources.share({ artifactID: id, access: "read" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) > 0);
  h.proxy.releaseWrites();
  await expect(text(page, 0)).toHaveText("Apples"); await expect(text(page, 0)).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Couldn't save that change.");
  expect(await h.read(id, "items/a/text")).toBe("Apples"); await statusOrder(page);
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 15_000 });
  h.proxy.releaseServerMessages(connection);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(add(page)).toBeVisible(); await text(page, 0).fill("Allowed");
  await expect.poll(() => h.read(id, "items/a/text")).toBe("Allowed");
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-save-failure
// Selective buffering keeps the page writable until the real title refusal arrives.
test("a refused title save does not retain an unrelated item named undefined", async ({ page }) => {
  const value = fixture(); value.items.undefined = item("Unrelated", 3);
  const id = await h.createStored(value);
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID); await expect(title(page)).toHaveText("Groceries");
  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdWrites(); h.proxy.holdServerMessages(connection, message => message.type === "access");
  await title(page).fill("Refused title");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.client.resources.share({ artifactID: id, access: "read" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) > 0);
  h.proxy.releaseWrites();
  await expect(title(page)).toHaveText("Groceries");
  await expect(page.getByRole("status")).toHaveText("Couldn't save that change.");
  await h.remove(id, "items/undefined");
  await h.set(id, "Observed", "items/c/text");
  await expect(text(page, 2)).toHaveText("Observed");
  await expect(page.locator(".checklist-text")).toHaveText(["Apples", "Bread", "Observed"]);
  h.proxy.releaseServerMessages(connection);
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-invalid
test("malformed and missing values replace the whole checklist with an alert without repair", async ({ page }) => {
  const id = await open(page);
  for (const missing of [false, true]) {
    if (missing) await h.remove(id); else await h.set(id, { ...fixture(), items: { good: item("Good", 0), bad: { text: "Broken" } } });
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("This checklist can't be shown");
      await expect(alert).toContainText("Its saved data isn't in the form this page reads. Ask your agent to check it.");
      await expect(alert.locator('tv-icon[name="warning"]')).toHaveCount(1);
      await expect(page.getByRole("textbox")).toHaveCount(0); await expect(page.locator(".checklist-items")).toHaveCount(0);
      expect(await h.read(id)).toEqual(missing ? undefined : { ...fixture(), items: { good: item("Good", 0), bad: { text: "Broken" } } });
    }
    await h.set(id, fixture()); await expect(title(page)).toHaveText("Groceries");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-unavailable
test("real damaged saved bytes show unavailable and recover after repair and server restart", async ({ page }) => {
  const id = await open(page);
  const file = h.contentFile(id);
  const original = readFileSync(file);
  await h.restart(() => writeFileSync(file, "{not json"));
  await expect(page.getByRole("alert")).toContainText("This checklist can't be shown");
  expect(readFileSync(file, "utf8")).toBe("{not json");
  await h.restart(() => writeFileSync(file, original));
  await expect(title(page)).toHaveText("Groceries", { timeout: 20_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await text(page, 0).fill("Recovered"); await expect.poll(() => h.read(id, "items/a/text")).toBe("Recovered");
});

// proofs/ui/templates/checklist.md#^checklist-ui-ac-layout
test("long and narrow lists wrap without overflow and final controls remain reachable with a status strip", async ({ page }) => {
  const value = { title: "Long list", items: Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`key${i}`, item(`Task ${i} ${"a long wrapped line ".repeat(8)}`, i)])) };
  const id = await open(page, value);
  for (const size of [{ width: 640, height: 800 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await add(page).scrollIntoViewIfNeeded(); await expect(add(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await text(page, 27).fill(`Edited at ${size.width}`);
    await expect.poll(() => h.read(id, "items/key27/text")).toBe(`Edited at ${size.width}`);
    await add(page).fill(`Added at ${size.width}`); await add(page).press("Enter");
    await expect.poll(() => texts(id)).toContain(`Added at ${size.width}`);
    h.proxy.refuse(true); h.proxy.sever();
    await expect(page.getByRole("status")).toHaveText("Reconnecting…");
    const last = page.locator(".checklist-text").last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
    await page.mouse.move(size.width / 2, size.height / 2); await page.mouse.wheel(0, 10_000);
    await expect.poll(async () => {
      const row = await last.boundingBox(); const strip = await page.getByRole("status").boundingBox();
      return row!.y + row!.height <= strip!.y;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    h.proxy.refuse(false); await expect(add(page)).toBeVisible();
  }
});
