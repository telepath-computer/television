// Every exported spec story is compared with an independently installed Table
// reached through real services, stored values and page input.
import type { Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "@playwright/test";
import { artifactURL, client, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";

const run = useConformance();

const parks = {
  headerRow: true,
  columns: {
    c1: { order: 1 }, c2: { order: 2 }, c3: { order: 3 }, c4: { order: 4 },
  },
  rows: {
    r1: { order: 1, cells: { c1: "Park", c2: "State", c3: "Open", c4: "Rating" } },
    r2: { order: 2, cells: { c1: "Acadia", c2: "Maine", c3: "Yes", c4: "4.9" } },
    r3: { order: 3, cells: { c1: "Arches", c2: "Utah", c3: "Yes", c4: "4.8" } },
    r4: { order: 4, cells: { c1: "Everglades", c2: "Florida", c3: "No", c4: "4.6" } },
    r5: { order: 5, cells: { c1: "Olympic", c2: "Washington", c3: "Yes", c4: "4.8" } },
    r6: { order: 6, cells: { c1: "Yosemite", c2: "California", c3: "Yes", c4: "4.9" } },
    r7: { order: 7, cells: { c1: "Zion", c2: "Utah", c3: "Yes" } },
  },
} as const;
const schedule = {
  columns: { c1: { order: 1 }, c2: { order: 2 }, c3: { order: 3 } },
  rows: {
    r1: { order: 1, cells: { c1: "Time", c2: "Plan", c3: "Starts" } },
    r2: { order: 2, cells: { c1: "Morning", c2: "Train", c3: "08:40" } },
    r3: { order: 3, cells: { c1: "Afternoon", c2: "Walk" } },
    r4: { order: 4, cells: { c1: "Evening", c3: "Dinner" } },
  },
} as const;

const resized = {
  headerRow: true,
  columns: {
    c1: { order: 1, width: 230 }, c2: { order: 2, width: 130 },
    c3: { order: 3, width: 96 }, c4: { order: 4, width: 112 },
  },
  rows: {
    ...parks.rows,
    r1: { ...parks.rows.r1, height: 28 },
    r2: { ...parks.rows.r2, height: 52 },
    r8: { order: 8, cells: { c1: "Grand Canyon", c2: "Arizona", c3: "Yes", c4: "4.9" } },
    r9: { order: 9, cells: { c1: "Joshua Tree", c2: "California", c3: "Yes", c4: "4.7" } },
    r10: { order: 10, height: 28, cells: { c1: "Redwood", c2: "California", c3: "Yes", c4: "4.8" } },
  },
} as const;

const scrolled = {
  headerRow: true,
  columns: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`c${index + 1}`, { order: index + 1 }])),
  rows: Object.fromEntries([
    ["r1", { order: 1, height: 52, cells: { c1: "Park", c2: "State", c3: "Open", c4: "Rating", c5: "Region", c6: "Visits", c7: "Notes" } }],
    ...Array.from({ length: 23 }, (_, index) => [`r${index + 2}`, {
      order: index + 2,
      cells: {
        c1: `Park ${index + 1}`, c2: index % 2 === 0 ? "California" : "Utah",
        c3: index % 4 === 0 ? "No" : "Yes", c4: (4.2 + (index % 8) / 10).toFixed(1),
        c5: index % 2 === 0 ? "West" : "Mountain", c6: `${index + 2}.${index % 10}m`,
        c7: index % 3 === 0 ? "Seasonal access" : "",
      },
    }]),
  ]),
} as unknown as JSONValue;

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
const offTable = (page: Page, storyName: string) => storyName === "scrolled"
  ? page.mouse.move(1, 1)
  : page.mouse.move(758, 768);
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
  resized: { data: resized as unknown as JSONValue },
  scrolled: { data: scrolled, ready: async page => {
    const scroll = page.locator(".table-scroll");
    await scroll.hover();
    await page.mouse.wheel(360, 180);
    await expect.poll(() => scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
      .toEqual({ left: 360, top: 180 });
  } },
  "selected-cell": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 1).click(); } },
  "selected-header": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 1).click(); } },
  "selected-row": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await row(page, 1).click(); } },
  "selected-column": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await column(page, "C").click(); } },
  "keyboard-focus": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 0).click(); await page.keyboard.press("ArrowRight"); } },
  "keyboard-focus-row": { data: parks as unknown as JSONValue, ready: async page => {
    await row(page, 1).click();
    await page.keyboard.press("ArrowRight");
  } },
  "editing-cell": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 3, 0).click(); await page.keyboard.press("Enter"); } },
  "editing-header-cell": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 1).click(); await page.keyboard.press("Enter"); } },
  "open-menu": { data: parks as unknown as JSONValue, ready: async page => { await cell(page, 0, 0).click(); await row(page, 0).click({ button: "right" }); } },
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
        await offTable(page, storyName);
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
        await offTable(page, storyName);
      },
    }, { browser: run.browser, root: ".table-page", width: 760, height: 770 });
  });
}
