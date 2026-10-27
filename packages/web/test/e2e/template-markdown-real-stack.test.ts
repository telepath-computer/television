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
  await content(frame).press("ControlOrMeta+A");
  await content(frame).pressSequentially(value);
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
test("new Markdown from Toolbox starts blank, then saves through the shared editor", async ({ page }) => {
  const responses: string[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/styles\.css|sdk\/v1\/resources\.js|views\/markdown\/v1\/editor\.(?:js|css)|\/styles\.css$/.test(response.url()) && response.ok()) {
      responses.push(response.url());
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
  await expect(content(independent)).toContainText("Project notes");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-live
test("agent writes update the open editor and local save echoes preserve the caret", async ({ page }) => {
  const initial: MarkdownData = { markdown: "Starting text", extra: { preserved: true } };
  const id = await h.createStored(initial);
  await h.open(page, id);
  await expect(content(page)).toContainText(initial.markdown);
  expect(writes()).toEqual([]);

  const agentText = "# Agent replacement\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "markdown", JSON.stringify(agentText)]);
  await expect(content(page)).toContainText("Agent replacement");
  await expect(page.locator(".tbl-cell-view").filter({ hasText: "1" })).toBeVisible();
  expect(writes()).toEqual([]);

  await replaceDocument(page, "Unsent person draft");
  await h.set(id, { ...initial, markdown: "Agent interrupts before debounce" });
  await expect(content(page)).toContainText("Agent interrupts before debounce");
  await page.waitForTimeout(600);
  expect(await h.read(id, "markdown")).toBe("Agent interrupts before debounce");
  expect(writes()).toEqual([]);

  const connection = h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
  h.proxy.holdServerMessages(connection, message => message.type === "applied");
  await replaceDocument(page, "Local complete string");
  await expect.poll(() => h.read(id, "markdown")).toBe("Local complete string");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(connection) === 1);
  await page.waitForTimeout(100);
  await content(page).press("ControlOrMeta+Home");
  for (let index = 0; index < 5; index += 1) await content(page).press("ArrowRight");
  h.proxy.releaseServerMessages(connection);
  await page.waitForTimeout(100);
  await content(page).pressSequentially("X");
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

// proofs/arch/templates/markdown.md#^templates-markdown-t-live
test("an agent write to another field preserves in-progress typing", async ({ page }) => {
  const initial: MarkdownData = { markdown: "Starting text", extra: { preserved: true } };
  const id = await h.createStored(initial);
  await h.open(page, id);
  await expect(content(page)).toHaveText(initial.markdown);
  await content(page).press("ControlOrMeta+End");

  await Promise.all([
    content(page).pressSequentially(" person keeps typing", { delay: 50 }),
    page.waitForTimeout(150).then(() => h.set(id, "Agent title", "title")),
  ]);

  const expected = "Starting text person keeps typing";
  await expect(content(page)).toHaveText(expected);
  await expect.poll(() => h.read(id, "markdown")).toBe(expected);
  expect(await h.read(id, "title")).toBe("Agent title");
  expect(await h.read(id, "extra")).toEqual({ preserved: true });
  expect(writes()).toEqual([
    { kind: "set", path: "markdown", value: { value: expected } },
  ]);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("a pending page write shows its saving status until confirmation", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  await h.open(page, id);
  await expect(content(page)).toHaveText("Stored document");

  h.proxy.holdWrites();
  await replaceDocument(page, "Pending document");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(status(page)).toHaveText("Saving…");
  expect(await h.read(id, "markdown")).toBe("Stored document");

  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "markdown")).toBe("Pending document");
  await expect(status(page)).toHaveText("");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("read access blocks changes and a same-share upgrade resumes editing", async ({ page }) => {
  const stored = "- [ ] Keep this open\n\n| A |\n| - |\n| one |";
  const id = await h.createStored({ markdown: stored });
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID);
  await expect(content(page)).toContainText("Keep this open");

  await replaceDocument(page, "Unsent access-loss draft");
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(content(page)).toContainText("Keep this open");
  expect(await h.read(id, "markdown")).toBe(stored);

  const checkbox = page.locator(".cm-md-task-checkbox");
  const cell = page.locator(".tbl-cell-view").first();
  await expect(checkbox).toBeDisabled();
  await expect(cell).toHaveAttribute("contenteditable", "false");
  await checkbox.evaluate((element) => (element as HTMLInputElement).click());
  expect(await h.read(id, "markdown")).toBe(stored);
  expect(writes()).toEqual([]);

  await h.client.resources.share({ artifactID: id, access: "read-write" });
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await replaceDocument(page, "Editable again");
  await expect.poll(() => h.read(id, "markdown")).toBe("Editable again");
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

  await h.set(id, { markdown: 7 } as unknown as JSONValue);
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  const count = writes().length;
  await page.keyboard.type("ignored");
  await page.waitForTimeout(600);
  expect(writes()).toHaveLength(count);
  await h.set(id, { markdown: "Repaired" });
  await expect(content(page)).toContainText("Repaired");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await h.remove(id);
  await expect(page.getByRole("alert")).toContainText("This document can't be shown");
  await expect(content(page)).toBeHidden();
  expect(await h.read(id)).toBeUndefined();
  await h.set(id, { markdown: "Restored after missing data" });
  await expect(content(page)).toContainText("Restored after missing data");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("reconnection with unchanged data resumes editing", async ({ page }) => {
  const id = await h.createStored({ markdown: "Saved document" });
  await h.open(page, id);
  await expect(content(page)).toContainText("Saved document");

  await replaceDocument(page, "Unsent disconnected draft");
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

// proofs/arch/templates/markdown.md#^templates-markdown-t-live
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
  await expect(content(page)).toContainText("Confirmed document");
  expect(await h.read(id, "markdown")).toBe("Confirmed document");

  h.proxy.refuse(false);
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await expect(content(page)).toContainText("Confirmed document");
});

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
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

// proofs/arch/templates/markdown.md#^templates-markdown-t-states
test("a refused save restores the stored document and reports the failure", async ({ page }) => {
  const id = await h.createStored({ markdown: "Stored document" });
  const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await h.open(page, id, share.shareID);
  await expect(content(page)).toContainText("Stored document");

  const connection = h.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
  h.proxy.holdWrites();
  h.proxy.holdServerMessages(connection, message => message.type === "access");
  await content(page).press("ControlOrMeta+A");
  await content(page).pressSequentially("Refused draft");
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
