import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectTelemetryDeveloperHost, POSTHOG_PRODUCTION_PROJECT, POSTHOG_TEST_PROJECT, resolvePostHogProject, resolveTelemetryDeveloperHome } from "./posthog-config.ts";
import { createPostHogTransport, createTelemetrySink, type TelemetryTransport } from "./sink.ts";
import type { BuiltTelemetryEvent } from "./types.ts";

const CONFIGURED_TIMEOUT_MS = 250;
const DEFAULT_TIMEOUT_MS = 10_000;

function event(name: BuiltTelemetryEvent["name"], distinctId = "telemetry-user"): BuiltTelemetryEvent {
  return {
    name,
    distinctId,
    properties: { distinct_id: distinctId },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("telemetry PostHog transport", () => {
  it("resolves only permitted destinations under the four rules", () => {
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", "production");
    expect(resolvePostHogProject({}, { developerHost: false })).toBe(POSTHOG_PRODUCTION_PROJECT);
    expect(resolvePostHogProject({}, { developerHost: true })).toBeNull();
    expect(resolvePostHogProject({ TV_TELEMETRY_TEST: "true" }, { developerHost: true })).toBe(POSTHOG_TEST_PROJECT);
    expect(resolvePostHogProject({ TV_TELEMETRY_TEST: "1", CI: "1" })).toBeNull();
    expect(resolvePostHogProject({ TV_TELEMETRY_TEST: "1", DO_NOT_TRACK: "1" })).toBeNull();
    expect(resolvePostHogProject({ TV_TELEMETRY_TEST: "1" }, { optedOut: true })).toBeNull();
    vi.stubGlobal("__TV_TELEMETRY_BUILD__", undefined);
    expect(resolvePostHogProject({})).toBeNull();
    expect(resolvePostHogProject({ TV_TELEMETRY_TEST: "1" })).toBe(POSTHOG_TEST_PROJECT);
  });

  it("detects the developer-host marker under an explicit telemetry developer home", () => {
    const markedHome = mkdtempSync(path.join(os.tmpdir(), "television-developer-host-"));
    const otherHome = mkdtempSync(path.join(os.tmpdir(), "television-other-host-"));
    try {
      expect(resolveTelemetryDeveloperHome({ TELEVISION_DEVELOPER_HOME: markedHome })).toBe(markedHome);
      expect(detectTelemetryDeveloperHost(markedHome)).toBe(false);
      writeFileSync(path.join(markedHome, ".tv-developer"), "", "utf8");
      expect(detectTelemetryDeveloperHost(markedHome)).toBe(true);
      expect(detectTelemetryDeveloperHost(otherHome)).toBe(false);
    } finally {
      rmSync(markedHome, { recursive: true, force: true });
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it.each([
    ["configured", CONFIGURED_TIMEOUT_MS],
    ["default", DEFAULT_TIMEOUT_MS],
  ])("aborts a pending send at the %s timeout", async (kind, expectedTimeoutMs) => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const transport = createPostHogTransport({
      ...(kind === "configured" ? { timeoutMs: expectedTimeoutMs } : {}),
      fetchImpl: async (_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error("expected an abort signal");
        requestSignal = signal;
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    const send = transport.send(event("server_started"));
    const rejection = expect(send).rejects.toThrow(`PostHog capture timed out after ${expectedTimeoutMs}ms`);
    await vi.advanceTimersByTimeAsync(expectedTimeoutMs - 1);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it.each([
    ["default production project", undefined, POSTHOG_PRODUCTION_PROJECT],
    ["explicit test project", POSTHOG_TEST_PROJECT, POSTHOG_TEST_PROJECT],
  ])("uses the %s", async (_name, project, expectedProject) => {
    const requests: Array<{ url: string; body: { api_key?: string } }> = [];
    const transport = createPostHogTransport({
      ...(project === undefined ? {} : { project }),
      timeoutMs: 0,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as { api_key?: string } });
        return new Response(null, { status: 200 });
      },
    });

    await transport.send(event("server_started"));

    expect(requests).toEqual([
      {
        url: new URL("/capture/", expectedProject.ingestionHost).toString(),
        body: expect.objectContaining({ api_key: expectedProject.projectToken, properties: expect.objectContaining({ $ip: "0.0.0.0", $geoip_disable: true }) }) as { api_key?: string },
      },
    ]);
  });
});

// proofs/arch/telemetry/sink.md#^t-transport-privacy
it("overrides supplied privacy fields and sends no forwarding headers", async () => {
  const built = event("server_started");
  Object.assign(built.properties, { $ip: "192.0.2.1", $geoip_disable: false });
  const requests: RequestInit[] = [];
  const transport = createPostHogTransport({ fetchImpl: async (_url, init) => {
    requests.push(init!);
    return new Response(null, { status: 200 });
  } });
  await transport.send(built);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(String(requests[0]!.body)).properties).toEqual({ ...built.properties, $ip: "0.0.0.0", $geoip_disable: true });
});

describe("telemetry sink buffer", () => {
  it("keeps memory bounded and drops the oldest events on overflow", async () => {
    const sent: BuiltTelemetryEvent[] = [];
    const transport: TelemetryTransport = { send: async (built) => { sent.push(built); } };
    const sink = createTelemetrySink({ transport, maxBufferSize: 2, autoFlush: false });

    expect(() => {
      sink.enqueue(event("server_installed"));
      sink.enqueue(event("server_started"));
      sink.enqueue(event("server_upgraded"));
    }).not.toThrow();

    expect(sink.pendingCount()).toBe(2);
    await sink.flush();
    expect(sent.map((built) => built.name)).toEqual(["server_started", "server_upgraded"]);
  });

  it("swallows transport failures from enqueue, flush, and shutdown", async () => {
    let shutdownCalls = 0;
    const transport: TelemetryTransport = {
      send: async () => {
        throw new Error("offline");
      },
      shutdown: async () => {
        shutdownCalls += 1;
        throw new Error("shutdown failed");
      },
    };
    const sink = createTelemetrySink({ transport, maxBufferSize: 4, autoFlush: false });

    expect(() => sink.enqueue(event("server_started"))).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
    await expect(sink.shutdown()).resolves.toBeUndefined();
    expect(shutdownCalls).toBe(1);
    expect(sink.pendingCount()).toBe(1);
  });

  it("flushes queued offline events after the transport becomes reachable", async () => {
    const sent: BuiltTelemetryEvent[] = [];
    let online = false;
    const transport: TelemetryTransport = {
      send: async (built) => {
        if (!online) throw new Error("offline");
        sent.push(built);
      },
    };
    const sink = createTelemetrySink({ transport, maxBufferSize: 4, autoFlush: false });

    sink.enqueue(event("server_installed"));
    sink.enqueue(event("server_started"));
    await sink.flush();
    expect(sent).toEqual([]);
    expect(sink.pendingCount()).toBe(2);

    online = true;
    await sink.flush();

    expect(sent.map((built) => built.name)).toEqual(["server_installed", "server_started"]);
    expect(sink.pendingCount()).toBe(0);
  });
});
