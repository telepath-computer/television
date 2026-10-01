import { chromium, expect, test, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server, ServerStore } from "@telepath-computer/television-server";
import { artifactNavigationStorageKey } from "../../src/services/artifact-navigation-state.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { createApplicationProtocolHandler } from "../../../../test/helpers/application-protocol-handler.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { configureTestMotion } from "./helpers.ts";

const EXTERNAL_URL = "https://example.com/external";

type NavigationRecord = {
  v: 1;
  entries: Array<{ url: string }>;
  cursor: number;
  lastWritten: number;
};

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-artifact-navigation-e2e-"));
}

function html(body: string): string {
  return `<!doctype html><html><head><style>
    body { font-family: sans-serif; margin: 0; padding: 16px; }
    .spacer { height: 1200px; }
  </style></head><body>${body}</body></html>`;
}

async function waitForApp(page: Page): Promise<void> {
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  await configureTestMotion(page);
  const view = page.locator(".artifact-view").first();
  await expect(view.locator("iframe.artifact-content")).toBeVisible({ timeout: 15_000 });
  await expect(view).toHaveAttribute("data-embed-loaded", "", { timeout: 15_000 });
}

async function navigationRecord(page: Page, artifactID: string): Promise<NavigationRecord | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, artifactNavigationStorageKey(artifactID));
}

async function startVirtualDisplay(): Promise<{ display: string; dispose(): Promise<void> }> {
  const xvfb = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", "1280x720x24"], {
    stdio: ["ignore", "ignore", "pipe", "pipe"],
  });
  const displayStream = xvfb.stdio[3];
  if (!displayStream) throw new Error("Xvfb did not expose its display descriptor");
  const display = await new Promise<string>((resolve, reject) => {
    let output = "";
    const handleData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      cleanup();
      resolve(`:${output.slice(0, newline).trim()}`);
    };
    const handleExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Xvfb exited before publishing a display (code ${String(code)})`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      displayStream.off("data", handleData);
      xvfb.off("exit", handleExit);
      xvfb.off("error", handleError);
    };
    displayStream.on("data", handleData);
    xvfb.on("exit", handleExit);
    xvfb.on("error", handleError);
  });
  return {
    display,
    async dispose(): Promise<void> {
      if (xvfb.exitCode !== null || xvfb.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        xvfb.once("exit", () => resolve());
        xvfb.kill();
      });
    },
  };
}


test.describe("artifact iframe navigation", () => {
  let storagePath: string;
  let server: Server;
  let store: ServerStore;
  let serverURL: string;
  let token: string;
  let artifactID: string;
  let artifactDir: string;

  test.beforeEach(async ({ page, baseURL }) => {
    storagePath = createDataDir();
    artifactDir = path.join(storagePath, "site");
    mkdirSync(artifactDir, { recursive: true });
    store = createServingStore(storagePath);
    server = new Server({ store, port: 0 });
    const channelID = store.listChannels()[0]!.id;

    writeFileSync(
      path.join(artifactDir, "index.html"),
      html(`
        <h1>Index</h1>
        <a id="page1" href="page1.html">Page 1</a>
        <a id="fragment" href="#section">Section</a>
        <a id="external" href="${EXTERNAL_URL}">External</a>
        <div class="spacer"></div><h2 id="section">Section</h2>
      `),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page1.html"),
      html(`
        <h1>Page 1</h1>
        <a id="page2" href="page2.html">Page 2</a>
        <a id="external" href="${EXTERNAL_URL}">External</a>
        <a id="canonical" href="./">Index</a>
        <a id="cmd-external" href="${EXTERNAL_URL}">External tab</a>
        <button id="replace" onclick="history.replaceState({}, '', 'replace-state.html')">Replace</button>
        <script>
          setTimeout(() => {
            window.navigation?.addEventListener("navigate", (event) => {
              parent.postMessage({
                type: "test-default-prevented",
                value: event.defaultPrevented,
                url: event.destination.url,
              }, "*");
            });
          });
        </script>
      `),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page2.html"),
      html(`<h1>Page 2</h1><a id="page3" href="page3.html">Page 3</a>`),
      "utf8",
    );
    writeFileSync(
      path.join(artifactDir, "page3.html"),
      html(`<h1>Page 3</h1>`),
      "utf8",
    );

    const artifact = store.createArtifact({
      kind: "path",
      title: "Navigation fixture",
      path: `${artifactDir}${path.sep}`,
      channelID: channelID,
    });
    artifactID = artifact.id;
    await server.start();
    serverURL = server.getBaseURL();
    token = server.getAuthToken();

    await page.addInitScript(() => {
      // Child-frame navigations must not clear the artifact history under test.
      if (window === window.top) localStorage.clear();
    });
    await page.goto(
      `${baseURL ?? ""}/packages/web/src/index.html?serverURL=${encodeURIComponent(serverURL)}&token=${token}`,
    );
    await waitForApp(page);
  });

  test.afterEach(async () => {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  });

  test("clicking a link back to canonical resets the cursor without storing canonical", async ({ page }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();

    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    await frame.locator("#canonical").click();
    await expect(frame.locator("h1")).toHaveText("Index");

    const record = await navigationRecord(page, artifactID);
    expect(record?.entries).toEqual([{ url: `/artifact/${artifactID}/page1.html` }]);
    expect(record?.cursor).toBe(-1);
  });

  test("modifier-click opens a new tab and leaves iframe history unchanged", async ({ page, context }) => {
    const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
    await frame.locator("#page1").click();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    const before = await navigationRecord(page, artifactID);

    const popupPromise = context.waitForEvent("page");
    await frame.locator("#cmd-external").click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    const popup = await popupPromise;

    await expect(popup).toHaveURL(EXTERNAL_URL);
    await popup.close();
    await expect(frame.locator("h1")).toHaveText("Page 1");
    expect(await navigationRecord(page, artifactID)).toEqual(before);
  });

})


test.describe("markdown artifact navigation", () => {

test("markdown modifier-click opens a tab and leaves artifact history unchanged", async ({ page, context, baseURL }) => {
  const storagePath = createDataDir();
  const store = createServingStore(storagePath);
  const server = new Server({ store, port: 0 });
  try {
    const channelID = store.listChannels()[0]!.id;
    const markdownPath = path.join(storagePath, "research.md");
    writeFileSync(markdownPath, `[external](${EXTERNAL_URL})`, "utf8");
    const artifact = store.createArtifact({
      kind: "path",
      title: "Research",
      path: markdownPath,
      channelID: channelID,
    });
    await server.start();

    await page.addInitScript(() => {
      // Child-frame navigations must not clear the artifact history under test.
      if (window === window.top) localStorage.clear();
    });
    await page.goto(
      `${baseURL ?? ""}/packages/web/src/index.html?serverURL=${encodeURIComponent(server.getBaseURL())}&token=${server.getAuthToken()}`,
    );
    await waitForApp(page);
    await expect(page.locator(".artifact-view iframe.artifact-content")).toHaveAttribute("src", "/views/markdown/");

    const markdown = page.frameLocator(".artifact-view iframe.artifact-content");
    const externalLink = markdown.locator(`a.cm-md-link[data-href="${EXTERNAL_URL}"]`);
    await expect(externalLink).toBeVisible();
    const before = await navigationRecord(page, artifact.id);
    const popupPromise = context.waitForEvent("page");
    await externalLink.click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
    const popup = await popupPromise;

    await expect(popup).toHaveURL(EXTERNAL_URL);
    await popup.close();
    await expect(externalLink).toBeVisible();
    expect(await navigationRecord(page, artifact.id)).toEqual(before);
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
  }
});
})

// spec: proofs/product/artifact-navigation.md#^ac-application-links-browser
test("application-link activations cross the real Linux browser handler without popups", async ({ baseURL }) => {
  test.skip(process.platform !== "linux", "temporary protocol-handler fixture uses Linux gio and Xvfb");
  const handler = createApplicationProtocolHandler();
  let virtualDisplay: Awaited<ReturnType<typeof startVirtualDisplay>> | null = null;
  try {
    virtualDisplay = await startVirtualDisplay();
    for (const artifactKind of ["html", "markdown"] as const) {
      const storagePath = createDataDir();
      const store = createServingStore(storagePath);
      const server = new Server({ store, port: 0 });
      let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
      let profilePath: string | null = null;
      try {
        const channelID = store.listChannels()[0]!.id;
        const applicationURL = `example-app://open/from-browser-${artifactKind}`;
        const artifactPath = path.join(storagePath, artifactKind === "html" ? "application.html" : "application.md");
        writeFileSync(
          artifactPath,
          artifactKind === "html"
            ? html(`<h1>HTML application</h1>
                <a id="application-link" href="${applicationURL}">Open application</a>
                <a id="script-link" href="javascript:void(document.body.dataset.scriptActivated='true')">Run local script</a>`)
            : `[Open application](${applicationURL})\n\n[Do not run](javascript:document.body.dataset.scriptActivated='true')`,
          "utf8",
        );
        const artifact = store.createArtifact({
          kind: "path",
          title: `${artifactKind} application link`,
          path: artifactPath,
          channelID,
        });
        await server.start();

        profilePath = mkdtempSync(path.join(os.tmpdir(), "television-browser-protocol-profile-"));
        mkdirSync(path.join(profilePath, "Default"), { recursive: true });
        const allowedOrigins = {
          [new URL(baseURL ?? "http://127.0.0.1").origin]: { "example-app": true },
          [new URL(server.getBaseURL()).origin]: { "example-app": true },
        };
        writeFileSync(
          path.join(profilePath, "Default", "Preferences"),
          JSON.stringify({ protocol_handler: { allowed_origin_protocol_pairs: allowedOrigins } }),
        );
        context = await chromium.launchPersistentContext(profilePath, {
          headless: false,
          env: {
            ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
            ...handler.env,
            DISPLAY: virtualDisplay.display,
          },
          args: ["--no-sandbox"],
        });
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(
          `${baseURL ?? ""}/packages/web/src/index.html?serverURL=${encodeURIComponent(server.getBaseURL())}&token=${server.getAuthToken()}`,
        );
        await waitForApp(page);
        const frame = page.frameLocator(".artifact-view iframe.artifact-content").first();
        const applicationLink = artifactKind === "html"
          ? frame.locator("#application-link")
          : frame.locator(`a.cm-md-link[data-href="${applicationURL}"]`);
        await expect(applicationLink).toBeVisible();
        const initialFrameURL = await frame.locator("html").evaluate(() => window.location.href);
        const initialPageCount = context.pages().length;
        let popupPageCount = 0;
        context.on("page", () => {
          popupPageCount += 1;
        });
        await frame.locator("html").evaluate(() => {
          const state = window as Window & { __applicationWindowOpenCalls?: number };
          const nativeOpen = window.open.bind(window);
          state.__applicationWindowOpenCalls = 0;
          window.open = (url?: string | URL, target?: string, features?: string): WindowProxy | null => {
            state.__applicationWindowOpenCalls = (state.__applicationWindowOpenCalls ?? 0) + 1;
            return nativeOpen(url, target, features);
          };
        });
        handler.clearInvocations();

        await applicationLink.click();
        await applicationLink.click({ modifiers: ["Control"] });
        await applicationLink.click({ modifiers: ["Meta"] });
        await applicationLink.click({ button: "middle" });

        await expect.poll(() => handler.readInvocations(), { timeout: 15_000 }).toEqual([
          applicationURL,
          applicationURL,
          applicationURL,
          applicationURL,
        ]);
        await page.waitForTimeout(500);
        expect(await frame.locator("html").evaluate(() => {
          return (window as Window & { __applicationWindowOpenCalls?: number })
            .__applicationWindowOpenCalls ?? 0;
        })).toBe(0);
        expect(popupPageCount).toBe(0);
        expect(await frame.locator("html").evaluate(() => window.location.href)).toBe(initialFrameURL);
        expect(await navigationRecord(page, artifact.id)).toBeNull();
        expect(context.pages()).toHaveLength(initialPageCount);

        if (artifactKind === "html") {
          await frame.locator("#script-link").click();
          await expect(frame.locator("body")).toHaveAttribute("data-script-activated", "true");
        } else {
          const scriptLink = frame.locator("a.cm-md-link").filter({ hasText: "Do not run" });
          await scriptLink.click();
          await expect(frame.locator("body")).not.toHaveAttribute("data-script-activated", "true");
        }
        expect(handler.readInvocations()).toEqual([
          applicationURL,
          applicationURL,
          applicationURL,
          applicationURL,
        ]);
        expect(await navigationRecord(page, artifact.id)).toBeNull();

        await context.close();
        context = null;
        rmSync(profilePath, { recursive: true, force: true });
        profilePath = null;
      } finally {
        await context?.close();
        await server.dispose();
        if (profilePath) rmSync(profilePath, { recursive: true, force: true });
        rmSync(storagePath, { recursive: true, force: true });
      }
    }
  } finally {
    await virtualDisplay?.dispose();
    handler.dispose();
  }
});

test("unsupported page installs the browser bridge without navigation reporting", async ({ page, baseURL }) => {
  await page.setContent(`<!doctype html><script>
    window.__messages = [];
    addEventListener("message", (event) => window.__messages.push(event.data));
  </script><iframe src="${baseURL ?? ""}/views/url-unsupported/"></iframe>`);
  await expect(page.frameLocator("iframe").locator("h1")).toContainText("This is an external web page");
  await page.waitForTimeout(300);

  const messages = await page.evaluate(() => (window as unknown as { __messages: unknown[] }).__messages);
  expect(messages).not.toContainEqual(expect.objectContaining({ type: "navigation-request" }));
});
