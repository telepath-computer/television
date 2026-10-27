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
type MarkdownWindow = Window & {
  __cmView?: {
    state: { doc: { toString(): string }; selection: { main: { head: number } } };
    dispatch(spec: unknown): void;
  };
};

const content = (frame: Page | Frame): Locator => frame.locator(".cm-content").first();
const status = (frame: Page | Frame): Locator => frame.locator(".markdown-status");
const source = (frame: Page | Frame): Promise<string> => frame.evaluate(() =>
  (window as MarkdownWindow).__cmView?.state.doc.toString() ?? "");
const caret = (frame: Page | Frame): Promise<number> => frame.evaluate(() =>
  (window as MarkdownWindow).__cmView?.state.selection.main.head ?? -1);

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
test("new Markdown from Toolbox starts blank and focused, then saves through the shared editor", async ({ page }) => {
  const responses: string[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/styles\.css|sdk\/v1\/resources\.js|views\/markdown\/v1\/editor\.(?:js|css)|\/styles\.css$/.test(response.url()) && response.ok()) {
      responses.push(response.url());
    }
  });

  const { artifactID: id, frame } = await h.create(page);
  await expect(content(frame)).toBeVisible();
  await expect(content(frame)).toBeFocused();
  expect(await source(frame)).toBe("");
  expect(await h.read(id)).toEqual({ markdown: "" });
  expect(writes()).toEqual([]);
  expect(h.proxy.messages.filter(({ message }) => message.type === "subscribe").map(({ message }) => message.path)).toContain("");

  await content(frame).pressSequentially("# Project notes");
  await content(frame).press("Enter");
  await content(frame).press("Enter");
  await content(frame).pressSequentially("[OpenAI](https://openai.com)");
  const markdown = "# Project notes\n\n[OpenAI](https://openai.com)";
  await expect.poll(() => h.read(id, "markdown")).toBe(markdown);
  expect(writes().at(-1)).toEqual({ kind: "set", path: "markdown", value: { value: markdown } });
  expect(responses.some(url => url.includes("/views/markdown/v1/editor.js"))).toBe(true);
  expect(responses.some(url => url.includes("/views/markdown/v1/editor.css"))).toBe(true);
  expect(responses.some(url => url.includes("/sdk/v1/resources.js"))).toBe(true);

  renameSync(path.join(h.home, "templates/markdown"), path.join(h.home, "markdown-outside-discovery"));
  await page.reload();
  const independent = await h.frame(page, id);
  await expect.poll(() => source(independent)).toBe(markdown);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-live
test("agent writes update the open editor and local save echoes preserve the caret", async ({ page }) => {
  const initial: MarkdownData = { markdown: "Starting text", extra: { preserved: true } };
  const id = await h.createStored(initial);
  await h.open(page, id);
  await expect.poll(() => source(page)).toBe(initial.markdown);
  expect(writes()).toEqual([]);

  const agentText = "# Agent replacement\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify(agentText)]);
  await expect.poll(() => source(page)).toBe(agentText);
  expect(writes()).toEqual([]);

  await page.evaluate(() => {
    const view = (window as MarkdownWindow).__cmView;
    view?.dispatch({ selection: { anchor: 0, head: view.state.doc.toString().length } });
  });
  await content(page).pressSequentially("Unsent person draft");
  await h.set(id, { ...initial, markdown: "Agent interrupts before debounce" });
  await expect.poll(() => source(page)).toBe("Agent interrupts before debounce");
  await page.waitForTimeout(600);
  expect(await h.read(id, "markdown")).toBe("Agent interrupts before debounce");
  expect(writes()).toEqual([]);

  const connection = h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
  h.proxy.holdServerMessages(connection, message => message.type === "applied");
  await page.evaluate(() => {
    const view = (window as MarkdownWindow).__cmView;
    view?.dispatch({ selection: { anchor: 0, head: view.state.doc.toString().length } });
  });
  await content(page).pressSequentially("Local complete string");
  await expect.poll(() => h.read(id, "markdown")).toBe("Local complete string");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);
  await page.evaluate(() => (window as MarkdownWindow).__cmView?.dispatch({ selection: { anchor: 5 } }));
  expect(await caret(page)).toBe(5);
  h.proxy.releaseServerMessages(connection);
  await expect.poll(() => caret(page)).toBe(5);
  expect(await h.read(id, "extra")).toEqual({ preserved: true });
  expect(writes()).toEqual([{ kind: "set", path: "markdown", value: { value: "Local complete string" } }]);

  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify("Agent wins last")]);
  await expect.poll(() => source(page)).toBe("Agent wins last");
  expect(writes()).toHaveLength(1);
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify("Local complete string")]);
  await expect.poll(() => source(page)).toBe("Local complete string");
  expect(writes()).toHaveLength(1);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("read access blocks task, table and document changes", async ({ page }) => {
  const stored = "- [ ] Keep this open\n\n| A |\n| - |\n| one |";
  const id = await h.createStored({ markdown: stored });
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect.poll(() => source(page)).toBe(stored);

  const checkbox = page.locator(".cm-md-task-checkbox");
  const cell = page.locator(".tbl-cell-view").first();
  await expect(checkbox).toBeDisabled();
  await expect(cell).toHaveAttribute("contenteditable", "false");
  await checkbox.evaluate((element) => (element as HTMLInputElement).click());
  await page.evaluate(() => {
    const view = (window as MarkdownWindow).__cmView;
    view?.dispatch({ changes: { from: 0, insert: "blocked" } });
  });
  expect(await source(page)).toBe(stored);
  expect(writes()).toEqual([]);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("access, connection and unreadable data keep the editor from writing and recover live", async ({ page }) => {
  const id = await h.createStored({ markdown: "Saved document" });
  h.proxy.hold("to-browser");
  await h.open(page, id);
  await expect(page.locator(".markdown-loading")).toBeVisible();
  await expect(content(page)).toBeHidden();
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  h.proxy.release("to-browser");
  await expect.poll(() => source(page)).toBe("Saved document");

  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect.poll(() => source(page)).toBe("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await h.client.resources.unshare({ artifactID: id });
  await expect.poll(() => source(page)).toBe("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  expect(writes()).toEqual([]);

  await h.open(page, id);
  await expect.poll(() => source(page)).toBe("Saved document");
  await expect(content(page)).not.toBeFocused();
  await h.set(id, { markdown: "" });
  await expect.poll(() => source(page)).toBe("");
  await expect(content(page)).not.toBeFocused();
  await h.set(id, { markdown: "Saved document" });
  await expect.poll(() => source(page)).toBe("Saved document");
  const writesBeforeDisconnect = writes().length;
  await page.evaluate(() => {
    const view = (window as MarkdownWindow).__cmView;
    view?.dispatch({ changes: { from: 0, to: view.state.doc.toString().length, insert: "Disconnected unsent draft" } });
  });
  expect(await source(page)).toBe("Disconnected unsent draft");
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
  await expect.poll(() => source(page)).toBe("Saved document");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await page.waitForTimeout(600);
  expect(writes()).toHaveLength(writesBeforeDisconnect);
  expect(await h.read(id, "markdown")).toBe("Saved document");
  await h.set(id, { markdown: "Changed while disconnected" });
  h.proxy.refuse(false);
  await expect.poll(() => source(page)).toBe("Changed while disconnected");
  await expect(content(page)).toHaveAttribute("contenteditable", "true");

  await h.set(id, { markdown: 7 } as unknown as JSONValue);
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  const count = writes().length;
  await page.keyboard.type("ignored");
  await page.waitForTimeout(600);
  expect(writes()).toHaveLength(count);
  await h.set(id, { markdown: "Repaired" });
  await expect.poll(() => source(page)).toBe("Repaired");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await h.remove(id);
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  expect(await h.read(id)).toBeUndefined();
  await h.set(id, { markdown: "Restored after missing data" });
  await expect.poll(() => source(page)).toBe("Restored after missing data");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("damaged saved bytes recover after repair and restart", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  await h.open(page, id);
  await expect.poll(() => source(page)).toBe("Stored document");
  const file = h.contentFile(id);
  const original = readFileSync(file);

  await h.restart(() => writeFileSync(file, "{damaged json"));
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  expect(readFileSync(file, "utf8")).toBe("{damaged json");

  await h.restart(() => writeFileSync(file, original));
  await expect.poll(() => source(page), { timeout: 20_000 }).toBe("Stored document");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    const view = (window as MarkdownWindow).__cmView;
    view?.dispatch({ selection: { anchor: view.state.doc.toString().length } });
  });
  await content(page).pressSequentially(" recovered");
  await expect.poll(() => h.read(id, "markdown")).toBe("Stored document recovered");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("a refused save restores the stored document and reports the failure", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID);
  await expect.poll(() => source(page)).toBe("Stored document");

  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdWrites();
  h.proxy.holdServerMessages(connection, message => message.type === "access");
  await content(page).press("ControlOrMeta+A");
  await content(page).pressSequentially("Refused draft");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.client.resources.share({ artifactID: id, access: "read" });
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) > 0);
  h.proxy.releaseWrites();

  await expect.poll(() => source(page)).toBe("Stored document");
  await expect(status(page)).toHaveText("Couldn't save that change.");
  expect(await h.read(id, "markdown")).toBe("Stored document");
  h.proxy.releaseServerMessages(connection);
  await expect(content(page)).toHaveAttribute("contenteditable", "false");
  await expect(status(page)).toHaveText("", { timeout: 5_000 });
});
