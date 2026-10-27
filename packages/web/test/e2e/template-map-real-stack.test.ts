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
    museum: {
      title: "City Museum", lat: 38.627, lng: -90.201, order: 2, category: "culture", icon: "landmark", description: "History and art",
      photo: "icon.svg", credit: { text: "Bundled map icon", url: "https://example.com/icon-source" },
      fields: { Admission: "$12", Hours: { Monday: "9–5" }, Stops: ["North", "South"], Notes: null },
    },
    garden: { title: "Botanical Garden", lat: 38.615, lng: -90.258, order: 1, category: "parks", description: "Glasshouses and gardens" },
    arch: { title: "Gateway Arch", lat: 38.625, lng: -90.185, order: 3, category: "missing", icon: "heart", description: "Riverfront monument" },
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
}

// proofs/arch/templates/map.md#^templates-map-ac-create
// proofs/product/templates.md delegates the bundled creation journey to this acceptance.
test("new Map from Toolbox has the empty seed, shared display and independent packaged assets", async ({ page }) => {
  const responses: { url: string; ok: boolean }[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/(styles\.css|components\.js)|sdk\/v1\/resources\.js|\/(map\.css|map\.js|map-model\.js|leaflet\.css|leaflet\.js)$/.test(response.url())) {
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
  expect(responses.some(response => response.url.endsWith(`/artifact/${id}/map-model.js`))).toBe(true);
  expect(responses.some(response => response.url.includes("/canonical/v2/components.js"))).toBe(true);
  expect(responses.some(response => response.url.includes("/sdk/v1/resources.js"))).toBe(true);
  expect(tileRequests.length).toBeGreaterThan(0);

  renameSync(path.join(h.home, "templates/map"), path.join(h.home, "map-outside-discovery"));
  await page.reload();
  const independent = await h.frame(page, id);
  await expect(independent.getByText("No places yet", { exact: true })).toBeVisible();
});

// proofs/arch/templates/map.md#^templates-map-ac-live
test("live store values and tolerant later reads stay read-only", async ({ page }) => {
  const data = places();
  const id = await open(page, data);
  await expect(page.locator("#title")).toHaveText("City places");
  await expect(page).toHaveTitle("City places");
  await expect(page.locator("#subtitle")).toHaveText("Three stops");
  await expect(rows(page)).toHaveText(["Botanical GardenParksGlasshouses and gardens", "City MuseumCultureHistory and art", "Gateway ArchRiverfront monument"]);
  await expect(page.locator('.map-pin[data-key="garden"] [data-icon="park"]')).toHaveCount(1);
  await expect(page.locator('.map-pin[data-key="museum"] [data-icon="landmark"]')).toHaveCount(1);
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
  await expect(page.locator("#detail-fields")).toContainText('{"Monday":"9–5"}');
  await expect(page.locator("#detail-fields")).toContainText('["North","South"]');
  await expect(page.locator("#detail-fields")).toContainText("Notes—");
  await expect(page.locator("#detail-photo img")).toHaveAttribute("src", "icon.svg");
  await expect(page.locator("#detail-credit a")).toHaveText("Photo: Bundled map icon");
  await expect(page.locator("#detail-credit a")).toHaveAttribute("href", "https://example.com/icon-source");
  await page.getByRole("button", { name: "Back to places" }).click();
  await page.getByRole("button", { name: "Map layers" }).click();
  await page.getByRole("button", { name: /Satellite/ }).click();
  await expect(page.locator("#layer-label")).toHaveText("Satellite");
  await expect.poll(() => tileRequests.some(url => url.includes("World_Imagery/MapServer"))).toBe(true);
  await page.getByRole("button", { name: "Map layers" }).click();
  await page.getByRole("button", { name: /Hybrid/ }).click();
  await expect(page.locator("#layer-label")).toHaveText("Hybrid");
  await expect.poll(() => tileRequests.some(url => url.includes("Reference/World_Boundaries_and_Places/MapServer"))).toBe(true);
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "false");

  await h.set(id, { title: "Added live", lat: 38.64, lng: -90.24, order: 4, category: "parks" }, "places/live");
  await expect(page.locator('.place-button[data-key="live"]')).toContainText("Added live");
  const pushed = JSON.parse(h.product.runCLI([
    "resource", "json", "push", "--artifact", id, "places",
    JSON.stringify({ title: "Agent place", lat: 38.65, lng: -90.25, order: 5 }),
  ])) as { key: string };
  expect(pushed.key).toMatch(/^-/);
  await expect(page.locator(`.place-button[data-key="${pushed.key}"]`)).toContainText("Agent place");
  await expect(page.locator("#layer-label")).toHaveText("Hybrid");
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "false");

  await h.set(id, "standard", "basemap");
  await expect(page.locator("#layer-label")).toHaveText("Standard");
  await h.set(id, "open", "sidebar");
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "true");
  expect(await h.read(id)).toEqual({
    ...data,
    basemap: "standard",
    sidebar: "open",
    places: {
      ...data.places,
      live: { title: "Added live", lat: 38.64, lng: -90.24, order: 4, category: "parks" },
      [pushed.key]: { title: "Agent place", lat: 38.65, lng: -90.25, order: 5 },
    },
  });

  await h.set(id, "satellite", "basemap");
  await expect(page.locator("#layer-label")).toHaveText("Satellite");
  await h.set(id, "closed", "sidebar");
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "false");

  await h.set(id, {
    title: 42,
    subtitle: {},
    numbered: "yes",
    basemap: "terrain",
    sidebar: true,
    categories: {
      apple: { name: "Lower" },
      ab: { name: "Explicit", icon: "star", color: "blue" },
      Zoo: { name: "Upper" },
      fallback: { name: "Fallback", icon: "park", color: "unknown" },
      neutral: { name: "Neutral", color: "neutral" },
      nameless: { icon: "heart", color: "pink" },
      "-bad": { name: "Ignored", icon: "heart", color: "red" },
    },
    places: {
      neutralPlace: { title: "Neutral place", lat: 38.655, lng: -90.255, order: 0, category: "neutral" },
      apple: { title: "Lowercase", lat: 38.64, lng: -90.24, order: 0 },
      Zoo: { title: "Uppercase", lat: 38.63, lng: -90.23, order: 0, category: "fallback", icon: "unknown" },
      "10": { title: "Ten", lat: 38.61, lng: -90.21, order: 0, category: "apple" },
      abPlace: { title: "Explicit blue", lat: 38.635, lng: -90.235, order: 0, category: "ab" },
      namelessPlace: { title: "Nameless category", lat: 38.645, lng: -90.245, order: 0, category: "nameless" },
      "2": { title: "Two", lat: 38.62, lng: -90.22, order: 0, category: "Zoo" },
      "-push": {
        title: "", lat: 38.65, lng: -90.25, order: "last", category: "-bad", description: 3,
        photo: "http://example.com/photo.jpg", credit: { text: "Unsafe credit", url: "http://example.com" }, fields: [], extra: "ignored",
      },
      badCoordinates: { title: "Off map", lat: 120, lng: -90 },
    },
    extra: "ignored",
  } as unknown as JSONValue);
  await expect(rows(page)).toHaveText([
    "TwoUpper", "TenLower", "UppercaseFallback", "Explicit blueExplicit", "Lowercase", "Nameless category", "Neutral placeNeutral", "Untitled place",
  ]);
  await expect(page.locator('.map-pin[data-key="2"]')).toHaveAttribute("data-color", "red");
  await expect(page.locator('.map-pin[data-key="10"]')).toHaveAttribute("data-color", "orange");
  await expect(page.locator('.map-pin[data-key="Zoo"]')).toHaveAttribute("data-color", "yellow");
  await expect(page.locator('.map-pin[data-key="Zoo"] [data-icon="park"]')).toHaveCount(1);
  await expect(page.locator('.map-pin[data-key="abPlace"]')).toHaveAttribute("data-color", "blue");
  await expect(page.locator('.map-pin[data-key="abPlace"] [data-icon="star"]')).toHaveCount(1);
  await expect(page.locator('.map-pin[data-key="neutralPlace"]')).toHaveAttribute("data-color", "neutral");
  await expect(page.locator('.map-pin[data-key="apple"]')).toHaveAttribute("data-color", "default");
  await expect(page.locator('.map-pin[data-key="apple"] [data-icon="pin"]')).toHaveCount(1);
  await expect(page.locator('.map-pin[data-key="namelessPlace"]')).toHaveAttribute("data-color", "default");
  await expect(page.locator('.map-pin[data-key="-push"]')).toHaveAttribute("data-color", "default");
  await expect(page.locator('.map-pin[data-key="-push"] [data-icon="pin"]')).toHaveCount(1);
  await expect(page.locator('.place-button[data-key="badCoordinates"]')).toHaveCount(0);
  await expect(page.locator("#title")).toHaveText("Places");
  await expect(page).toHaveTitle("Map");
  await expect(page.locator("#subtitle")).toBeHidden();
  await expect(page.locator(".pin-number, .list-badge")).toHaveCount(0);
  await expect(page.locator("#layer-label")).toHaveText("Standard");
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar-open", "true");
  await h.set(id, true, "numbered");
  await expect(page.locator(".list-badge")).toHaveText(["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."]);
  await expect(page.locator(".pin-number")).toHaveText(["1", "2", "3", "4", "5", "6", "7", "8"]);
  await h.set(id, "yes", "numbered");
  await expect(page.locator(".pin-number, .list-badge")).toHaveCount(0);
  await page.locator('.place-button[data-key="-push"]').click();
  await expect(page.locator("#detail-title")).toHaveText("Untitled place");
  await expect(page.locator("#detail-description")).toBeHidden();
  await expect(page.locator("#detail-photo")).toBeHidden();
  await expect(page.locator("#detail-credit")).toHaveText("Photo: Unsafe credit");
  await expect(page.locator("#detail-credit a")).toHaveCount(0);
  await expect(page.locator("#detail-fields")).toBeHidden();

  await h.set(id, {
    categories: [],
    places: { solo: { title: "No category map", lat: 38.66, lng: -90.26, category: "Zoo" } },
  } as unknown as JSONValue);
  await expect(rows(page)).toHaveText(["No category map"]);
  await expect(page.locator('.map-pin[data-key="solo"]')).toHaveAttribute("data-color", "default");
  await h.set(id, { categories: {}, places: [] } as unknown as JSONValue);
  await expect(page.getByText("No places yet", { exact: true })).toBeVisible();
  await expect(alert(page)).toBeHidden();
  await h.set(id, null);
  await expect(page.getByText("No places yet", { exact: true })).toBeVisible();
  await h.remove(id);
  await expect(page.getByText("No places yet", { exact: true })).toBeVisible();
  await expect(alert(page)).toBeHidden();
  expect(writes()).toEqual([]);
});

// proofs/arch/templates/map.md#^templates-map-ac-connection
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

// proofs/arch/templates/map.md#^templates-map-ac-recovery
test("unreadable roots and terminal errors recover without repair", async ({ page }) => {
  const id = await open(page);
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
