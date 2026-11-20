import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";
import { configureTestMotion, waitForApplicationShell } from "../../../web/test/e2e/helpers.ts";
import { desktopE2EOrigin, launchDesktop } from "./helpers.ts";

// proofs/ui/app/toolbox.md#^toolbox-t-shortcut-seam
test("host keyboard delivery toggles Toolbox and focuses search in Electron", async () => {
  const product = await launchProductServer({ auth: true });
  const profile = mkdtempSync(path.join(os.tmpdir(), "tv-toolbox-desktop-"));
  let launched: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    const url = new URL("/packages/web/src/index.html", await product.appURL(desktopE2EOrigin()));
    url.searchParams.set("token", product.token);
    url.searchParams.set("mode", "electron");
    const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
    url.searchParams.set("desktopAppVersion", version);
    launched = await launchDesktop({ fixture: url.href, userDataDir: profile, env: { TV_TEST_DESKTOP_APP_VERSION: undefined } });
    const { app, page } = launched;
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
    await waitForApplicationShell(page);
    await configureTestMotion(page);
    await page.locator(".stage").click({ position: { x: 10, y: 10 } });
    async function pressShortcut() {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.focus();
        window.webContents.focus();
        const modifiers: Array<"meta" | "control"> = process.platform === "darwin" ? ["meta"] : ["control"];
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers });
      });
    }
    await pressShortcut();
    await expect(page.getByRole("combobox", { name: "Search toolbox" })).toBeFocused();
    await expect(page.getByRole("region", { name: "Toolbox" })).toBeVisible();
    await pressShortcut();
    await expect(page.getByRole("region", { name: "Toolbox" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Toolbox", exact: true })).toBeFocused();
  } finally {
    await launched?.app.close();
    await product.dispose();
    rmSync(profile, { recursive: true, force: true });
  }
});
