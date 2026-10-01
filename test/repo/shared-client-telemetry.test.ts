import { afterEach, describe, expect, it, vi } from "vitest";
import { TelevisionClient, TELEVISION_CLIENT_META_HEADER, type ClientTelemetryMeta } from "@telepath-computer/television-shared";

const SERVER_URL = "http://television.test";
const CLIENT_META: ClientTelemetryMeta = {
  clientId: "client-shared-http",
  userAgent: "TestBrowser/123",
  clientApp: "browser",
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("shared TelevisionClient telemetry metadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches X-Television-Client-Meta to every HTTP verb when configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/channels")) return jsonResponse({ channels: [] });
      if (url.endsWith("/artifacts/artifact-1")) return jsonResponse({ outcome: "deleted", kind: "path", artifactID: "artifact-1", path: "/tmp/a.md" });
      if (url.endsWith("/display")) return new Response(null, { status: 204 });
      if (url.endsWith("/markdown/artifact-1")) return new Response(null, { status: 204 });
      return jsonResponse({ channel: { id: "screen-1", name: "Screen", layout: [] } });
    });
    const client = new TelevisionClient(SERVER_URL, { telemetryMeta: CLIENT_META });

    await client.channels.list();
    await client.channels.create({ name: "Private" });
    await client.display.patch({ focusedChannelId: null });
    await client.markdown.update({ artifactID: "artifact-1", content: "# private" });
    await client.artifacts.delete({ artifactID: "artifact-1" });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers).toMatchObject({
        [TELEVISION_CLIENT_META_HEADER]: JSON.stringify(CLIENT_META),
      });
    }
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["GET", "POST", "PATCH", "PUT", "DELETE"]);
  });

  it("omits the telemetry metadata header for default CLI-style clients", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ channels: [] }));
    const client = new TelevisionClient(SERVER_URL);

    await client.channels.list();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toBeUndefined();
  });

  it("exposes telemetry status and control endpoints", async () => {
    const statusPayload = { state: "active", reason: null, guidPresent: true, region: "us" };
    const disabledPayload = { state: "opted-out", reason: null, guidPresent: true, region: "us" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/telemetry") && init?.method === "GET") return jsonResponse(statusPayload);
      if (url.endsWith("/telemetry/disable") && init?.method === "POST") return jsonResponse(disabledPayload);
      if (url.endsWith("/telemetry/enable") && init?.method === "POST") return jsonResponse(statusPayload);
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
    });
    const client = new TelevisionClient(SERVER_URL, { token: "secret" });

    await expect(client.telemetry.status()).resolves.toEqual(statusPayload);
    await expect(client.telemetry.disable()).resolves.toEqual(disabledPayload);
    await expect(client.telemetry.enable()).resolves.toEqual(statusPayload);

    expect(fetchMock.mock.calls.map((call) => [String(call[0]), (call[1] as RequestInit).method])).toEqual([
      [`${SERVER_URL}/telemetry`, "GET"],
      [`${SERVER_URL}/telemetry/disable`, "POST"],
      [`${SERVER_URL}/telemetry/enable`, "POST"],
    ]);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret" });
    }
  });
});
