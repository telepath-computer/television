import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const FIXTURE = "/packages/web/test/e2e/fixtures/desktop-upgrade-gate.html";
// The gate surface's authored copy: the fallback and its link are read from
// here rather than restated, so the copy has one authored home.
const GATE_CONTENT = parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../specs/ui/app/desktop-upgrade-gate/content.yml"), "utf8"),
) as { fallback_instructions: string; restart_to_update: string; restarting: string };

interface ScrollState {
  bodyScrollLeft: number;
  bodyScrollTop: number;
  dialogScrollLeft: number;
  dialogScrollTop: number;
  documentScrollLeft: number;
  documentScrollTop: number;
  overlayScrollLeft: number;
  overlayScrollTop: number;
  windowScrollX: number;
  windowScrollY: number;
}

interface GateSnapshot extends ScrollState {
  backdropPresses: number;
  bodyClientHeight: number;
  bodyRect: Rect;
  bodyScrollEvents: number;
  bodyScrollHeight: number;
  cancelEvents: number;
  closeEvents: number;
  dialogRect: Rect;
  dialogScrollEvents: number;
  documentScrollEvents: number;
  modal: boolean;
  open: boolean;
  overlayRect: Rect;
  overlayScrollEvents: number;
  preventedCancels: number;
  scrollSamples: ScrollState[];
  windowScrollEvents: number;
}

interface Rect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

declare global {
  interface Window {
    __fixtureReady?: boolean;
    __renderMarkdown(text: string): string;
    __upgradeGateFixture: {
      setInstructions(desktop: { upgradeMarkdown: string } | null): void;
      reportDownload(version: string): void;
      restarts(): number;
      settle(): Promise<void>;
      snapshot(): GateSnapshot;
      waitForStableBodyScroll(): Promise<void>;
    };
  }
}

async function gotoFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);
}

async function setInstructions(
  page: Page,
  desktop: { upgradeMarkdown: string } | null,
): Promise<void> {
  await page.evaluate((value) => window.__upgradeGateFixture.setInstructions(value), desktop);
}

async function snapshot(page: Page): Promise<GateSnapshot> {
  return page.evaluate(() => window.__upgradeGateFixture.snapshot());
}

const gateScreen = (page: Page) => page.locator(".desktop-upgrade-gate");
const body = (page: Page) => page.locator('[data-testid="upgrade-gate-body"]');

test.describe("gate screen rendering", () => {
  test("renders channel instructions through the standard markdown pipeline, links external", async ({
    page,
  }) => {
    await gotoFixture(page);
    const upgradeMarkdown =
      "Your desktop app needs an upgrade — see the [guide](https://television.run/install.md).\n\n```bash\nnpm install -g @telepath-computer/television-desktop@2.0.0\n```";
    await setInstructions(page, { upgradeMarkdown });

    await expect(gateScreen(page)).toBeVisible();
    const panel = gateScreen(page).locator("dialog");
    await expect(panel.locator(":scope > *")).toHaveCount(1);
    const content = panel.locator(":scope > .dialog-content");
    await expect(content).toHaveCount(1);
    const panelChildren = await content.evaluate((element) => {
      return Array.from(element.children).map((child) => ({
        testid: child.getAttribute("data-testid"),
        tag: child.tagName.toLowerCase(),
      }));
    });
    expect(panelChildren).toEqual([{ testid: "upgrade-gate-body", tag: "div" }]);

    const { bodyHTML, pipelineHTML } = await page.evaluate((source) => {
      const container = document.querySelector('[data-testid="upgrade-gate-body"]');
      return {
        bodyHTML: container === null
          ? null
          : [...container.childNodes]
            .filter((node) => node.nodeType !== Node.COMMENT_NODE)
            .map((node) => node instanceof Element ? node.outerHTML : node.textContent ?? "")
            .join(""),
        pipelineHTML: window.__renderMarkdown(source),
      };
    }, upgradeMarkdown);
    expect(bodyHTML).toBe(pipelineHTML);

    const link = body(page).locator("a");
    await expect(link).toHaveAttribute("href", "https://television.run/install.md");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("renders the built-in fallback when the channel offers no instructions, its link external", async ({
    page,
  }) => {
    await gotoFixture(page);
    await setInstructions(page, null);

    await expect(gateScreen(page)).toBeVisible();
    const fallbackMarkdown = GATE_CONTENT.fallback_instructions;
    const { bodyHTML, pipelineHTML } = await page.evaluate((source) => {
      const container = document.querySelector('[data-testid="upgrade-gate-body"]');
      return {
        bodyHTML: container === null
          ? null
          : [...container.childNodes]
            .filter((node) => node.nodeType !== Node.COMMENT_NODE)
            .map((node) => node instanceof Element ? node.outerHTML : node.textContent ?? "")
            .join(""),
        pipelineHTML: window.__renderMarkdown(source),
      };
    }, fallbackMarkdown);
    expect(bodyHTML).toBe(pipelineHTML);

    const authoredLink = /\[([^\]]+)\]\(([^)]+)\)/.exec(fallbackMarkdown);
    if (authoredLink === null) throw new Error("the authored fallback carries no link");
    const link = body(page).locator("a");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(authoredLink[1]!);
    await expect(link).toHaveAttribute("href", authoredLink[2]!);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  // proofs/ui/app/desktop-upgrade-gate/index.md#^dug-ac-restart
  test("the restart button requests the restart once (^dug-ac-restart)", async ({ page }) => {
    await gotoFixture(page);
    await page.evaluate(() => window.__upgradeGateFixture.reportDownload("1.5.0"));

    const button = gateScreen(page).locator(".upgrade-gate-restart");
    await expect(button).toHaveText(GATE_CONTENT.restart_to_update);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(GATE_CONTENT.restarting);
    await button.click({ force: true });
    await page.evaluate(() => window.__upgradeGateFixture.settle());

    expect(await page.evaluate(() => window.__upgradeGateFixture.restarts())).toBe(1);
    const state = await snapshot(page);
    expect(state.open).toBe(true);
    expect(state.modal).toBe(true);
  });

  test("blocks dismissal and confines wheel scrolling to long instructions (^dug-ac-blocking-interaction)", async ({
    page,
  }) => {
    await gotoFixture(page);
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) => `Instruction ${index + 1}: finish the desktop upgrade before relaunching.`,
    ).join("\n\n");
    await setInstructions(page, { upgradeMarkdown: `# Long upgrade\n\n${paragraphs}` });

    let result = await snapshot(page);
    expect(result.open).toBe(true);
    expect(result.modal).toBe(true);
    expect(result.bodyScrollHeight).toBeGreaterThan(result.bodyClientHeight);
    expect(result.closeEvents).toBe(0);

    await page.mouse.click(4, 4);
    await page.evaluate(() => window.__upgradeGateFixture.settle());
    result = await snapshot(page);
    expect(result.backdropPresses).toBe(1);
    expect(result.closeEvents).toBe(0);
    expect(result.open).toBe(true);
    expect(result.modal).toBe(true);

    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__upgradeGateFixture.settle());
    result = await snapshot(page);
    expect(result.cancelEvents).toBe(1);
    expect(result.preventedCancels).toBe(1);
    expect(result.closeEvents).toBe(0);
    expect(result.open).toBe(true);
    expect(result.modal).toBe(true);

    const beforeScroll = result;
    await body(page).hover();
    await page.mouse.wheel(0, 720);
    await page.evaluate(() => window.__upgradeGateFixture.waitForStableBodyScroll());
    result = await snapshot(page);

    expect(result.bodyScrollEvents).toBeGreaterThan(beforeScroll.bodyScrollEvents);
    expect(result.bodyScrollTop).toBeGreaterThan(beforeScroll.bodyScrollTop);
    expect(result.bodyScrollLeft).toBe(beforeScroll.bodyScrollLeft);
    expect(result.dialogScrollEvents).toBe(beforeScroll.dialogScrollEvents);
    expect(result.overlayScrollEvents).toBe(beforeScroll.overlayScrollEvents);
    expect(result.documentScrollEvents).toBe(beforeScroll.documentScrollEvents);
    expect(result.windowScrollEvents).toBe(beforeScroll.windowScrollEvents);
    expect(result.dialogScrollLeft).toBe(beforeScroll.dialogScrollLeft);
    expect(result.dialogScrollTop).toBe(beforeScroll.dialogScrollTop);
    expect(result.overlayScrollLeft).toBe(beforeScroll.overlayScrollLeft);
    expect(result.overlayScrollTop).toBe(beforeScroll.overlayScrollTop);
    expect(result.documentScrollLeft).toBe(beforeScroll.documentScrollLeft);
    expect(result.documentScrollTop).toBe(beforeScroll.documentScrollTop);
    expect(result.windowScrollX).toBe(beforeScroll.windowScrollX);
    expect(result.windowScrollY).toBe(beforeScroll.windowScrollY);
    expect(result.dialogRect).toEqual(beforeScroll.dialogRect);
    expect(result.overlayRect).toEqual(beforeScroll.overlayRect);

    const settledSamples = result.scrollSamples.slice(-2);
    expect(settledSamples).toHaveLength(2);
    expect(settledSamples[0]?.bodyScrollTop).toBeGreaterThan(0);
    expect(settledSamples[1]?.bodyScrollTop).toBe(settledSamples[0]?.bodyScrollTop);
    for (const sample of settledSamples) {
      expect(sample.dialogScrollTop).toBe(0);
      expect(sample.overlayScrollTop).toBe(0);
      expect(sample.documentScrollTop).toBe(0);
      expect(sample.windowScrollY).toBe(0);
    }

    expect(result.closeEvents).toBe(0);
    expect(result.open).toBe(true);
    expect(result.modal).toBe(true);
  });
});
