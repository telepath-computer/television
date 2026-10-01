import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_POLL_INTERVAL_MS,
  POLL_JITTER_MAX_MS,
  createUpdateChannelPoller,
  deriveUpdateState,
  parseUpdateChannelDocument,
  type UpdateChannelFetch,
  type UpdateChannelPollerOptions,
} from "./update-channel.ts";

// Contract tests for the update channel (specs/arch/updates/update-channel.md):
//   ^t-channel-validation — the document validator, pure logic over
//     test-authored documents; permutation breadth lives here.
//   ^t-poll-failures — the polling loop, consumer side of the channel-HTTP
//     seam. The HTTP boundary is MOCKED — greenlit by the spec, because
//     failure permutations are the point; forfeits real-network coverage,
//     carried by ^t-poll-fetch (test/update-channel.seam.test.ts). The
//     scheduler is injected, so schedule shape (boot + interval + jitter,
//     ^poll-schedule) is timer-controlled, no waiting.
//   ^t-bypass — poll gating: the 0.0.0 dev-version suppression, superseded
//     by TV_UPDATE_CHANNEL_URL (^hook-url-implies-polling). Gating reads
//     exactly the own version and the URL override; the ~/.tv-developer
//     marker is not among the poller's inputs (^dev-marker-no-bypass), so
//     no marker permutation exists here — the marked-host spine walk is
//     ^ac-toast-dev-host (update-notification.spec.ts).
//   ^t-relay — the UpdateState derivation, producer side of the relay seam;
//     pure logic (numeric-triple newer-than per arch/updates/index.md
//     ^updates-version-comparisons).

const NOW_SECONDS = Number("1750000000");
const HALF = Number("0.5");
const ALMOST_ONE = Number("0.99");
const FAST_INTERVAL_MS = Number("50");
const FETCH_TIMEOUT_MS = Number("10000");
const NOT_A_STRING: unknown = Number("42");

const VALID_DOCUMENT = {
  schemaVersion: 1,
  version: "2.0.0",
  toast: {
    markdown: "A new release is out!",
    prompt: "Please upgrade my Television server following https://television.run/install.md",
    promptButtonLabel: "Copy upgrade prompt",
  },
  desktop: {
    upgradeMarkdown: "Upgrade the desktop app:\n\n```\nnpm install -g @telepath-computer/television-desktop@latest\n```",
  },
};

describe("channel document validation (^t-channel-validation)", () => {
  it("accepts the documented shape, with and without the optional fields", () => {
    expect(parseUpdateChannelDocument(VALID_DOCUMENT)).toEqual(VALID_DOCUMENT);

    const minimal = { schemaVersion: 1, version: "0.2.0", toast: { markdown: "hi" } };
    expect(parseUpdateChannelDocument(minimal)).toEqual(minimal);

    const noDesktop = { schemaVersion: 1, version: "0.2.0", toast: { markdown: "hi", prompt: "p" } };
    expect(parseUpdateChannelDocument(noDesktop)).toEqual(noDesktop);
  });

  it("reads unknown fields and a higher schemaVersion without rejecting (^evolution-no-gate)", () => {
    const evolved = {
      ...VALID_DOCUMENT,
      schemaVersion: 99,
      futureField: { anything: true },
      toast: { ...VALID_DOCUMENT.toast, futureToastField: "x" },
    };
    const parsed = parseUpdateChannelDocument(evolved);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe("2.0.0");
    expect(parsed!.toast.markdown).toBe(VALID_DOCUMENT.toast.markdown);
    expect(parsed!.desktop).toEqual(VALID_DOCUMENT.desktop);
  });

  it("rejects missing or mistyped required fields", () => {
    const cases: unknown[] = [
      null,
      "a string",
      NOT_A_STRING,
      [],
      {},
      { ...VALID_DOCUMENT, schemaVersion: undefined },
      { ...VALID_DOCUMENT, schemaVersion: 0 },
      { ...VALID_DOCUMENT, schemaVersion: -1 },
      { ...VALID_DOCUMENT, schemaVersion: 1.5 },
      { ...VALID_DOCUMENT, schemaVersion: "1" },
      { ...VALID_DOCUMENT, version: undefined },
      { ...VALID_DOCUMENT, version: "v1.2.3" },
      { ...VALID_DOCUMENT, version: "1.2" },
      { ...VALID_DOCUMENT, version: "1.2.3-beta" },
      { ...VALID_DOCUMENT, version: "" },
      { ...VALID_DOCUMENT, version: NOT_A_STRING },
      { ...VALID_DOCUMENT, toast: undefined },
      { ...VALID_DOCUMENT, toast: "read me" },
      { ...VALID_DOCUMENT, toast: {} },
      { ...VALID_DOCUMENT, toast: { markdown: "" } },
      { ...VALID_DOCUMENT, toast: { markdown: NOT_A_STRING } },
      { ...VALID_DOCUMENT, toast: { ...VALID_DOCUMENT.toast, prompt: NOT_A_STRING } },
      { ...VALID_DOCUMENT, toast: { ...VALID_DOCUMENT.toast, promptButtonLabel: NOT_A_STRING } },
      { ...VALID_DOCUMENT, desktop: "upgrade" },
      { ...VALID_DOCUMENT, desktop: {} },
      { ...VALID_DOCUMENT, desktop: { upgradeMarkdown: "" } },
      { ...VALID_DOCUMENT, desktop: { upgradeMarkdown: NOT_A_STRING } },
    ];
    for (const [index, document] of cases.entries()) {
      expect(parseUpdateChannelDocument(document), `case ${index}`).toBeNull();
    }
  });
});

describe("update state derivation (^t-relay)", () => {
  const document = parseUpdateChannelDocument(VALID_DOCUMENT)!;

  it("yields a toast iff the channel version is strictly newer than the server's (numeric triple)", () => {
    expect(deriveUpdateState(document, "1.9.9")!.toast).toEqual({
      version: "2.0.0",
      markdown: VALID_DOCUMENT.toast.markdown,
      prompt: VALID_DOCUMENT.toast.prompt,
      promptButtonLabel: VALID_DOCUMENT.toast.promptButtonLabel,
    });
    expect(deriveUpdateState(document, "2.0.0")!.toast).toBeNull();
    expect(deriveUpdateState(document, "2.0.1")!.toast).toBeNull();

    // Numeric ordering, not lexicographic: 10 > 9 per component.
    const tens = parseUpdateChannelDocument({ ...VALID_DOCUMENT, version: "10.0.0" })!;
    expect(deriveUpdateState(tens, "9.0.0")!.toast).not.toBeNull();
    const nines = parseUpdateChannelDocument({ ...VALID_DOCUMENT, version: "9.0.0" })!;
    expect(deriveUpdateState(nines, "10.0.0")!.toast).toBeNull();
  });

  it("omits absent optional toast fields rather than inventing them", () => {
    const minimal = parseUpdateChannelDocument({ schemaVersion: 1, version: "2.0.0", toast: { markdown: "hi" } })!;
    expect(deriveUpdateState(minimal, "1.0.0")!.toast).toEqual({ version: "2.0.0", markdown: "hi" });
  });

  it("relays the desktop block verbatim when present, null when absent", () => {
    expect(deriveUpdateState(document, "1.0.0")!.desktop).toEqual(VALID_DOCUMENT.desktop);
    const noDesktop = parseUpdateChannelDocument({ schemaVersion: 1, version: "2.0.0", toast: { markdown: "hi" } })!;
    expect(deriveUpdateState(noDesktop, "1.0.0")!.desktop).toBeNull();
    // The desktop half is content, not decision: it relays even when the
    // toast half is suppressed (^relay-split).
    expect(deriveUpdateState(document, "2.0.0")!.desktop).toEqual(VALID_DOCUMENT.desktop);
  });

  it("yields null with no document — no valid channel data applies", () => {
    expect(deriveUpdateState(null, "1.0.0")).toBeNull();
  });
});

// ── Poller ──────────────────────────────────────────────────────────────────

interface ScheduledTask {
  id: number;
  callback: () => void;
  delayMs: number;
}

function fakeScheduler() {
  const tasks: ScheduledTask[] = [];
  let nextId = 1;
  return {
    tasks,
    setTimeoutImpl: (callback: () => void, delayMs: number): unknown => {
      const id = nextId++;
      tasks.push({ id, callback, delayMs });
      return id;
    },
    clearTimeoutImpl: (handle: unknown): void => {
      const index = tasks.findIndex((task) => task.id === handle);
      if (index >= 0) tasks.splice(index, 1);
    },
    async fire(index = 0): Promise<void> {
      const [task] = tasks.splice(index, 1);
      task!.callback();
      await flush();
    },
  };
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

function okResponse(body: unknown): { ok: boolean; json(): Promise<unknown> } {
  return { ok: true, json: async () => body };
}

interface PollerHarness {
  poller: ReturnType<typeof createUpdateChannelPoller>;
  scheduler: ReturnType<typeof fakeScheduler>;
  fetchCalls: { url: string; headers: Record<string, string> }[];
  stateChanges: number;
}

function pollerHarness(input: {
  serverVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: UpdateChannelFetch;
  random?: () => number;
}): PollerHarness {
  const scheduler = fakeScheduler();
  const fetchCalls: PollerHarness["fetchCalls"] = [];
  const harness: PollerHarness = { poller: null as never, scheduler, fetchCalls, stateChanges: 0 };
  const defaultFetch: UpdateChannelFetch = async (url, init) => {
    fetchCalls.push({ url, headers: init.headers });
    return okResponse(VALID_DOCUMENT);
  };
  const recordingFetch: UpdateChannelFetch = input.fetch
    ? async (url, init) => {
        fetchCalls.push({ url, headers: init.headers });
        return input.fetch!(url, init);
      }
    : defaultFetch;
  const options: UpdateChannelPollerOptions = {
    serverVersion: input.serverVersion ?? "1.0.0",
    env: input.env ?? {},
    fetchImpl: recordingFetch,
    setTimeoutImpl: scheduler.setTimeoutImpl,
    clearTimeoutImpl: scheduler.clearTimeoutImpl,
    random: input.random ?? (() => 0),
    nowSeconds: () => NOW_SECONDS,
    onStateChange: () => {
      harness.stateChanges += 1;
    },
  };
  harness.poller = createUpdateChannelPoller(options);
  return harness;
}

const FIXTURE_URL = "http://127.0.0.1:4999/update-channel.json";

describe("poll gating (^t-bypass)", () => {
  it("a 0.0.0 (development) server never fetches — no boot poll, no timer (^dev-version-no-poll)", async () => {
    const h = pollerHarness({ serverVersion: "0.0.0" });
    h.poller.start();
    await flush();
    expect(h.fetchCalls).toEqual([]);
    expect(h.scheduler.tasks).toEqual([]);
    expect(h.poller.getState()).toBeNull();
  });

  it("TV_UPDATE_CHANNEL_URL supersedes the dev-version suppression (^hook-url-implies-polling)", async () => {
    const h = pollerHarness({
      serverVersion: "0.0.0",
      env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL },
    });
    h.poller.start();
    await flush();
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.url.startsWith(FIXTURE_URL)).toBe(true);
  });

  it("an unguarded release server polls the production channel URL", async () => {
    const h = pollerHarness({ serverVersion: "1.0.0" });
    h.poller.start();
    await flush();
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.url.startsWith("https://television.run/update-channel.json?")).toBe(true);
  });
});

describe("poll schedule and request shape (^poll-schedule, ^poll-cache-bust)", () => {
  it("polls on the specced production cadence: every 5 minutes with 0–1 min uniform jitter", () => {
    const FIVE_MINUTES_MS = Number("300000");
    const ONE_MINUTE_MS = Number("60000");
    expect(PRODUCTION_POLL_INTERVAL_MS).toBe(FIVE_MINUTES_MS);
    expect(POLL_JITTER_MAX_MS).toBe(ONE_MINUTE_MS);
  });

  it("fetches once at boot, then schedules the interval with uniform jitter", async () => {
    const h = pollerHarness({ env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL }, random: () => HALF });
    h.poller.start();
    await flush();
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.scheduler.tasks).toHaveLength(1);
    expect(h.scheduler.tasks[0]!.delayMs).toBe(PRODUCTION_POLL_INTERVAL_MS + POLL_JITTER_MAX_MS / 2);

    await h.scheduler.fire();
    expect(h.fetchCalls).toHaveLength(2);
    expect(h.scheduler.tasks).toHaveLength(1);
  });

  it("busts caches: ?t=<epoch-seconds> plus a Cache-Control: no-cache request header", async () => {
    const h = pollerHarness({ env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL } });
    h.poller.start();
    await flush();
    const call = h.fetchCalls[0]!;
    expect(new URL(call.url).searchParams.get("t")).toBe("1750000000");
    expect(call.headers["cache-control"]).toBe("no-cache");
  });

  it("honors TV_UPDATE_CHANNEL_POLL_INTERVAL_MS exactly (jitter disabled), only with the URL override (^hook-poll-interval)", async () => {
    const overridden = pollerHarness({
      env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL, TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: String(FAST_INTERVAL_MS) },
      random: () => ALMOST_ONE,
    });
    overridden.poller.start();
    await flush();
    expect(overridden.scheduler.tasks[0]!.delayMs).toBe(FAST_INTERVAL_MS);

    // Without the URL override the interval hook is inert — production
    // cadence applies (the URL-less guard here is a release server).
    const inert = pollerHarness({ env: { TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: String(FAST_INTERVAL_MS) }, random: () => 0 });
    inert.poller.start();
    await flush();
    expect(inert.scheduler.tasks[0]!.delayMs).toBe(PRODUCTION_POLL_INTERVAL_MS);
  });
});

describe("failure semantics (^t-poll-failures)", () => {
  const failureModes: { name: string; fetch: UpdateChannelFetch }[] = [
    { name: "network error", fetch: async () => { throw new Error("ECONNREFUSED"); } },
    { name: "non-200 status", fetch: async () => ({ ok: false, json: async () => VALID_DOCUMENT }) },
    { name: "malformed JSON", fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }) },
    { name: "invalid shape", fetch: async () => okResponse({ schemaVersion: 1, version: "not-a-version", toast: { markdown: "x" } }) },
  ];

  for (const mode of failureModes) {
    it(`${mode.name}: silent, keeps polling, and with no last-known-good the state is "no update"`, async () => {
      const h = pollerHarness({ env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL }, fetch: mode.fetch });
      h.poller.start();
      await flush();
      expect(h.poller.getState()).toBeNull();
      expect(h.stateChanges).toBe(0);
      // The loop is not dead: the next cycle is scheduled.
      expect(h.scheduler.tasks).toHaveLength(1);
    });
  }

  it("timeout: the in-flight fetch is aborted after the bound, silently", async () => {
    let abortedURL: string | null = null;
    const h = pollerHarness({
      env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL },
      fetch: (url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            abortedURL = url;
            reject(new Error("aborted"));
          });
        }),
    });
    h.poller.start();
    await flush();
    // The hanging fetch leaves the 10-second abort bound and no next-cycle
    // task (the next cycle is scheduled only after the fetch settles).
    expect(h.scheduler.tasks).toHaveLength(1);
    expect(h.scheduler.tasks[0]!.delayMs).toBe(FETCH_TIMEOUT_MS);
    await h.scheduler.fire(); // the abort bound
    expect(abortedURL).not.toBeNull();
    expect(h.poller.getState()).toBeNull();
    expect(h.stateChanges).toBe(0);
    expect(h.scheduler.tasks).toHaveLength(1); // next cycle scheduled after settle
  });

  it("a failure after a good poll leaves the last-known-good state intact, in memory only", async () => {
    let mode: "good" | "fail" = "good";
    const h = pollerHarness({
      env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL },
      fetch: async () => {
        if (mode === "fail") throw new Error("network down");
        return okResponse(VALID_DOCUMENT);
      },
    });
    h.poller.start();
    await flush();
    expect(h.poller.getState()!.toast!.version).toBe("2.0.0");
    expect(h.stateChanges).toBe(1);

    mode = "fail";
    await h.scheduler.fire();
    expect(h.poller.getState()!.toast!.version).toBe("2.0.0");
    expect(h.stateChanges).toBe(1);
  });
});

describe("state adoption and change notification (^relay)", () => {
  it("notifies on the first valid document, not on an identical re-fetch, again on a different one", async () => {
    let body: unknown = VALID_DOCUMENT;
    const h = pollerHarness({ env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL }, fetch: async () => okResponse(body) });
    h.poller.start();
    await flush();
    expect(h.stateChanges).toBe(1);

    await h.scheduler.fire();
    expect(h.stateChanges).toBe(1); // identical document: no change

    body = { ...VALID_DOCUMENT, version: "3.0.0" };
    await h.scheduler.fire();
    expect(h.stateChanges).toBe(2);
    expect(h.poller.getState()!.toast!.version).toBe("3.0.0");
  });

  it("stop() clears the pending timer and aborts an in-flight fetch", async () => {
    const aborted = vi.fn();
    let hang = false;
    const h = pollerHarness({
      env: { TV_UPDATE_CHANNEL_URL: FIXTURE_URL },
      fetch: (url, init) => {
        if (!hang) return Promise.resolve(okResponse(VALID_DOCUMENT));
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            aborted();
            reject(new Error("aborted"));
          });
        });
      },
    });
    h.poller.start();
    await flush();
    expect(h.scheduler.tasks).toHaveLength(1); // next cycle pending

    hang = true;
    await h.scheduler.fire(); // starts the hanging fetch; abort bound now pending
    h.poller.stop();
    await flush();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(h.scheduler.tasks).toEqual([]); // nothing left ticking
  });
});
