import { describe, expect, it, vi } from "vitest";
import { preflightConnection } from "../src/connect-preflight.ts";

const serverURL = "http://127.0.0.1:32848";
const desktopAppVersion = "0.1.207+desktop"; // Non-triple on purpose: proves URL encoding.
const markerBody = { product: "television" };

function mockJSONFetch(status: number, body: unknown = markerBody): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

async function check(fetchImpl: typeof fetch, token = "") {
  return preflightConnection({
    serverURL,
    token,
    desktopAppVersion,
    fetchImpl,
  });
}

const rejectedResponses: Array<[string, () => typeof fetch]> = [
  ["a non-200 success status", () => mockJSONFetch(201)],
  ["a 404 from a server without the route", () => mockJSONFetch(404, { error: "Not found" })],
  ["a 500 server error", () => mockJSONFetch(500, { error: "Internal server error" })],
  ["non-JSON", () => vi.fn(async () => new Response("<!doctype html>", { status: 200 })) as typeof fetch],
  ["null", () => mockJSONFetch(200, null)],
  ["an array", () => mockJSONFetch(200, [{ product: "television" }])],
  ["a primitive", () => mockJSONFetch(200, "television")],
  ["a missing marker", () => mockJSONFetch(200, { future: true })],
  ["a wrong marker", () => mockJSONFetch(200, { product: "other" })],
];

// Spec: ^updates-t-connect-check-reader-contract
describe("preflightConnection desktop connect check", () => {
  it("sends one encoded connect-check GET with a bearer token and accepts the minimum marker", async () => {
    const fetchImpl = mockJSONFetch(200);

    await expect(check(fetchImpl, "good")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:32848/desktop/connect-check?desktopAppVersion=0.1.207%2Bdesktop",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer good" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("omits authorization for an empty token and tolerates unknown response members", async () => {
    const fetchImpl = mockJSONFetch(200, { product: "television", future: { tolerated: true } });

    await expect(check(fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:32848/desktop/connect-check?desktopAppVersion=0.1.207%2Bdesktop",
      expect.objectContaining({ headers: {}, signal: expect.any(AbortSignal) }),
    );
  });

  it("returns unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const result = await check(fetchImpl);
    expect(result).toEqual({
      ok: false,
      code: "unreachable",
      message: `Couldn't reach ${serverURL} — is the server running?`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns unreachable when the connect check times out", async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
      });
    }) as typeof fetch;

    const result = await preflightConnection({
      serverURL,
      token: "",
      desktopAppVersion,
      fetchImpl,
      timeoutMs: 1,
    });

    expect(result).toEqual({
      ok: false,
      code: "unreachable",
      message: `Couldn't reach ${serverURL} — is the server running?`,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns auth-required on 401 with an empty token", async () => {
    const fetchImpl = mockJSONFetch(401, { error: "Unauthorized" });
    await expect(check(fetchImpl)).resolves.toEqual({
      ok: false,
      code: "auth-required",
      message: "This server requires a token",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns auth-rejected on 401 with a token", async () => {
    const fetchImpl = mockJSONFetch(401, { error: "Unauthorized" });
    await expect(check(fetchImpl, "bad")).resolves.toEqual({
      ok: false,
      code: "auth-rejected",
      message: "Token rejected",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(rejectedResponses)("returns not-tv-server for %s without falling back to /display", async (_label, makeFetch) => {
    const fetchImpl = makeFetch();

    await expect(check(fetchImpl)).resolves.toEqual({
      ok: false,
      code: "not-tv-server",
      message: "This URL doesn't seem to be a Television server — please check it.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestedURL = String(vi.mocked(fetchImpl).mock.calls[0]![0]);
    expect(new URL(requestedURL).pathname).toBe("/desktop/connect-check");
    expect(requestedURL).not.toContain("/display");
  });
});
