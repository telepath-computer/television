import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import { StorybookSource } from "@telepath-computer/conform/storybook";
import { TelevisionClient } from "@telepath-computer/television-shared";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "@playwright/test";
import { NetworkProxy } from "../../../server/test/e2e/network-proxy.ts";
import { CHECKLIST_LAUNCH, TEST_HOST } from "./checklist-harness.ts";
import { SERVER_ENV, type SharedServer } from "./checklist-conformance-setup.ts";

// Global setup starts one product server for every worker.
const server = JSON.parse(process.env[SERVER_ENV]!) as SharedServer;
const client = new TelevisionClient(server.serverURL, { token: server.token });

// conform drives its own Playwright, so each worker's browser comes from that version rather than the runner's.
let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch(CHECKLIST_LAUNCH); });
test.afterAll(async () => { await browser?.close(); });

// Each story's page reaches the server through its own proxy, so held or refused traffic never carries over.
let proxy: NetworkProxy;
test.beforeEach(async () => { proxy = await NetworkProxy.start(Number(new URL(server.serverURL).port)); });
test.afterEach(async () => { await proxy?.close(); });

async function create(data?: JSONValue): Promise<string> {
  const { artifactID } = await client.templates.create({ templateID: "checklist", channelID: server.channelID, source: "cli" });
  if (data !== undefined) await client.resources.json.set({ store: { artifactID }, path: "", value: data });
  return artifactID;
}

const storybook = new StorybookSource({ url: process.env.TV_CHECKLIST_STORYBOOK_URL });

type Item = [text: string, done: boolean];

function checklist(title: string, items: Item[]): JSONValue {
  return { title, items: Object.fromEntries(items.map(([text, done], order) => [`item${order}`, { text, done, order }])) };
}

const groceries: Item[] = [
  ["Sourdough loaf", true],
  ["Oat milk", false],
  ["Lemons", true],
  ["Parmesan, the good one from the deli counter", false],
  ["Basil", false],
  ["Coffee beans", false],
];
const withItems = checklist("Groceries", groceries);
const unreadable = { title: "Groceries", items: { broken: { text: "Missing done", order: 0 } } };

/** How production reaches one story's state: what is stored, how the page is opened, and what happens on it. */
interface State {
  data?: JSONValue;
  share?: "read" | "read-write";
  dark?: boolean;
  narrow?: boolean;
  // The page's data is held back, so it never arrives.
  loading?: boolean;
  ready?: (page: Page, id: string) => Promise<void>;
}

const shown = (page: Page) => page.locator(".checklist-title, .checklist-unreadable").waitFor();
const focused = (page: Page, selector: string) => page.locator(`${selector}:focus`).waitFor();

async function disconnect(page: Page): Promise<void> {
  proxy.refuse(true);
  proxy.sever();
  await page.getByRole("status").filter({ hasText: "Reconnecting…" }).waitFor();
}

async function caretAtEnd(page: Page, index: number): Promise<void> {
  const text = page.locator(".checklist-text").nth(index);
  await text.click();
  await text.press("ControlOrMeta+End");
  await focused(page, `.checklist-item:nth-child(${index + 1}) .checklist-text`);
}

async function tabTo(page: Page, presses: number, selector: string): Promise<void> {
  await page.locator(".checklist-title-text").click();
  for (let i = 0; i < presses; i++) await page.keyboard.press("Tab");
  await focused(page, selector);
}

const states: Record<string, State> = {
  "new": { ready: page => focused(page, ".checklist-add-input") },
  "with-items": { data: withItems },
  "loading": { loading: true },
  "loading-disconnected": { loading: true, ready: disconnect },
  "editing-item": { data: withItems, ready: page => caretAtEnd(page, 1) },
  "new-empty-item": {
    data: withItems,
    ready: async page => {
      await caretAtEnd(page, 1);
      await page.keyboard.press("Enter");
      await focused(page, ".checklist-item:nth-child(3) .checklist-text");
    },
  },
  "editing-done-item": { data: withItems, ready: page => caretAtEnd(page, 0) },
  "keyboard-focus": { data: withItems, ready: page => tabTo(page, 4, ".checklist-item:nth-child(2) .checklist-check") },
  "remove-focus": { data: withItems, ready: page => tabTo(page, 6, ".checklist-item:nth-child(2) .checklist-remove") },
  "adding": {
    data: withItems,
    ready: async page => {
      await page.locator(".checklist-add-input").click();
      await page.keyboard.type("Tomatoes");
    },
  },
  "untitled": { data: checklist("", groceries) },
  "long-items": {
    data: checklist("Before the trip", [
      ["Book the airport transfer for the early flight, and confirm the pickup time the night before", false],
      ["Passports", true],
      ["Ask the neighbours to water the tomatoes and take in any parcels that arrive while we're away", false],
    ]),
  },
  "many-items": { data: checklist("Spring cleaning", Array.from({ length: 28 }, (_, i): Item => [`Task ${i + 1}`, i % 3 === 0])) },
  "read-only": { data: withItems, share: "read" },
  "empty-read-only": { data: checklist("Groceries", []), share: "read" },
  "disconnected": { data: withItems, ready: disconnect },
  "save-failed": {
    // A box is ticked while the share link is changed to read-only, so the server refuses the save.
    data: withItems,
    share: "read-write",
    ready: async (page, id) => {
      const connection = proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
      proxy.holdWrites();
      proxy.holdServerMessages(connection, message => message.type === "access");
      await page.locator(".checklist-check").first().click();
      await proxy.waitFor(() => proxy.heldWriteCount === 1);
      await client.resources.share({ artifactID: id, access: "read" });
      await proxy.waitFor(() => proxy.heldServerMessageCount(connection) > 0);
      proxy.releaseWrites();
      await page.getByRole("status").filter({ hasText: "Couldn't save that change." }).waitFor();
      await page.mouse.click(1, 1);
    },
  },
  "unreadable": { data: unreadable },
  "unreadable-disconnected": { data: unreadable, ready: disconnect },
  "dark": { data: withItems, dark: true },
  "narrow": { data: withItems, narrow: true },
};

// Storybook's index lists every exported story, including those the MDX does not embed.
const index = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../storybook/dist/index.json"), "utf8")) as {
  entries: Record<string, { id: string; type: string; importPath: string }>;
};
const stories = Object.values(index.entries).filter(entry =>
  entry.type === "story" && entry.importPath === "./spec/templates/checklist/checklist.stories.ts");

// proofs/ui/templates/checklist/index.md#^checklist-ui-ac-conformance
for (const { id: storyID } of stories) {
  test(`Checklist conforms: ${storyID}`, async () => {
    const state = states[storyID.replace("spec-templates-checklist--", "")];
    expect(state, `No production state for the Checklist story ${storyID}`).toBeDefined();
    const { data, share, dark, narrow, loading, ready } = state!;

    const id = await create(data);
    const shareID = share && (await client.resources.share({ artifactID: id, access: share })).shareID;
    if (loading) proxy.hold("to-browser");

    await conform(storybook.page(storyID), {
      url: `http://${TEST_HOST}:${proxy.port}/artifact/${encodeURIComponent(shareID ?? id)}/index.html`,
      setup: page => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }),
      ready: async page => {
        if (loading) await proxy.waitFor(() => proxy.openWebSockets > 0);
        else await shown(page);
        await ready?.(page, id);
        await page.mouse.move(0, 0);
      },
    }, { browser, root: ".checklist-page", ...(narrow ? { width: 360, height: 640 } : { width: 640, height: 800 }) });
  });
}
