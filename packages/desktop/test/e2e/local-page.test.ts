import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { startConnectTestServer } from "./connect-server.ts";
import { createUserDataDir, launchDesktopConnectScreen, expectConnectedPage, waitForConnectScreen, disconnectFromServerMenu } from "./helpers.ts";

const desktopDist = path.resolve(import.meta.dirname, "../../dist");
const root = path.resolve(import.meta.dirname, "../../../..");

async function assertLocalResources(page: Page): Promise<void> {
  const resources = await page.evaluate(async () => {
    const fonts = await document.fonts.load("400 18px Hind");
    await document.fonts.ready;
    const wallpapers = await Promise.all(["wallpaper.webp", "wallpaper-dark.webp"].map(name => new Promise<boolean>(resolve => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0);
      image.onerror = () => resolve(false);
      image.src = new URL(`clouds/${name}`, location.href).href;
    })));
    return {
      marker: document.documentElement.getAttribute("data-television-document"),
      sheets: [...document.styleSheets].map(sheet => ({ href: sheet.href, rules: sheet.cssRules.length })),
      loadedFonts: fonts.map(font => ({ family: font.family, status: font.status })),
      fontReady: document.fonts.check("400 18px Hind"),
      family: getComputedStyle(document.body).fontFamily,
      controlLine: getComputedStyle(document.documentElement).getPropertyValue("--line-control-lg"),
      wallpapers,
      resources: performance.getEntriesByType("resource").map(entry => entry.name),
    };
  });
  expect(resources.marker).toBe("app");
  expect(resources.sheets).toEqual(expect.arrayContaining([
    { href: expect.stringMatching(/^file:.*connect-page\.css$/), rules: expect.any(Number) },
    { href: expect.stringMatching(/^file:.*clouds\/theme\.css$/), rules: expect.any(Number) },
  ]));
  expect(resources.sheets.every(sheet => sheet.rules > 0)).toBe(true);
  expect(resources.fontReady).toBe(true);
  expect(resources.family).toContain("Hind");
  expect(resources.controlLine.trim()).not.toBe("");
  expect(resources.wallpapers).toEqual([true, true]);
  expect(resources.loadedFonts).toEqual([{ family: "Hind", status: "loaded" }]);
  expect(resources.resources.filter(url => /^https?:/.test(url))).toEqual([]);
}

// ^desktop-t-local-assets: production build and Chromium file loader remain real.
// Seeding the second launch is a stored-data fixture; no server styles exist.
test("the built local page loads foundation, Clouds, fonts and icons for setup and saved dialogs", async () => {
  const userDataDir = createUserDataDir();
  let launch = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(launch.page);
    await assertLocalResources(launch.page);
    await test.info().attach("local-page", { body: await launch.page.screenshot(), contentType: "image/png" });
    expect(await launch.page.locator("tv-icon").first().evaluate(icon => Boolean(icon.shadowRoot?.querySelector("svg")))).toBe(true);
    for (const name of ["theme.css", "wallpaper.webp", "wallpaper-dark.webp"]) {
      expect(readFileSync(path.join(desktopDist, "clouds", name))).toEqual(readFileSync(path.join(root, "packages/server/assets/themes/clouds", name)));
    }
    const font = readdirSync(path.join(desktopDist, "assets")).find(name => name.endsWith(".woff2"))!;
    expect(readFileSync(path.join(desktopDist, "assets", font))).toEqual(readFileSync(path.join(root, "specs/ui/foundation/fonts/Hind-Variable.woff2")));
    await launch.app.close();
    writeFileSync(path.join(userDataDir, "connection.json"), JSON.stringify({ serverURL: "http://127.0.0.1:9", token: "" }));
    launch = await launchDesktopConnectScreen({ userDataDir });
    await expect(launch.page.getByRole("heading", { name: "Can’t connect with server" })).toBeVisible();
    await assertLocalResources(launch.page);
    await test.info().attach("local-page", { body: await launch.page.screenshot(), contentType: "image/png" });
  } finally {
    await launch.app.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ^setup-t-agent-links: the packaged page, Chromium's new-window request and the
// main-process window-open handler are real. The external-open hook records the
// URL in place of shell.openExternal.
test("an agent link on setup opens in the browser and leaves setup in place", async () => {
  const userDataDir = createUserDataDir();
  const launch = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(launch.page);
    await launch.page.getByRole("link", { name: "Claude Code" }).click();
    await expect.poll(() => launch.app.evaluate(() => {
      return (globalThis as typeof globalThis & { __televisionExternalOpenLog?: string[] }).__televisionExternalOpenLog ?? [];
    })).toEqual(["https://claude.com/product/claude-code"]);
    expect(launch.app.windows()).toHaveLength(1);
    expect(launch.page.url()).toMatch(/^file:.*\/connect\.html$/);
    await expect(launch.page.getByRole("heading", { name: "Give your agent this prompt" })).toBeVisible();
  } finally {
    await launch.app.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ^desktop-appearance-t-local: display API and native bridge are real. The final
// nativeTheme assignment substitutes the preference input, not its rendering.
test("the local page retains native appearance while always wearing Clouds", async () => {
  const server = await startConnectTestServer();
  const client = new TelevisionClient(server.serverURL, { token: server.token });
  await client.display.patch({ activeThemeName: null, appearanceMode: "dark" });
  const userDataDir = createUserDataDir();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("system");
    const initialDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect(page.locator("html")).toHaveAttribute("data-theme", initialDark ? "dark" : "light");
    await page.getByRole("textbox", { name: "Link from your agent" }).fill(`${server.serverURL}/?token=${server.token}`);
    await page.getByRole("textbox", { name: "Link from your agent" }).press("Enter");
    await expectConnectedPage(page);
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
    await disconnectFromServerMenu(app);
    await waitForConnectScreen(page);
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.locator('link[href="clouds/theme.css"]').count()).toBe(1);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-wallpaper-image"))).toContain("wallpaper-dark.webp");
    await test.info().attach("local-dark-setup", { body: await page.screenshot(), contentType: "image/png" });
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-wallpaper-image"))).toContain("wallpaper.webp");
  } finally {
    await app.close();
    await server.dispose();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ^desktop-t-load-recovery-seam: the HTTP peer substitutes Television, passes
// the identity check, then breaks real top-level navigation and later checks.
test("a real failed remote page load returns to saved-connection recovery", async () => {
  let checks = 0;
  const peer = createServer((request, response) => {
    if (request.url?.startsWith("/desktop/connect-check") && checks++ === 0) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ product: "television" }));
    } else request.socket.destroy();
  });
  await new Promise<void>(resolve => peer.listen(0, "127.0.0.1", resolve));
  const address = peer.address();
  if (!address || typeof address === "string") throw new Error("HTTP peer missing port");
  const serverURL = `http://127.0.0.1:${address.port}`;
  const userDataDir = createUserDataDir();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    await page.getByRole("textbox", { name: "Link from your agent" }).fill(serverURL);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Can’t connect with server" })).toBeVisible();
    expect(page.url()).toMatch(/^file:.*connect\.html$/);
    await expect(page.locator(".setup-screen, #setup-link-error")).toHaveCount(0);
    expect(JSON.parse(readFileSync(path.join(userDataDir, "connection.json"), "utf8"))).toEqual({ serverURL, token: "" });
    expect(checks).toBeGreaterThan(1);
  } finally {
    await app.close();
    peer.closeAllConnections();
    await new Promise<void>(resolve => peer.close(() => resolve()));
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
