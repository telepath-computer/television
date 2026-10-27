/** Real browser acceptance for the copied Map page and its shared JSON store. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 900, height: 760 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

type MapData = {
  title?: string;
  subtitle?: string;
  numbered?: boolean;
  basemap?: "standard" | "satellite" | "hybrid";
  sidebar?: "open" | "closed";
  categories?: Record<string, Record<string, JSONValue>>;
  places?: Record<string, Record<string, JSONValue>>;
};

const places = (): MapData => ({
  title: "City places",
  subtitle: "Three stops",
  categories: {
    culture: { name: "Culture", icon: "museum", color: "purple" },
    parks: { name: "Parks", icon: "park", color: "green" },
  },
  places: {
    museum: { title: "City Museum", lat: 38.627, lng: -90.201, order: 2, category: "culture", description: "History and art", fields: { Admission: "$12" } },
    garden: { title: "Botanical Garden", lat: 38.615, lng: -90.258, order: 1, category: "parks", description: "Glasshouses and gardens" },
    arch: { title: "Gateway Arch", lat: 38.625, lng: -90.185, order: 3, category: "missing", description: "Riverfront monument" },
  },
});

const rows = (page: Page | Frame): Locator => page.locator(".place-row:not([hidden]) .place-button");
const filter = (page: Page | Frame): Locator => page.getByRole("searchbox", { name: "Filter places" });
const alert = (page: Page | Frame): Locator => page.getByRole("alert");

let h: TemplateHarness;
let tileRequests: string[];
test.beforeEach(async ({ page }) => {
  tileRequests = [];
  await page.route("https://server.arcgisonline.com/**", async route => {
    tileRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  page.on("pageerror", error => console.error("Map page error:", error));
  h = await TemplateHarness.start({ id: "map", name: "Map" });
});
test.afterEach(async () => { await h?.cleanup(); });

function writes(): Record<string, unknown>[] {
  return h.proxy.messages.filter(({ message }) => message.type === "write").map(({ message }) => message.write as Record<string, unknown>);
}

async function open(page: Page, value: MapData = places()): Promise<string> {
  const id = await h.createStored(value as unknown as JSONValue);
  await h.open(page, id);
  await expect(rows(page)).toHaveCount(Object.keys(value.places ?? {}).length);
  return id;
}

async function expectError(page: Page): Promise<void> {
  await expect(alert(page)).toBeVisible();
  await expect(alert(page).locator("h1")).toHaveText("This map can't be shown");
  await expect(alert(page).locator("p")).toHaveText("Its saved data isn't in the form this page reads. Ask your agent to check it.");
  await expect(alert(page).locator('tv-icon[name="warning"]')).toBeVisible();
}

// proofs/arch/templates/map.md#^templates-map-ac-live
// proofs/product/templates.md delegates the bundled creation journey to this acceptance.
test("new Map from Toolbox has the empty seed, shared display and independent packaged assets", async ({ page }) => {
  const responses: { url: string; ok: boolean }[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/(styles\.css|components\.js)|sdk\/v1\/resources\.js|\/(map\.css|map\.js|leaflet\.css|leaflet\.js)$/.test(response.url())) {
      responses.push({ url: response.url(), ok: response.ok() });
    }
  });

  const { artifactID: id, frame } = await h.create(page);
  await expect(frame.getByText("No places yet", { exact: true })).toBeVisible();
  await expect(frame.locator("#sidebar")).toBeHidden();
  expect(await h.read(id)).toEqual({});
  expect(writes()).toEqual([]);
  expect(h.proxy.messages.filter(({ message }) => message.type === "subscribe").map(({ message }) => message.path)).toContain("");
  const layout = (await h.client.channels.get({ channelID: h.channelID })).channel.layout;
  expect(layout[0]).toMatchObject({ size: { width: 760, height: 770 }, geometry: { kind: "single", full_screen: false } });

  const links = await frame.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  expect(links[0]).toContain("/canonical/v2/styles.css");
  expect(links).toEqual(expect.arrayContaining([
    expect.stringContaining(`/artifact/${id}/vendor/leaflet.css`),
    expect.stringContaining(`/artifact/${id}/map.css`),
  ]));
  expect(responses.every(response => response.ok)).toBe(true);
  expect(responses.some(response => response.url.endsWith(`/artifact/${id}/map.css`))).toBe(true);
  expect(responses.some(response => response.url.endsWith(`/artifact/${id}/map.js`))).toBe(true);
  expect(responses.some(response => response.url.includes("/canonical/v2/components.js"))).toBe(true);
  expect(responses.some(response => response.url.includes("/sdk/v1/resources.js"))).toBe(true);
  expect(tileRequests.length).toBeGreaterThan(0);

  renameSync(path.join(h.home, "templates/map"), path.join(h.home, "map-outside-discovery"));
  await page.reload();
  const independent = await h.frame(page, id);
  await expect(independent.getByText("No places yet", { exact: true })).toBeVisible();
});

// proofs/arch/templates/map.md#^templates-map-ac-live
test("live places, filtering, details and local controls never write to the store", async ({ page }) => {
  const data = places();
  const id = await open(page, data);
  await expect(rows(page)).toHaveText(["Botanical GardenParksGlasshouses and gardens", "City MuseumCultureHistory and art", "Gateway ArchRiverfront monument"]);
  await expect(page.locator('.map-pin[data-key="garden"] [data-icon="park"]')).toHaveCount(1);
  await expect(page.locator('.map-pin[data-key="arch"] [data-icon="pin"]')).toHaveCount(1);

  await filter(page).fill("culture");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toHaveAttribute("data-key", "museum");
  await filter(page).fill("nothing here");
  await expect(page.getByText("No matching places", { exact: true })).toBeVisible();
  await filter(page).press("Escape");
  await expect(rows(page)).toHaveCount(3);

  await page.locator('.place-button[data-key="museum"]').click();
  await expect(page.locator("#detail-title")).toHaveText("City Museum");
  await expect(page.locator("#detail-fields")).toContainText("Admission$12");
  await page.getByRole("button", { name: "Back to places" }).click();
  await page.getByRole("button", { name: "Map layers" }).click();
  await page.getByRole("button", { name: /Satellite/ }).click();
  await expect(page.locator("#layer-label")).toHaveText("Satellite");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "false");

  await h.set(id, { title: "Added live", lat: 38.64, lng: -90.24, order: 4, category: "parks" }, "places/live");
  await expect(page.locator('.place-button[data-key="live"]')).toContainText("Added live");
  expect(h.product.runCLI(["resource", "json", "set", "--artifact", id, "places/agent", JSON.stringify({ title: "Agent place", lat: 38.65, lng: -90.25, order: 5 })]))
    .toContain(`JSON store of artifact ${id} updated.`);
  await expect(page.locator('.place-button[data-key="agent"]')).toContainText("Agent place");
  await expect(page.locator("#layer-label")).toHaveText("Satellite");
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "false");
  expect(await h.read(id)).toEqual({ ...data, places: { ...data.places, live: { title: "Added live", lat: 38.64, lng: -90.24, order: 4, category: "parks" }, agent: { title: "Agent place", lat: 38.65, lng: -90.25, order: 5 } } });
  expect(writes()).toEqual([]);
});

// proofs/arch/templates/map.md#^templates-map-ac-live
test("read-only access loss and disconnection retain the last map and reconnect live", async ({ page }) => {
  const data = places();
  const id = await h.createStored(data as unknown as JSONValue);
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID);
  await expect(rows(page)).toHaveCount(3);
  await page.evaluate(async () => {
    const sdk = await import("/sdk/v1/resources.js");
    Object.assign(window, { mapListenerError: null, mapConnections: [] });
    sdk.onValue(sdk.ref(sdk.getStore()), () => {}, error => { Object.assign(window, { mapListenerError: error.code }); });
    sdk.onConnectionStatusChanged(status => (window as unknown as { mapConnections: string[] }).mapConnections.push(status));
  });

  h.proxy.refuse(true);
  h.proxy.sever();
  await expect.poll(() => page.evaluate(() => (window as unknown as { mapConnections: string[] }).mapConnections.includes("disconnected"))).toBe(true);
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "places/museum/title", JSON.stringify("Museum updated")]);
  await expect(page.locator('.place-button[data-key="museum"]')).toContainText("City Museum");
  await expect(alert(page)).toBeHidden();
  h.proxy.refuse(false);
  await expect(page.locator('.place-button[data-key="museum"]')).toContainText("Museum updated");

  await h.client.resources.unshare({ artifactID: id });
  await expect.poll(() => page.evaluate(() => (window as unknown as { mapListenerError: string | null }).mapListenerError)).toBe("no-store");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.place-button[data-key="museum"]')).toContainText("Museum updated");
  await expect(alert(page)).toBeHidden();
  expect(writes()).toEqual([]);
});

// proofs/arch/templates/map.md#^templates-map-ac-live
test("unreadable and damaged data recover without repair while invalid coordinates are omitted", async ({ page }) => {
  const id = await open(page);
  await h.set(id, { title: "Off map", lat: 120, lng: -90 }, "places/bad");
  await expect(page.locator('.place-button[data-key="bad"]')).toHaveCount(0);
  await h.set(id, { title: "Untitled fallback", lat: 38.7, lng: -90.3, category: "parks", icon: "unknown" }, "places/fallback");
  await expect(page.locator('.map-pin[data-key="fallback"] [data-icon="park"]')).toHaveCount(1);

  await h.set(id, [] as unknown as JSONValue);
  await expectError(page);
  expect(writes()).toEqual([]);
  await h.set(id, places() as unknown as JSONValue);
  await expect(rows(page)).toHaveCount(3);
  await expect(alert(page)).toBeHidden();

  const file = h.contentFile(id);
  const original = readFileSync(file);
  await h.restart(() => writeFileSync(file, "{damaged json"));
  await expectError(page);
  expect(readFileSync(file, "utf8")).toBe("{damaged json");
  await h.restart(() => writeFileSync(file, original));
  await expect(rows(page)).toHaveCount(3, { timeout: 20_000 });
  await expect(alert(page)).toBeHidden();
  expect(writes()).toEqual([]);
});
