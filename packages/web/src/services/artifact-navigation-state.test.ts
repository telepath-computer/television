// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactNavigationState,
  artifactNavigationStorageKey,
  pruneStaleNavigationHistory,
  convertURL,
  type ArtifactNavigationRecord,
} from "./artifact-navigation-state.ts";

const artifactId = "01HISTORYTESTARTIFACT000000000";
const storageKey = artifactNavigationStorageKey(artifactId);
const historyLimit = 100;
const overflowEntryCount = historyLimit + 1;
const lastIndexAfterCap = historyLimit - 1;
const hydratedCursor = historyLimit / 2;
const expectedCursorAfterHydratedTrim = hydratedCursor - 1;
const firstTimestamp = 1_000;
const secondTimestamp = 2_000;
const thirdTimestamp = 3_000;
const fourthTimestamp = 4_000;
const fifthTimestamp = 5_000;
const invalidVersion = 2;
const numericURL = 123;
const invalidCursor = 5;
const millisecondsPerSecond = 1000;
const secondsPerMinute = 60;
const minutesPerHour = 60;
const hoursPerDay = 24;
const staleAgeDays = 31;
const freshAgeDays = 1;
const millisecondsPerDay = hoursPerDay * minutesPerHour * secondsPerMinute * millisecondsPerSecond;
const staleTimestamp = Date.now() - staleAgeDays * millisecondsPerDay;
const freshTimestamp = Date.now() - freshAgeDays * millisecondsPerDay;

function readRecord(id = artifactId): ArtifactNavigationRecord {
  const raw = localStorage.getItem(artifactNavigationStorageKey(id));
  if (raw === null) throw new Error("missing navigation record");
  return JSON.parse(raw) as ArtifactNavigationRecord;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

function writeRecord(id: string, lastWritten: number): void {
  localStorage.setItem(
    artifactNavigationStorageKey(id),
    JSON.stringify({
      v: 1,
      entries: [{ url: `/artifact/${id}/page.html` }],
      cursor: 0,
      lastWritten,
    } satisfies ArtifactNavigationRecord),
  );
}

describe("ArtifactNavigationState", () => {
  it("starts at the canonical URL with empty history", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

    expect(state.currentURL).toBeNull();
    expect(state.cursor).toBe(-1);
    expect(state.entries).toEqual([]);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("navigate(url) appends an entry, moves the cursor to the end, and persists", () => {
    vi.useFakeTimers();
    vi.setSystemTime(firstTimestamp);
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    const listener = vi.fn();
    state.addEventListener("change", listener);

    state.navigate("/artifact/abc/page2.html");

    expect(state.currentURL).toBe("/artifact/abc/page2.html");
    expect(state.cursor).toBe(0);
    expect(state.entries).toEqual([{ url: "/artifact/abc/page2.html" }]);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(false);
    expect(readRecord()).toEqual({
      v: 1,
      entries: [{ url: "/artifact/abc/page2.html" }],
      cursor: 0,
      lastWritten: firstTimestamp,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("navigate after back discards forward entries and appends at cursor + 1", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");
    state.navigate("/artifact/abc/page2.html");
    state.navigate("/artifact/abc/page3.html");
    state.back();

    state.navigate("/artifact/abc/replacement.html");

    expect(state.entries).toEqual([
      { url: "/artifact/abc/page1.html" },
      { url: "/artifact/abc/page2.html" },
      { url: "/artifact/abc/replacement.html" },
    ]);
    expect(state.cursor).toBe(2);
    expect(state.currentURL).toBe("/artifact/abc/replacement.html");
    expect(state.canGoForward).toBe(false);
  });

  it("navigate from canonical discards existing forward history", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");
    state.navigate("/artifact/abc/page2.html");
    state.back();
    state.back();

    state.navigate("/artifact/abc/page3.html");

    expect(state.entries).toEqual([{ url: "/artifact/abc/page3.html" }]);
    expect(state.cursor).toBe(0);
    expect(state.currentURL).toBe("/artifact/abc/page3.html");
    expect(state.canGoForward).toBe(false);
  });

  it("back() decrements the cursor and returns from entry 0 to canonical", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    const listener = vi.fn();
    state.navigate("/artifact/abc/page1.html");
    state.navigate("/artifact/abc/page2.html");
    state.addEventListener("change", listener);

    state.back();
    expect(state.cursor).toBe(0);
    expect(state.currentURL).toBe("/artifact/abc/page1.html");
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(true);

    state.back();
    expect(state.cursor).toBe(-1);
    expect(state.currentURL).toBeNull();
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(true);

    state.back();
    expect(state.cursor).toBe(-1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("forward() increments the cursor and no-ops at the end", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");
    state.navigate("/artifact/abc/page2.html");
    state.back();
    state.back();
    const listener = vi.fn();
    state.addEventListener("change", listener);

    state.forward();
    expect(state.cursor).toBe(0);
    expect(state.currentURL).toBe("/artifact/abc/page1.html");

    state.forward();
    expect(state.cursor).toBe(1);
    expect(state.currentURL).toBe("/artifact/abc/page2.html");
    expect(state.canGoForward).toBe(false);

    state.forward();
    expect(state.cursor).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("navigate(canonicalURL) resets to canonical without appending", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");
    const listener = vi.fn();
    state.addEventListener("change", listener);

    state.navigate("/artifact/abc/");

    expect(state.cursor).toBe(-1);
    expect(state.currentURL).toBeNull();
    expect(state.entries).toEqual([{ url: "/artifact/abc/page1.html" }]);
    expect(listener).toHaveBeenCalledTimes(1);

    state.navigate("/artifact/abc/");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("replace(url) replaces the current entry without appending or discarding forward entries", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");
    state.navigate("/artifact/abc/page2.html");
    state.navigate("/artifact/abc/page3.html");
    state.back();

    state.replace("/artifact/abc/replaced.html");

    expect(state.entries).toEqual([
      { url: "/artifact/abc/page1.html" },
      { url: "/artifact/abc/replaced.html" },
      { url: "/artifact/abc/page3.html" },
    ]);
    expect(state.cursor).toBe(1);
    expect(state.currentURL).toBe("/artifact/abc/replaced.html");
    expect(state.canGoForward).toBe(true);
  });

  it("replace(url) at canonical behaves like navigate(url)", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

    state.replace("/artifact/abc/page1.html");

    expect(state.entries).toEqual([{ url: "/artifact/abc/page1.html" }]);
    expect(state.cursor).toBe(0);
    expect(state.currentURL).toBe("/artifact/abc/page1.html");
  });

  it("replace(canonicalURL) resets to canonical and removes the current entry", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");
    state.navigate("/artifact/abc/page2.html");
    state.navigate("/artifact/abc/page3.html");
    state.back();

    state.replace("/artifact/abc/");

    expect(state.cursor).toBe(-1);
    expect(state.currentURL).toBeNull();
    expect(state.entries).toEqual([
      { url: "/artifact/abc/page1.html" },
      { url: "/artifact/abc/page3.html" },
    ]);
    expect(state.canGoForward).toBe(true);
  });

  it("caps history at 100 entries by evicting the oldest entry", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

    for (let i = 0; i < overflowEntryCount; i += 1) {
      state.navigate(`/artifact/abc/page${i}.html`);
    }

    expect(state.entries).toHaveLength(historyLimit);
    expect(state.entries[0]).toEqual({ url: "/artifact/abc/page1.html" });
    expect(state.entries[lastIndexAfterCap]).toEqual({ url: "/artifact/abc/page100.html" });
    expect(state.cursor).toBe(lastIndexAfterCap);
    expect(state.currentURL).toBe("/artifact/abc/page100.html");
  });

  it("normalizes oversized hydrated history and adjusts a mid-history cursor", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 1,
        entries: Array.from({ length: overflowEntryCount }, (_, index) => ({
          url: `/artifact/abc/page${index}.html`,
        })),
        cursor: hydratedCursor,
        lastWritten: 123,
      } satisfies ArtifactNavigationRecord),
    );

    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

    expect(state.entries).toHaveLength(historyLimit);
    expect(state.entries[0]).toEqual({ url: "/artifact/abc/page1.html" });
    expect(state.cursor).toBe(expectedCursorAfterHydratedTrim);
    expect(state.currentURL).toBe("/artifact/abc/page50.html");
  });

  it("hydrates entries and cursor from localStorage", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 1,
        entries: [{ url: "/artifact/abc/page1.html" }, { url: "https://example.com" }],
        cursor: 1,
        lastWritten: 123,
      } satisfies ArtifactNavigationRecord),
    );

    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

    expect(state.entries).toEqual([
      { url: "/artifact/abc/page1.html" },
      { url: "https://example.com" },
    ]);
    expect(state.cursor).toBe(1);
    expect(state.currentURL).toBe("https://example.com");
  });

  it("recovers from malformed localStorage JSON without throwing", () => {
    localStorage.setItem(storageKey, "not json");
    let state!: ArtifactNavigationState;

    expect(() => {
      state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    }).not.toThrow();

    expect(state.entries).toEqual([]);
    expect(state.cursor).toBe(-1);
    expect(state.currentURL).toBeNull();
  });

  it("recovers from structurally invalid localStorage JSON without throwing", () => {
    const invalidRecords = [
      { v: invalidVersion, entries: [], cursor: -1, lastWritten: 0 },
      { v: 1, entries: "string", cursor: -1, lastWritten: 0 },
      { v: 1, entries: [{ url: numericURL }], cursor: 0, lastWritten: 0 },
      { v: 1, entries: [], cursor: invalidCursor, lastWritten: 0 },
    ];

    for (const record of invalidRecords) {
      localStorage.setItem(storageKey, JSON.stringify(record));
      const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

      expect(state.entries).toEqual([]);
      expect(state.cursor).toBe(-1);
      expect(state.currentURL).toBeNull();
    }
  });

  it("keeps in-memory state usable and dispatches change when persistence quota is exceeded", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    const listener = vi.fn();
    state.addEventListener("change", listener);

    expect(() => state.navigate("/artifact/abc/page1.html")).not.toThrow();

    expect(state.currentURL).toBe("/artifact/abc/page1.html");
    expect(state.entries).toEqual([{ url: "/artifact/abc/page1.html" }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(storageKey, expect.any(String));
  });

  it("updates lastWritten on navigate, replace, back, forward, and reset mutations", () => {
    vi.useFakeTimers();
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");

    vi.setSystemTime(firstTimestamp);
    state.navigate("/artifact/abc/page1.html");
    expect(readRecord().lastWritten).toBe(firstTimestamp);

    vi.setSystemTime(secondTimestamp);
    state.replace("/artifact/abc/page1b.html");
    expect(readRecord().lastWritten).toBe(secondTimestamp);

    vi.setSystemTime(thirdTimestamp);
    state.back();
    expect(readRecord().lastWritten).toBe(thirdTimestamp);

    vi.setSystemTime(fourthTimestamp);
    state.forward();
    expect(readRecord().lastWritten).toBe(fourthTimestamp);

    vi.setSystemTime(fifthTimestamp);
    state.reset();
    expect(readRecord()).toEqual({
      v: 1,
      entries: [],
      cursor: -1,
      lastWritten: fifthTimestamp,
    });
  });

  it("dispatches change only for actual state transitions", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    const listener = vi.fn();
    state.addEventListener("change", listener);

    state.back();
    state.forward();
    state.navigate("/artifact/abc/");
    state.reset();
    expect(listener).not.toHaveBeenCalled();

    state.navigate("/artifact/abc/page1.html");
    state.replace("/artifact/abc/page1.html");
    state.forward();
    expect(listener).toHaveBeenCalledTimes(1);

    state.navigate("/artifact/abc/");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns defensive entry snapshots", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    state.navigate("/artifact/abc/page1.html");

    const entries = state.entries as Array<{ url: string }>;
    entries[0].url = "/mutated.html";
    entries.push({ url: "/pushed.html" });

    expect(state.entries).toEqual([{ url: "/artifact/abc/page1.html" }]);
    expect(state.currentURL).toBe("/artifact/abc/page1.html");
  });
});

describe("pruneStaleNavigationHistory", () => {
  it("deletes history for unknown artifacts older than thirty days", () => {
    writeRecord("unknown", staleTimestamp);

    pruneStaleNavigationHistory(new Set([artifactId]));

    expect(localStorage.getItem(artifactNavigationStorageKey("unknown"))).toBeNull();
  });

  it("keeps history for known artifacts regardless of age", () => {
    writeRecord(artifactId, staleTimestamp);

    pruneStaleNavigationHistory(new Set([artifactId]));

    expect(localStorage.getItem(artifactNavigationStorageKey(artifactId))).not.toBeNull();
  });

  it("keeps history for unknown artifacts written less than thirty days ago", () => {
    writeRecord("unknown-fresh", freshTimestamp);

    pruneStaleNavigationHistory(new Set([artifactId]));

    expect(localStorage.getItem(artifactNavigationStorageKey("unknown-fresh"))).not.toBeNull();
  });

  it("deletes malformed navigation records without throwing", () => {
    localStorage.setItem(artifactNavigationStorageKey("malformed"), "not json");
    localStorage.setItem(
      artifactNavigationStorageKey("invalid"),
      JSON.stringify({ v: 1, entries: [{ url: numericURL }], cursor: 0, lastWritten: staleTimestamp }),
    );

    expect(() => pruneStaleNavigationHistory(new Set([artifactId]))).not.toThrow();

    expect(localStorage.getItem(artifactNavigationStorageKey("malformed"))).toBeNull();
    expect(localStorage.getItem(artifactNavigationStorageKey("invalid"))).toBeNull();
  });

  it("deletes navigation records with non-finite lastWritten values", () => {
    localStorage.setItem(
      artifactNavigationStorageKey("infinite"),
      '{"v":1,"entries":[{"url":"/artifact/infinite/page.html"}],"cursor":0,"lastWritten":1e999}',
    );

    pruneStaleNavigationHistory(new Set([artifactId]));

    expect(localStorage.getItem(artifactNavigationStorageKey("infinite"))).toBeNull();
  });
});

describe("convertURL", () => {
  it("converts same-origin absolute URLs to path, search, and hash", () => {
    const absolute = new URL("/artifact/abc/page2.html?x=1#section", window.location.href)
      .href;

    expect(convertURL(absolute)).toBe("/artifact/abc/page2.html?x=1#section");
  });

  it("preserves external absolute URLs as-is", () => {
    expect(convertURL("https://example.com")).toBe("https://example.com");
    expect(convertURL("https://example.com/page?x=1#hash")).toBe(
      "https://example.com/page?x=1#hash",
    );
  });

  it("strips the proxy reload cache-buster while preserving other URL parts", () => {
    expect(convertURL("/artifact/abc/page2.html?tv-reload=1&x=1#section")).toBe(
      "/artifact/abc/page2.html?x=1#section",
    );
    expect(convertURL("https://example.com/page2.html?tv-reload=2&x=1#section")).toBe(
      "https://example.com/page2.html?x=1#section",
    );
  });

  it("converts relative URLs against the current document location", () => {
    window.history.replaceState(null, "", "/artifact/abc/index.html");

    expect(convertURL("page2.html?x=1#section")).toBe(
      "/artifact/abc/page2.html?x=1#section",
    );
  });

  it("normalizes navigate(url) through convertURL", () => {
    const state = new ArtifactNavigationState(artifactId, "/artifact/abc/");
    const internalAbsolute = new URL("/artifact/abc/page2.html", window.location.href).href;

    state.navigate(internalAbsolute);
    expect(state.currentURL).toBe("/artifact/abc/page2.html");

    state.navigate("https://example.com");
    expect(state.currentURL).toBe("https://example.com");
  });
});
