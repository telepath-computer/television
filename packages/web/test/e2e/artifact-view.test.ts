import { chromium, expect, test } from "@playwright/test";

declare global {
  interface Window {
    __fixtureReady?: boolean;
    setArtifact?: (artifact: unknown) => void;
    setApplication?: (application: unknown) => void;
    RequestError?: new (message: string, fields: { serverURL: string; status?: number }) => Error;
    __navigationKeys?: string[];
    __bridgeLifecycle?: Array<{
      type: "bridge-ready" | "leaving";
      guid: string;
      installed: boolean | null;
    }>;
    __bridgeTrustGuid?: () => string | null;
  }
}

const BUNDLE_ID = "bundle";

// Trust has no public presentation state; this helper is reserved for lifecycle-adoption evidence.
async function artifactTrustGuid(
  page: import("@playwright/test").Page,
  selector = ".artifact-view",
): Promise<string | null> {
  return page.locator(selector).evaluate((view) => (
    view as unknown as { _trustedChannel: { currentGuid: string | null } }
  )._trustedChannel.currentGuid);
}

async function observeBrowserLifecycle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__bridgeLifecycle = [];
    window.addEventListener("message", (event) => {
      const message = event.data as { type?: unknown; guid?: unknown };
      if (
        (message.type !== "bridge-ready" && message.type !== "leaving") ||
        typeof message.guid !== "string"
      ) {
        return;
      }

      let installed: boolean | null = null;
      try {
        installed = (event.source as Window & {
          __televisionArtifactBridgeInstalled?: boolean;
        }).__televisionArtifactBridgeInstalled === true;
      } catch {
        // Cross-origin documents deliberately do not expose installation state.
      }
      window.__bridgeLifecycle?.push({
        type: message.type,
        guid: message.guid,
        installed,
      });
    });
  });
}

async function browserLifecycle(
  page: import("@playwright/test").Page,
): Promise<NonNullable<Window["__bridgeLifecycle"]>> {
  return page.evaluate(() => window.__bridgeLifecycle ?? []);
}

async function lifecycleTrustGuid(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => window.__bridgeTrustGuid?.() ?? null);
}

async function routeBrowserLifecycleHarness(page: import("@playwright/test").Page): Promise<void> {
  // Vite's development-only HMR socket makes an otherwise ordinary document
  // ineligible for BFCache. Suppress only that test-server client; the
  // production bridge, trusted channel, iframe, and lifecycle events stay real.
  await page.route("**/@vite/client", async (route) => {
    await route.fulfill({ contentType: "application/javascript", body: "" });
  });
}

async function openFixture(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/artifact/bundle/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/style.css")) {
      await route.fulfill({ contentType: "text/css", body: "body { background: rgb(1, 2, 3); }" });
      return;
    }
    if (url.pathname.endsWith("/page2.html")) {
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body><h1>Second page</h1><script>window.parent.postMessage({ type: 'bridge-ready', guid: 'bundle-page2' }, '*');</script></body></html>",
      });
      return;
    }
    if (url.pathname.endsWith("/fast-target.html")) {
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body><script>window.parent.postMessage({ type: 'bridge-ready', guid: 'fast-target' }, '*');</script><h1>Fast target</h1></body></html>",
      });
      return;
    }
    if (url.pathname.endsWith("/keyboard.html")) {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <input id="editor" value="focused artifact document">
          <script type="module">
            import { installBridge } from "/packages/artifact/src/browser/artifact-bridge.ts";
            installBridge(window, { reportNavigation: false });
          </script>
        </body></html>`,
      });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head><link rel='stylesheet' href='style.css'></head><body><h1>Bundle root</h1><a id='next' href='page2.html'>next</a><script>window.parent.postMessage({ type: 'bridge-ready', guid: 'bundle-root' }, '*');</script></body></html>",
    });
  });
  await page.route("**/views/url-unsupported/**", async (route) => {
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>URL artifacts are unavailable in browser mode</h1>" });
  });
  await page.goto("/packages/web/test/e2e/fixtures/artifact-view-dispatcher.html");
  await page.waitForFunction(() => window.__fixtureReady === true);
}

// spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-navigation-key-seam
test("forwards every browser navigation arrow from a focused artifact document", async ({ page }) => {
  await openFixture(page);
  await page.evaluate((id) => {
    window.__navigationKeys = [];
    const events = new EventTarget();
    window.setApplication!({
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      handleNavigationKey: (key: string) => window.__navigationKeys!.push(key),
    });
    window.setArtifact!({ id, kind: "path", title: "Keyboard", path: "/tmp/keyboard.html" });
  }, BUNDLE_ID);

  const editor = page.frameLocator(".artifact-view iframe").locator("#editor");
  await editor.focus();
  await expect(editor).toBeFocused();
  const platform = await editor.evaluate(() => navigator.platform);
  const modifier = /^(Mac|iPhone|iPad|iPod)/i.test(platform) ? "Alt" : "Control";
  const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  for (const key of arrows) await page.keyboard.press(`${modifier}+${key}`);

  await expect.poll(() => page.evaluate(() => window.__navigationKeys)).toEqual(arrows);
  await expect(editor).toBeFocused();
});

// spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-reset-order
test("host navigation adopts bridge-ready from its single fast target load", async ({ page }) => {
  const targetPath = `/artifact/${BUNDLE_ID}/fast-target.html`;
  let targetRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === targetPath) targetRequests += 1;
  });

  await openFixture(page);
  await page.evaluate((id) => {
    window.setArtifact!({ id, kind: "path", title: "Bundle", path: "/tmp/bundle/" });
  }, BUNDLE_ID);
  await expect.poll(() => artifactTrustGuid(page)).toBe("bundle-root");

  await page.frameLocator(".artifact-view iframe").locator("body").evaluate((_body, url) => {
    window.parent.postMessage({ type: "navigation-request", url }, "*");
  }, targetPath);

  const iframe = page.locator(".artifact-view iframe");
  await expect(iframe).toHaveAttribute("src", targetPath);
  await expect(page.frameLocator(".artifact-view iframe").locator("h1")).toHaveText("Fast target");
  await expect.poll(() => artifactTrustGuid(page)).toBe("fast-target");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(targetRequests).toBe(1);
});

test.describe("artifact rendering dispatcher", () => {
  test("artifact menu uses shared placement and retains its document through confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openFixture(page);
    await page.evaluate((id) => window.setArtifact!({ id, kind: "path", title: "Bundle", path: "/tmp/bundle/" }), BUNDLE_ID);
    const frame = page.locator(".artifact-view iframe");
    await expect(page.frameLocator(".artifact-view iframe").locator("h1")).toHaveText("Bundle root");
    const original = await frame.elementHandle();
    const trigger = page.getByRole("button", { name: "Bundle menu", exact: true });
    const triggerId = await trigger.getAttribute("id");
    await trigger.click();
    const menu = page.locator("tv-menu[open]");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("trigger", triggerId!);
    await expect(menu).not.toHaveAttribute("placement");
    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    if (!triggerBox || !menuBox) throw new Error("Menu and trigger need rendered boxes");
    expect(menuBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height);
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThan(1);
    await menu.locator("tv-menu-item").filter({ hasText: /^Delete$/ }).click();
    await expect(page.locator("tv-menu[open]")).toHaveCount(0);
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(alert).toHaveCount(0);
    expect(await frame.evaluate((element, before) => element === before, original)).toBe(true);
    await expect(trigger).toHaveAttribute("id", triggerId!);
  });

  test("separates wrapper identity while sharing its top clipping radius", async ({ page }) => {
    await openFixture(page);
    await page.evaluate((id) => {
      window.setArtifact!({ id, kind: "path", title: "Bundle", path: "/tmp/bundle/" });
    }, BUNDLE_ID);

    const wrapper = page.locator(".artifact-view");
    const clip = wrapper.locator(":scope > .artifact-frame-clip");
    const documentElement = clip.locator(":scope > iframe.artifact-content");

    await expect(wrapper).toHaveClass(/\bartifact-frame\b/);
    await expect(wrapper).toHaveCSS("overflow", "visible");
    await expect(clip).toHaveCount(1);
    await expect(clip).toHaveCSS("overflow", "hidden");
    await expect(documentElement).toHaveCount(1);
    await expect(documentElement).not.toHaveClass(/\bartifact-frame\b/);
    const frameRadius = await wrapper.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--frame-radius").trim()
    );
    await expect(clip).toHaveCSS("border-radius", frameRadius);
    expect(await documentElement.evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ];
    })).toEqual([frameRadius, frameRadius, "0px", "0px"]);
  });

  test("renders directory path artifacts through a proxy iframe with relative assets and navigation", async ({ page }) => {
    await openFixture(page);
    await page.evaluate((id) => window.setArtifact!({ id, kind: "path", title: "Bundle", path: "/tmp/bundle/" }), BUNDLE_ID);

    const iframe = page.locator(".artifact-view iframe");
    await expect(iframe).toHaveAttribute("src", `/artifact/${BUNDLE_ID}/`);
    await expect(iframe).not.toHaveAttribute("sandbox", /.*/);

    const frame = page.frameLocator(".artifact-view iframe");
    await expect(frame.locator("h1")).toHaveText("Bundle root");
    await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(1, 2, 3)");

    await frame.locator("#next").click();
    await expect(frame.locator("h1")).toHaveText("Second page");
  });

  test("renders an empty markdown artifact without showing a placeholder", async ({ page }) => {
    await page.route("**/views/markdown/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><div id="content">placeholder</div><script>
          parent.postMessage({ type: "ready" }, "*");
          addEventListener("message", (event) => {
            if (event.data?.type === "content-updated") {
              document.getElementById("content").textContent = event.data.content;
            }
          });
        </script>`,
      });
    });
    await openFixture(page);
    await page.evaluate(() => {
      const view = document.getElementById("view") as HTMLElement & { application?: unknown };
      view.application = {
        readMarkdown: async () => "",
        writeMarkdown: async () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
      window.setArtifact!({ id: "empty", kind: "path", title: "Empty", path: "/tmp/empty.md" });
    });

    const iframe = page.locator(".artifact-view iframe.artifact-content");
    await expect(iframe).toBeVisible();
    await expect(page.locator(".artifact-placeholder")).toHaveCount(0);
    const content = page.frameLocator(".artifact-view iframe.artifact-content").locator("#content");
    await expect(content).toBeAttached();
    await expect(content).toHaveText("");
  });

  test("renders a styled host not-found page for missing markdown artifacts", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => {
      const RequestError = window.RequestError!;
      window.setApplication!({
        readMarkdown: async () => {
          throw new RequestError("Markdown artifact not found: missing", { serverURL: "http://example.test", status: 404 });
        },
        writeMarkdown: async () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      });
      window.setArtifact!({ id: "missing", kind: "path", title: "Missing", path: "/tmp/missing.md" });
    });

    await expect(page.locator(".artifact-view .artifact-missing")).toBeVisible();
    await expect(page.locator(".artifact-view")).toContainText("Artifact file not found");
    await expect(page.locator(".artifact-view")).toContainText("/tmp/missing.md");
    await expect(page.locator(".artifact-view iframe")).toHaveCount(0);
  });

  test("renders URL artifacts through the unsupported browser placeholder without loading the remote URL", async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => window.setArtifact!({ id: "url", kind: "url", title: "Remote", url: "https://example.com/remote" }));

    const iframe = page.locator(".artifact-view iframe");
    await expect(iframe).toHaveAttribute("src", "/views/url-unsupported/");
    await expect(iframe).not.toHaveAttribute("sandbox", /.*/);
    await expect(page.frameLocator(".artifact-view iframe").locator("h1")).toContainText("URL artifacts");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-ready-browser-seam
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-subscribe-browser
  test("adopts installed browser bridge identity when artifact data predates connection", async ({ page }) => {
    await page.route("**/artifact/fast-before-connect/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Fast local</h1><script type="module">
          import { installBridge } from "/packages/artifact/src/browser/artifact-bridge.ts";
          installBridge(window, { reportNavigation: false });
        </script>`,
      });
    });
    await openFixture(page);
    await observeBrowserLifecycle(page);

    await page.evaluate(() => {
      document.getElementById("view")?.remove();
      const view = document.createElement("artifact-view-fixture") as HTMLElement & {
        artifact?: unknown;
      };
      view.id = "fast-view";
      view.artifact = { id: "fast-before-connect", kind: "path", title: "Fast", path: "/tmp/fast.html" };
      document.body.appendChild(view);
    });

    const iframe = page.locator("#fast-view iframe.artifact-content");
    await expect(iframe).toHaveAttribute("src", "/artifact/fast-before-connect/fast.html");
    await expect(page.frameLocator("#fast-view iframe.artifact-content").locator("h1")).toHaveText("Fast local");
    await expect.poll(() => artifactTrustGuid(page, "#fast-view")).toMatch(/^tvb-/);

    const guid = await artifactTrustGuid(page, "#fast-view");
    if (!guid) throw new Error("Expected adopted browser bridge GUID");
    expect(await browserLifecycle(page)).toEqual([
      { type: "bridge-ready", guid, installed: true },
    ]);
  });

  test("renders TV artifact URL artifacts inline in browser mode", async ({ page }) => {
    const url = "http://producer.test/artifact/01J00000000000000000000000/index.html";
    await page.route("http://producer.test/artifact/01J00000000000000000000000/**", async (route) => {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Shared artifact</h1>" });
    });
    await openFixture(page);
    await page.evaluate((artifactURL) => window.setArtifact!({ id: "tv-url-inline", kind: "url", title: "Remote", url: artifactURL }), url);

    const iframe = page.locator(".artifact-view iframe");
    await expect(iframe).toHaveAttribute("src", url);
    expect(await artifactTrustGuid(page)).toBeNull();
    await expect(page.frameLocator(".artifact-view iframe").locator("h1")).toHaveText("Shared artifact");
  });

  test("adopts shared-TV lifecycle identity and preserves the tv-reload src across plain renders", async ({ page }) => {
    const url = "http://producer.test/artifact/01J00000000000000000000000/index.html";
    let requestCount = 0;
    await page.route("http://producer.test/artifact/01J00000000000000000000000/**", async (route) => {
      requestCount += 1;
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Shared artifact</h1><script>
          parent.postMessage({ type: 'bridge-ready', guid: 'shared-ready-guid' }, '*');
        </script>`,
      });
    });
    await openFixture(page);
    await page.evaluate((artifactURL) => {
      const target = new EventTarget();
      window.setApplication!({
        readMarkdown: async () => "",
        writeMarkdown: async () => undefined,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
      });
      window.setArtifact!({ id: "tv-url-ready", kind: "url", title: "Remote", url: artifactURL });
    }, url);

    const iframe = page.locator(".artifact-view iframe");
    await expect(iframe).toHaveAttribute("src", url);
    await expect.poll(() => artifactTrustGuid(page)).toBe("shared-ready-guid");
    expect(requestCount).toBe(1);

    await page.evaluate(() => {
      const iframe = document.querySelector(".artifact-view iframe") as HTMLIFrameElement | null;
      if (!iframe?.contentWindow) throw new Error("missing iframe");
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "proxy-content-changed" },
        source: iframe.contentWindow,
      }));
    });
    await expect(iframe).toHaveAttribute("src", /tv-reload=1/);
    const reloadSrc = await iframe.getAttribute("src");
    if (!reloadSrc) throw new Error("missing reload src");
    await expect.poll(() => artifactTrustGuid(page)).toBe("shared-ready-guid");
    expect(requestCount).toBe(2);

    await page.evaluate((artifactURL) => {
      window.setArtifact!({ id: "tv-url-ready", kind: "url", title: "Renamed", url: artifactURL });
    }, url);
    await page.waitForTimeout(250);

    await expect(iframe).toHaveAttribute("src", reloadSrc);
    expect(await artifactTrustGuid(page)).toBe("shared-ready-guid");
    expect(requestCount).toBe(2);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-content-reload
  test("reloads shared URL artifacts but ignores proxy-content-changed from path artifacts", async ({ page }) => {
    const sharedURL = "http://producer.test/artifact/01J00000000000000000000000/index.html";
    await page.route("http://producer.test/artifact/01J00000000000000000000000/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>
          parent.postMessage({ type: 'bridge-ready', guid: 'shared-reload-guid' }, '*');
          if (!location.search.includes('tv-reload=')) {
            parent.postMessage({ type: 'proxy-content-changed' }, '*');
          }
        </script>`,
      });
    });
    await openFixture(page);
    await page.evaluate((artifactURL) => window.setArtifact!({ id: "tv-url-reload", kind: "url", title: "Remote", url: artifactURL }), sharedURL);
    await expect(page.locator(".artifact-view iframe")).toHaveAttribute("src", /tv-reload=1/);

    await openFixture(page);
    await page.route("**/artifact/path/**", async (route) => {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><script>parent.postMessage({ type: 'proxy-content-changed' }, '*')</script>" });
    });
    await page.evaluate(() => window.setArtifact!({ id: "path", kind: "path", title: "Local", path: "/tmp/local.html" }));
    await page.waitForTimeout(250);
    await expect(page.locator(".artifact-view iframe")).toHaveAttribute("src", "/artifact/path/local.html");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-reparent-seam
  test("retires a departing browser document and adopts its replacement with a fresh GUID", async ({ page }) => {
    await routeBrowserLifecycleHarness(page);
    await page.goto("/packages/web/test/e2e/fixtures/artifact-bridge-lifecycle-host.html");
    await page.waitForFunction(() => window.__fixtureReady === true);

    const document = page.frameLocator("#lifecycle-frame");
    await expect(document.locator("h1")).toHaveText("First lifecycle document");
    await expect.poll(() => lifecycleTrustGuid(page)).toMatch(/^tvb-/);
    const firstGuid = await lifecycleTrustGuid(page);
    if (!firstGuid) throw new Error("Expected first browser document GUID");
    expect(await browserLifecycle(page)).toEqual([
      { type: "bridge-ready", guid: firstGuid, installed: true },
    ]);

    await document.locator("#next").click();
    await expect.poll(() => browserLifecycle(page)).toEqual([
      { type: "bridge-ready", guid: firstGuid, installed: true },
      { type: "leaving", guid: firstGuid, installed: null },
    ]);
    expect(await lifecycleTrustGuid(page)).toBeNull();

    await expect(document.locator("h1")).toHaveText("Second lifecycle document");
    await expect.poll(() => lifecycleTrustGuid(page)).toMatch(/^tvb-/);
    const secondGuid = await lifecycleTrustGuid(page);
    if (!secondGuid) throw new Error("Expected replacement browser document GUID");
    expect(secondGuid).not.toBe(firstGuid);
    expect(await browserLifecycle(page)).toEqual([
      { type: "bridge-ready", guid: firstGuid, installed: true },
      { type: "leaving", guid: firstGuid, installed: null },
      { type: "bridge-ready", guid: secondGuid, installed: true },
    ]);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-bfcache-browser-seam
  test("re-adopts the same browser document GUID after a persisted page return", async ({ baseURL }) => {
    if (!baseURL) throw new Error("Expected Playwright baseURL");
    const browser = await chromium.launch({
      channel: "chromium",
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
    });
    const page = await browser.newPage({ baseURL });
    const observed: Array<{
      type: "bridge-ready" | "leaving";
      guid: string;
      trustedGuid: string | null;
      lifecycle: NonNullable<Window["__bridgeLifecycle"]>;
    }> = [];
    page.on("console", (message) => {
      const prefix = "TV_BRIDGE_TRUST ";
      const text = message.text();
      if (text.startsWith(prefix)) {
        observed.push(JSON.parse(text.slice(prefix.length)) as typeof observed[number]);
      }
    });

    try {
      await routeBrowserLifecycleHarness(page);
      await page.goto("/packages/web/test/e2e/fixtures/artifact-bridge-lifecycle-host.html");
      await page.waitForFunction(() => window.__fixtureReady === true);

      const document = page.frameLocator("#lifecycle-frame");
      await expect(document.locator("h1")).toHaveText("First lifecycle document");
      await expect.poll(() => lifecycleTrustGuid(page)).toMatch(/^tvb-/);
      const guid = await lifecycleTrustGuid(page);
      if (!guid) throw new Error("Expected browser document GUID");
      await expect.poll(() => observed).toEqual([{
        type: "bridge-ready",
        guid,
        trustedGuid: guid,
        lifecycle: [{ type: "bridge-ready", guid, installed: true }],
      }]);
      await page.unroute("**/@vite/client");

      await page.goto("/packages/web/test/e2e/fixtures/artifact-bridge-lifecycle-away.html");
      await expect(page.locator("h1")).toHaveText("Away");
      await page.evaluate(() => history.back());

      await expect.poll(() => (
        observed.find((report) => report.lifecycle.length === 3) ?? null
      )).toEqual({
        type: "bridge-ready",
        guid,
        trustedGuid: guid,
        lifecycle: [
          { type: "bridge-ready", guid, installed: true },
          { type: "leaving", guid, installed: true },
          { type: "bridge-ready", guid, installed: true },
        ],
      });
      expect(observed.find((report) => report.type === "leaving") ?? null).toEqual({
        type: "leaving",
        guid,
        trustedGuid: null,
        lifecycle: [
          { type: "bridge-ready", guid, installed: true },
          { type: "leaving", guid, installed: true },
        ],
      });
    } finally {
      await browser.close();
    }
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-theme-exception
  test("theme changes replace built-in missing and unsupported documents", async ({ page }) => {
    await openFixture(page);
    await page.unroute("**/views/url-unsupported/**");

    let missingLoads = 0;
    let unsupportedLoads = 0;
    await page.route("**/artifact/missing/**", async (route) => {
      missingLoads += 1;
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body data-load="${missingLoads}"><h1>Artifact missing</h1></body>`,
      });
    });
    await page.route("**/views/url-unsupported/**", async (route) => {
      unsupportedLoads += 1;
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body data-load="${unsupportedLoads}"><h1>URL unsupported</h1></body>`,
      });
    });

    await page.evaluate(() => {
      const target = new EventTarget();
      window.setApplication!({
        readMarkdown: async () => "",
        writeMarkdown: async () => undefined,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchThemeChanged: () => target.dispatchEvent(new Event("theme-changed")),
      });
      window.setArtifact!({
        id: "missing",
        kind: "path",
        title: "Missing",
        path: "/tmp/missing.html",
      });
    });

    const iframe = page.locator(".artifact-view iframe");
    const artifactDocument = page.frameLocator(".artifact-view iframe");
    await expect(iframe).toHaveAttribute("src", "/artifact/missing/missing.html");
    await expect(artifactDocument.locator("body")).toHaveAttribute("data-load", "1");

    await page.evaluate(() => {
      const view = document.getElementById("view") as HTMLElement & {
        application?: { dispatchThemeChanged(): void };
      };
      view.application?.dispatchThemeChanged();
    });
    await expect(iframe).toHaveAttribute("src", /\/artifact\/missing\/missing\.html\?tv-reload=1/);
    await expect(artifactDocument.locator("body")).toHaveAttribute("data-load", "2");
    expect(missingLoads).toBe(2);

    await page.evaluate(() => window.setArtifact!({
      id: "external",
      kind: "url",
      title: "External",
      url: "https://example.com/page",
    }));
    await expect(iframe).toHaveAttribute("src", "/views/url-unsupported/");
    await expect(artifactDocument.locator("body")).toHaveAttribute("data-load", "1");

    await page.evaluate(() => {
      const view = document.getElementById("view") as HTMLElement & {
        application?: { dispatchThemeChanged(): void };
      };
      view.application?.dispatchThemeChanged();
    });
    await expect(iframe).toHaveAttribute("src", /\/views\/url-unsupported\/\?tv-reload=2/);
    await expect(artifactDocument.locator("body")).toHaveAttribute("data-load", "2");
    expect(unsupportedLoads).toBe(2);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-theme-exception
  test("does not reload shared URL artifacts on consumer theme changes", async ({ page }) => {
    const url = "http://producer.test/artifact/01J00000000000000000000000/index.html";
    await page.route("http://producer.test/artifact/01J00000000000000000000000/**", async (route) => {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Shared artifact</h1>" });
    });
    await openFixture(page);
    await page.evaluate((artifactURL) => {
      const target = new EventTarget();
      window.setApplication!({
        readMarkdown: async () => "",
        writeMarkdown: async () => undefined,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatch: () => target.dispatchEvent(new Event("theme-changed")),
      });
      window.setArtifact!({ id: "tv-url-theme", kind: "url", title: "Remote", url: artifactURL });
    }, url);

    await expect(page.locator(".artifact-view iframe")).toHaveAttribute("src", url);
    await page.evaluate(() => {
      const view = document.getElementById("view") as HTMLElement & { application?: { dispatch(): void } };
      view.application?.dispatch();
    });
    await page.waitForTimeout(250);
    await expect(page.locator(".artifact-view iframe")).toHaveAttribute("src", url);
  });

  test("real unsupported page link opens the target URL in a new browser tab", async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("Expected Playwright baseURL");
    const targetURL = new URL(
      "/packages/web/test/e2e/fixtures/url-open-target.html",
      baseURL,
    ).href;
    await page.goto("/packages/web/test/e2e/fixtures/artifact-view-dispatcher.html");
    await page.waitForFunction(() => window.__fixtureReady === true);
    await page.evaluate((url) => window.setArtifact!({ id: "url", kind: "url", title: "Remote", url }), targetURL);

    const iframe = page.locator(".artifact-view iframe");
    await expect(iframe).toHaveAttribute("src", "/views/url-unsupported/");
    const frame = page.frameLocator(".artifact-view iframe");
    const link = frame.locator("#target-link");
    await expect(frame.locator("h1")).toContainText("This is an external web page");
    await expect(link).toHaveText(targetURL);
    await expect(link).toHaveAttribute("href", targetURL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const popupPromise = context.waitForEvent("page");
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toBe(targetURL);
    await expect(popup.locator("h1")).toHaveText("Opened external page target");
    await popup.close();
  });
})
