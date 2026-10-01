import { expect, test } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/lit-view-stable-iframe.html";

interface LitViewStableIframeFixture {
  readonly loadCount: number;
  render(hostArgument: string): void;
}

declare global {
  interface Window {
    __litViewStableIframe: LitViewStableIframeFixture;
  }
}

test("preserves an owned iframe across host rerenders (^lv-t-browser-stable-node)", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => {
    const iframe = document.querySelector("iframe");
    return (
      window.__litViewStableIframe.loadCount > 0 &&
      iframe?.contentDocument?.readyState === "complete"
    );
  });

  const result = await page.evaluate(async () => {
    const before = document.querySelector("iframe");
    if (!before?.contentDocument || !before.contentWindow) {
      throw new Error("Expected the owned iframe to have a same-origin document");
    }

    const beforeWindow = before.contentWindow;
    const loadsBeforeRerender = window.__litViewStableIframe.loadCount;
    before.contentDocument.body.dataset.acquiredState = "retained";

    window.__litViewStableIframe.render("updated");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const after = document.querySelector("iframe");
    if (!after?.contentDocument) {
      throw new Error("Expected the owned iframe after the host rerender");
    }

    return {
      acquiredState: after.contentDocument.body.dataset.acquiredState,
      hostArgument: after.dataset.hostArgument,
      loadCounts: [loadsBeforeRerender, window.__litViewStableIframe.loadCount],
      sameNode: after === before,
      sameWindow: after.contentWindow === beforeWindow,
    };
  });

  expect(result).toEqual({
    acquiredState: "retained",
    hostArgument: "updated",
    loadCounts: [1, 1],
    sameNode: true,
    sameWindow: true,
  });
});
