import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_PAGE_SIZE, TelevisionClient } from "@telepath-computer/television-shared";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion, createArtifactFile } from "./helpers.ts";

function template(home: string, id: string, name: string): string {
  const folder = path.join(home, "templates", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name, description: "Ready to use", version: "1.0.0" }));
  writeFileSync(path.join(folder, "index.html"), `<!doctype html><title>${name}</title><h1>${name}</h1>`);
  return folder;
}

async function openApp(page: Page, product: ProductServer, baseURL: string | undefined): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  const appURL = await product.appURL(baseURL);
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  url.searchParams.set("token", product.token);
  await page.goto(url.toString());
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  await expect(page.locator("#app")).toHaveAttribute("data-app-state", /^(connected|empty-channel)$/);
}

async function openToolbox(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Toolbox", exact: true }).click();
  await expect(page.locator(".toolbox-popover")).toHaveAttribute("open", "");
  await expect(page.getByRole("combobox", { name: "Search toolbox" })).toBeFocused();
}

// proofs/ui/app/toolbox.md#^toolbox-ac-icon-continuity
test("creating an artifact keeps Toolbox icons in place without letter fallbacks", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  let releaseIcons!: () => void;
  const iconGate = new Promise<void>((resolve) => { releaseIcons = resolve; });
  try {
    for (const name of ["Calendar", "Notes"]) {
      const folder = template(product.home, name.toLowerCase(), name);
      writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name, description: "Page", version: "1.0.0", icons: [{ src: "icon.svg" }] }));
      writeFileSync(path.join(folder, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
    }
    await openApp(page, product, baseURL);
    await openToolbox(page);
    const images = page.locator(".toolbox-tile img");
    await expect(images).toHaveCount(2);
    await expect.poll(() => images.evaluateAll((nodes: HTMLImageElement[]) => nodes.every(img => img.complete && img.naturalWidth === 20))).toBe(true);
    const initial = await images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map(img => img.src));
    await page.route("**/templates/*/icon", async route => {
      await iconGate;
      await route.continue();
    });
    await page.evaluate(() => {
      const state = { fallbacks: 0 };
      (window as unknown as { __toolboxIcons: typeof state }).__toolboxIcons = state;
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element) state.fallbacks += Number(node.matches(".toolbox-letter")) + node.querySelectorAll(".toolbox-letter").length;
        }
      }).observe(document.querySelector(".toolbox-popover")!, { subtree: true, childList: true });
    });
    const created = page.waitForResponse(response => response.url().endsWith("/templates/artifacts") && response.request().method() === "POST");
    await page.getByRole("gridcell", { name: "Calendar", exact: true }).click();
    expect((await created).ok()).toBe(true);
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    await openToolbox(page);
    await expect(images).toHaveCount(2);
    expect(await images.evaluateAll((nodes: HTMLImageElement[]) => nodes.map(img => img.src))).toEqual(initial);
    expect(await page.evaluate(() => (window as unknown as { __toolboxIcons: { fallbacks: number } }).__toolboxIcons.fallbacks)).toBe(0);
    await expect(page.locator(".toolbox-letter")).toHaveCount(0);
  } finally {
    releaseIcons();
    await page.unrouteAll({ behavior: "wait" });
    await product.dispose();
  }
});

// proofs/ui/app/toolbox.md#^toolbox-ac-open
// proofs/ui/app/toolbox.md#^toolbox-t-shortcut-seam
test("Toolbox opens, dismisses and toggles with the host keyboard shortcut", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const longName = "An item with a much longer name than usual";
    for (const [id, name] of [["calendar", "Calendar"], ["long-name", longName], ["checklist", "Checklist"], ["code", "Code"]]) {
      template(product.home, id!, name!);
    }
    await openApp(page, product, baseURL);
    const trigger = page.getByRole("button", { name: "Toolbox", exact: true });
    await expect(trigger).toHaveAttribute("title", "Toolbox");
    const controls = page.locator(".top-bar-controls > button");
    expect(await controls.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")).slice(0, 2))).toEqual(["Toolbox", "Settings"]);
    await openToolbox(page);
    const panel = page.getByRole("region", { name: "Toolbox" });
    const search = page.getByRole("combobox", { name: "Search toolbox" });
    await expect(search).toHaveAttribute("placeholder", "Search toolbox…");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-haspopup", "grid");
    await expect(search).toHaveAttribute("aria-autocomplete", "list");
    await expect(search).toHaveAttribute("aria-expanded", "true");
    await expect(search).toHaveAttribute("aria-controls", "toolbox-grid");
    const grid = page.getByRole("grid", { name: "Toolbox" });
    const rows = grid.getByRole("row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByRole("gridcell")).toHaveCount(3);
    await expect(rows.last().getByRole("gridcell")).toHaveCount(1);
    const tile = grid.getByRole("gridcell", { name: "Calendar", exact: true });
    await expect(tile).toHaveAccessibleDescription("");
    await expect(tile.locator(".toolbox-letter")).toHaveAttribute("aria-hidden", "true");
    await expect(grid.getByRole("gridcell", { name: longName, exact: true })).toBeVisible();
    const triggerBounds = await trigger.boundingBox(), panelBounds = await panel.boundingBox();
    expect(Math.abs(panelBounds!.x + panelBounds!.width - triggerBounds!.x - triggerBounds!.width)).toBeLessThan(1);
    await search.fill("cal");
    await expect(tile).toHaveAttribute("aria-selected", "true");
    await expect(grid.locator('[aria-selected="true"]')).toHaveCount(1);
    await expect(search).toHaveAttribute("aria-activedescendant", await tile.getAttribute("id") ?? "missing-id");
    await search.fill("missing");
    await expect(page.getByRole("grid", { name: "Toolbox" })).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).not.toHaveAttribute("aria-controls");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await search.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(trigger).toBeFocused();
    const chord = await page.evaluate(() => navigator.platform.startsWith("Mac") ? "Meta+k" : "Control+k");
    await page.keyboard.press(chord);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await page.keyboard.press(chord);
    await expect(panel).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await openToolbox(page);
    await page.locator(".stage").click({ position: { x: 10, y: 10 } });
    await expect(panel).not.toBeVisible();
    await expect(page.locator(".toolbox-search input")).not.toBeFocused();
    await openToolbox(page);
    await trigger.click();
    await expect(panel).not.toBeVisible();
  } finally { await product.dispose(); }
});

// proofs/ui/app/toolbox.md#^toolbox-ac-directory-error
test("authenticated fresh directory failure replaces cached Toolbox tiles", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    template(product.home, "calendar", "Calendar");
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    await openApp(page, product, baseURL);
    await openToolbox(page);
    await expect(page.getByRole("gridcell", { name: "Calendar" })).toBeVisible();
    await page.keyboard.press("Escape");
    rmSync(path.join(product.home, "templates"), { recursive: true });
    writeFileSync(path.join(product.home, "templates"), "blocked");
    const scan = await client.templates.list({ fresh: true });
    expect(scan.errors[0]?.folder).toBeNull();
    await openToolbox(page);
    await expect(page.locator(".toolbox-folder-error")).toContainText("Could not read the templates folder.");
    await expect(page.locator(".toolbox-folder-error")).toContainText(scan.errors[0]!.error);
    await expect(page.locator(".toolbox-popover").getByRole("gridcell")).toHaveCount(0);
    await expect(page.getByRole("combobox")).not.toHaveAttribute("aria-controls");
  } finally { await product.dispose(); }
});

test("click and Return create copied artifacts with starting data after selected tab or in empty channel (^toolbox-ac-activation, ^templates-ac-ui-create)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const folder = template(product.home, "example", "Example");
    writeFileSync(path.join(folder, "data.json"), '{"message":"Toolbox starting value"}');
    writeFileSync(path.join(folder, "index.html"), `<!doctype html><h1>Example</h1><p id="message"></p><script type="module">
      import { getStore, onValue, ref } from "/sdk/v1/resources.js";
      onValue(ref(getStore()), snapshot => document.querySelector("#message").textContent = snapshot.val()?.message ?? "Unwritten");
    </script>`);
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
    await openToolbox(page);
    await page.getByRole("combobox", { name: "Search toolbox" }).press("Enter");
    expect(requests).toHaveLength(0);
    await page.locator(".toolbox-tile").click();
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.channels.get({ channelID })).channel.layout.map((entry) => entry.artifactIds[0])).toHaveLength(3);
    const created = (await client.channels.get({ channelID })).channel.layout[1]!.artifactIds[0]!;
    expect((await client.channels.get({ channelID })).channel.layout.map((entry) => entry.artifactIds[0])).toEqual([first.id, created, second.id]);
    await expect(page.locator(`.stage .page[data-page-key="${created}"]`)).toHaveAttribute("selected", "");
    expect(requests[0]).toEqual({ templateID: "example", channelID, after: first.id, source: "ui" });
    const artifact = (await client.artifacts.get({ artifactID: created })).artifact;
    expect(artifact.kind).toBe("path");
    if (artifact.kind !== "path") throw new Error("Expected a copied folder artifact");
    expect(path.dirname(path.resolve(artifact.path))).toBe(path.join(product.home, "artifacts"));
    expect(await client.resources.json.get({ store: { artifactID: created }, path: "" })).toEqual({ exists: true, value: { message: "Toolbox starting value" } });
    await expect(page.locator(`.stage .page[data-page-key="${created}"] iframe`).contentFrame().locator("#message")).toHaveText("Toolbox starting value");
    rmSync(path.join(folder, "data.json"));
    await expect(page.locator(`.stage .page[data-page-key="${created}"] iframe`).contentFrame().locator("h1")).toHaveText("Example");
    const empty = (await client.channels.create({ name: "Empty template channel" })).channel;
    await client.display.patch({ focusedChannelId: empty.id });
    await expect(page.locator(".stage .page")).toHaveCount(0);
    await openToolbox(page);
    const search = page.getByRole("combobox", { name: "Search toolbox" });
    await search.fill("ex");
    await search.press("Enter");
    await expect.poll(async () => (await client.channels.get({ channelID: empty.id })).channel.layout).toHaveLength(1);
    expect(requests[1]).toEqual({ templateID: "example", channelID: empty.id, source: "ui" });
    expect(requests[1]).not.toHaveProperty("after");
    await expect(page.locator(".stage .page[selected]")).toHaveCount(1);
    const unseeded = (await client.channels.get({ channelID: empty.id })).channel.layout[0]!.artifactIds[0]!;
    expect(await client.resources.json.get({ store: { artifactID: unseeded }, path: "" })).toEqual({ exists: false });
    await expect(page.locator(`.stage .page[data-page-key="${unseeded}"] iframe`).contentFrame().locator("#message")).toHaveText("Unwritten");
  } finally {
    await product.dispose();
  }
});

// proofs/product/templates.md#^templates-ac-display-ui
test("Toolbox uses manifest display and shared defaults without sending display", async ({ page, baseURL }) => {
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
    await openToolbox(page);
    await page.locator(".toolbox-tile").click();
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

// proofs/product/templates.md#^templates-ac-transparent-ui
test("Toolbox creates a focused transparent frame from manifest defaults without sending display (^templates-ac-transparent-ui)", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const product = await launchProductServer({ auth: true });
  try {
    const folder = template(product.home, "overlay", "Overlay");
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
      name: "Overlay", description: "Transparent document", version: "1.0.0",
      display: { width: 360, transparent: true },
    }));
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    await openApp(page, product, baseURL);
    await openToolbox(page);
    const requested = page.waitForRequest((request) => request.url().endsWith("/templates/artifacts") && request.method() === "POST");
    await page.getByRole("gridcell", { name: "Overlay" }).click();
    const request = (await requested).postDataJSON() as Record<string, unknown>;
    expect(request).toMatchObject({ templateID: "overlay", channelID, source: "ui" });
    expect(request).not.toHaveProperty("display");
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.channels.get({ channelID })).channel.layout).toHaveLength(1);
    const layout = (await client.channels.get({ channelID })).channel.layout[0]!;
    expect(layout).toMatchObject({
      geometry: { kind: "single", full_screen: false },
      size: { width: 360, height: DEFAULT_PAGE_SIZE.height },
    });
    const artifactID = layout.artifactIds[0]!;
    expect((await client.artifacts.get({ artifactID })).artifact).toMatchObject({ id: artifactID, transparent: true });
    const selected = page.locator(`.stage .page[data-page-key="${artifactID}"]`);
    await expect(selected).toHaveAttribute("selected", "");
    await expect(selected.locator("iframe").contentFrame().locator("h1")).toHaveText("Overlay");
    await page.mouse.move(0, 0);
    await expect(selected.locator(".artifact-view")).toHaveClass(/artifact-frame-transparent/);
    await expect(selected.locator(".artifact-title-bar")).toHaveCSS("visibility", "hidden");
  } finally {
    await product.dispose();
  }
});

test("failed focus request leaves the prior page selected (^toolbox-ac-activation)", async ({ page, baseURL }) => {
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
    await openToolbox(page);
    let focusRequests = 0;
    await page.route((url) => url.pathname === "/display/focus", async (route) => {
      focusRequests++;
      await route.abort("failed");
    });
    await page.locator(".toolbox-tile").click();
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.artifacts.list({ channelID })).artifacts.length).toBe(2);
    expect(focusRequests).toBe(1);
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", existing.id);
    expect((await client.display.get()).focusedChannelId).toBe(channelID);
  } finally {
    await product.dispose();
  }
});

test("partial creation after channel layout obstruction never takes focus (^toolbox-ac-activation)", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    template(product.home, "copied", "Copied");
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    const existing = (await client.artifacts.create({ channelID, kind: "path", title: "Existing", path: createArtifactFile(product.home, "existing", "<title>Existing</title>", "html") })).artifact;
    await openApp(page, product, baseURL);
    await openToolbox(page);
    const layoutPath = path.join(product.home, "state", "channels", `${channelID}.json`);
    rmSync(layoutPath);
    mkdirSync(layoutPath);
    await page.evaluate(() => {
      (window as unknown as { __templateSelections: string[] }).__templateSelections = [];
      new MutationObserver(() => {
        const id = document.querySelector<HTMLElement>(".stage .page[selected]")?.dataset.pageKey;
        if (id) (window as unknown as { __templateSelections: string[] }).__templateSelections.push(id);
      }).observe(document.querySelector(".stage")!, { subtree: true, childList: true, attributes: true });
    });
    const response = page.waitForResponse((value) => value.url().endsWith("/templates/artifacts") && value.request().method() === "POST");
    await page.locator(".toolbox-tile").click();
    expect((await response).status()).toBe(500);
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    await expect.poll(async () => (await client.artifacts.list({ channelID })).artifacts.length).toBe(2);

    const selected = await page.evaluate(() => (window as unknown as { __templateSelections: string[] }).__templateSelections);
    expect(selected.every((id) => id === existing.id)).toBe(true);
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", existing.id);
    await expect(page.locator(".toolbox-popover")).not.toContainText("Error");
  } finally {
    await product.dispose();
  }
});

// proofs/ui/app/toolbox.md#^toolbox-ac-activation
test("fresh creation refuses a template removed after list load without changing selection", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const folder = template(product.home, "removed", "Removed");
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    const existing = (await client.artifacts.create({ channelID, kind: "path", title: "Existing", path: createArtifactFile(product.home, "existing", "<title>Existing</title>", "html") })).artifact;
    await openApp(page, product, baseURL);
    await openToolbox(page);
    const tile = page.getByRole("gridcell", { name: "Removed", exact: true });
    await tile.hover();
    const bounds = (await tile.boundingBox())!;
    const refused = page.waitForResponse(response => response.url().endsWith("/templates/artifacts"));
    rmSync(folder, { recursive: true });
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    expect((await refused).status()).toBe(404);
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    expect((await client.artifacts.list({ channelID })).artifacts).toHaveLength(1);
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", existing.id);
    expect((await client.display.get()).focusedChannelId).toBe(channelID);
  } finally { await product.dispose(); }
});

// proofs/product/templates.md#^templates-ac-ui-create
test("Toolbox creates and focuses an ordinary URL artifact without a store", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const url = new URL("/health", product.serverURL).href;
    const folder = path.join(product.home, "templates", "url");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: "Local URL", description: "Local page", version: "1.0.0", url }));
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]!.id;
    await openApp(page, product, baseURL);
    await openToolbox(page);
    const requested = page.waitForRequest(request => request.url().endsWith("/templates/artifacts"));
    await page.getByRole("gridcell", { name: "Local URL" }).click();
    expect((await requested).postDataJSON()).toEqual({ templateID: "url", channelID, source: "ui" });
    await expect(page.locator(".toolbox-popover")).not.toHaveAttribute("open", "");
    const artifacts = (await client.artifacts.list({ channelID })).artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "url", url, title: "Local URL" });
    expect(artifacts[0]).not.toHaveProperty("store");
    await expect(page.locator(".stage .page[selected]")).toHaveAttribute("data-page-key", artifacts[0]!.id);
  } finally { await product.dispose(); }
});

// proofs/ui/app/toolbox.md#^toolbox-t-icon-browser
test("real SVG and PNG icons decode while pending, absent, aborted and broken icons fall back", async ({ page, baseURL }) => {
  const product = await launchProductServer({ auth: true });
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';
    for (const id of ["svg", "png", "broken", "pending", "aborted", "absent"]) {
      const folder = template(product.home, id, id);
      if (id === "absent") continue;
      const file = id === "png" ? "icon.png" : "icon.svg";
      writeFileSync(path.join(folder, file), id === "png" ? readFileSync(new URL("../../../desktop/assets/icon.png", import.meta.url)) : id === "broken" ? "undecodable bytes" : svg);
      writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: id, description: "Icon fixture", version: "1.0.0", icons: [{ src: file }] }));
    }
    await page.route("**/templates/pending/icon", async route => { await held; await route.continue(); });
    await page.route("**/templates/aborted/icon", route => route.abort("failed"));
    await openApp(page, product, baseURL);
    await openToolbox(page);
    for (const name of ["absent", "pending", "aborted", "broken"]) {
      await expect(page.getByRole("gridcell", { name, exact: true }).locator(".toolbox-letter")).toHaveText(name[0]!.toUpperCase());
    }
    for (const name of ["svg", "png"]) {
      const img = page.getByRole("gridcell", { name, exact: true }).locator("img");
      await expect(img).toHaveAttribute("alt", "");
      await expect(img).toHaveAttribute("draggable", "false");
      await expect.poll(() => img.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    }
    release();
    await expect(page.getByRole("gridcell", { name: "pending", exact: true }).locator("img")).toBeVisible();
    const oldSource = await page.getByRole("gridcell", { name: "svg", exact: true }).locator("img").getAttribute("src");
    writeFileSync(path.join(product.home, "templates", "svg", "icon.svg"), svg.replace("red", "blue"));
    const image = page.getByRole("gridcell", { name: "svg", exact: true }).locator("img");
    await expect(image).not.toHaveAttribute("src", oldSource!);
    await expect.poll(() => image.evaluate(async (element: HTMLImageElement) => (await fetch(element.src)).text())).toContain('fill="blue"');
  } finally { release(); await product.dispose(); }
});
