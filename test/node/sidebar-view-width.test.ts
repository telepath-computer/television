import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Page } from "playwright";
import {
  ProductContext,
  artifactURL,
  createPathArtifact,
  focusedChannel,
  frameAt,
  openApp,
  parse,
  share,
} from "./resource-product-harness.ts";

/*
 * The sidebar-view skill's sidebar width, shared through the artifact's own
 * store: two people see it in the app in a real browser, and a third opens
 * the artifact's read share link. The skill is unregistered, so the carried
 * files come from its source folder. Proves [[ui/skills/sidebar-view/index.md#^sv-ac-width]].
 */

const SKILL_FOLDER = path.resolve(process.cwd(), "packages", "skills", "skills", "tv-sidebar-view");
const HOST = "tv-sidebar.test";
const DEFAULT_WIDTH = 220;
const MAXIMUM_WIDTH = 400;
const context = new ProductContext();

afterEach(async () => {
  await context.cleanup();
});

// The markup and loading lines `SKILL.md` teaches for a directory artifact,
// without the release version, which `SKILL.md` says to omit when unknown.
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Projects</title>
<link rel="stylesheet" href="/canonical/v2/styles.css" />
<script type="module" src="/canonical/v2/components.js"></script>
<link rel="stylesheet" href="./sidebar.css" />
<script type="module" src="./sidebar.js"></script>
<div class="sidebar-view">
  <tv-sidebar>
    <tv-sidebar-group>
      <tv-sidebar-item item="all-tasks" selected><label>All tasks</label></tv-sidebar-item>
    </tv-sidebar-group>
    <tv-sidebar-group>
      <h2>Projects</h2>
      <tv-sidebar-item item="riso-zine"><label>Launch riso zine issue 3</label></tv-sidebar-item>
    </tv-sidebar-group>
  </tv-sidebar>
  <main class="detail">
    <tv-view item="all-tasks" shown><p>Every task.</p></tv-view>
    <tv-view item="riso-zine"><p>The zine.</p></tv-view>
  </main>
</div>
`;

async function sidebarReady(frame: Frame): Promise<void> {
  await frame.waitForFunction(() => customElements.get("tv-sidebar") !== undefined, undefined, { timeout: 20_000 });
}

function sidebarWidth(frame: Frame): Promise<number> {
  return frame.evaluate(() => document.querySelector("tv-sidebar")!.getBoundingClientRect().width);
}

/** Drags the sidebar's boundary with real mouse input until the pointer is `x` pixels from the sidebar's left edge. */
async function dragBoundary(page: Page, frame: Frame, x: number): Promise<void> {
  const offset = frame === page.mainFrame() ? { x: 0, y: 0 } : (await (await frame.frameElement()).boundingBox())!;
  const sidebar = await frame.evaluate(() => {
    const rect = document.querySelector("tv-sidebar")!.getBoundingClientRect();
    return { left: rect.left, right: rect.right, middle: (rect.top + rect.bottom) / 2 };
  });
  const y = offset.y + sidebar.middle;
  await page.mouse.move(offset.x + sidebar.right - 2, y);
  await page.mouse.down();
  await page.mouse.move(offset.x + sidebar.left + x, y, { steps: 8 });
  await page.mouse.up();
}

describe("the sidebar view's width", () => {
  it("is shared through the artifact's store by everyone viewing it, while a read share link's viewer resizes it only for themselves", async () => {
    const folder = context.temporaryDirectory("television-sidebar-view-");
    for (const file of ["sidebar.css", "sidebar.js"]) copyFileSync(path.join(SKILL_FOLDER, file), path.join(folder, file));
    writeFileSync(path.join(folder, "index.html"), PAGE);

    const server = await context.serve(context.temporaryDirectory("television-sidebar-view-home-"));
    const channelID = await focusedChannel(server, "Sidebar");
    const artifactID = await createPathArtifact(server, channelID, "Projects", folder);
    const stored = async () => parse(await server.tv(["resource", "json", "get", "--artifact", artifactID, "tv-sidebar-view/width"]));

    const browser = await context.launch("chromium", [HOST]);
    const first = await openApp(browser, server, HOST);
    const second = await openApp(browser, server, HOST);
    const firstFrame = await frameAt(first.page, artifactURL(server, HOST, artifactID));
    const secondFrame = await frameAt(second.page, artifactURL(server, HOST, artifactID));
    for (const frame of [firstFrame, secondFrame]) {
      await sidebarReady(frame);
      expect(await sidebarWidth(frame)).toBe(DEFAULT_WIDTH);
    }
    expect(await stored()).toEqual({ exists: false });

    // A drag past the maximum leaves the maximum width, for both people, and in the store.
    await dragBoundary(first.page, firstFrame, MAXIMUM_WIDTH + 200);
    expect(await sidebarWidth(firstFrame)).toBe(MAXIMUM_WIDTH);
    await expect.poll(() => sidebarWidth(secondFrame), { timeout: 10_000 }).toBe(MAXIMUM_WIDTH);
    await expect.poll(() => stored(), { timeout: 10_000 }).toEqual({ exists: true, value: MAXIMUM_WIDTH });

    // Through a read share link, in a browser context that holds no token.
    const { link } = await share(server, artifactID, "read", HOST);
    const reader = await browser.newPage();
    const readerErrors: string[] = [];
    reader.on("pageerror", (error) => readerErrors.push(`pageerror: ${error.message}`));
    reader.on("console", (message) => {
      if (message.type() === "error") readerErrors.push(`console: ${message.text()}`);
    });
    await reader.goto(link);
    await sidebarReady(reader.mainFrame());
    await expect.poll(() => sidebarWidth(reader.mainFrame()), { timeout: 10_000 }).toBe(MAXIMUM_WIDTH);

    // The reader's resize stays theirs.
    await dragBoundary(reader, reader.mainFrame(), 250);
    expect(await sidebarWidth(reader.mainFrame())).toBe(250);
    expect(await stored()).toEqual({ exists: true, value: MAXIMUM_WIDTH });
    expect(await sidebarWidth(firstFrame)).toBe(MAXIMUM_WIDTH);
    expect(await sidebarWidth(secondFrame)).toBe(MAXIMUM_WIDTH);
    expect(await sidebarWidth(reader.mainFrame())).toBe(250);

    await reader.reload();
    await sidebarReady(reader.mainFrame());
    await expect.poll(() => sidebarWidth(reader.mainFrame()), { timeout: 10_000 }).toBe(MAXIMUM_WIDTH);

    const errors = [...first.errors.list(), ...second.errors.list(), ...readerErrors];
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
