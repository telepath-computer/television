// Every exported spec story is compared with an independently installed Table
// reached through real services, stored values and page input.
import type { Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "@playwright/test";
import { artifactURL, client, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";

const run = useConformance();

type Cell = string | number | boolean | null | Record<string, string>;
type StoredRow = { order: number } & Record<string, Cell>;

const parkRows: Record<string, StoredRow> = {
  acadia: { order: 1, Park: "Acadia", State: "Maine", Open: true, Rating: 4.9, Notes: "Granite peaks, woodland paths and the rocky Atlantic coast.", Details: { region: "Northeast" } },
  arches: { order: 2, Park: "Arches", State: "Utah", Open: true, Rating: 4.8, Notes: "More than two thousand natural sandstone arches.", Details: { region: "West" } },
  everglades: { order: 3, Park: "Everglades", State: "Florida", Open: false, Rating: 4.6, Notes: "A slow river of grass, mangroves and coastal prairie.", Details: { region: "South" } },
  olympic: { order: 4, Park: "Olympic", State: "Washington", Open: true, Rating: 4.8, Notes: "Glacier-capped mountains, old-growth rainforest and a wild Pacific shoreline.", Details: { region: "West" } },
  yosemite: { order: 5, Park: "Yosemite", State: "California", Open: true, Rating: 4.9, Notes: "Waterfalls, deep valleys, grand meadows and ancient giant sequoias.", Details: { region: "West" } },
  zion: { order: 6, Park: "Zion", State: "Utah", Open: true, Rating: null, Notes: "Sandstone cliffs above a narrow canyon.", Details: { region: "West" } },
};
const parks = { rows: parkRows } as unknown as JSONValue;
const many = {
  rows: Object.fromEntries(Array.from({ length: 80 }, (_, index) => {
    const [key, row] = Object.entries(parkRows)[index % Object.keys(parkRows).length]!;
    return [`${key}-${index}`, { ...row, order: index, Visit: index + 1 }];
  })),
} as unknown as JSONValue;

interface State {
  data?: JSONValue;
  dark?: boolean;
  loading?: boolean;
  narrow?: boolean;
  ready?: (page: Page) => Promise<void>;
}

const shown = (page: Page) => page.locator("tbody tr, .table-placeholder, .table-unreadable").first().waitFor();
const search = (query: string) => async (page: Page) => {
  const input = page.getByRole("searchbox", { name: "Search rows" });
  await input.fill(query);
  await input.blur();
};
const settleEdges = async (page: Page) => {
  await page.locator(".table-frame").waitFor();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
};

const states: Record<string, State> = {
  "with-rows": { data: parks, ready: settleEdges },
  "new": { ready: settleEdges },
  "filtered": { data: parks, ready: search("Utah") },
  "no-results": { data: parks, ready: search("Redwood") },
  "sorted": {
    data: parks,
    ready: async page => { await page.getByRole("button", { name: "Rating" }).click(); },
  },
  "selected": {
    data: parks,
    ready: async page => {
      const scroll = page.locator(".table-scroll");
      await page.locator(".table-count").click();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.locator(".table-scroll:focus").waitFor();
      for (let index = 0; index < 4; index += 1) await page.keyboard.press("ArrowDown");
      await scroll.evaluate(element => element.scrollTo(0, 0));
      await expect.poll(() => scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })))
        .toEqual({ left: 0, top: 0 });
      await settleEdges(page);
    },
  },
  "many-rows": { data: many, ready: settleEdges },
  "narrow": {
    data: parks,
    narrow: true,
    ready: async page => {
      const scroll = page.locator(".table-scroll");
      await scroll.hover();
      await page.mouse.wheel(180, 0);
      await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(180);
    },
  },
  "loading": { loading: true },
  "unreadable": { data: { rows: [] } },
  "dark": { data: parks, dark: true, ready: settleEdges },
  "unreadable-dark": { data: { rows: [] }, dark: true },
};

const stories = specStories("./spec/templates/table/table.stories.ts");
if (stories.length === 0) throw new Error("The worktree Storybook build contains no Table stories");

// proofs/ui/templates/table.md#^table-ac-conformance
for (const storyID of stories) {
  test(`Table conforms: ${storyID}`, async () => {
    const state = states[storyID.replace("spec-templates-table--", "")];
    expect(state, `No production state for the Table story ${storyID}`).toBeDefined();
    const { data, dark, loading, narrow, ready } = state!;
    const artifactID = await createArtifact("table", data);
    if (loading) run.proxy.hold("to-browser");

    const reference = storybook.page(storyID);
    if (typeof reference === "string") throw new Error("Storybook must supply its completed-play readiness hook");
    await conform({
      ...reference,
      ready: async page => {
        await reference.ready?.(page);
        await page.evaluate(() => document.fonts.ready);
      },
    }, {
      url: artifactURL(run.proxy, artifactID),
      setup: page => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }),
      ready: async page => {
        if (loading) await run.proxy.waitFor(() => run.proxy.openWebSockets > 0);
        else await shown(page);
        await page.evaluate(() => document.fonts.ready);
        await ready?.(page);
        await page.mouse.move(0, 0);
      },
    }, {
      browser: run.browser,
      root: ".table-page",
      ...(narrow ? { width: 400, height: 600 } : { width: 760, height: 770 }),
    });
  });
}
