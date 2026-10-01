// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { installBridge } from "@telepath-computer/television-artifact/browser";

const BRIDGE_CHANNEL = "television-artifact-bridge";
const TV_ARTIFACT_PATH = "/artifact/01J00000000000000000000000/index.html";
const TV_ARTIFACT_URL = `http://producer.test${TV_ARTIFACT_PATH}`;
const POLL_ADVANCES_MS = [0, 5000, 5000, 10000, 15000, 5000] as const;
const HOOKED_POLL_ADVANCES_MS = [0, 250, 250, 500, 750, 250] as const;
const HOOKED_POLL_CADENCE = { normalMs: 250, slowMs: 750 } as const;

interface FakeIpcRenderer {
  sendToHost: Mock<(...args: unknown[]) => void>;
  on: Mock<(...args: unknown[]) => void>;
  removeListener: Mock<(...args: unknown[]) => void>;
}

const fakeIpc: FakeIpcRenderer = {
  sendToHost: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
};

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    sendToHost: (...args: unknown[]) => fakeIpc.sendToHost(...args),
    on: (...args: unknown[]) => fakeIpc.on(...args),
    removeListener: (...args: unknown[]) => fakeIpc.removeListener(...args),
  },
}));

type PollOutcome =
  | { kind: "etag"; value: string }
  | { kind: "http-error" }
  | { kind: "throw" };

interface PollTracePoint {
  elapsedMs: number;
  fetches: number;
  messages: Array<{ type: "proxy-content-changed" }>;
}

interface PollRun {
  trace: PollTracePoint[];
  methods: string[];
}

function makeFramedWindow(url: string): Window {
  const iframe = document.createElement("iframe");
  iframe.src = url;
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) throw new Error("iframe has no contentWindow");
  return win;
}

function makeFetch(outcomes: readonly PollOutcome[]): ReturnType<typeof vi.fn> {
  let cursor = 0;
  return vi.fn(async () => {
    const outcome = outcomes[cursor++];
    if (!outcome) throw new Error(`Unexpected poll #${cursor}`);
    if (outcome.kind === "throw") throw new Error("offline");
    if (outcome.kind === "http-error") return new Response(null, { status: 500 });
    return new Response(null, { status: 200, headers: { ETag: outcome.value } });
  });
}

function isProxyContentChanged(value: unknown): value is { type: "proxy-content-changed" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "proxy-content-changed";
}

function requestMethods(fetch: ReturnType<typeof vi.fn>): string[] {
  return fetch.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
}

async function collectTrace(
  fetch: ReturnType<typeof vi.fn>,
  messages: () => Array<{ type: "proxy-content-changed" }>,
  advancesMs: readonly number[] = POLL_ADVANCES_MS,
): Promise<PollTracePoint[]> {
  const trace: PollTracePoint[] = [];
  let elapsedMs = 0;
  for (const advanceMs of advancesMs) {
    await vi.advanceTimersByTimeAsync(advanceMs);
    elapsedMs += advanceMs;
    trace.push({
      elapsedMs,
      fetches: fetch.mock.calls.length,
      messages: messages(),
    });
  }
  return trace;
}

async function runIframeBridgePoll(
  outcomes: readonly PollOutcome[],
  pollCadence?: { normalMs: number; slowMs: number },
): Promise<PollRun> {
  vi.useFakeTimers();
  let win: Window | null = null;
  try {
    win = makeFramedWindow(TV_ARTIFACT_URL);
    const fetch = makeFetch(outcomes);
    Object.defineProperty(win, "fetch", { configurable: true, value: fetch });
    const postMessage = vi.spyOn(win.parent, "postMessage");

    installBridge(win, { reportNavigation: false, pollCadence });
    const trace = await collectTrace(fetch, () => {
      return postMessage.mock.calls
        .map(([message]) => message)
        .filter(isProxyContentChanged);
    }, pollCadence ? HOOKED_POLL_ADVANCES_MS : POLL_ADVANCES_MS);
    return { trace, methods: requestMethods(fetch) };
  } finally {
    win?.dispatchEvent(new Event("pagehide"));
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  }
}

async function runWebviewPreloadPoll(
  outcomes: readonly PollOutcome[],
  pollCadence?: { normalMs: number; slowMs: number },
  testMode = pollCadence !== undefined,
): Promise<PollRun> {
  vi.useFakeTimers();
  const previousEnv = {
    testMode: process.env.TV_TEST_MODE,
    normalMs: process.env.TV_TEST_ARTIFACT_POLL_NORMAL_MS,
    slowMs: process.env.TV_TEST_ARTIFACT_POLL_SLOW_MS,
  };
  try {
    fakeIpc.sendToHost.mockClear();
    const fetch = makeFetch(outcomes);
    Object.defineProperty(window, "fetch", { configurable: true, value: fetch });
    window.history.pushState({}, "", TV_ARTIFACT_PATH);
    if (pollCadence) {
      process.env.TV_TEST_ARTIFACT_POLL_NORMAL_MS = String(pollCadence.normalMs);
      process.env.TV_TEST_ARTIFACT_POLL_SLOW_MS = String(pollCadence.slowMs);
    }
    if (testMode) process.env.TV_TEST_MODE = "true";
    else delete process.env.TV_TEST_MODE;
    vi.resetModules();

    await import("../src/webview-bridge-preload.ts");
    const trace = await collectTrace(fetch, () => {
      return fakeIpc.sendToHost.mock.calls
        .filter(([channel]) => channel === BRIDGE_CHANNEL)
        .map(([, message]) => message)
        .filter(isProxyContentChanged);
    }, pollCadence && testMode ? HOOKED_POLL_ADVANCES_MS : POLL_ADVANCES_MS);
    return { trace, methods: requestMethods(fetch) };
  } finally {
    window.dispatchEvent(new Event("pagehide"));
    vi.clearAllTimers();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
    for (const [name, value] of [
      ["TV_TEST_MODE", previousEnv.testMode],
      ["TV_TEST_ARTIFACT_POLL_NORMAL_MS", previousEnv.normalMs],
      ["TV_TEST_ARTIFACT_POLL_SLOW_MS", previousEnv.slowMs],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("ETag content poll loop parity", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    fakeIpc.sendToHost.mockClear();
    fakeIpc.on.mockClear();
    fakeIpc.removeListener.mockClear();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  it("keeps the injected bridge and Electron preload poll loops behaviorally equivalent", async () => {
    const outcomes: PollOutcome[] = [
      { kind: "etag", value: '"one"' },
      { kind: "etag", value: '"one"' },
      { kind: "throw" },
      { kind: "http-error" },
      { kind: "etag", value: '"one"' },
      { kind: "etag", value: '"two"' },
    ];
    const expectedTrace: PollTracePoint[] = [
      { elapsedMs: 0, fetches: 1, messages: [] },
      { elapsedMs: 5000, fetches: 2, messages: [] },
      { elapsedMs: 10000, fetches: 3, messages: [] },
      { elapsedMs: 20000, fetches: 4, messages: [] },
      { elapsedMs: 35000, fetches: 5, messages: [] },
      { elapsedMs: 40000, fetches: 6, messages: [{ type: "proxy-content-changed" }] },
    ];

    const iframeBridge = await runIframeBridgePoll(outcomes);
    const webviewPreload = await runWebviewPreloadPoll(outcomes);

    expect(iframeBridge.trace).toEqual(expectedTrace);
    expect(webviewPreload.trace).toEqual(expectedTrace);
    expect(iframeBridge.methods).toEqual(Array(outcomes.length).fill("HEAD"));
    expect(webviewPreload.methods).toEqual(iframeBridge.methods);
  });

  it("keeps hooked browser and Electron poll cadences behaviorally equivalent", async () => {
    const outcomes: PollOutcome[] = [
      { kind: "etag", value: '"one"' },
      { kind: "etag", value: '"one"' },
      { kind: "throw" },
      { kind: "http-error" },
      { kind: "etag", value: '"one"' },
      { kind: "etag", value: '"two"' },
    ];
    const expectedTrace: PollTracePoint[] = [
      { elapsedMs: 0, fetches: 1, messages: [] },
      { elapsedMs: 250, fetches: 2, messages: [] },
      { elapsedMs: 500, fetches: 3, messages: [] },
      { elapsedMs: 1000, fetches: 4, messages: [] },
      { elapsedMs: 1750, fetches: 5, messages: [] },
      { elapsedMs: 2000, fetches: 6, messages: [{ type: "proxy-content-changed" }] },
    ];

    const iframeBridge = await runIframeBridgePoll(outcomes, HOOKED_POLL_CADENCE);
    const webviewPreload = await runWebviewPreloadPoll(outcomes, HOOKED_POLL_CADENCE);

    expect(iframeBridge.trace).toEqual(expectedTrace);
    expect(webviewPreload.trace).toEqual(expectedTrace);
    expect(webviewPreload.methods).toEqual(iframeBridge.methods);
  });

  it("ignores Electron poll cadence variables unless TV_TEST_MODE is true", async () => {
    const outcomes: PollOutcome[] = [
      { kind: "etag", value: '"one"' },
      { kind: "etag", value: '"one"' },
      { kind: "throw" },
      { kind: "http-error" },
      { kind: "etag", value: '"one"' },
      { kind: "etag", value: '"two"' },
    ];

    const productionCadence = await runWebviewPreloadPoll(outcomes, HOOKED_POLL_CADENCE, false);

    expect(productionCadence.trace.at(-1)).toEqual({
      elapsedMs: 40000,
      fetches: 6,
      messages: [{ type: "proxy-content-changed" }],
    });
  });
});
