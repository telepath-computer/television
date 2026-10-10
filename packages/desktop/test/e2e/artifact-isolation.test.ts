import type { ElectronApplication, Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { writeLoadingFixture, type LoadingResults } from "../../../../test/helpers/sandboxed-artifact-fixture.ts";
import { expectDesktopIsolationEnforced, launchIsolationServer, writeIsolationFixture, type IsolationResults } from "../../../../test/helpers/artifact-isolation-fixture.ts";
import { minimalTallPdf } from "../../../../test/helpers/tall-pdf.ts";
import { configureTestMotion } from "../../../web/test/e2e/helpers.ts";
import { createUserDataDir, desktopE2EOrigin, expectPermanentApplicationShell, launchDesktop } from "./helpers.ts";

// Artifact isolation in the real Electron app against a really-running
// product server, with each artifact unsandboxed in its partition. Artifacts
// are authored fixtures registered through the production API; the fixture
// hook only selects the app URL, and the default CSS-motion override is the
// only mock. Code run in a webview through Electron plays the artifact's own.

const X11_POINTER_PRESS = path.join(path.dirname(fileURLToPath(import.meta.url)), "x11-pointer-press.py");
const X11_POINTER_WHEEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "x11-pointer-wheel.py");
const execFileAsync = promisify(execFile);

/** A page point's position on the X screen. */
async function screenPoint(app: ElectronApplication, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return app.evaluate(({ BrowserWindow }, pagePoint) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("BrowserWindow missing");
    const content = window.getContentBounds();
    return { x: Math.round(content.x + pagePoint.x), y: Math.round(content.y + pagePoint.y) };
  }, point);
}

/** Presses at a page point, then turns the wheel down there, through the X server, as a user's mouse would. */
async function nativePressAndWheel(app: ElectronApplication, point: { x: number; y: number }, notches: number): Promise<void> {
  const screen = await screenPoint(app, point);
  await execFileAsync("python3", [X11_POINTER_PRESS, String(screen.x), String(screen.y)], { timeout: 5_000 });
  await execFileAsync("python3", [X11_POINTER_WHEEL, String(screen.x), String(screen.y), String(notches)], { timeout: 5_000 });
}

async function createPathArtifact(product: Pick<ProductServer, "serverURL" | "token">, title: string, artifactPath: string): Promise<string> {
  const client = new TelevisionClient(product.serverURL, { token: product.token });
  const display = await client.display.get();
  const channelID = display.focusedChannelId ?? (await client.channels.list()).channels[0]!.id;
  const { artifact } = await client.artifacts.create({ channelID, kind: "path", title, path: artifactPath });
  return artifact.id;
}

async function openDesktop(product: ProductServer, args: readonly string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const url = new URL("/packages/web/src/index.html", await product.appURL(desktopE2EOrigin()));
  url.searchParams.set("mode", "electron");
  url.searchParams.set("desktopAppVersion", "9.9.9");
  const launched = await launchDesktop({ fixture: url.href, args });
  try {
    await expectPermanentApplicationShell(launched.page);
    await configureTestMotion(launched.page);
    return launched;
  } catch (error) {
    await launched.app.close().catch(() => undefined);
    throw error;
  }
}

/** Runs `source` in the main frame of the webview whose address contains `marker`; null while there is none. */
async function inWebview(app: ElectronApplication, marker: string, source: string): Promise<unknown> {
  return app.evaluate(async ({ webContents }, { expectedMarker, script }) => {
    const guest = webContents.getAllWebContents()
      .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker));
    return guest ? await guest.executeJavaScript(script) : null;
  }, { expectedMarker: marker, script: source });
}

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-escalation-electron
test("artifact storage and authority stay isolated in the desktop app", async () => {
  const product = await launchIsolationServer();
  let app: ElectronApplication | null = null;
  let userDataDir: string | undefined;
  try {
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    // Connect before registering the artifact so native state is observed
    // before the fixture runs. This uses the real saved-connection flow.
    const launched = await launchDesktop({
      connectTo: { serverURL: product.serverURL, token: product.token },
      env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
    });
    ({ app, userDataDir } = launched);
    const { page } = launched;
    await expectPermanentApplicationShell(page);
    await configureTestMotion(page);
    const appLocation = page.url();
    const connectionFile = path.join(userDataDir!, "connection.json");
    const connectionBefore = readFileSync(connectionFile, "utf8");
    const storedToken = () => page.evaluate(() => localStorage.getItem("store-television-electron"));
    const tokenBefore = await storedToken();
    expect(JSON.parse(tokenBefore!)).toEqual({ authTokens: { [product.serverURL]: product.token } });
    const appearanceBefore = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
    // Observe window creation without replacing its handlers or granting the
    // artifact any test interface. The artifact's own requests are same-origin,
    // so it reads their answers itself.
    await app.evaluate(({ app: electron }) => {
      const record = globalThis as typeof globalThis & { __isolationWindows: number };
      record.__isolationWindows = 0;
      electron.on("browser-window-created", () => { record.__isolationWindows++; });
    });
    const sentinel = randomUUID();
    await page.evaluate((value) => localStorage.setItem("artifact-isolation-sentinel", value), sentinel);
    const folder = writeIsolationFixture(path.join(product.home, "isolation-fixture"));
    const artifactID = await createPathArtifact(product, "Isolation fixture", folder);
    const before = { channels: await client.channels.list(), artifacts: await client.artifacts.list() };
    const marker = `/artifact/${artifactID}/`;
    for (const phase of ["load", "click"] as const) {
      if (phase === "click") {
        await page.locator(`webview[src*="${marker}"]`).evaluate((element) => {
          const record = window as typeof window & { __isolationMessages: unknown[] };
          record.__isolationMessages = [];
          element.addEventListener("ipc-message", (event) => {
            const message = event as Event & { channel: string; args: Array<{ type?: string }> };
            if (message.channel === "television-artifact-bridge" && message.args[0]?.type?.startsWith("television:")) {
              record.__isolationMessages.push(message.args[0]);
            }
          });
        });
        await app.evaluate(async ({ webContents }, expectedMarker) => {
          const guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker));
          if (!guest) throw new Error("No isolation artifact webview");
          const point = await guest.executeJavaScript(`(() => {
            const rect = document.getElementById("check").getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          })()`) as { x: number; y: number };
          guest.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
          guest.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
        }, marker);
      }
      const read = () => inWebview(app!, marker, `document.getElementById(${JSON.stringify(phase)})?.textContent ?? ""`);
      await expect.poll(read, { timeout: 15_000 }).toMatch(/^\{/);
      const results = JSON.parse(String(await read())) as IsolationResults;
      expect(await inWebview(app, marker, "String(self.origin)")).toBe(new URL(product.serverURL).origin);
      expectDesktopIsolationEnforced(results, artifactID, phase === "click", product.token);
      expect(results.desktop).toEqual({
        globals: { require: "undefined", process: "undefined", module: "undefined", Buffer: "undefined", ipcRenderer: "undefined", electron: "undefined" },
        // The proxy also injects its page-owned appearance resolver. The
        // content bridge is the only global supplied by the native preload.
        televisionGlobals: ["__televisionAppearanceResolver", "__televisionContentBridge"],
        bridgeKeys: ["onHostMessage", "openApplicationLink", "postToHost"],
        links: phase === "load" ? { web: false, file: false, script: false, application: false } : { web: false, file: false, script: false },
        appWindow: true, selfWindow: true,
      });
    }
    expect(await page.evaluate(() => (window as typeof window & { __isolationMessages: unknown[] }).__isolationMessages)).toEqual(
      ["television:disconnect", "television:restart-to-install-update", "television:set-appearance-mode"]
        .map((type) => ({ type, mode: "dark", channel: type })),
    );
    expect(await app.evaluate(({ nativeTheme }) => {
      const record = globalThis as typeof globalThis & {
        __isolationWindows: number;
        __televisionExternalOpenLog?: string[]; __televisionRestartToInstallLog?: string[];
      };
      return {
        windows: record.__isolationWindows,
        external: record.__televisionExternalOpenLog ?? [], restarts: record.__televisionRestartToInstallLog ?? [],
        appearance: nativeTheme.themeSource,
      };
    })).toEqual({ windows: 0, external: [product.serverURL + "/", product.serverURL + marker, product.serverURL + "/", product.serverURL + marker], restarts: [], appearance: appearanceBefore });
    expect(readFileSync(connectionFile, "utf8")).toBe(connectionBefore);
    expect(await storedToken()).toBe(tokenBefore);
    expect(await page.evaluate(() => localStorage.getItem("artifact-isolation-sentinel"))).toBe(sentinel);
    // Nothing the artifact wrote, or registered, reached the window's session.
    expect(await page.evaluate(async () => ({
      local: localStorage.getItem("isolation-storage-probe"),
      cookie: document.cookie.includes("artifactIsolationProbe"),
      databases: (await indexedDB.databases()).map((database) => database.name).includes("artifact-isolation"),
      workers: (await navigator.serviceWorker.getRegistrations()).length,
    }))).toEqual({ local: null, cookie: false, databases: false, workers: 0 });
    expect(page.url()).toBe(appLocation);
    expect({ channels: await client.channels.list(), artifacts: await client.artifacts.list() }).toEqual(before);
    const authenticated = page.waitForResponse((response) => new URL(response.url()).pathname === "/channels" && [200, 304].includes(response.status()));
    await page.reload();
    await authenticated;
    await expectPermanentApplicationShell(page);
    expect(await storedToken()).toBe(tokenBefore);
  } finally {
    await app?.close().catch(() => undefined);
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    await product.dispose();
  }
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-artifacts-load
test("an artifact loads its own files, the canonical bundle, its store and the missing-file page in its partition", async () => {
  const product = await launchProductServer();
  let app: ElectronApplication | null = null;
  try {
    const folder = writeLoadingFixture(path.join(product.home, "loading-fixture"));
    const artifactID = await createPathArtifact(product, "Loading fixture", `${folder}${path.sep}`);
    let page: Page;
    ({ app, page } = await openDesktop(product));
    const marker = `/artifact/${artifactID}/`;

    await expect.poll(() => inWebview(app!, marker, `document.getElementById("results")?.textContent ?? ""`), { timeout: 15_000 })
      .not.toBe("");
    const results = JSON.parse(String(await inWebview(app, marker, `document.getElementById("results").textContent`))) as LoadingResults;
    // The fixture hook loads the app through the development proxy, whose
    // origin is the artifact's address.
    const serverOrigin = new URL(page.url()).origin;
    expect(results).toEqual({
      origin: serverOrigin,
      module: "module ran",
      json: 42,
      font: true,
      canonicalStyle: true,
      canonicalElement: true,
      store: "round-trip",
    });
    expect(JSON.parse(product.runCLI(["resource", "json", "get", "--artifact", artifactID, "probe"]))).toEqual({ exists: true, value: "round-trip" });

    rmSync(path.join(folder, "index.html"));
    await expect.poll(() => inWebview(app!, marker, `document.getElementById("missing-title")?.textContent ?? ""`), { timeout: 15_000 })
      .toBe("Artifact file not found");
    expect(await inWebview(app, marker, `({
      path: document.getElementById("missing-path").textContent,
      title: document.title,
      padded: getComputedStyle(document.querySelector(".artifact-error")).paddingTop !== "0px",
      origin: String(self.origin),
    })`)).toEqual({ path: `${folder}${path.sep}`, title: "Loading fixture", padded: true, origin: serverOrigin });
  } finally {
    await app?.close().catch(() => undefined);
    await product.dispose();
  }
});

// spec: proofs/product/artifacts.md#^af-ac-native-pdf-electron
test("a folder artifact's PDF renders in its webview and scrolls under native input", async () => {
  test.skip(process.platform !== "linux", "Native pointer driver requires Linux/X11");
  const product = await launchProductServer();
  let app: ElectronApplication | null = null;
  try {
    const folder = path.join(product.home, "pdf-fixture");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), `<!doctype html><a id="pdf" href="tall.pdf">The PDF</a>`);
    writeFileSync(path.join(folder, "tall.pdf"), minimalTallPdf());
    const artifactID = await createPathArtifact(product, "PDF fixture", `${folder}${path.sep}`);
    let page: Page;
    ({ app, page } = await openDesktop(product));

    await expect.poll(() => inWebview(app!, `/artifact/${artifactID}/`, `document.getElementById("pdf") !== null`), { timeout: 15_000 }).toBe(true);
    await inWebview(app, `/artifact/${artifactID}/`, `document.getElementById("pdf").click()`);
    const pdfMarker = `/artifact/${artifactID}/tall.pdf`;
    await expect.poll(() => app!.evaluate(({ webContents }, marker) => webContents.getAllWebContents()
      .some((contents) => contents.getType() === "webview" && contents.getURL().endsWith(marker)), pdfMarker), { timeout: 15_000 }).toBe(true);

    // Chromium's PDF viewer shows it in a frame of its own whose document
    // embeds the plugin.
    const viewer = () => app!.evaluate(async ({ webContents }, marker) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview" && contents.getURL().endsWith(marker));
      for (const frame of guest?.mainFrame.framesInSubtree ?? []) {
        const state = await frame.executeJavaScript(`document.querySelector('embed[type="application/x-google-chrome-pdf"]')
          ? { scrollTop: document.scrollingElement.scrollTop, scrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight }
          : null`).catch(() => null) as { scrollTop: number; scrollable: boolean } | null;
        if (state !== null) return state;
      }
      return null;
    }, pdfMarker);
    // The viewer has laid the page out taller than the webview before the walk scrolls it.
    await expect.poll(viewer, { timeout: 15_000 }).toEqual({ scrollTop: 0, scrollable: true });

    const webview = page.locator(`.stage .page[data-page-key="${artifactID}"] .artifact-view webview.artifact-content`);
    const box = await webview.boundingBox();
    if (!box) throw new Error("Expected the PDF webview's bounds");
    await nativePressAndWheel(app, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 5);
    await expect.poll(async () => (await viewer())?.scrollTop ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    await app?.close().catch(() => undefined);
    await product.dispose();
  }
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-permissions-seam
test("a webview's artifact writes to the clipboard and enters fullscreen from a click, and is refused notifications, geolocation, the microphone and pointer lock", async () => {
  const product = await launchProductServer();
  let app: ElectronApplication | null = null;
  try {
    const folder = path.join(product.home, "permissions-fixture");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), `<!doctype html>
      <button id="use" style="width: 200px; height: 80px">Use features</button>
      <pre id="results"></pre>
      <script>
        document.getElementById("use").addEventListener("click", async () => {
          const results = {};
          const attempt = async (name, use) => {
            try { results[name] = await use(); } catch (error) { results[name] = error.name; }
          };
          // Fullscreen consumes the click's activation, so the clipboard goes first.
          await attempt("clipboard", () => navigator.clipboard.writeText("written by the artifact").then(() => "written"));
          await attempt("fullscreen", () => document.documentElement.requestFullscreen().then(() => document.fullscreenElement === null ? "not entered" : "entered"));
          await attempt("notifications", () => Notification.requestPermission());
          await attempt("geolocation", () => new Promise((resolve) => navigator.geolocation.getCurrentPosition(
            () => resolve("position"),
            (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "error " + error.code),
          )));
          await attempt("microphone", () => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => "stream"));
          await attempt("pointerLock", () => new Promise((resolve) => {
            document.addEventListener("pointerlockchange", () => resolve(document.pointerLockElement === null ? "released" : "locked"), { once: true });
            document.addEventListener("pointerlockerror", () => resolve("refused"), { once: true });
            Promise.resolve(document.body.requestPointerLock()).catch(() => resolve("refused"));
          }));
          document.getElementById("results").textContent = JSON.stringify(results);
        });
      </script>`);
    const artifactID = await createPathArtifact(product, "Permissions fixture", `${folder}${path.sep}`);
    let page: Page;
    // Chromium's fake capture device gives the microphone request a device;
    // without one the request fails before any permission is considered.
    ({ app, page } = await openDesktop(product, ["--use-fake-device-for-media-stream"]));
    const marker = `/artifact/${artifactID}/`;
    await expect.poll(() => inWebview(app!, marker, `document.getElementById("use") !== null`), { timeout: 15_000 }).toBe(true);

    await app.evaluate(async ({ webContents }, expectedMarker) => {
      const guest = webContents.getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker));
      if (!guest) throw new Error("No artifact webview");
      const point = await guest.executeJavaScript(`(() => {
        const rect = document.getElementById("use").getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`) as { x: number; y: number };
      guest.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      guest.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
      guest.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
    }, marker);

    await expect.poll(() => inWebview(app!, marker, `document.getElementById("results").textContent`), { timeout: 15_000 })
      .not.toBe("");
    // Without the handlers, Electron grants the notifications and geolocation
    // requests. The document is unsandboxed, so the microphone and pointer
    // lock requests reach the handlers too.
    expect(JSON.parse(String(await inWebview(app, marker, `document.getElementById("results").textContent`)))).toEqual({
      clipboard: "written",
      fullscreen: "entered",
      notifications: "denied",
      geolocation: "denied",
      microphone: "NotAllowedError",
      pointerLock: "refused",
    });
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("written by the artifact");

    // The window's own page is still granted what it asks for.
    expect(await page.evaluate(() => Notification.requestPermission())).toBe("granted");
  } finally {
    await app?.close().catch(() => undefined);
    await product.dispose();
  }
});

function partitionStoragePath(userDataDir: string, serverURL: string, artifactID: string): string {
  const key = createHash("sha256").update(`${new URL(serverURL).origin}\n${artifactID}`, "utf8").digest("hex").slice(0, 32);
  return path.join(userDataDir, "Partitions", `artifact-${key}`);
}

/** Runs `source` in the webview whose address contains `marker` and whose session is stored at `storagePath`. */
async function inGuest(app: ElectronApplication, marker: string, storagePath: string, source: string): Promise<unknown> {
  return app.evaluate(async ({ webContents }, { expectedMarker, expectedPath, script }) => {
    const guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview" &&
      contents.getURL().includes(expectedMarker) && contents.session.getStoragePath() === expectedPath && !contents.isLoading());
    return guest ? await guest.executeJavaScript(script) : null;
  }, { expectedMarker: marker, expectedPath: storagePath, script: source });
}

type Probe = "W" | "L1" | "L2" | "S1" | "S2" | "T1" | "T2" | "T3" | "P";

/** A probe's findings: whose markers it finds in each kind of storage, and what it can read. */
interface Findings {
  local: string[];
  databases: string[];
  cookies: string[];
  readable: string[];
}

// Played as the artifact's own code in each probe's page, and in the window's.
const WRITE_MARKERS = (probe: Probe) => `(async () => {
  localStorage.setItem("matrix-${probe}", "${probe}");
  document.cookie = "matrix-${probe}=${probe}; Path=/; Max-Age=86400";
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("matrix-${probe}");
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  return true;
})()`;
const READ_MARKERS = `(async () => {
  const probes = (names) => names.filter((name) => name.startsWith("matrix-")).map((name) => name.slice("matrix-".length)).sort();
  const cookieNames = document.cookie.split(";").map((cookie) => cookie.trim().split("=")[0]).filter(Boolean);
  return {
    local: probes(Object.keys(localStorage)),
    databases: probes((await indexedDB.databases()).map((database) => database.name ?? "")),
    cookies: probes(cookieNames),
    readable: [...Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? ""), document.cookie],
  };
})()`;

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-storage
test("storage visibility in the desktop app matches the matrix across the window and every kind of artifact, before and after a restart", async () => {
  test.setTimeout(180_000);
  const product = await launchIsolationServer();
  const producer = await launchProductServer({ auth: true });
  const site = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><p id="ready">${request.url}</p>`);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const sitePort = (site.address() as AddressInfo).port;
  const userDataDir = createUserDataDir("television-storage-matrix-");
  // Each origin on a host of its own: a browser keeps cookies by host,
  // ignoring the port.
  const args = ["--host-resolver-rules=MAP *.test 127.0.0.1"];
  const running: { app: ElectronApplication | null } = { app: null };
  try {
    const folder = (home: string, name: string) => {
      const directory = path.join(home, name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "index.html"), `<!doctype html><p id="ready">${name}</p>`);
      return `${directory}${path.sep}`;
    };
    const l1 = await createPathArtifact(product, "L1", folder(product.home, "l1"));
    const l2 = await createPathArtifact(product, "L2", folder(product.home, "l2"));
    const shared = await createPathArtifact(producer, "Shared", folder(producer.home, "shared"));
    const producerURL = `http://producer.test:${new URL(producer.serverURL).port}/artifact/${shared}/`;
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.display.get()).focusedChannelId ?? (await client.channels.list()).channels[0]!.id;
    const urlArtifact = async (title: string, url: string) =>
      (await client.artifacts.create({ channelID, kind: "url", title, url })).artifact.id;
    // Each probe's artifact; the walk finds its webview through the app's
    // page, whatever session the webview is in.
    const probes: Record<Exclude<Probe, "W">, string> = {
      L1: l1,
      L2: l2,
      S1: await urlArtifact("S1", `${product.serverURL}/artifact/${l1}/`),
      S2: await urlArtifact("S2", `${product.serverURL}/artifact/${l2}/`),
      T1: await urlArtifact("T1", `http://site-a.test:${sitePort}/t1.html`),
      T2: await urlArtifact("T2", `http://site-a.test:${sitePort}/t2.html`),
      T3: await urlArtifact("T3", `http://site-b.test:${sitePort}/t3.html`),
      P: await urlArtifact("P", producerURL),
    };
    const inArtifact = async (window: Page, artifactID: string, source: string): Promise<unknown> => {
      const contentsID = await window.locator(`.stage .page[data-page-key="${artifactID}"] webview.artifact-content`)
        .evaluate((element) => (element as unknown as { getWebContentsId(): number }).getWebContentsId(), undefined, { timeout: 1_000 })
        .catch(() => null);
      if (contentsID === null) return null;
      return running.app!.evaluate(async ({ webContents }, { id, script }) => {
        const guest = webContents.fromId(id);
        return guest && !guest.isLoading() ? await guest.executeJavaScript(script) : null;
      }, { id: contentsID, script: source });
    };

    const launch = async (): Promise<Page> => {
      const launched = await launchDesktop({
        connectTo: { serverURL: product.serverURL, token: product.token },
        userDataDir,
        args,
        env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
      });
      running.app = launched.app;
      await expectPermanentApplicationShell(launched.page);
      for (const [probe, artifactID] of Object.entries(probes)) {
        // Ready once the fixture's document shows its nonempty marker text.
        await expect.poll(() => inArtifact(launched.page, artifactID, `document.getElementById("ready")?.textContent || null`), { timeout: 15_000, message: probe })
          .not.toBeNull();
      }
      return launched.page;
    };
    const run = (window: Page, probe: Probe, source: string): Promise<unknown> => probe === "W"
      ? window.evaluate(source)
      : inArtifact(window, probes[probe], source);
    const all: Probe[] = ["W", "L1", "L2", "S1", "S2", "T1", "T2", "T3", "P"];
    const observe = async (window: Page) => {
      const observed: Record<string, { local: string[]; databases: string[]; cookies: string[]; token: boolean }> = {};
      for (const probe of all) {
        const findings = await run(window, probe, READ_MARKERS) as Findings;
        observed[probe] = {
          local: findings.local, databases: findings.databases, cookies: findings.cookies,
          token: findings.readable.some((value) => value.includes(product.token)),
        };
      }
      return observed;
    };
    const sees = (markers: Probe[], token = false) => ({ local: markers, databases: markers, cookies: markers, token });
    const expected = {
      W: sees(["W"], true),
      L1: sees(["L1"]),
      L2: sees(["L2"]),
      S1: sees(["S1", "S2"]),
      S2: sees(["S1", "S2"]),
      T1: sees(["T1", "T2"]),
      T2: sees(["T1", "T2"]),
      T3: sees(["T3"]),
      P: sees(["P"]),
    };

    let window = await launch();
    for (const probe of all) expect({ probe, written: await run(window, probe, WRITE_MARKERS(probe)) }).toEqual({ probe, written: true });
    const before = await observe(window);
    console.log(`storage matrix before restart ${JSON.stringify(before)}`);
    expect(before).toEqual(expected);

    // After a restart, without writing again, the same matrix holds.
    await running.app!.close();
    window = await launch();
    const after = await observe(window);
    console.log(`storage matrix after restart ${JSON.stringify(after)}`);
    expect(after).toEqual(expected);
  } finally {
    await running.app?.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => site.close(() => resolve()));
    await producer.dispose();
    await product.dispose();
  }
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-header-seam
test("an artifact runs unsandboxed in its partition and sends other sites only its server's origin as referrer", async () => {
  const product = await launchProductServer({ auth: true });
  const referrers: Array<{ path: string; referer: string | null }> = [];
  const site = http.createServer((request, response) => {
    referrers.push({ path: new URL(request.url ?? "/", "http://site.invalid").pathname, referer: request.headers.referer ?? null });
    response.writeHead(200, { "Content-Type": "image/gif", "Access-Control-Allow-Origin": "*" })
      .end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const siteOrigin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  let app: ElectronApplication | null = null;
  let userDataDir: string | undefined;
  try {
    const folder = path.join(product.home, "referrer-fixture");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "index.html"), `<!doctype html><p id="ready">ready</p>`);
    writeFileSync(path.join(folder, "own.json"), "{}");
    const artifactID = await createPathArtifact(product, "Referrer fixture", `${folder}${path.sep}`);
    const launched = await launchDesktop({
      connectTo: { serverURL: product.serverURL, token: product.token },
      env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
    });
    ({ app, userDataDir } = launched);
    await expectPermanentApplicationShell(launched.page);
    const marker = `/artifact/${artifactID}/`;
    const storagePath = partitionStoragePath(userDataDir!, product.serverURL, artifactID);
    const run = (source: string) => inGuest(app!, marker, storagePath, source);
    await expect.poll(() => run(`document.getElementById("ready")?.textContent ?? ""`), { timeout: 15_000 }).toBe("ready");
    const serverOrigin = new URL(product.serverURL).origin;
    expect(await run("String(self.origin)")).toBe(serverOrigin);

    // Observe, without replacing anything, the artifact session's requests.
    await app.evaluate(({ webContents }, expectedMarker) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker))!;
      const record = globalThis as typeof globalThis & {
        __ownReferrers: Array<string | null>; __documentStatuses: Array<{ statusCode: number; fromCache: boolean }>;
      };
      record.__ownReferrers = [];
      record.__documentStatuses = [];
      guest.session.webRequest.onSendHeaders({ urls: ["*://*/artifact/*"] }, (details) => {
        if (new URL(details.url).pathname.endsWith("/own.json")) record.__ownReferrers.push(details.requestHeaders.Referer ?? details.referrer ?? null);
      });
      guest.session.webRequest.onCompleted({ urls: ["*://*/artifact/*"] }, (details) => {
        if (details.resourceType === "mainFrame") record.__documentStatuses.push({ statusCode: details.statusCode, fromCache: details.fromCache });
      });
    }, marker);
    await run(`(async () => {
      await new Promise((resolve) => { const image = new Image(); image.onload = image.onerror = resolve; image.src = ${JSON.stringify(`${siteOrigin}/tile.gif`)}; });
      await fetch(${JSON.stringify(`${siteOrigin}/data`)});
      await fetch("own.json");
    })()`);
    expect(referrers).toEqual([
      { path: "/tile.gif", referer: `${serverOrigin}/` },
      { path: "/data", referer: `${serverOrigin}/` },
    ]);
    const documentURL = await run("location.href");
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __ownReferrers: Array<string | null> }).__ownReferrers))
      .toEqual([documentURL]);

    // A reload revalidates the document; the proxy answers 304, which
    // Electron reports as the cached 200. The document stays unsandboxed.
    await app.evaluate(({ webContents }, expectedMarker) => {
      webContents.getAllWebContents().find((contents) => contents.getType() === "webview" && contents.getURL().includes(expectedMarker))!.reload();
    }, marker);
    await expect.poll(() => app!.evaluate(() => (globalThis as typeof globalThis & {
      __documentStatuses: Array<{ statusCode: number; fromCache: boolean }>;
    }).__documentStatuses), { timeout: 15_000 }).toEqual([{ statusCode: 200, fromCache: true }]);
    await expect.poll(() => run(`document.getElementById("ready")?.textContent ?? ""`), { timeout: 15_000 }).toBe("ready");
    expect(await run("String(self.origin)")).toBe(serverOrigin);
  } finally {
    await app?.close().catch(() => undefined);
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => site.close(() => resolve()));
    await product.dispose();
  }
});
