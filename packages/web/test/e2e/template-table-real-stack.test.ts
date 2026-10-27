/** Real browser acceptance for the copied Table page and its shared JSON store. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 760, height: 770 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

type StoredRow = { order: number; [cell: string]: JSONValue };
type TableData = { rows: Record<string, StoredRow> };

const parkRows: Record<string, StoredRow> = {
  acadia: { order: 1, Park: "Acadia", State: "Maine", Open: true, Rating: 4.9, Notes: "Granite peaks, woodland paths and the rocky Atlantic coast.", Details: { region: "Northeast" } },
  arches: { order: 2, Park: "Arches", State: "Utah", Open: true, Rating: 4.8, Notes: "More than two thousand natural sandstone arches.", Details: { region: "West" } },
  everglades: { order: 3, Park: "Everglades", State: "Florida", Open: false, Rating: 4.6, Notes: "A slow river of grass, mangroves and coastal prairie.", Details: { region: "South" } },
  olympic: { order: 4, Park: "Olympic", State: "Washington", Open: true, Rating: 4.8, Notes: "Glacier-capped mountains, old-growth rainforest and a wild Pacific shoreline.", Details: { region: "West" } },
  yosemite: { order: 5, Park: "Yosemite", State: "California", Open: true, Rating: 4.9, Notes: "Waterfalls, deep valleys, grand meadows and ancient giant sequoias.", Details: { region: "West" } },
  zion: { order: 6, Park: "Zion", State: "Utah", Open: true, Rating: null, Notes: "Sandstone cliffs above a narrow canyon.", Details: { region: "West" } },
};
const parks = (): TableData => ({ rows: structuredClone(parkRows) });
const count = (page: Page | Frame): Locator => page.locator(".table-count");
const rows = (page: Page | Frame): Locator => page.locator("tbody tr");
const search = (page: Page | Frame): Locator => page.getByRole("searchbox", { name: "Search rows" });
const alert = (page: Page | Frame): Locator => page.getByRole("alert");

async function expectKeys(page: Page | Frame, expected: string[]): Promise<void> {
  await expect.poll(() => rows(page).evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.key))).toEqual(expected);
}

let h: TemplateHarness;
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("Table page error:", error));
  h = await TemplateHarness.start({ id: "table", name: "Table" });
});
test.afterEach(async () => { await h?.cleanup(); });

function writes(): Record<string, unknown>[] {
  return h.proxy.messages.filter(({ message }) => message.type === "write").map(({ message }) => message.write as Record<string, unknown>);
}

async function open(page: Page, value: TableData = parks()): Promise<string> {
  const id = await h.createStored(value as unknown as JSONValue);
  await h.open(page, id);
  await expect(count(page)).toHaveText(`${Object.keys(value.rows).length} rows`);
  return id;
}

async function expectError(page: Page): Promise<void> {
  await expect(alert(page)).toBeVisible();
  await expect(alert(page).locator("h1")).toHaveText("This table can't be shown");
  await expect(alert(page).locator("p")).toHaveText("Its saved data isn't in the form this page reads. Ask your agent to check it.");
  await expect(alert(page).locator('tv-icon[name="warning"]')).toBeVisible();
  await expect(page.locator(".table-frame")).toHaveCount(0);
}

// proofs/ui/templates/table.md#^table-ac-new
// proofs/product/templates.md delegates the bundled creation journey to table-ac-new.
test("new Table from Toolbox has the exact seed, shared display and independent packaged assets", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  const responses: { url: string; body: Buffer; ok: boolean }[] = [];
  const bodies: Promise<void>[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/(styles\.css|components\.js)|sdk\/v1\/resources\.js|\/(styles\.css|page\.js|model\.js)$/.test(response.url())) {
      bodies.push(response.body().then(body => { responses.push({ url: response.url(), body, ok: response.ok() }); }));
    }
  });
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));

  const { artifactID: id, frame } = await h.create(page);
  await expect(frame.getByText("No rows", { exact: true })).toBeVisible();
  await expect(frame.getByText("This table is empty.", { exact: true })).toBeVisible();
  await expect(count(frame)).toHaveText("");
  expect(await h.read(id)).toEqual({ rows: {} });
  expect(writes()).toEqual([]);
  expect(h.proxy.messages.filter(({ message }) => message.type === "subscribe").map(({ message }) => message.path)).toContain("");
  const layout = (await h.client.channels.get({ channelID: h.channelID })).channel.layout;
  expect(layout[0]).toMatchObject({ size: { width: 760, height: 770 }, geometry: { kind: "single", full_screen: false } });
  const links = await frame.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  expect(links[0]).toContain("/canonical/v2/styles.css");
  expect(links[1]).toContain(`/artifact/${id}/styles.css`);
  await Promise.all(bodies);
  expect(responses.every(response => response.ok)).toBe(true);
  for (const name of ["styles.css", "page.js", "model.js"]) {
    expect(responses.find(response => response.url.endsWith(`/artifact/${id}/${name}`))?.body)
      .toEqual(readFileSync(path.resolve(import.meta.dirname, `../../../server/assets/templates/table/${name}`)));
  }
  expect(responses.some(response => response.url.includes("/canonical/v2/components.js"))).toBe(true);
  expect(responses.some(response => response.url.includes("/sdk/v1/resources.js"))).toBe(true);
  expect(requests.some(url => /storybook|\/specs\//.test(url))).toBe(false);

  renameSync(path.join(h.home, "templates/table"), path.join(h.home, "table-outside-discovery"));
  await page.reload();
  const independent = await h.frame(page, id);
  await expect(independent.getByText("No rows", { exact: true })).toBeVisible();
});

// proofs/ui/templates/table.md#^table-ac-rows
// proofs/ui/templates/table.md#^table-ac-search
// proofs/ui/templates/table.md#^table-ac-sort
// proofs/ui/templates/table.md#^table-ac-selection
test("live rows, cells, search, sort and selection preserve the store and remain page-only", async ({ page }) => {
  const data: TableData = {
    rows: {
      zed: { order: 2, Name: "Trail 10", Open: true, Score: 12, Empty: "", Detail: { kind: "park" }, Notes: "A long description that runs beyond forty characters and wraps." },
      alpha: { order: 1, Name: "Trail 2", Open: false, Score: 2, Empty: null, Detail: ["quiet", "city"], Notes: "Short" },
      beta: { order: 2, Name: "Forest", Open: true, Score: null, Notes: "Another short value" },
    },
  };
  const id = await open(page, data);
  await expect(rows(page)).toHaveCount(3);
  await expectKeys(page, ["alpha", "beta", "zed"]);
  await expect(page.getByRole("columnheader")).toHaveText(["Name", "Open", "Score", "Empty", "Detail", "Notes"]);
  await expect(page.locator('tr[data-key="alpha"]')).toContainText("Trail 2No2—[\"quiet\",\"city\"]Short");
  await expect(page.locator('tr[data-key="zed"] .table-yes')).toHaveAttribute("aria-label", "Yes");
  await expect(page.locator('tr[data-key="zed"] .table-code')).toHaveText('{"kind":"park"}');
  await expect(page.locator('tr[data-key="zed"] .table-text-long')).toHaveCSS("-webkit-line-clamp", "3");

  await search(page).fill("  PARK  ");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toHaveAttribute("data-key", "zed");
  await expect(count(page)).toHaveText("3 rows");
  await search(page).fill("missing");
  await expect(page.getByText("No results", { exact: true })).toBeVisible();
  await expect(page.getByText("No rows match “missing”.", { exact: true })).toBeVisible();
  await search(page).press("Escape");
  await expect(rows(page)).toHaveCount(3);

  const score = page.getByRole("button", { name: "Score" });
  await score.click();
  await expect(score.locator("xpath=..")).toHaveAttribute("aria-sort", "ascending");
  await expectKeys(page, ["alpha", "zed", "beta"]);
  await score.click();
  await expectKeys(page, ["zed", "alpha", "beta"]);
  await score.click();
  await expect(score.locator("xpath=..")).toHaveAttribute("aria-sort", "none");
  await expectKeys(page, ["alpha", "beta", "zed"]);

  await page.locator('tr[data-key="zed"]').click();
  await expect(page.locator('tr[data-key="zed"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('tr[data-key="zed"] .table-text-long')).toHaveCSS("display", "block");
  await page.locator(".table-scroll").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('tr[data-key="beta"]')).toHaveAttribute("aria-selected", "true");
  await search(page).fill("Trail");
  await expect(rows(page)).toHaveCount(2);
  await search(page).press("Escape");
  await expect(page.locator('tr[data-key="beta"]')).toHaveAttribute("aria-selected", "true");
  await h.remove(id, "rows/beta");
  await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(0);
  await h.set(id, { order: 4, Name: "Added live", Open: true }, "rows/live");
  await expect(page.locator('tr[data-key="live"]')).toContainText("Added live");
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "rows/agent", JSON.stringify({ order: 5, Name: "Agent row", Open: true })]);
  await expect(page.locator('tr[data-key="agent"]')).toContainText("Agent row");
  expect(await h.read(id)).toEqual({
    rows: { alpha: data.rows.alpha, zed: data.rows.zed, live: { order: 4, Name: "Added live", Open: true }, agent: { order: 5, Name: "Agent row", Open: true } },
  });
  expect(writes()).toEqual([]);
});

// proofs/ui/templates/table.md#^table-ac-access
test("read-only controls remain local and revoked access keeps the last table", async ({ page }) => {
  const id = await h.createStored(parks() as unknown as JSONValue);
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect(count(page)).toHaveText("6 rows");
  await page.evaluate(async () => {
    const sdk = await import("/sdk/v1/resources.js");
    Object.assign(window, { tableListenerError: null });
    sdk.onValue(sdk.ref(sdk.getStore()), () => {}, error => { Object.assign(window, { tableListenerError: error.code }); });
  });
  await search(page).fill("Utah");
  await page.getByRole("button", { name: "Rating" }).click();
  await page.locator('tr[data-key="arches"]').click();
  await expect(rows(page)).toHaveCount(2);
  expect(writes()).toEqual([]);

  await h.client.resources.unshare({ artifactID: id });
  await expect.poll(() => page.evaluate(() => (window as unknown as { tableListenerError: string | null }).tableListenerError)).toBe("no-store");
  await expect(count(page)).toHaveText("6 rows");
  await expect(rows(page)).toHaveCount(2);
  await expect(alert(page)).toHaveCount(0);
  await search(page).press("Escape");
  await expect(rows(page)).toHaveCount(6);
  expect(writes()).toEqual([]);
});

// proofs/ui/templates/table.md#^table-ac-disconnection
test("disconnection keeps the last table and catches up without a message", async ({ page }) => {
  const id = await open(page);
  await page.evaluate(async () => {
    const sdk = await import("/sdk/v1/resources.js");
    const changes: string[] = [];
    Object.assign(window, { tableConnections: changes });
    sdk.onConnectionStatusChanged(status => changes.push(status));
  });
  h.proxy.refuse(true);
  h.proxy.sever();
  await expect.poll(() => page.evaluate(() => (window as unknown as { tableConnections: string[] }).tableConnections.includes("disconnected"))).toBe(true);
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "rows/acadia/Park", JSON.stringify("Acadia updated")]);
  await expect(page.locator('tr[data-key="acadia"]')).toContainText("Acadia");
  await expect(page.locator('tr[data-key="acadia"]')).not.toContainText("Acadia updated");
  await expect(page.locator(".table-page")).not.toContainText(/reconnect/i);
  h.proxy.refuse(false);
  await expect(page.locator('tr[data-key="acadia"]')).toContainText("Acadia updated");
  expect(writes()).toEqual([]);
});

// proofs/ui/templates/table.md#^table-ac-unreadable
test("loading, invalid, missing and unavailable data use one alert and recover live without repair writes", async ({ page }) => {
  const loadingID = await h.createStored();
  h.proxy.hold("to-browser");
  await h.open(page, loadingID);
  await h.proxy.waitFor(() => h.proxy.openWebSockets > 0);
  await expect(page.locator('tv-icon[name="spinner"]')).toBeVisible();
  await expect(count(page)).toHaveText("");
  h.proxy.release("to-browser");
  await expect(page.getByText("No rows", { exact: true })).toBeVisible();

  for (const broken of [{ rows: [] }, null] as const) {
    if (broken === null) await h.remove(loadingID);
    else await h.set(loadingID, broken as unknown as JSONValue);
    await expectError(page);
    expect(writes()).toEqual([]);
    await h.set(loadingID, parks() as unknown as JSONValue);
    await expect(count(page)).toHaveText("6 rows");
    await expect(alert(page)).toHaveCount(0);
  }

  const file = h.contentFile(loadingID);
  const original = readFileSync(file);
  await h.restart(() => writeFileSync(file, "{damaged json"));
  await expectError(page);
  expect(readFileSync(file, "utf8")).toBe("{damaged json");
  await h.restart(() => writeFileSync(file, original));
  await expect(count(page)).toHaveText("6 rows", { timeout: 20_000 });
  await expect(alert(page)).toHaveCount(0);
  expect(writes()).toEqual([]);
});

// proofs/ui/templates/table.md#^table-ac-scroll
// proofs/ui/templates/table.md#^table-ac-appearance
test("many wide rows scroll under sticky headers and foundation appearance follows light and dark", async ({ page }) => {
  const wide: TableData = {
    rows: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`row-${index}`, {
      order: index,
      Name: `Record ${index + 1}`,
      Region: "Northwest",
      Owner: "Operations team",
      Status: index % 2 === 0 ? "Ready" : "Waiting",
      Description: "A deliberately long description that makes this column wrap and the table wider.",
      Metadata: { batch: index + 1 },
    }])),
  };
  await page.setViewportSize({ width: 400, height: 600 });
  const id = await open(page, wide);
  const scroll = page.locator(".table-scroll");
  await expect(rows(page)).toHaveCount(80);
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(page.locator(".table-frame")).toHaveAttribute("data-more-end", "");
  const before = await page.locator("th").first().boundingBox();
  await scroll.hover();
  await page.mouse.wheel(180, 420);
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft > 0 && element.scrollTop > 0)).toBe(true);
  await expect(page.locator(".table-frame")).toHaveAttribute("data-more-start", "");
  const after = await page.locator("th").first().boundingBox();
  expect(after?.y).toBe(before?.y);

  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(count(page)).toHaveText("80 rows");
  const light = await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor);
  expect(dark).not.toBe(light);
  expect(await h.read(id)).toEqual(wide);
  expect(writes()).toEqual([]);
});
