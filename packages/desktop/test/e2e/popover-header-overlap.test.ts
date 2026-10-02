import { expect, test, type ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { startConnectTestServer } from "./connect-server.ts";
import { expectConnectedPage, launchDesktop } from "./helpers.ts";

const X11_POINTER_PRESS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "x11-pointer-press.py",
);
const NATIVE_PRESS_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

/** Press at a page point through the X server, as a user's mouse would. */
async function nativePress(app: ElectronApplication, point: { x: number; y: number }): Promise<void> {
  const screen = await app.evaluate(({ BrowserWindow }, { point }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("BrowserWindow missing");
    const content = window.getContentBounds();
    return { x: Math.round(content.x + point.x), y: Math.round(content.y + point.y) };
  }, { point });
  await execFileAsync("python3", [X11_POINTER_PRESS, String(screen.x), String(screen.y)], {
    timeout: NATIVE_PRESS_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
}

test("a native press on a theme option over the draggable navbar selects it (^po-ac-drag-overlap)", async () => {
  test.skip(process.platform !== "linux", "Native pointer driver requires Linux/X11");
  const server = await startConnectTestServer();
  const client = new TelevisionClient(server.serverURL, { token: server.token });
  let launched: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    cpSync(
      new URL("../../../server/assets/themes/", import.meta.url),
      path.join(server.storagePath, "themes"),
      { recursive: true },
    );
    await client.themes.refresh();
    await client.display.patch({ activeThemeName: "swiss" });
    launched = await launchDesktop({
      connectTo: { serverURL: server.serverURL, token: server.token },
    });
    const { app, page } = launched;
    await expectConnectedPage(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const theme = page.getByLabel("Theme", { exact: true });
    await expect(theme).toHaveText("Swiss");

    // The trigger sits below the navbar, so this press also shows that native
    // input from the driver reaches the page in this window.
    await nativePress(app, await theme.evaluate((trigger) => {
      const box = trigger.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }));
    const none = page.locator('tv-select[trigger="settings-theme"] tv-option[value=""]');
    await expect(none).toBeVisible();

    const target = await none.evaluate((option) => {
      const row = option.getBoundingClientRect();
      const navbar = document.querySelector(".top-bar")!;
      const bar = navbar.getBoundingClientRect();
      const x = row.left + row.width / 2;
      const y = row.top + row.height / 2;
      return {
        point: { x, y },
        overNavbar: y >= bar.top && y < bar.bottom,
        navbarRegion: getComputedStyle(navbar).getPropertyValue("-webkit-app-region"),
        domHit: document.elementFromPoint(x, y) === option,
      };
    });
    expect(target.overNavbar).toBe(true);
    expect(target.navbarRegion).toBe("drag");
    expect(target.domHit).toBe(true);

    await nativePress(app, target.point);
    await expect.poll(async () => (await client.display.get()).activeThemeName, {
      timeout: 2_000,
    }).toBeNull();
    await expect(theme).toHaveText("None");
  } finally {
    await launched?.app.close().catch(() => undefined);
    if (launched?.userDataDir !== undefined) {
      rmSync(launched.userDataDir, { recursive: true, force: true });
    }
    await server.dispose();
  }
});
