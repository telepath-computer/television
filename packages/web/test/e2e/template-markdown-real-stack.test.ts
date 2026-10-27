/** Real browser acceptance for the copied Markdown page and its shared JSON store. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 800, height: 700 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

type MarkdownData = { markdown: string; [key: string]: JSONValue };

const content = (frame: Page | Frame): Locator => frame.locator(".cm-content").first();
const status = (frame: Page | Frame): Locator => frame.locator(".markdown-status");

async function replaceDocument(frame: Page | Frame, value: string): Promise<void> {
  const editor = content(frame);
  await editor.click();
  await editor.press("ControlOrMeta+A");
  const page = "keyboard" in frame ? frame : frame.page();
  await page.keyboard.insertText(value);
}

let h: TemplateHarness;
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("Markdown page error:", error));
  h = await TemplateHarness.start({ id: "markdown", name: "Markdown" });
});
test.afterEach(async () => { await h?.cleanup(); });

function writes(): Record<string, unknown>[] {
  return h.proxy.messages
    .filter(({ message }) => message.type === "write")
    .map(({ message }) => message.write as Record<string, unknown>);
}

// proofs/arch/templates/markdown.md#^templates-markdown-t-blank-save
test("new Markdown from Toolbox starts blank, then saves and clears through its packaged editor", async ({ page }) => {
  const artifactFrameRequests: string[] = [];
  page.on("request", request => {
    if (request.frame().parentFrame() === page.mainFrame()) {
      artifactFrameRequests.push(new URL(request.url()).pathname);
    }
  });

  const { artifactID: id, frame } = await h.create(page);
  await expect(content(frame)).toBeVisible();
  await expect(content(frame)).toBeFocused();
  await expect(content(frame)).toHaveText("");
  expect(await frame.evaluate(() => "__cmView" in window)).toBe(false);
  expect(await h.read(id)).toEqual({ markdown: "" });
  expect(writes()).toEqual([]);
  expect(h.proxy.messages.filter(({ message }) => message.type === "subscribe").map(({ message }) => message.path)).toContain("");
  const record = JSON.parse(readFileSync(
    path.join(h.home, "state/artifacts", `${id}.json`),
    "utf8",
  )) as { path: string };
  const copiedFolder = record.path;
  for (const file of ["editor.js", "editor.css", "THIRD-PARTY-NOTICES.txt"]) {
    expect(readFileSync(path.join(copiedFolder, file)).length, file).toBeGreaterThan(0);
  }

  await content(frame).pressSequentially("# Project notes");
  await content(frame).press("Enter");
  await content(frame).press("Enter");
  await content(frame).pressSequentially("[OpenAI](https://openai.com)");
  const markdown = "# Project notes\n\n[OpenAI](https://openai.com)";
  await expect.poll(() => h.read(id, "markdown")).toBe(markdown);
  expect(writes().at(-1)).toEqual({ kind: "set", path: "markdown", value: { value: markdown } });
  expect(artifactFrameRequests).toEqual(expect.arrayContaining([
    "/canonical/v2/styles.css",
    "/canonical/v2/components.js",
    "/sdk/v1/resources.js",
    `/artifact/${id}/editor.js`,
    `/artifact/${id}/editor.css`,
  ]));
  expect(artifactFrameRequests.some(url => url.startsWith("/views/"))).toBe(false);

  renameSync(path.join(h.home, "templates/markdown"), path.join(h.home, "markdown-outside-discovery"));
  await page.reload();
  const independent = await h.frame(page, id);
  await expect(content(independent)).toContainText("Project notes");

  await content(independent).press("ControlOrMeta+A");
  await content(independent).press("Backspace");
  await expect.poll(() => h.read(id)).toEqual({ markdown: "" });
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-live
test("agent writes update the open editor and local save echoes preserve newer typing", async ({ page }) => {
  await page.clock.install();
  const initial: MarkdownData = { markdown: "Starting text", extra: { preserved: true } };
  const id = await h.createStored(initial);
  await h.open(page, id);
  await expect(content(page)).toContainText(initial.markdown);
  expect(writes()).toEqual([]);
  const connection = h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;

  const agentText = "# Agent replacement\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify(agentText)]);
  await expect(content(page)).toContainText("Agent replacement");
  await expect(page.locator(".tbl-cell-view").filter({ hasText: "1" })).toBeVisible();
  expect(writes()).toEqual([]);

  h.proxy.holdServerMessages(connection, message => (
    message.type === "value" && JSON.stringify(message).includes("Agent interrupts before debounce")
  ));
  await h.set(id, { ...initial, markdown: "Agent interrupts before debounce" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);
  await page.clock.pauseAt(Date.now() + 1000);
  await replaceDocument(page, "Unsent person draft");
  expect(writes()).toEqual([]);
  h.proxy.releaseServerMessages(connection);
  await expect(content(page)).toContainText("Agent interrupts before debounce");
  await page.clock.runFor(600);
  expect(await h.read(id, "markdown")).toBe("Agent interrupts before debounce");
  expect(writes()).toEqual([]);
  await page.clock.resume();

  h.proxy.holdServerMessages(connection, message => message.type === "applied");
  await replaceDocument(page, "Local complete string");
  await expect.poll(() => h.read(id, "markdown")).toBe("Local complete string");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);
  await page.waitForTimeout(100);
  await content(page).press("ControlOrMeta+Home");
  for (let index = 0; index < 5; index += 1) await content(page).press("ArrowRight");
  await page.keyboard.insertText("X");
  await expect(content(page)).toHaveText("LocalX complete string");
  expect(writes()).toHaveLength(1);
  h.proxy.releaseServerMessages(connection);
  await page.waitForTimeout(100);
  await expect(content(page)).toHaveText("LocalX complete string");
  await expect.poll(() => h.read(id, "markdown")).toBe("LocalX complete string");
  expect(await h.read(id, "extra")).toEqual({ preserved: true });
  expect(writes()).toEqual([
    { kind: "set", path: "markdown", value: { value: "Local complete string" } },
    { kind: "set", path: "markdown", value: { value: "LocalX complete string" } },
  ]);

  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify("Agent wins last")]);
  await expect(content(page)).toContainText("Agent wins last");
  expect(writes()).toHaveLength(2);
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify("LocalX complete string")]);
  await expect(content(page)).toContainText("LocalX complete string");
  expect(writes()).toHaveLength(2);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-live-root-fields
test("an agent write to another field preserves in-progress typing", async ({ page }) => {
  await page.clock.install();
  const initial: MarkdownData = { markdown: "Starting text", extra: { preserved: true } };
  const id = await h.createStored(initial);
  await h.open(page, id);
  await expect(content(page)).toHaveText(initial.markdown);
  const connection = h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
  h.proxy.holdServerMessages(connection, message => (
    message.type === "value" && JSON.stringify(message).includes("Agent title")
  ));
  await h.set(id, "Agent title", "title");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);

  await page.clock.pauseAt(Date.now() + 1000);
  await content(page).press("ControlOrMeta+End");
  await page.keyboard.insertText(" person keeps typing");
  expect(writes()).toEqual([]);
  h.proxy.releaseServerMessages(connection);

  const expected = "Starting text person keeps typing";
  await expect(content(page)).toHaveText(expected);
  expect(writes()).toEqual([]);
  await page.clock.runFor(600);
  await expect.poll(() => h.read(id, "markdown")).toBe(expected);
  expect(await h.read(id, "title")).toBe("Agent title");
  expect(await h.read(id, "extra")).toEqual({ preserved: true });
  expect(writes()).toEqual([
    { kind: "set", path: "markdown", value: { value: expected } },
  ]);
  await page.clock.resume();
});

test("a pending page write shows its saving status until confirmation", async ({ page }) => {
  await page.clock.install();
  const id = await h.createStored({ markdown: "Stored document" });
  await h.open(page, id);
  await expect(content(page)).toHaveText("Stored document");

  h.proxy.holdWrites();
  await page.clock.pauseAt(Date.now() + 1000);
  await replaceDocument(page, "Pending document");
  await page.clock.runFor(500);
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  expect(await status(page).textContent()).toBe("");
  await page.clock.runFor(299);
  expect(await status(page).textContent()).toBe("");
  await page.clock.runFor(1);
  await expect(status(page)).toHaveText("Saving…");
  expect(await h.read(id, "markdown")).toBe("Stored document");

  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "markdown")).toBe("Pending document");
  await expect(status(page)).toHaveText("");
  await page.clock.resume();
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-access
test("read access blocks changes and a same-share upgrade resumes editing", async ({ page }) => {
  await page.clock.install();
  const stored = "- [ ] Keep this open\n\n| A |\n| - |\n| one |";
  const id = await h.createStored({ markdown: stored });
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID);
  await expect(content(page)).toContainText("Keep this open");

  const connection = h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
  h.proxy.holdServerMessages(connection, message => message.type === "access");
  await h.client.resources.share({ artifactID: id, access: "read" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) > 0);
  await page.clock.pauseAt(Date.now() + 1000);
  const cell = page.locator(".tbl-cell", { hasText: "one" }).locator(".tbl-cell-view");
  await cell.click();
  const staleCellEditor = page.locator(".tbl-cell-editor .cm-content");
  await expect(staleCellEditor).toHaveCount(1);
  await staleCellEditor.press("ControlOrMeta+End");
  await page.keyboard.insertText(" stale draft");
  await expect(staleCellEditor).toContainText("one stale draft");
  expect(writes()).toEqual([]);
  h.proxy.releaseServerMessages(connection);
  await expect(content(page)).toContainText("Keep this open");
  await expect(page.locator(".tbl-cell-editor")).toHaveCount(0);
  await page.clock.runFor(600);
  expect(await h.read(id, "markdown")).toBe(stored);
  expect(writes()).toEqual([]);

  const checkbox = page.locator(".cm-md-task-checkbox");
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await expect(cell).toHaveAttribute("contenteditable", "false");
  await checkbox.evaluate((element) => (element as HTMLInputElement).click());
  await expect(checkbox).not.toBeChecked();
  await expect(content(page)).toContainText("Keep this open");

  const cellTextBox = await cell.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.move(cellTextBox.x, cellTextBox.y + cellTextBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    cellTextBox.x + cellTextBox.width,
    cellTextBox.y + cellTextBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("one");
  await expect(page.locator(".tbl-cell-editor")).toHaveCount(0);
  expect(await cell.evaluate((element) => element.closest(".tbl-table-widget")!.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Tab");
  expect(await cell.evaluate((element) => !element.closest(".tbl-table-widget")!.contains(document.activeElement))).toBe(true);

  await h.clipboard(page, "clipboard sentinel");
  await page.mouse.move(cellTextBox.x, cellTextBox.y + cellTextBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    cellTextBox.x + cellTextBox.width,
    cellTextBox.y + cellTextBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("one");
  const contextMenuWasPrevented = page.evaluate(() => new Promise<boolean>((resolve) => {
    window.addEventListener("contextmenu", (event) => resolve(event.defaultPrevented), { once: true });
  }));
  await cell.click({ button: "right", position: { x: cellTextBox.width / 2, y: cellTextBox.height / 2 } });
  expect(await contextMenuWasPrevented).toBe(false);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("one");
  await page.keyboard.press("ControlOrMeta+C");
  expect(await h.readClipboard(page)).toBe("one");
  await expect(page.locator(".tbl-cell-editor")).toHaveCount(0);

  await cell.click({ force: true });
  await expect(page.locator(".tbl-cell-editor")).toHaveCount(0);
  await page.keyboard.insertText(" changed");
  await expect(cell).toHaveText("one");

  for (const [location, item] of [["row", "Add row after"], ["col", "Add column after"]] as const) {
    const handles = page.locator(`.tbl-handle[data-type="header"][data-location="${location}"]`);
    await (location === "row" ? handles.last() : handles.first()).click({ force: true });
    const menuItem = page.locator(".tbl-menu-item", { hasText: item });
    if (await menuItem.isVisible()) await menuItem.click({ force: true });
    await expect(menuItem).toHaveCount(0);
  }
  await expect(page.locator(".tbl-cell")).toHaveCount(2);
  await expect(cell).toHaveText("one");
  expect(await h.read(id, "markdown")).toBe(stored);
  expect(writes()).toEqual([]);

  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await page.clock.runFor(600);
  expect(await h.read(id, "markdown")).toBe(stored);
  expect(writes()).toEqual([]);
  await page.clock.resume();
  await content(page).press("ControlOrMeta+Home");
  await page.keyboard.insertText("Editable again\n");
  const resumed = `Editable again\n${stored}`;
  await expect.poll(() => h.read(id, "markdown")).toBe(resumed);
  expect(writes()).toEqual([
    { kind: "set", path: "markdown", value: { value: resumed } },
  ]);
});

test("a missing packaged editor script shows the error state", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  await page.route("**/artifact/*/editor.js", route => route.abort());

  await h.open(page, id);

  await expect(page.getByRole("alert")).toContainText("The Markdown editor didn't load");
  await expect(page.locator(".markdown-loading")).toBeHidden();
  await expect(content(page)).toBeHidden();
  expect(await h.read(id, "markdown")).toBe("Stored document");
  expect(writes()).toEqual([]);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("access, connection and unreadable data keep the editor from writing and recover live", async ({ page }) => {
  const id = await h.createStored({ markdown: "Saved document" });
  h.proxy.hold("to-browser");
  await h.open(page, id);
  await expect(page.locator(".markdown-loading")).toBeVisible();
  await expect(content(page)).toHaveCount(0);
  h.proxy.release("to-browser");
  await expect(content(page)).toContainText("Saved document");

  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect(content(page)).toContainText("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await h.client.resources.unshare({ artifactID: id });
  await expect(content(page)).toContainText("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  expect(writes()).toEqual([]);

  await h.open(page, id);
  await expect(content(page)).toContainText("Saved document");
  await expect(content(page)).not.toBeFocused();
  await h.set(id, { markdown: "" });
  await expect(content(page)).toHaveText("");
  await expect(content(page)).not.toBeFocused();
  await h.set(id, { markdown: "Saved document" });
  await expect(content(page)).toContainText("Saved document");
  const writesBeforeDisconnect = writes().length;
  await replaceDocument(page, "Disconnected unsent draft");
  await expect(content(page)).toContainText("Disconnected unsent draft");
  expect(writes()).toHaveLength(writesBeforeDisconnect);
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(content(page)).toContainText("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await page.waitForTimeout(600);
  expect(writes()).toHaveLength(writesBeforeDisconnect);
  expect(await h.read(id, "markdown")).toBe("Saved document");
  await h.set(id, { markdown: "Changed while disconnected" });
  h.proxy.refuse(false);
  await expect(content(page)).toContainText("Changed while disconnected");
  await expect(content(page)).toHaveAttribute("contenteditable", "true");

  const writesBeforeUnreadable = writes().length;
  await replaceDocument(page, "Unsent unreadable draft");
  expect(writes()).toHaveLength(writesBeforeUnreadable);
  await h.set(id, { markdown: 7 } as unknown as JSONValue);
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  await page.keyboard.type("ignored");
  await page.waitForTimeout(600);
  expect(writes()).toHaveLength(writesBeforeUnreadable);
  await h.set(id, { markdown: "Repaired" });
  await expect(content(page)).toContainText("Repaired");
  await expect(page.getByRole("alert")).toHaveCount(0);

  const writesBeforeMissing = writes().length;
  await replaceDocument(page, "Unsent missing-data draft");
  expect(writes()).toHaveLength(writesBeforeMissing);
  await h.remove(id);
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  await page.waitForTimeout(600);
  expect(writes()).toHaveLength(writesBeforeMissing);
  expect(await h.read(id)).toBeUndefined();
  await h.set(id, { markdown: "Restored after missing data" });
  await expect(content(page)).toContainText("Restored after missing data");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-reconnect-unchanged
test("reconnection with unchanged data resumes editing", async ({ page }) => {
  const id = await h.createStored({ markdown: "Saved document" });
  await h.open(page, id);
  await expect(content(page)).toContainText("Saved document");

  await replaceDocument(page, "Unsent disconnected draft");
  expect(writes()).toEqual([]);
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(content(page)).toContainText("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  expect(await h.read(id, "markdown")).toBe("Saved document");

  h.proxy.refuse(false);
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await content(page).press("ControlOrMeta+End");
  await content(page).pressSequentially(" after reconnect");
  await expect.poll(() => h.read(id, "markdown")).toBe("Saved document after reconnect");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-live-lost-ack
test("a confirmed save survives a lost acknowledgement", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  await h.open(page, id);
  await expect(content(page)).toContainText("Stored document");

  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdServerMessages(connection, message => message.type === "applied");
  await replaceDocument(page, "Confirmed document");
  await expect.poll(() => h.read(id, "markdown")).toBe("Confirmed document");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);

  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await expect(content(page)).toContainText("Confirmed document");
  expect(await h.read(id, "markdown")).toBe("Confirmed document");

  h.proxy.refuse(false);
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await expect(content(page)).toContainText("Confirmed document");
  expect(await h.read(id, "markdown")).toBe("Confirmed document");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-damaged-recovery
test("damaged saved bytes recover after repair and restart", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  await h.open(page, id);
  await expect(content(page)).toContainText("Stored document");
  const file = h.contentFile(id);
  const original = readFileSync(file);

  await h.restart(() => writeFileSync(file, "{damaged json"));
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  expect(readFileSync(file, "utf8")).toBe("{damaged json");

  await h.restart(() => writeFileSync(file, original));
  await expect(content(page)).toContainText("Stored document", { timeout: 20_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await content(page).press("ControlOrMeta+End");
  await content(page).pressSequentially(" recovered");
  await expect.poll(() => h.read(id, "markdown")).toBe("Stored document recovered");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-refused-save
test("a refused save restores the stored document and reports the failure", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID);
  await expect(content(page)).toContainText("Stored document");

  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdWrites();
  h.proxy.holdServerMessages(connection, message => message.type === "access");
  await replaceDocument(page, "Refused draft");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.client.resources.share({ artifactID: id, access: "read" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) > 0);
  h.proxy.releaseWrites();

  await expect(content(page)).toContainText("Stored document");
  await expect(status(page)).toHaveText("Couldn't save that change.");
  expect(await h.read(id, "markdown")).toBe("Stored document");
  h.proxy.releaseServerMessages(connection);
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await expect(status(page)).toHaveText("", { timeout: 5_000 });
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-page-close
test("closing the page discards typing before its save pause", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  await h.open(page, id);
  await expect(content(page)).toHaveText("Stored document");

  await replaceDocument(page, "Unsent closing draft");
  expect(writes()).toEqual([]);
  await page.close();
  await new Promise((resolve) => setTimeout(resolve, 600));

  expect(await h.read(id, "markdown")).toBe("Stored document");
  expect(writes()).toEqual([]);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-links
test("relative links resolve from the sandboxed copied page", async ({ page }) => {
  const id = await h.createStored({
    markdown: "| Link |\n| - |\n| [Read me](./README.md) |",
  });
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.openApp(page);
  const iframe = page.locator(`.stage .page[data-page-key="${id}"] iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((element, url) => {
    (element as HTMLIFrameElement).src = url;
  }, h.url(id, share.shareID));
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error(`Artifact ${id} has no browser frame`);
  await expect.poll(() => frame.url()).toContain(`/artifact/${share.shareID}/index.html`);
  await expect(iframe).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads",
  );
  expect(await frame.evaluate(() => window.origin)).toBe("null");
  expect(await frame.evaluate(() => window.isSecureContext)).toBe(false);
  await expect(content(frame)).toHaveAttribute("contenteditable", "false");
  const link = frame.locator('.cm-md-table-link a.cm-md-link[data-href="./README.md"]');
  await expect(link).toHaveText("Read me");

  await link.click({ modifiers: ["Alt"] });
  await page.waitForTimeout(1_000);
  expect(frame.url()).toContain(`/artifact/${share.shareID}/index.html`);
  await expect(link).toBeVisible();
  await link.click();

  await expect.poll(() => frame.url()).toContain(`/artifact/${share.shareID}/README.md`);
});
