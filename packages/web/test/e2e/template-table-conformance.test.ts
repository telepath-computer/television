// Every exported spec story is compared with an independently installed Table
// reached through real services, stored values and page input.
import type { Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "@playwright/test";
import { artifactURL, client, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";

const run = useConformance();

const parks = {
  showHeader: true,
  columns: {
    c1: { order: 1, name: "Park" }, c2: { order: 2, name: "State" },
    c3: { order: 3, name: "Open" }, c4: { order: 4, name: "Rating" },
  },
  rows: {
    r1: { order: 1, cells: { c1: "Acadia", c2: "Maine", c3: "Yes", c4: "4.9" } },
    r2: { order: 2, cells: { c1: "Arches", c2: "Utah", c3: "Yes", c4: "4.8" } },
    r3: { order: 3, cells: { c1: "Everglades", c2: "Florida", c3: "No", c4: "4.6" } },
    r4: { order: 4, cells: { c1: "Olympic", c2: "Washington", c3: "Yes", c4: "4.8" } },
    r5: { order: 5, cells: { c1: "Yosemite", c2: "California", c3: "Yes", c4: "4.9" } },
    r6: { order: 6, cells: { c1: "Zion", c2: "Utah", c3: "Yes" } },
  },
} as const;
const schedule = {
  columns: { c1: { order: 1 }, c2: { order: 2 }, c3: { order: 3 } },
  rows: {
    r1: { order: 1, cells: { c1: "Morning", c2: "Train", c3: "08:40" } },
    r2: { order: 2, cells: { c1: "Afternoon", c2: "Walk" } },
    r3: { order: 3, cells: { c1: "Evening", c3: "Dinner" } },
  },
} as const;

interface State {
  data?: JSONValue;
  share?: "read" | "read-write";
  dark?: boolean;
  loading?: boolean;
  ready?: (page: Page, id: string) => Promise<void>;
}

const cell = (page: Page, row: number, column: number) =>
  page.locator(`[data-cell][data-row-index="${row}"][data-column-index="${column}"]`);
const row = (page: Page, index: number) => page.getByRole("button", { name: `Select row ${index + 1}`, exact: true });
const column = (page: Page, letter: string) => page.getByRole("button", { name: `Select column ${letter}`, exact: true });
const shown = async (page: Page) => {
  await page.locator(".table-grid, .table-loading, .table-unreadable").first().waitFor();
};
const offTable = (page: Page) => page.mouse.move(758, 768);
const disconnect = async (page: Page) => {
  run.proxy.refuse(true);
  run.proxy.sever();
  await page.locator(".table-status").filter({ hasText: "Reconnecting…" }).waitFor();
};

const states: Record<string, State> = {
  blank: {},
  "partially-filled": { data: { columns: { c1: { order: 1 } }, rows: { r1: { order: 1, cells: { c1: "Yosemite" } } } } },
  "with-data": { data: parks as unknown as JSONValue },
  "header-off": { data: schedule as unknown as JSONValue },
  "selected-cell": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 1).click(); } },
  "selected-header": { data: parks as unknown as JSONValue, ready: async page => { await page.locator('[data-header-text][data-column-index="1"]').click(); } },
  "selected-row": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await row(page, 1).click(); } },
  "selected-column": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await column(page, "C").click(); } },
  "keyboard-focus": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 0).click(); await page.keyboard.press("ArrowRight"); } },
  "editing-cell": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 0).click(); await page.keyboard.press("Enter"); } },
  "open-menu": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await row(page, 1).click({ button: "right" }); } },
  "open-column-menu": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await column(page, "C").click({ button: "right" }); } },
  "open-multi-row-menu": { data: parks as unknown as JSONValue, ready: async page => {
    await cell(page, 0, 0).click();
    await row(page, 1).click();
    await row(page, 3).click({ modifiers: ["Shift"] });
    await row(page, 1).click({ button: "right" });
  } },
  "read-only": { data: parks as unknown as JSONValue, share: "read", ready: async page => { await cell(page, 3, 1).click(); } },
  disconnected: { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 1).click(); await disconnect(page); } },
  "save-failed": {
    data: parks as unknown as JSONValue,
    share: "read-write",
    ready: async (page, id) => {
      const connection = run.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
      run.proxy.holdWrites();
      run.proxy.holdServerMessages(connection, message => message.type === "access");
      await cell(page, 3, 1).click();
      await page.keyboard.type("Refused");
      await page.locator(".table-input").press("Enter");
      await run.proxy.waitFor(() => run.proxy.heldWriteCount === 1);
      await client.resources.share({ artifactID: id, access: "read" });
      await run.proxy.waitFor(() => run.proxy.heldServerMessageCount(connection) > 0);
      run.proxy.releaseWrites();
      await page.locator(".table-status").filter({ hasText: "Couldn't save that change." }).waitFor();
      await cell(page, 3, 1).click();
    },
  },
  loading: { loading: true },
  "loading-disconnected": { loading: true, ready: disconnect },
  unreadable: { data: { columns: {}, rows: null } },
  "unreadable-disconnected": { data: { columns: {}, rows: null }, ready: disconnect },
  dark: { data: parks as unknown as JSONValue, dark: true, ready: async page => { await cell(page, 3, 1).click(); } },
};

const stories = specStories("./spec/templates/table/table.stories.ts");
if (stories.length === 0) throw new Error("The worktree Storybook build contains no Table stories");

// proofs/ui/templates/table.md#^table-ac-conformance
for (const storyID of stories) {
  test(`Table conforms: ${storyID}`, async () => {
    const storyName = storyID.replace("spec-templates-table--", "");
    const state = states[storyName];
    expect(state, `No production state for the Table story ${storyID}`).toBeDefined();
    const { data, share, dark, loading, ready } = state!;
    const artifactID = await createArtifact("table", data);
    const shareID = share && (await client.resources.share({ artifactID: artifactID, access: share })).shareID;
    if (loading) run.proxy.hold("to-browser");

    const reference = storybook.page(storyID);
    if (typeof reference === "string") throw new Error("Storybook must supply its completed-play readiness hook");
    await conform({
      ...reference,
      root: ".table-page",
      ready: async page => {
        await reference.ready?.(page);
        await page.evaluate(() => document.fonts.ready);
        await offTable(page);
      },
    }, {
      url: artifactURL(run.proxy, shareID ?? artifactID),
      setup: page => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }),
      ready: async page => {
        if (loading) await run.proxy.waitFor(() => run.proxy.openWebSockets > 0);
        else {
          await shown(page);
          if (!storyName.startsWith("unreadable")) {
            await page.locator(`.table-page[data-editable="${share === "read" ? "false" : "true"}"]`).waitFor();
          }
        }
        await page.evaluate(() => document.fonts.ready);
        await ready?.(page, artifactID);
        await offTable(page);
      },
    }, { browser: run.browser, root: ".table-page", width: 760, height: 770 });
  });
}
