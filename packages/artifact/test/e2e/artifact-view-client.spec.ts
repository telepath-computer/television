import { expect, test, type Frame, type Page } from "@playwright/test";
import { readPublishedArtifactE2EURLs } from "./artifact-e2e-urls.js";

const publishedURLs = readPublishedArtifactE2EURLs();

function hostURL(): string {
  return publishedURLs.hostURL;
}

function viewOrigin(): string {
  return publishedURLs.viewOrigin;
}

const WAIT_FOR_RESPONSE_TIMEOUT = 5_000;
const POLL_INTERVAL = 25;

type PendingResult = { ok: true } | { ok: false; message: string };

type ViewWindow = {
  __events: Array<{ type: string; content?: string }>;
  __updateContent: (content: string) => number;
  __poll: (id: number) => PendingResult | "pending";
  __disposeArtifact: () => void;
  __postSelfContentUpdated: (content: string) => void;
  __postGarbageToParent: () => void;
};

async function gotoFreshHost(page: Page): Promise<void> {
  await page.goto(hostURL());
  await page.waitForFunction(() => typeof window.__bootView === "function");
}

async function bootView(
  page: Page,
  options: { registerHandler?: "resolve" | "throw" | "none" } = {},
): Promise<Frame> {
  await page.evaluate((opts) => window.__bootView(opts), options);
  // Wait for the view instance to exist and for the iframe to have loaded the
  // view origin (cross-origin: we can only detect via frame URL matching).
  await page.waitForFunction(
    () => typeof window.__view !== "undefined" && window.__view !== null,
  );
  const frame = await page.waitForFunction((origin) => {
    const iframe = document.querySelector("iframe");
    if (!(iframe instanceof HTMLIFrameElement)) return false;
    return iframe.src.startsWith(`${origin}/`);
  }, viewOrigin());
  await frame.dispose();
  // Grab the Playwright Frame handle for the cross-origin iframe.
  const viewFrame = page.frames().find((f) => f.url().startsWith(viewOrigin()));
  if (!viewFrame) throw new Error("view iframe frame not found in page.frames()");
  // Wait until the harness exposes its helpers.
  await viewFrame.waitForFunction(
    () => typeof (window as unknown as { __updateContent?: unknown }).__updateContent === "function",
  );
  return viewFrame;
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Array.isArray(window.__events) && window.__events.some((e) => e.type === "ready"),
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT },
  );
}

async function sendUpdateContent(viewFrame: Frame, content: string): Promise<number> {
  return viewFrame.evaluate(
    (ctn) => (window as unknown as ViewWindow).__updateContent(ctn),
    content,
  );
}

async function pollPending(viewFrame: Frame, requestId: number): Promise<PendingResult> {
  const handle = await viewFrame.waitForFunction(
    (id) => {
      const result = (window as unknown as ViewWindow).__poll(id);
      return result === "pending" ? null : result;
    },
    requestId,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  return (await handle.jsonValue()) as PendingResult;
}

async function readViewEvents(viewFrame: Frame): Promise<Array<{ type: string; content?: string }>> {
  return viewFrame.evaluate(() => (window as unknown as ViewWindow).__events.slice());
}

test("ready handshake: view posts ready on construction; host emits ReadyEvent", async ({ page }) => {
  await gotoFreshHost(page);
  await bootView(page);
  await waitForReady(page);
  const events = await page.evaluate(() => window.__events);
  expect(events.filter((e) => e.type === "ready")).toHaveLength(1);
});

test("host → view: setting content after ready delivers content-updated to ArtifactContext", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page);
  await waitForReady(page);
  await page.evaluate(() => window.__setContent("payload-alpha"));
  const handle = await viewFrame.waitForFunction(
    () =>
      (window as unknown as ViewWindow).__events.find(
        (e) => e.type === "content-updated" && e.content === "payload-alpha",
      ) ?? null,
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  const value = (await handle.jsonValue()) as { type: string; content?: string };
  expect(value.content).toBe("payload-alpha");
});

test("host → view: content set before ready is delivered on ready", async ({ page }) => {
  await gotoFreshHost(page);
  // Defer iframe load so we can set content before `ready` arrives.
  await page.evaluate(() => window.__bootView({ deferIframeLoad: true, initialContent: "early" }));
  // Now let the iframe actually load.
  await page.evaluate(() => window.__finishIframeLoad());
  const viewFrame = page.frames().find((f) => f.url().startsWith(viewOrigin()));
  if (!viewFrame) throw new Error("view iframe frame not found");
  await viewFrame.waitForFunction(
    () => typeof (window as unknown as { __events?: unknown }).__events !== "undefined",
  );
  await viewFrame.waitForFunction(
    () =>
      (window as unknown as ViewWindow).__events.some(
        (e) => e.type === "content-updated" && e.content === "early",
      ),
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  const events = await readViewEvents(viewFrame);
  expect(events.filter((e) => e.type === "content-updated").map((e) => e.content)).toEqual(["early"]);
});

test("host → view: multiple sets before ready collapse to the latest", async ({ page }) => {
  await gotoFreshHost(page);
  await page.evaluate(() => window.__bootView({ deferIframeLoad: true, initialContent: "a" }));
  await page.evaluate(() => {
    window.__setContent("b");
    window.__setContent("c");
  });
  await page.evaluate(() => window.__finishIframeLoad());
  const viewFrame = page.frames().find((f) => f.url().startsWith(viewOrigin()));
  if (!viewFrame) throw new Error("view iframe frame not found");
  await viewFrame.waitForFunction(
    () => typeof (window as unknown as { __events?: unknown }).__events !== "undefined",
  );
  await viewFrame.waitForFunction(
    () =>
      (window as unknown as ViewWindow).__events.some(
        (e) => e.type === "content-updated" && e.content === "c",
      ),
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  // Give any stray additional content-updated messages a chance to arrive.
  await page.waitForTimeout(100);
  const events = await readViewEvents(viewFrame);
  expect(events.filter((e) => e.type === "content-updated").map((e) => e.content)).toEqual(["c"]);
});

test("host → view: reloading the iframe re-delivers the current content on the new ready", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page);
  await waitForReady(page);
  await page.evaluate(() => window.__setContent("persisted"));
  await viewFrame.waitForFunction(
    () =>
      (window as unknown as ViewWindow).__events.some(
        (e) => e.type === "content-updated" && e.content === "persisted",
      ),
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );

  // Count ready events before reload.
  const readyBefore = await page.evaluate(() =>
    window.__events.filter((e) => e.type === "ready").length,
  );

  // Reload the iframe. Same ArtifactView instance on the host.
  await page.evaluate(() => window.__rebootIframe());

  // Wait until a second ready has arrived.
  await page.waitForFunction(
    (before) => window.__events.filter((e) => e.type === "ready").length > before,
    readyBefore,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );

  // The new iframe's view should have received the persisted content again
  // via content-updated without the host doing anything explicit.
  const newViewFrame = page.frames().find((f) => f.url().startsWith(viewOrigin()));
  if (!newViewFrame) throw new Error("reloaded view iframe frame not found");
  await newViewFrame.waitForFunction(
    () =>
      (window as unknown as ViewWindow).__events.some(
        (e) => e.type === "content-updated" && e.content === "persisted",
      ),
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
});

test("host → view: multiple sets after ready each deliver in order", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page);
  await waitForReady(page);
  await page.evaluate(() => {
    window.__setContent("a");
    window.__setContent("b");
    window.__setContent("c");
  });
  await viewFrame.waitForFunction(
    () => {
      const events = (window as unknown as ViewWindow).__events.filter(
        (e) => e.type === "content-updated",
      );
      return events.length >= 3;
    },
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  const events = await readViewEvents(viewFrame);
  expect(events.filter((e) => e.type === "content-updated").map((e) => e.content)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("host → view: never-set content means no content-updated is posted on ready", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page);
  await waitForReady(page);
  // Give any stray content-updated messages a chance to arrive.
  await page.waitForTimeout(150);
  const events = await readViewEvents(viewFrame);
  expect(events.some((e) => e.type === "content-updated")).toBe(false);
});

test("ArtifactView.content getter reflects the last-set value; null before first set", async ({ page }) => {
  await gotoFreshHost(page);
  await bootView(page);
  await waitForReady(page);
  const beforeSet = await page.evaluate(() => window.__getContent());
  expect(beforeSet).toBeNull();
  await page.evaluate(() => window.__setContent("first"));
  const afterFirst = await page.evaluate(() => window.__getContent());
  expect(afterFirst).toBe("first");
  await page.evaluate(() => window.__setContent("second"));
  const afterSecond = await page.evaluate(() => window.__getContent());
  expect(afterSecond).toBe("second");
});

test("view → host request happy path: updateContent() resolves after handler resolves", async ({
  page,
}) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page, { registerHandler: "resolve" });
  await waitForReady(page);
  const requestId = await sendUpdateContent(viewFrame, "saved-content");
  const result = await pollPending(viewFrame, requestId);
  expect(result).toEqual({ ok: true });

  const invocations = await page.evaluate(() => window.__handlerInvocations);
  expect(invocations).toContain("saved-content");
});

test("view → host request error path: host handler rejects, updateContent() rejects with handler message", async ({
  page,
}) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page, { registerHandler: "throw" });
  await waitForReady(page);
  const requestId = await sendUpdateContent(viewFrame, "will-fail");
  await page.waitForFunction(
    () => window.__handlerInvocations.length > 0,
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  await page.evaluate(() => window.__rejectNextHandler("host-rejected-us"));
  const result = await pollPending(viewFrame, requestId);
  expect(result).toEqual({ ok: false, message: "host-rejected-us" });
});

test("view → host request with no handler: view receives error response", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page, { registerHandler: "none" });
  await waitForReady(page);
  const requestId = await sendUpdateContent(viewFrame, "no-listener");
  const result = await pollPending(viewFrame, requestId);
  expect(result).toEqual({ ok: false, message: "No handler registered for update-content" });
});

test("self-source filter: view's own posted content-updated does not fire ContentUpdatedEvent on itself", async ({
  page,
}) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page);
  await waitForReady(page);
  await viewFrame.evaluate(() => {
    (window as unknown as ViewWindow).__postSelfContentUpdated("self-posted");
  });
  await page.waitForTimeout(100);
  const events = await readViewEvents(viewFrame);
  expect(events.some((e) => e.type === "content-updated")).toBeFalsy();
});

test("unknown payloads: garbage messages are silently dropped on both sides", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page);
  await waitForReady(page);
  // View → host garbage.
  await viewFrame.evaluate(() => {
    (window as unknown as ViewWindow).__postGarbageToParent();
  });
  // Host → view garbage (via the real iframe.contentWindow reference, which
  // cross-origin posting is allowed to do).
  await page.evaluate(() => {
    const iframe = document.querySelector("iframe");
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error("no iframe");
    const win = iframe.contentWindow;
    if (!win) throw new Error("no contentWindow");
    win.postMessage({ type: "banana" }, "*");
    win.postMessage("not-an-object", "*");
    win.postMessage({ type: "response", id: "no-such-request", result: {} }, "*");
  });
  await page.waitForTimeout(100);
  const hostEvents = await page.evaluate(() => window.__events);
  expect(hostEvents.filter((e) => e.type !== "ready")).toHaveLength(0);
  const viewEvents = await readViewEvents(viewFrame);
  expect(viewEvents.some((e) => e.type === "content-updated")).toBeFalsy();
});

test("dispose() on host stops delivery and future calls throw", async ({ page }) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page, { registerHandler: "none" });
  await waitForReady(page);
  await page.evaluate(() => window.__disposeView());
  // After dispose, view's update-content must stay pending — no host listener.
  const requestId = await sendUpdateContent(viewFrame, "after-dispose");
  await page.waitForTimeout(200);
  const state = await viewFrame.evaluate(
    (id) => (window as unknown as ViewWindow).__poll(id),
    requestId,
  );
  expect(state).toBe("pending");
});

test("dispose() on view rejects in-flight updateContent() with 'ArtifactContext disposed'", async ({
  page,
}) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page, { registerHandler: "throw" });
  await waitForReady(page);
  const requestId = await sendUpdateContent(viewFrame, "to-abort");
  await page.waitForFunction(
    () => window.__handlerInvocations.length > 0,
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );
  await viewFrame.evaluate(() => (window as unknown as ViewWindow).__disposeArtifact());
  const result = await pollPending(viewFrame, requestId);
  expect(result).toEqual({ ok: false, message: "ArtifactContext disposed" });
});

test("cross-origin round trip: host and view on separate origins complete notification + request/response", async ({
  page,
}) => {
  await gotoFreshHost(page);
  const viewFrame = await bootView(page, { registerHandler: "resolve" });
  await waitForReady(page);

  // Verify origins genuinely differ.
  expect(new URL(page.url()).origin).toBe(new URL(hostURL()).origin);
  expect(new URL(viewFrame.url()).origin).toBe(viewOrigin());

  // Notification direction.
  await page.evaluate(() => window.__setContent("cross-origin-notif"));
  await viewFrame.waitForFunction(
    () =>
      (window as unknown as ViewWindow).__events.some(
        (e) => e.type === "content-updated" && e.content === "cross-origin-notif",
      ),
    undefined,
    { timeout: WAIT_FOR_RESPONSE_TIMEOUT, polling: POLL_INTERVAL },
  );

  // Request/response direction.
  const requestId = await sendUpdateContent(viewFrame, "cross-origin-save");
  const result = await pollPending(viewFrame, requestId);
  expect(result).toEqual({ ok: true });
});
