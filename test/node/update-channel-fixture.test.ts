import { afterEach, describe, expect, it } from "vitest";
import {
  startUpdateChannelFixture,
  type UpdateChannelFixtureServer,
} from "../helpers/update-channel-fixture.ts";

// Smoke test for the request-recording update-channel fixture server — the
// harness helper behind the channel acceptance criteria
// (specs/product/update-notifications.md, staged via TV_UPDATE_CHANNEL_URL per
// specs/arch/updates/update-channel.md Test hooks). It serves an authored
// channel document over real HTTP, records the request URLs and headers the
// server-under-test sends, and can swap the response mid-test.

const CHANNEL_DOCUMENT = {
  schemaVersion: 1,
  version: "0.2.0",
  toast: { markdown: "A new release is out." },
};

describe("update-channel fixture server", () => {
  let fixture: UpdateChannelFixtureServer | undefined;

  afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
  });

  it("serves the authored document as JSON over real HTTP", async () => {
    fixture = await startUpdateChannelFixture(CHANNEL_DOCUMENT);
    const response = await fetch(fixture.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(CHANNEL_DOCUMENT);
  });

  it("records request URLs (including query) and headers", async () => {
    fixture = await startUpdateChannelFixture(CHANNEL_DOCUMENT);
    await fetch(`${fixture.url}?t=1234`, { headers: { "cache-control": "no-cache" } });
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]!.url).toContain("?t=1234");
    expect(fixture.requests[0]!.headers["cache-control"]).toBe("no-cache");
  });

  it("swaps the response mid-test", async () => {
    fixture = await startUpdateChannelFixture(CHANNEL_DOCUMENT);
    const updated = { ...CHANNEL_DOCUMENT, version: "0.3.0" };
    fixture.setResponse(updated);
    const response = await fetch(fixture.url);
    expect(await response.json()).toEqual(updated);
  });

  it("serves raw bodies and error statuses for failure-mode staging", async () => {
    fixture = await startUpdateChannelFixture(CHANNEL_DOCUMENT);
    fixture.setResponse("not json {", { status: 200, contentType: "text/plain" });
    const malformed = await fetch(fixture.url);
    expect(await malformed.text()).toBe("not json {");

    fixture.setResponse("", { status: 500 });
    const failing = await fetch(fixture.url);
    expect(failing.status).toBe(500);
  });

  it("stops accepting connections after dispose", async () => {
    fixture = await startUpdateChannelFixture(CHANNEL_DOCUMENT);
    const url = fixture.url;
    await fixture.dispose();
    const disposed = fixture;
    fixture = undefined;
    await expect(fetch(url)).rejects.toThrow();
    await disposed.dispose();
  });
});
