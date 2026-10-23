// Each exported spec story is compared with an independently copied note reached through real services and input.
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import { StorybookSource } from "@telepath-computer/conform/storybook";
import { TelevisionClient } from "@telepath-computer/television-shared";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "@playwright/test";
import { NetworkProxy } from "../../../server/test/e2e/network-proxy.ts";
import { TEMPLATE_LAUNCH, TEST_HOST } from "./template-harness.ts";
import { SERVER_ENV, type SharedServer } from "./template-conformance-setup.ts";

const server = JSON.parse(process.env[SERVER_ENV]!) as SharedServer;
const client = new TelevisionClient(server.serverURL, { token: server.token });
const storybook = new StorybookSource({ url: process.env.TV_STICKY_NOTE_STORYBOOK_URL });

// conform owns a separate Playwright version; its browser must come from that version.
let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch(TEMPLATE_LAUNCH); });
test.afterAll(async () => { await browser?.close(); });

let proxy: NetworkProxy;
test.beforeEach(async () => { proxy = await NetworkProxy.start(Number(new URL(server.serverURL).port)); });
test.afterEach(async () => { await proxy?.close(); });

const note = "Buy milk\nCall the plumber\nBook Barcelona dinner";
const longNote = [
  "Before the trip",
  "",
  "Book the airport transfer and confirm the pickup time the night before.",
  "Passports and tickets",
  "Ask the neighbours to water the tomatoes and take in any parcels.",
  "",
  "Booking reference:",
  "BARCELONA012345678901234567890123456789",
  "",
  "Leave a spare key with Sam.",
  "Turn off the lights.",
].join("\n");

/** Stored values and real actions that reach one story's rendered state. */
interface State {
  data?: JSONValue;
  share?: "read" | "read-write";
  dark?: boolean;
  loading?: boolean;
  ready?: (page: Page, id: string) => Promise<void>;
}

async function fontLoaded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fonts = await document.fonts.load('500 24px "Sticky Note Caveat"');
    if (fonts.length === 0) throw new Error("The bundled Caveat font did not load");
    await document.fonts.ready;
  });
}

async function disconnect(page: Page): Promise<void> {
  proxy.refuse(true);
  proxy.sever();
  await page.getByRole("status").filter({ hasText: "Reconnecting…" }).waitFor();
}

async function caretAtEnd(page: Page): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note", exact: true });
  await field.click();
  await field.press("ControlOrMeta+End");
  await page.locator(".sticky-note-text:focus").waitFor();
}

async function scrollText(page: Page, position: number | "bottom"): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note", exact: true });
  await fontLoaded(page);
  await field.hover();
  await page.mouse.wheel(0, position === "bottom" ? 10_000 : position);
  await expect.poll(() => field.evaluate((element, requested) => {
    const text = element as HTMLTextAreaElement;
    return requested === "bottom" ? text.scrollTop === text.scrollHeight - text.clientHeight : text.scrollTop === requested;
  }, position)).toBe(true);
}

const states: Record<string, State> = {
  "new": {},
  "with-text": { data: { text: note } },
  "empty": {
    data: { text: note },
    ready: async page => {
      await caretAtEnd(page);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await expect.poll(() => page.getByRole("textbox", { name: "Note", exact: true }).inputValue()).toBe("");
    },
  },
  "loading": { loading: true },
  "loading-disconnected": { loading: true, ready: disconnect },
  "typing": {
    data: { text: note },
    ready: async page => {
      await caretAtEnd(page);
      await page.keyboard.type(" for Friday");
    },
  },
  "long-text": { data: { text: longNote } },
  "long-text-scrolled": { data: { text: longNote }, ready: page => scrollText(page, 180) },
  "read-only": { data: { text: note }, share: "read" },
  "empty-read-only": { share: "read" },
  "disconnected": {
    data: { text: note },
    ready: async page => { await caretAtEnd(page); await disconnect(page); },
  },
  "long-text-disconnected": {
    data: { text: longNote },
    ready: async page => { await disconnect(page); await scrollText(page, "bottom"); },
  },
  "save-failed": {
    data: { text: note },
    share: "read-write",
    ready: async (page, id) => {
      const connection = proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
      // Keep the page unaware of the downgrade until the server rejects its real save.
      proxy.holdWrites();
      proxy.holdServerMessages(connection, message => message.type === "access");
      await caretAtEnd(page);
      await page.keyboard.type(" refused");
      await proxy.waitFor(() => proxy.heldWriteCount === 1);
      await client.resources.share({ artifactID: id, access: "read" });
      await proxy.waitFor(() => proxy.heldServerMessageCount(connection) > 0);
      proxy.releaseWrites();
      await page.getByRole("status").filter({ hasText: "Couldn't save that change." }).waitFor();
      await expect.poll(() => page.getByRole("textbox", { name: "Note", exact: true }).inputValue()).toBe(note);
      await page.mouse.click(1, 1);
    },
  },
  "unreadable": { data: { text: null } },
  "unreadable-disconnected": { data: { text: null }, ready: disconnect },
  "dark": { data: { text: note }, dark: true },
};

const index = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../storybook/dist/index.json"), "utf8")) as {
  entries: Record<string, { id: string; type: string; importPath: string }>;
};
const stories = Object.values(index.entries).filter(entry =>
  entry.type === "story" && entry.importPath === "./spec/templates/sticky-note/sticky-note.stories.ts");
if (stories.length === 0) throw new Error("The worktree Storybook build contains no Sticky note stories");

// proofs/ui/templates/sticky-note/index.md#^sticky-note-ui-ac-conformance
for (const { id: storyID } of stories) {
  test(`Sticky note conforms: ${storyID}`, async () => {
    const state = states[storyID.replace("spec-templates-sticky-note--", "")];
    expect(state, `No production state for the Sticky note story ${storyID}`).toBeDefined();
    const { data, share, dark, loading, ready } = state!;
    const { artifactID } = await client.templates.create({ templateID: "sticky-note", channelID: server.channelID, source: "cli" });
    if (data !== undefined) await client.resources.json.set({ store: { artifactID }, path: "", value: data });
    const shareID = share && (await client.resources.share({ artifactID, access: share })).shareID;
    if (loading) proxy.hold("to-browser");

    const reference = storybook.page(storyID);
    if (typeof reference === "string") throw new Error("Storybook must supply its completed-play readiness hook");
    await conform({
      ...reference,
      ready: async page => { await reference.ready?.(page); await fontLoaded(page); },
    }, {
      url: `http://${TEST_HOST}:${proxy.port}/artifact/${encodeURIComponent(shareID ?? artifactID)}/index.html`,
      setup: page => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }),
      ready: async page => {
        if (loading) await proxy.waitFor(() => proxy.openWebSockets > 0);
        else await page.locator(".sticky-note-text, .sticky-note-unreadable").waitFor();
        await fontLoaded(page);
        await ready?.(page, artifactID);
        await page.mouse.move(0, 0);
      },
    }, { browser, root: ".sticky-note-page", width: 360, height: 360 });
  });
}
