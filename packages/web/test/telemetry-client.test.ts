import { beforeEach, describe, expect, it, vi } from "vitest";
import { TELEMETRY_ACTIVITY_MESSAGE_TYPE } from "@telepath-computer/television-shared";
import {
  ACTIVITY_DEBOUNCE_MS,
  CLIENT_ID_KEY,
  buildClientTelemetryMeta,
  createTelemetryActivityAgent,
  encodeClientTelemetryMetaSearchParams,
  getOrCreateTelemetryClientId,
} from "../src/services/telemetry-client.ts";

const FIRST_CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const USER_AGENT = "Mozilla/5.0 TestBrowser/123";
const DESKTOP_VERSION = "0.1.170";
const ONE_MS = 1;

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeEventTarget {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }
}

class FakeDocument extends FakeEventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

function makeIdFactory(ids: string[]): () => string {
  return () => ids.shift() ?? "33333333-3333-4333-8333-333333333333";
}

describe("web telemetry client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it("mints, persists, reloads, and re-mints the client id when storage is absent", () => {
    const storage = new MemoryStorage();
    const idFactory = makeIdFactory([FIRST_CLIENT_ID, SECOND_CLIENT_ID]);

    expect(getOrCreateTelemetryClientId(storage, idFactory)).toBe(FIRST_CLIENT_ID);
    expect(storage.getItem(CLIENT_ID_KEY)).toBe(FIRST_CLIENT_ID);
    expect(getOrCreateTelemetryClientId(storage, idFactory)).toBe(FIRST_CLIENT_ID);

    storage.removeItem(CLIENT_ID_KEY);
    expect(getOrCreateTelemetryClientId(storage, idFactory)).toBe(SECOND_CLIENT_ID);
    expect(storage.getItem(CLIENT_ID_KEY)).toBe(SECOND_CLIENT_ID);
  });

  it("builds the standard metadata and websocket query params from one helper", () => {
    const storage = new MemoryStorage();
    const meta = buildClientTelemetryMeta({
      storage,
      clientApp: "desktop",
      desktopAppVersion: DESKTOP_VERSION,
      userAgent: USER_AGENT,
      idFactory: () => FIRST_CLIENT_ID,
    });

    expect(meta).toEqual({
      clientId: FIRST_CLIENT_ID,
      userAgent: USER_AGENT,
      clientApp: "desktop",
      desktopAppVersion: DESKTOP_VERSION,
    });
    const params = encodeClientTelemetryMetaSearchParams(meta);
    expect(params.get("clientId")).toBe(FIRST_CLIENT_ID);
    expect(params.get("userAgent")).toBe(USER_AGENT);
    expect(params.get("clientApp")).toBe("desktop");
    expect(params.get("desktopAppVersion")).toBe(DESKTOP_VERSION);
  });

  it.each([
    ["visibility", (documentTarget: FakeDocument, _windowTarget: FakeEventTarget) => {
      documentTarget.visibilityState = "hidden";
      documentTarget.visibilityState = "visible";
      documentTarget.emit("visibilitychange");
    }],
    ["focus", (_documentTarget: FakeDocument, windowTarget: FakeEventTarget) => windowTarget.emit("focus")],
    ["pointer", (_documentTarget: FakeDocument, windowTarget: FakeEventTarget) => windowTarget.emit("pointerdown")],
    ["scroll", (_documentTarget: FakeDocument, windowTarget: FakeEventTarget) => windowTarget.emit("scroll")],
    ["key", (_documentTarget: FakeDocument, windowTarget: FakeEventTarget) => windowTarget.emit("keydown")],
  ] as const)("sends content-free activity on %s engagement", (_name, engage) => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeEventTarget();
    const sent: unknown[] = [];
    const agent = createTelemetryActivityAgent({
      meta: { clientId: FIRST_CLIENT_ID, userAgent: USER_AGENT, clientApp: "browser" },
      documentTarget,
      windowTarget,
      send: (signal) => sent.push(signal),
    });

    agent.start();
    engage(documentTarget, windowTarget);
    expect(sent).toEqual([{ type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: FIRST_CLIENT_ID }]);
    agent.stop();
  });

  it("debounces activity to five minutes and removes listeners when stopped", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeEventTarget();
    const sent: unknown[] = [];
    const agent = createTelemetryActivityAgent({
      meta: { clientId: FIRST_CLIENT_ID, userAgent: USER_AGENT, clientApp: "browser" },
      documentTarget,
      windowTarget,
      send: (signal) => sent.push(signal),
    });

    agent.start();
    windowTarget.emit("scroll");
    expect(sent).toEqual([{ type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: FIRST_CLIENT_ID }]);

    vi.advanceTimersByTime(ACTIVITY_DEBOUNCE_MS - ONE_MS);
    windowTarget.emit("scroll");
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(ONE_MS);
    windowTarget.emit("scroll");
    expect(sent).toHaveLength(2);
    expect(Object.keys(sent[1] as Record<string, unknown>).sort()).toEqual(["clientId", "type"]);

    agent.stop();
    vi.advanceTimersByTime(ACTIVITY_DEBOUNCE_MS);
    windowTarget.emit("scroll");
    expect(sent).toHaveLength(2);
  });

  it("stays silent while backgrounded and does not read any server telemetry setting", () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeEventTarget();
    const sent: unknown[] = [];
    const agent = createTelemetryActivityAgent({
      meta: { clientId: FIRST_CLIENT_ID, userAgent: USER_AGENT, clientApp: "browser" },
      documentTarget,
      windowTarget,
      send: (signal) => sent.push(signal),
    });

    agent.start();
    documentTarget.visibilityState = "hidden";
    windowTarget.emit("pointerdown");
    windowTarget.emit("keydown");
    expect(sent).toEqual([]);

    documentTarget.visibilityState = "visible";
    documentTarget.emit("visibilitychange");
    expect(sent).toEqual([{ type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: FIRST_CLIENT_ID }]);
    expect(agent).not.toHaveProperty("telemetryEnabled");
  });
});
