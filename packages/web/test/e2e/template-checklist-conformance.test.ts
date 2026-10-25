import type { Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "@playwright/test";
import { artifactURL, client, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";

const run = useConformance();
const create = (data?: JSONValue) => createArtifact("checklist", data);

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
  run.proxy.refuse(true);
  run.proxy.sever();
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
      const connection = run.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
      run.proxy.holdWrites();
      run.proxy.holdServerMessages(connection, message => message.type === "access");
      await page.locator(".checklist-check").first().click();
      await run.proxy.waitFor(() => run.proxy.heldWriteCount === 1);
      await client.resources.share({ artifactID: id, access: "read" });
      await run.proxy.waitFor(() => run.proxy.heldServerMessageCount(connection) > 0);
      run.proxy.releaseWrites();
      await page.getByRole("status").filter({ hasText: "Couldn't save that change." }).waitFor();
      await page.mouse.click(1, 1);
    },
  },
  "unreadable": { data: unreadable },
  "unreadable-disconnected": { data: unreadable, ready: disconnect },
  "dark": { data: withItems, dark: true },
  "narrow": { data: withItems, narrow: true },
};

// proofs/ui/templates/checklist.md#^checklist-ui-ac-conformance
for (const storyID of specStories("./spec/templates/checklist/checklist.stories.ts")) {
  test(`Checklist conforms: ${storyID}`, async () => {
    const state = states[storyID.replace("spec-templates-checklist--", "")];
    expect(state, `No production state for the Checklist story ${storyID}`).toBeDefined();
    const { data, share, dark, narrow, loading, ready } = state!;

    const id = await create(data);
    const shareID = share && (await client.resources.share({ artifactID: id, access: share })).shareID;
    if (loading) run.proxy.hold("to-browser");

    await conform(storybook.page(storyID), {
      url: artifactURL(run.proxy, shareID ?? id),
      setup: page => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }),
      ready: async page => {
        if (loading) await run.proxy.waitFor(() => run.proxy.openWebSockets > 0);
        else await shown(page);
        await ready?.(page, id);
        await page.mouse.move(0, 0);
      },
    }, { browser: run.browser, root: ".checklist-page", ...(narrow ? { width: 360, height: 640 } : { width: 640, height: 800 }) });
  });
}
