import { expect, test, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface WebviewLayoutMetrics {
  host: { width: number; height: number };
  guest: { innerWidth: number; innerHeight: number; bodyHeight: number; documentHeight: number } | null;
}

function createIsolatedElectronMain(): { entry: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "television-isolated-webview-layout-"));
  const entry = path.join(dir, "main.cjs");
  writeFileSync(
    entry,
    `const { app, BrowserWindow } = require("electron");

const targetURL = process.argv[2];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: true,
    webPreferences: {
      contextIsolation: true,
      webviewTag: true,
    },
  });
  await win.loadURL(targetURL);
});

app.on("window-all-closed", () => app.quit());
`,
  );
  return {
    entry,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function dataURL(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

function fixtureURLForWebviewStyle(webviewStyle: string): string {
  const embedURL = dataURL(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>plain webview guest</title>
    <style>
      html, body { margin: 0; padding: 0; }
      body { height: 4000px; background: linear-gradient(#fff, #ccc); }
    </style>
  </head>
  <body>
    <h1>Plain webview guest</h1>
  </body>
</html>`);
  const html = `<!doctype html>
<html style="height: 100%;">
  <head>
    <meta charset="utf-8" />
    <title>isolated webview layout</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      webview { ${webviewStyle} }
    </style>
  </head>
  <body>
    <webview id="probe" src="${embedURL}"></webview>
    <script>
      const probe = document.getElementById("probe");
      probe.addEventListener("did-finish-load", () => { window.__webviewReady = true; });
    </script>
  </body>
</html>`;
  return dataURL(html);
}

async function measure(app: ElectronApplication): Promise<WebviewLayoutMetrics> {
  return app.evaluate(async ({ BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("No BrowserWindow found");
    const host = await win.webContents.executeJavaScript(`(() => {
      const frame = document.getElementById("probe");
      if (!frame) throw new Error("No #probe webview found");
      const rect = frame.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })()`);
    const guestContents = webContents.getAllWebContents().find((contents) => contents.getType() === "webview");
    const guest = guestContents
      ? await guestContents.executeJavaScript(`({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          bodyHeight: document.body.getBoundingClientRect().height,
          documentHeight: document.documentElement.getBoundingClientRect().height,
        })`)
      : null;
    return { host, guest };
  });
}

async function launchIsolatedFixture(fixtureURL: string): Promise<{ app: ElectronApplication; cleanup: () => void }> {
  const isolated = createIsolatedElectronMain();
  try {
    const app = await electron.launch({ args: [isolated.entry, fixtureURL] });
    const page = await app.firstWindow();
    await page.waitForFunction(() => (window as unknown as { __webviewReady?: boolean }).__webviewReady === true);
    return { app, cleanup: isolated.cleanup };
  } catch (error) {
    isolated.cleanup();
    throw error;
  }
}

test.describe("isolated Electron <webview> layout", () => {
  test("display:block leaves the guest viewport at Electron's default 150px height", async () => {
    const { app, cleanup } = await launchIsolatedFixture(
      fixtureURLForWebviewStyle("display: block; width: 100%; height: 100%;"),
    );
    try {
      const metrics = await measure(app);
      console.log("isolated display:block webview metrics", JSON.stringify(metrics, null, 2));

      expect(metrics.host.height).toBeGreaterThan(900);
      expect(metrics.guest).not.toBeNull();
      expect(metrics.guest!.innerHeight).toBe(150);
    } finally {
      await app.close();
      cleanup();
    }
  });

  test("Electron's default webview display lets the guest viewport track the embedder height", async () => {
    const { app, cleanup } = await launchIsolatedFixture(
      fixtureURLForWebviewStyle("width: 100%; height: 100%;"),
    );
    try {
      const metrics = await measure(app);
      console.log("isolated default-display webview metrics", JSON.stringify(metrics, null, 2));

      expect(metrics.host.height).toBeGreaterThan(900);
      expect(metrics.guest).not.toBeNull();
      expect(metrics.guest!.innerHeight).toBeGreaterThan(metrics.host.height * 0.9);
    } finally {
      await app.close();
      cleanup();
    }
  });
});
