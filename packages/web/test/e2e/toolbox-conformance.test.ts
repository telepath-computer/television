import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { StorybookSource } from "@telepath-computer/conform/storybook";
import { test, expect } from "@playwright/test";
import type { ArtifactTemplateScan } from "@telepath-computer/television-shared";
import { specStories, storybook } from "./conformance-harness.ts";

// Use Conform's Playwright peer for capture; the runner uses the root toolchain.
let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch(); });
test.afterAll(async () => { await browser?.close(); });

const mountURL = new URL("/packages/web/test/e2e/fixtures/toolbox.html", process.env.TV_WEB_E2E_URL).href;

interface Item { id: string; name: string; icon?: string }
interface State {
  items?: Item[];
  errors?: ArtifactTemplateScan["errors"];
  pending?: boolean;
  closed?: boolean;
  query?: string;
  highlight?: boolean;
  pressed?: boolean;
  failedIcon?: boolean;
}
const calendarIcon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1.5" y="3" width="17" height="15.5" rx="3" fill="#fff" stroke="#d4d4d4"/><path d="M1.5 6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v1.5h-17z" fill="#ef4444"/><text x="10" y="15.8" font-family="Helvetica,Arial,sans-serif" font-size="8" font-weight="700" fill="#262626" text-anchor="middle">22</text></svg>');
const mailIcon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1" y="3" width="18" height="14" rx="2" fill="#2563eb"/><path d="m2 5 8 6 8-6" fill="none" stroke="#fff" stroke-width="1.5"/></svg>');
const calendar: Item = { id: "calendar", name: "Calendar", icon: calendarIcon };
const mail: Item = { id: "mail-compose", name: "Mail compose", icon: mailIcon };
const items: Item[] = [
  { id: "agent-tasks", name: "Agent Tasks" }, calendar,
  { id: "checklist", name: "Checklist" }, { id: "code", name: "Code" },
  { id: "color-study", name: "Color study" }, { id: "day-calendar", name: "Day calendar" },
  { id: "email", name: "Email" }, { id: "email-draft", name: "Email draft" }, mail,
];
const invalid = [{ folder: "my-template", error: "manifest.json is missing a description." }];
const states: Record<string, State> = {
  "closed": { closed: true },
  "before-first-list": { pending: true },
  "open": {},
  "highlighted": { highlight: true },
  "pressed": { highlight: true, pressed: true },
  "searching": { query: "calendar" },
  "no-matches": { query: "spreadsheet" },
  "no-templates": { items: [] },
  "only-errors": { items: [], errors: invalid },
  "folder-unreadable": { items: [], errors: [{ folder: null, error: "EACCES: permission denied, scandir '/home/me/.television/templates'" }] },
  "supplied-icons": { items: [calendar, mail] },
  "default-icons": { items: items.filter(item => !item.icon) },
  "failed-icon": { items: [calendar], failedIcon: true },
  "long-name": { items: [{ id: "long-name", name: "An item with a much longer name than usual" }, calendar, { id: "long-word", name: "Extraordinarilylongartifactname" }] },
  "with-errors": { errors: invalid },
  "search-with-errors": { query: "spreadsheet", errors: invalid },
  "multiple-errors": { errors: [...invalid, { folder: "weekly-review", error: "index.html is missing." }, { folder: "old-dashboard", error: "manifest.json is not valid JSON." }] },
  "many-items": {
    items: [...items,
      { id: "image-comparison", name: "Image comparison" }, { id: "image-gallery", name: "Image gallery" },
      { id: "map", name: "Map with POIs" }, { id: "news", name: "News top 10" },
      { id: "priorities", name: "Priorities board" }, { id: "sticky-note", name: "Sticky note" },
      { id: "table", name: "Table" }, { id: "todo-list", name: "To-do list" }, { id: "trip", name: "Trip" },
    ].sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en")),
  },
};

async function prepare(page: Page, state: State): Promise<void> {
  await page.getByRole("button", { name: "Toolbox", exact: true }).waitFor();
  if (!state.pending) {
    const rows = state.items ?? items;
    const scan: ArtifactTemplateScan = {
      templates: rows.map(item => ({ id: item.id, name: item.name, description: "Agent-facing description", version: "1.0.0", path: `/templates/${item.id}`, hasIcon: !!item.icon })),
      errors: state.errors ?? [], watching: true,
    };
    const icons: [string, string][] = rows.filter(item => item.icon).map(item => [item.id, state.failedIcon ? "data:image/png;base64,AA==" : item.icon!]);
    await page.evaluate(serialized => {
      const { scan, icons } = JSON.parse(serialized) as { scan: ArtifactTemplateScan; icons: [string, string][] };
      (window as unknown as { toolbox: { set(scan: ArtifactTemplateScan, icons: [string, string][]): void } }).toolbox.set(scan, icons);
    }, JSON.stringify({ scan, icons }));
  }
  if (state.closed) return;
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search toolbox" });
  await page.locator(".toolbox-search input:focus").waitFor();
  if (state.query) await search.pressSequentially(state.query);
  if (state.highlight) await page.getByRole("gridcell").nth(1).hover();
  else await page.mouse.move(0, 0);
  if (state.pressed) await page.mouse.down();
  if (state.failedIcon) await page.locator(".toolbox-letter").filter({ hasText: "C" }).waitFor();
}

// Every exported story receives a test, including future stories.
const stories = specStories("./spec/toolbox/toolbox.stories.ts");
test.beforeAll(() => { expect(stories.length).toBeGreaterThan(0); });

// proofs/ui/app/toolbox.md#^toolbox-t-conformance
for (const id of stories) {
  test(`Toolbox conforms: ${id}`, async () => {
    const state = states[id.replace("spec-toolbox--", "")];
    expect(state, `No production state for Toolbox story ${id}`).toBeDefined();
    const reference = storybook.page(id) as Exclude<ReturnType<StorybookSource["page"]>, string>;
    // Compare the whole viewport, including the trigger and fixed production panel.
    // The preview canvas has no application layout; only its outer size is fixed.
    const canvas = async (page: Page) => { await page.addStyleTag({ content: "html { height: 100vh; }" }); };
    await conform({ ...reference, root: "html", ready: async page => { await reference.ready?.(page); await canvas(page); } }, {
      url: mountURL, root: "html",
      ready: async page => { await prepare(page, state!); await canvas(page); },
    }, { browser, width: 640, height: 800 });
  });
}

test("Toolbox has one docs entry rendering its MDX and all embedded stories", async () => {
  const index = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../storybook/dist/index.json"), "utf8")) as {
    entries: Record<string, { id: string; title: string; type: string }>;
  };
  const toolboxDocs = Object.values(index.entries)
    .filter(entry => entry.type === "docs" && entry.title.split("/").at(-1)?.toLowerCase() === "toolbox");
  expect(toolboxDocs.map(entry => entry.id)).toEqual(["spec-toolbox--docs"]);
  const page = await browser.newPage();
  try {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(new URL("iframe.html?id=spec-toolbox--docs&viewMode=docs", process.env.TV_SPEC_STORYBOOK_URL).href);
    await page.getByRole("heading", { name: /Toolbox$/ }).waitFor();
    await page.getByRole("heading", { name: /The highlight$/ }).waitFor();
    for (const id of stories) await page.locator(`#story--${id}`).waitFor({ state: "attached" });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
