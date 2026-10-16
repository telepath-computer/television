import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_PAGE_SIZE, TelevisionClient } from "@telepath-computer/television-shared";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion, createArtifactFile } from "./helpers.ts";

function template(home: string, id: string, name: string, description = "Ready to use", image?: string, data?: unknown): string {
  const folder = path.join(home, "templates", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name, description, version: "1.0.0" }));
  writeFileSync(path.join(folder, "index.html"), `<!doctype html><title>${name}</title><h1>${name}</h1>`);
  if (image) writeFileSync(path.join(folder, "thumbnail.png"), readFileSync(image));
  if (data !== undefined) writeFileSync(path.join(folder, "data.json"), JSON.stringify(data));
  return folder;
}

function appIndexURL(appURL: string, token: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  url.searchParams.set("token", token);
  return url.toString();
}

async function openApp(page: Page, product: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  await page.goto(appIndexURL(await product.appURL(baseURL), product.token));
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", /^(connected|empty-channel)$/);
}

async function openTemplates(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await expect(page.locator(".templates-popover")).toHaveAttribute("open", "");
  await expect(page.getByRole("combobox", { name: "Search templates" })).toBeFocused();
}

test("fresh authenticated scan, images, errors, and empty states (^templates-ui-ac-open)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const calendar = path.resolve("../../specs/ui/app/skill-selector/thumbnails/calendar.png");
    template(product.home, "calendar", "Calendar", "A weekly view", calendar);
    template(product.home, "example", "Example");
    const broken = template(product.home, "broken", "Broken");
    rmSync(path.join(broken, "index.html"));
    await openApp(page, product, baseURL);
    const requests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/templates/") && request.url().includes("thumbnail.png")) requests.push(request.url()); });
    await expect(page.getByRole("button", { name: "Templates", exact: true })).toHaveAttribute("title", "Templates");
    await openTemplates(page);
    await expect(page.locator(".templates-grid > .template-tile")).toHaveCount(2);
    await expect(page.locator(".template-tile-name")).toHaveText(["Calendar", "Example"]);
    await expect(page.locator(".templates-invalid")).toContainText("broken");
    await expect(page.locator(".templates-invalid")).toContainText("index.html");
    await expect(page.locator(".template-tile img")).toHaveCount(1);
    await expect(page.locator(".template-tile img")).toHaveAttribute("alt", "");
    await expect(page.locator(".template-tile img")).toHaveAttribute("draggable", "false");
    await expect(page.locator(".template-tile").nth(1).locator('tv-icon[name="artifact"]')).toHaveCount(1);
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator(".templates-search input")).toHaveAttribute("aria-controls", "templates-grid");
    await expect(page.locator(".templates-search input")).not.toHaveAttribute("aria-activedescendant", /.+/);
    await page.getByRole("combobox", { name: "Search templates" }).fill("nothing");
    await expect(page.locator(".templates-empty")).toHaveText("No templates match “nothing”.");
    await expect(page.locator(".templates-invalid")).toContainText("broken");
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    rmSync(path.join(product.home, "templates", "calendar"), { recursive: true });
    rmSync(path.join(product.home, "templates", "example"), { recursive: true });
    await openTemplates(page);
    await expect(page.locator(".templates-empty")).toHaveText("No valid templates. Ask your agent to fix or make one.");
    await expect(page.locator(".templates-search input")).toHaveValue("");
    await expect(page.locator(".templates-search input")).not.toHaveAttribute("aria-activedescendant", /.+/);
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    rmSync(broken, { recursive: true });
    await openTemplates(page);
    await expect(page.locator(".templates-empty")).toHaveText("No templates yet. Ask your agent to make one.");
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    rmSync(path.join(product.home, "templates"), { recursive: true });
    writeFileSync(path.join(product.home, "templates"), "blocked");
    await openTemplates(page);
    await expect(page.locator(".templates-folder-error")).toContainText("Television couldn't read the templates folder.");
    await expect(page.locator(".templates-search input")).toHaveAttribute("aria-expanded", "false");
  } finally {
    await product.dispose();
  }
});

test("search, keyboard and pointer highlight (^templates-ui-ac-search)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    for (const [id, name, description] of [
      ["a", "Alpha", "One"], ["b", "Bravo", "Two"], ["c", "Charlie", "Three"],
      ["d", "Delta", "Four"], ["e", "Echo", "Five"], ["f", "Foxtrot", "Six"],
      ["g", "Golf", "Seven"],
    ]) template(product.home, id!, name!, description!);
    await openApp(page, product, baseURL);
    await openTemplates(page);
    const search = page.getByRole("combobox", { name: "Search templates" });
    const listbox = page.getByRole("listbox", { name: "Templates" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveCount(7);
    await expect(listbox.getByRole("option", { name: "Alpha" })).toHaveCount(1);
    for (const arrow of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
      await search.fill("One");
      await search.fill("");
      await expect(search).not.toHaveAttribute("aria-activedescendant", /.+/);
      await search.press(arrow);
      await expect(search).toHaveAttribute("aria-activedescendant", "template-0");
    }
    await search.press("ArrowRight");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-1");
    await search.press("ArrowUp");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-1");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-4");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-4");
    await search.press("ArrowUp");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-1");
    await search.press("ArrowLeft");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-0");
    await search.press("ArrowLeft");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-0");
    await search.fill("FIVE");
    await expect(page.locator(".template-tile-name")).toHaveText(["Echo"]);
    await expect(search).toHaveAttribute("aria-activedescendant", "template-0");
    await search.fill("brAV");
    await expect(listbox.getByRole("option", { name: "Bravo" })).toHaveCount(1);
    await expect(search).toHaveAttribute("aria-activedescendant", "template-0");
    await search.fill("");
    await expect(search).not.toHaveAttribute("aria-activedescendant", /.+/);
    await page.locator(".template-tile").nth(3).hover();
    await expect(search).toHaveAttribute("aria-activedescendant", "template-3");
    await expect(search).toBeFocused();
    await expect(page.locator(".template-tile").nth(3)).toHaveAttribute("data-highlighted", "");
    await expect(page.locator(".template-tile").first()).toHaveCSS("user-select", "none");
    await page.mouse.down();
    await expect(search).toBeFocused();
    await expect(page.locator(".template-tile").nth(3)).toHaveAttribute("data-pressed", "");
    const heading = await page.locator(".templates-heading").boundingBox();
    if (!heading) throw new Error("Templates heading has no pointer geometry");
    await page.mouse.move(heading.x + heading.width - 12, heading.y + heading.height / 2);
    await page.mouse.up();
    await expect(page.locator(".template-tile").nth(3)).not.toHaveAttribute("data-pressed", "");
    await expect(page.locator(".templates-popover")).toHaveAttribute("open", "");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-6");
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", "template-6");
    expect(await page.locator(".template-tile").first().evaluate((tile) => (tile as HTMLElement).draggable)).toBe(false);
  } finally {
    await product.dispose();
  }
});

test("typing before the real scan returns highlights the first match (^templates-ui-ac-search)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  let releaseScan = () => {};
  try {
    template(product.home, "alpha", "Alpha", "A named match");
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    const countBefore = (await client.artifacts.list({ channelID })).artifacts.length;
    await openApp(page, product, baseURL);
    const heldScan = new Promise<void>((resolve) => { releaseScan = resolve; });
    let observeScan = () => {};
    const scanRequested = new Promise<void>((resolve) => { observeScan = resolve; });
    await page.route((url) => url.pathname === "/templates", async (route) => {
      observeScan();
      await heldScan;
      await route.continue();
    });
    await openTemplates(page);
    await scanRequested;
    const search = page.getByRole("combobox", { name: "Search templates" });
    await search.fill("aLP");
    await expect(search).not.toHaveAttribute("aria-activedescendant", /.+/);
    releaseScan();
    await expect(page.locator(".templates-popover").getByRole("option", { name: "Alpha" })).toBeVisible();
    await expect(search).toHaveAttribute("aria-activedescendant", "template-0");
    await search.press("Enter");
    await expect.poll(async () => (await client.artifacts.list({ channelID })).artifacts.length).toBe(countBefore + 1);
  } finally {
    releaseScan();
    await product.dispose();
  }
});

test("click and Return create after selected tab or in empty channel; failures preserve selection (^templates-ui-ac-create, ^templates-ac-ui-create)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    template(product.home, "example", "Example");
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    const first = (await client.artifacts.create({ channelID, kind: "path", title: "First", path: createArtifactFile(product.home, "first", "<title>First</title>", "html") })).artifact;
    const second = (await client.artifacts.create({ channelID, kind: "path", title: "Second", path: createArtifactFile(product.home, "second", "<title>Second</title>", "html") })).artifact;
    await openApp(page, product, baseURL);
    await page.locator(`.top-bar .tab[data-artifact-id="${first.id}"]`).click();
    const requests: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/templates/artifacts") && request.method() === "POST") requests.push(request.postDataJSON());
    });
    await openTemplates(page);
    await page.getByRole("combobox", { name: "Search templates" }).press("Enter");
    expect(requests).toHaveLength(0);
    await page.locator(".template-tile").click();
    await expect(page.locator(".templates-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.channels.get({ channelID })).channel.layout.map((entry) => entry.artifactIds[0])).toHaveLength(3);
    const created = (await client.channels.get({ channelID })).channel.layout[1]!.artifactIds[0]!;
    expect((await client.channels.get({ channelID })).channel.layout.map((entry) => entry.artifactIds[0])).toEqual([first.id, created, second.id]);
    await expect(page.locator(`.stage .page[data-page-key="${created}"]`)).toHaveAttribute("selected", "");
    expect(requests[0]).toMatchObject({ templateID: "example", channelID, after: first.id, source: "ui" });
    await expect(page.locator(`.stage .page[data-page-key="${created}"] iframe`).contentFrame().locator("h1")).toHaveText("Example");
    const empty = (await client.channels.create({ name: "Empty template channel" })).channel;
    await client.display.patch({ focusedChannelId: empty.id });
    await expect(page.locator(".stage .page")).toHaveCount(0);
    await openTemplates(page);
    const search = page.getByRole("combobox", { name: "Search templates" });
    await search.fill("ex");
    await search.press("Enter");
    await expect.poll(async () => (await client.channels.get({ channelID: empty.id })).channel.layout).toHaveLength(1);
    expect(requests[1]).toMatchObject({ templateID: "example", channelID: empty.id, source: "ui" });
    expect(requests[1]).not.toHaveProperty("after");
    await expect(page.locator(".stage .page[selected]")).toHaveCount(1);
    await openTemplates(page);
    const selectedBefore = await page.locator(".stage .page[selected]").getAttribute("data-page-key");
    const artifactCountBefore = (await client.artifacts.list({ channelID: empty.id })).artifacts.length;
    rmSync(path.join(product.home, "templates", "example"), { recursive: true });
    const refused = page.waitForResponse((response) => response.url().endsWith("/templates/artifacts") && response.request().method() === "POST");
    await page.locator(".template-tile").click();
    expect((await refused).status()).toBe(404);
    await expect(page.locator(".templates-popover")).not.toHaveAttribute("open", "");
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", selectedBefore!);
    expect((await client.artifacts.list({ channelID: empty.id })).artifacts).toHaveLength(artifactCountBefore);
    await expect(page.locator(".templates-popover")).not.toContainText("Error");
    await openTemplates(page);
    await page.getByRole("combobox", { name: "Search templates" }).press("Escape");
    await expect(page.locator(".templates-popover")).not.toHaveAttribute("open", "");
  } finally {
    await product.dispose();
  }
});

// proofs/product/templates.md#^templates-ac-display-ui
test("Templates popover uses manifest display and shared defaults without sending display", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const folder = template(product.home, "sized", "Sized");
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
      name: "Sized", description: "Ready to use", version: "1.0.0",
      display: { width: 360, fullScreen: true },
    }));
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    let requestBody: Record<string, unknown> | undefined;
    page.on("request", (request) => {
      if (request.url().endsWith("/templates/artifacts") && request.method() === "POST") {
        requestBody = request.postDataJSON() as Record<string, unknown>;
      }
    });

    await openApp(page, product, baseURL);
    await openTemplates(page);
    await page.locator(".template-tile").click();
    await expect.poll(async () => (await client.channels.get({ channelID })).channel.layout).toHaveLength(1);
    const layout = (await client.channels.get({ channelID })).channel.layout;
    expect(layout[0]).toMatchObject({
      geometry: { kind: "single", full_screen: true }, size: { width: 360, height: DEFAULT_PAGE_SIZE.height },
    });
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("full-screen", "");
    expect(requestBody).toMatchObject({ templateID: "sized", channelID, source: "ui" });
    expect(requestBody).not.toHaveProperty("display");
  } finally {
    await product.dispose();
  }
});

test("failed focus request leaves the prior page selected (^templates-ui-ac-create)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    template(product.home, "example", "Example");
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    const existing = (await client.artifacts.create({
      channelID, kind: "path", title: "Existing",
      path: createArtifactFile(product.home, "existing", "<title>Existing</title>", "html"),
    })).artifact;
    await openApp(page, product, baseURL);
    await page.locator(`.top-bar .tab[data-artifact-id="${existing.id}"]`).click();
    await openTemplates(page);
    let focusRequests = 0;
    await page.route((url) => url.pathname === "/display/focus", async (route) => {
      focusRequests++;
      await route.abort("failed");
    });
    await page.locator(".template-tile").click();
    await expect(page.locator(".templates-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.artifacts.list({ channelID })).artifacts.length).toBe(2);
    expect(focusRequests).toBe(1);
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", existing.id);
    expect((await client.display.get()).focusedChannelId).toBe(channelID);
  } finally {
    await product.dispose();
  }
});

test("partial creation after store obstruction never takes focus (^templates-ui-ac-post-copy-failure)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    template(product.home, "seeded", "Seeded", "A seeded page", undefined, { ready: true });
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    const existing = (await client.artifacts.create({ channelID, kind: "path", title: "Existing", path: createArtifactFile(product.home, "existing", "<title>Existing</title>", "html") })).artifact;
    await openApp(page, product, baseURL);
    await openTemplates(page);
    writeFileSync(path.join(product.home, "resources"), "blocked");
    await page.evaluate(() => {
      (window as unknown as { __templateSelections: string[] }).__templateSelections = [];
      new MutationObserver(() => {
        const id = document.querySelector<HTMLElement>(".stage .page[selected]")?.dataset.pageKey;
        if (id) (window as unknown as { __templateSelections: string[] }).__templateSelections.push(id);
      }).observe(document.querySelector(".stage")!, { subtree: true, childList: true, attributes: true });
    });
    const response = page.waitForResponse((value) => value.url().endsWith("/templates/artifacts") && value.request().method() === "POST");
    await page.locator(".template-tile").click();
    expect((await response).status()).toBe(500);
    await expect(page.locator(".templates-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.channels.get({ channelID })).channel.layout.length).toBe(2);
    await expect(page.locator(".stage .page")).toHaveCount(2);
    const selected = await page.evaluate(() => (window as unknown as { __templateSelections: string[] }).__templateSelections);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((id) => id === existing.id)).toBe(true);
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", existing.id);
    await expect(page.locator(".templates-popover")).not.toContainText("Error");
  } finally {
    await product.dispose();
  }
});
