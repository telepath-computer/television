import { expect, test, type Page } from "@playwright/test";

// Link activation Playwright suite.
//
// Markdown link syntax `[label](url)` renders the label as an `<a
// class="cm-md-link" data-href="url">` decoration with no real `href`.
// Click semantics:
//   - Plain click posts a Television navigation-request and keeps the caret put.
//   - Alt/Option-click lets CodeMirror place the caret for editing.
//   - Cmd/Ctrl-click opens a web URL in a new browser context; application
//     links always use a same-context handoff.
//   - Middle-click does not activate a web link and performs the same single
//     handoff as plain click for an application link.
//   - Dragging from a link does not activate it.

const SEED_HTTPS_HREF = "https://example.com";
const SEED_HTTPS_RESOLVED_URL = "https://example.com/";

interface WindowOpenCall {
  url: string;
  target: string;
  features: string;
}

interface NavigationRequestCall {
  type: string;
  url?: string;
}

declare global {
  interface Window {
    __windowOpenCalls?: WindowOpenCall[];
    __navigationRequests?: NavigationRequestCall[];
  }
}

async function installCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__windowOpenCalls = [];
    window.__navigationRequests = [];
    (window as Window & {
      __televisionContentBridge?: {
        postToHost(message: unknown): void;
        onHostMessage(callback: (message: unknown) => void): () => void;
      };
    }).__televisionContentBridge = {
      postToHost(message: unknown): void {
        window.__navigationRequests?.push(message as NavigationRequestCall);
      },
      onHostMessage(_callback: (message: unknown) => void): () => void {
        return () => {};
      },
    };

    window.open = (
      url?: string | URL,
      target?: string,
      features?: string,
    ): WindowProxy | null => {
      window.__windowOpenCalls?.push({
        url: String(url ?? ""),
        target: String(target ?? ""),
        features: String(features ?? ""),
      });
      // Don't actually open anything — return null. Tests assert via
      // the captured array.
      return null;
    };
  });
}

async function setCaret(page: Page, position: number): Promise<void> {
  await page.evaluate((anchor) => {
    type V = Window & {
      __cmView?: {
        dispatch: (spec: unknown) => void;
        focus: () => void;
      };
    };
    const view = (window as V).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    view.focus();
    view.dispatch({ selection: { anchor } });
  }, position);
}

async function replaceDocument(page: Page, content: string): Promise<void> {
  await page.evaluate((nextContent) => {
    type V = Window & {
      __cmView?: {
        state: { doc: { length: number } };
        dispatch: (spec: unknown) => void;
      };
    };
    const view = (window as V).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    });
  }, content);
}

async function caretHead(page: Page): Promise<number> {
  return page.evaluate(() => {
    type V = Window & {
      __cmView?: { state: { selection: { main: { head: number } } } };
    };
    const view = (window as V).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    return view.state.selection.main.head;
  });
}

async function caretInsideInlineLinkLabel(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    type V = Window & {
      __cmView?: {
        state: {
          doc: { toString(): string };
          selection: { main: { head: number } };
        };
      };
    };
    const view = (window as V).__cmView;
    if (!view) throw new Error("EditorView not exposed");
    const source = view.state.doc.toString();
    const labelStart = source.indexOf("inline link");
    if (labelStart < 0) throw new Error("Expected inline link label in source");
    const labelEnd = labelStart + "inline link".length;
    const head = view.state.selection.main.head;
    return head >= labelStart && head <= labelEnd;
  });
}

async function navigationRequests(page: Page): Promise<NavigationRequestCall[]> {
  return page.evaluate(() => window.__navigationRequests ?? []);
}

async function windowOpenCalls(page: Page): Promise<WindowOpenCall[]> {
  return page.evaluate(() => window.__windowOpenCalls ?? []);
}

test.describe("markdown link activation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").waitFor();
    await expect(
      page.locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`).first(),
    ).toBeVisible();
    await installCapture(page);
  });

  test("https links render as data-href anchors without real href", async ({
    page,
  }) => {
    const anchors = page.locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`);
    await expect(anchors).toHaveCount(2);
    await expect(anchors.first()).toContainText("inline link");
    expect(await anchors.first().getAttribute("href")).toBeNull();
  });

  test("link styling uses underline, muted color, and unconditional pointer cursor", async ({ page }) => {
    const anchor = page
      .locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`)
      .first();
    const style = await anchor.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        textDecoration: cs.textDecorationLine,
        textUnderlineOffset: cs.textUnderlineOffset,
        fontSize: cs.fontSize,
        color: cs.color,
        cursor: cs.cursor,
      };
    });
    expect(style.textDecoration).toContain("underline");
    expect(Number.parseFloat(style.textUnderlineOffset))
      .toBeCloseTo(Number.parseFloat(style.fontSize) * 0.15, 3);
    expect(style.cursor).toBe("pointer");
    // Muted grey — concrete value depends on theme; we just check it
    // isn't the default link blue or a fully-saturated color. Theme
    // sets `rgba(0, 0, 0, 0.55)` which computes to roughly
    // `rgba(0, 0, 0, 0.55)` or `rgb(115, 115, 115)`-ish in some UAs.
    // Practically: assert it is NOT the user-agent default blue.
    expect(style.color).not.toMatch(/^rgb\(0,\s*0,\s*238\)/);
    expect(style.color).not.toMatch(/^rgb\(0,\s*0,\s*255\)/);
  });

  test("plain click posts a navigation-request and does not move the caret", async ({ page }) => {
    await setCaret(page, 0);
    const initialURL = page.url();
    const anchor = page
      .locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`)
      .first();

    await anchor.click();

    expect(await navigationRequests(page)).toEqual([
      { type: "navigation-request", url: SEED_HTTPS_RESOLVED_URL },
    ]);
    expect(await windowOpenCalls(page)).toEqual([]);
    expect(await caretHead(page)).toBe(0);
    expect(page.url()).toBe(initialURL);
  });

  // spec: proofs/product/artifact-navigation.md#^ac-application-links-browser
  test("plain application link opens outside without posting navigation", async ({ page }) => {
    const url = "example-app://open/item";
    await replaceDocument(page, `[Open app](${url})`);
    const anchor = page.locator(`a.cm-md-link[data-href="${url}"]`);
    await expect(anchor).toBeVisible();

    await anchor.click();

    expect(await navigationRequests(page)).toEqual([]);
    expect(await windowOpenCalls(page)).toEqual([]);
  });

  // spec: proofs/product/artifact-navigation.md#^ac-application-links-browser
  test("browser-local markdown link has no activation behavior", async ({ page }) => {
    const url = "javascript:document.body.dataset.owned='true'";
    await replaceDocument(page, `[Do not run](${url})`);
    const anchor = page.locator("a.cm-md-link").first();
    await expect(anchor).toBeVisible();

    await anchor.click();

    expect(await navigationRequests(page)).toEqual([]);
    expect(await windowOpenCalls(page)).toEqual([]);
    expect(await page.locator("body").getAttribute("data-owned")).toBeNull();
  });

  test("Alt-click leaves link editing to CodeMirror and does not navigate", async ({ page }) => {
    await setCaret(page, 0);
    const anchor = page
      .locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`)
      .first();

    await anchor.click({ modifiers: ["Alt"] });

    expect(await caretInsideInlineLinkLabel(page)).toBe(true);
    expect(await navigationRequests(page)).toEqual([]);
    expect(await windowOpenCalls(page)).toEqual([]);
  });

  test("cmd/ctrl-click opens the resolved URL without moving the caret", async ({ page }) => {
    await setCaret(page, 0);
    const anchor = page
      .locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`)
      .first();
    const platformModifier = process.platform === "darwin" ? "Meta" : "Control";

    await anchor.click({ modifiers: [platformModifier] });

    expect(await navigationRequests(page)).toEqual([]);
    expect(await caretHead(page)).toBe(0);
    const calls = await windowOpenCalls(page);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SEED_HTTPS_RESOLVED_URL);
    expect(calls[0]?.target).toBe("_blank");
    expect(calls[0]?.features).toContain("noopener");
    expect(calls[0]?.features).toContain("noreferrer");
  });

  test("middle-click does not activate a web link", async ({ page }) => {
    const anchor = page
      .locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`)
      .first();

    await anchor.click({ button: "middle" });

    expect(await navigationRequests(page)).toEqual([]);
    expect(await windowOpenCalls(page)).toEqual([]);
  });

  test("dragging from a link does not activate it", async ({ page }) => {
    await setCaret(page, 0);
    const anchor = page
      .locator(`a.cm-md-link[data-href="${SEED_HTTPS_HREF}"]`)
      .first();
    const box = await anchor.boundingBox();
    if (!box) throw new Error("Expected link bounding box");
    const startX = box.x + Math.max(2, Math.min(10, box.width / 3));
    const endX = Math.min(box.x + box.width - 2, startX + 8);
    const y = box.y + box.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 2 });
    await page.mouse.up();

    expect(await navigationRequests(page)).toEqual([]);
    expect(await windowOpenCalls(page)).toEqual([]);
  });
});
