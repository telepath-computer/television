import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { startStableFrontProxy } from "../../../../test/helpers/stable-front-proxy.ts";
import { startConnectTestServer } from "./connect-server.ts";
import { configureTestMotion } from "../../../web/test/e2e/helpers.ts";
import {
  createUserDataDir, expectConnectedPage, getBrowserWindowURL,
  launchDesktopConnectScreen, waitForConnectScreen, disconnectFromServerMenu, disconnectEnabled,
} from "./helpers.ts";

// ^desktop-ac-connect-link: real Electron, HTTP, disk and CSS motion. The
// ordinary shell-version hook is the only substituted production input.
test("a link connects, renders Connected, survives restart and is forgotten by the menu", async () => {
  const server = await startConnectTestServer();
  let releaseCheck: (() => void) | undefined;
  let checkBarrier: Promise<void> | undefined;
  const front = await startStableFrontProxy(server.serverURL, async request => {
    if (request.url?.startsWith("/desktop/connect-check")) await checkBarrier;
  });
  const serverURL = front.url;
  const userDataDir = createUserDataDir();
  let launch = await launchDesktopConnectScreen({ userDataDir });
  try {
    let { app, page } = launch;
    await waitForConnectScreen(page);
    await configureTestMotion(page, { allowCSSMotion: true });
    expect(await disconnectEnabled(app)).toBe(false);
    expect(await page.evaluate(() => typeof window.television.connect)).toBe("function");
    const prompt = page.locator(".setup-prompt p");
    await prompt.click();
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(await prompt.textContent());
    await expect(page.locator(".setup-screen")).toHaveAttribute("data-state", "ready");

    const events: string[] = [];
    page.on("console", message => { if (message.text().startsWith("setup-observe:")) events.push(message.text().slice(14)); });
    page.on("framenavigated", frame => { if (frame === page.mainFrame() && frame.url().startsWith(serverURL)) events.push("remote"); });
    await page.evaluate(() => {
      const screen = document.querySelector(".setup-screen")!;
      new MutationObserver(() => console.log(`setup-observe:${screen.getAttribute("data-state")}`))
        .observe(screen, { attributes: true, attributeFilter: ["data-state"] });
      document.querySelector(".setup-done")!.addEventListener("transitionend", () => {
        const done = document.querySelector(".setup-done")!;
        if (getComputedStyle(done).opacity === "1") console.log("setup-observe:connected-painted");
      });
    });
    const link = `${serverURL}/some/path?token=${encodeURIComponent(server.token)}&ignored=yes`;
    const input = page.getByRole("textbox", { name: "Link from your agent" });
    await input.fill(link);
    await input.press("Enter");
    await expectConnectedPage(page);
    expect(events).toEqual(expect.arrayContaining(["connecting", "connected", "connected-painted", "remote"]));
    expect(events.indexOf("connected-painted")).toBeLessThan(events.indexOf("remote"));
    const url = new URL(await getBrowserWindowURL(app));
    expect(url.origin).toBe(serverURL);
    expect(url.searchParams.get("mode")).toBe("electron");
    expect(url.searchParams.get("desktopAppVersion")).toBe("9.9.9");
    expect(url.searchParams.has("token")).toBe(false);
    expect(await page.evaluate(() => typeof window.television)).toBe("undefined");
    const record = path.join(userDataDir, "connection.json");
    expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({ serverURL, token: server.token });
    expect(await disconnectEnabled(app)).toBe(true);
    await page.reload();
    await expectConnectedPage(page);
    await app.close();

    checkBarrier = new Promise<void>(resolve => { releaseCheck = resolve; });
    launch = await launchDesktopConnectScreen({ userDataDir });
    ({ app, page } = launch);
    await expect(page.getByRole("heading", { name: "Connecting", exact: true })).toBeVisible();
    await expect(page.locator(".setup-screen")).toHaveCount(0);
    releaseCheck!();
    await expectConnectedPage(page);
    await expect(page.locator(".setup-screen")).toHaveCount(0);
    await disconnectFromServerMenu(app);
    await waitForConnectScreen(page);
    expect(existsSync(record)).toBe(false);
    expect(await disconnectEnabled(app)).toBe(false);
    await app.close();
    launch = await launchDesktopConnectScreen({ userDataDir });
    await waitForConnectScreen(launch.page);
    await expect(launch.page.getByRole("textbox", { name: "Link from your agent" })).toHaveValue("");
  } finally {
    await launch.app.close().catch(() => {});
    releaseCheck?.();
    await front.dispose();
    await server.dispose();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

// ^desktop-ac-setup-errors: malformed and real unauthorized responses stay
// inline; the corrected link succeeds through native button activation.
test("setup keeps rejected links editable and accepts the corrected current link", async () => {
  const server = await startConnectTestServer();
  const userDataDir = createUserDataDir();
  const { app, page } = await launchDesktopConnectScreen({ userDataDir });
  try {
    await waitForConnectScreen(page);
    await configureTestMotion(page);
    const input = page.getByRole("textbox", { name: "Link from your agent" });
    for (const link of ["not a url!!!", `${server.serverURL}/?token=wrong`]) {
      await input.fill(link);
      await input.press("Enter");
      await expect(page.locator("#setup-link-error")).toBeVisible();
      await expect(input).toHaveValue(link);
      await expect(input).toBeEditable();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("dialog")).toHaveCount(0);
      expect(existsSync(path.join(userDataDir, "connection.json"))).toBe(false);
    }
    await expect(page.locator("#setup-link-error")).toContainText("current link");
    await input.fill(`${server.serverURL}/?token=${encodeURIComponent(server.token)}`);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expectConnectedPage(page);
  } finally {
    await app.close();
    await server.dispose();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
