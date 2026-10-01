import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createArtifact, type Artifact } from "@telepath-computer/television-artifact";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  TelevisionClient,
  type Channel,
} from "@telepath-computer/television-shared";

const SERVER_URL = "http://localhost:32848";

function createJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

function createTextResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: vi.fn(async () => ({})),
    text: vi.fn(async () => body),
  };
}

function createEmptyResponse(status = 204) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: vi.fn(async () => ({})),
    text: vi.fn(async () => ""),
  };
}

describe("TelevisionClient", () => {
  const artifact: Artifact = createArtifact({
    id: "artifact-1",
    kind: "path",
    title: "Hello",
    path: "/tmp/hello.md",
  });
  const channel: Channel = {
    id: "screen-1",
    name: "Default",
    layout: [{
      artifactIds: [artifact.id],
      geometry: DEFAULT_PAGE_GEOMETRY,
      size: DEFAULT_PAGE_SIZE,
    }],
  };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("health uses GET /health and returns the parsed body", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ status: "ok", bindAddresses: ["127.0.0.1"], port: 32848 }));
    const client = new TelevisionClient(SERVER_URL);

    await expect(client.health()).resolves.toEqual({ status: "ok", bindAddresses: ["127.0.0.1"], port: 32848 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/health`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  describe("channels", () => {
    it("list() GETs /channels", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channels: [channel] }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.channels.list()).resolves.toEqual({ channels: [channel] });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("get() GETs /channels/:id with an explicit channelID", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channel, artifacts: [artifact] }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.channels.get({ channelID: channel.id })).resolves.toEqual({
        channel,
        artifacts: [artifact],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels/${channel.id}`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("get() auto-resolves channelID when only one channel exists", async () => {
      fetchMock
        .mockResolvedValueOnce(createJsonResponse({ channels: [channel] }))
        .mockResolvedValueOnce(createJsonResponse({ channel, artifacts: [artifact] }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.channels.get({})).resolves.toEqual({
        channel,
        artifacts: [artifact],
      });
      expect(fetchMock).toHaveBeenNthCalledWith(1, `${SERVER_URL}/channels`, expect.anything());
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${SERVER_URL}/channels/${channel.id}`,
        expect.anything(),
      );
    });

    it("get() refuses to auto-resolve when multiple channels match", async () => {
      const other = { ...channel, id: "screen-2", name: "Other" };
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channels: [channel, other] }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.channels.get({})).rejects.toThrow(/channelID is required/);
    });

    it("create() POSTs /channels with a JSON body", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channel }, 201));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.channels.create({ name: "Default" })).resolves.toEqual({ channel });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Default" }),
        }),
      );
    });

    it("create() forwards a caller-supplied id", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channel }, 201));
      const client = new TelevisionClient(SERVER_URL);

      await client.channels.create({ name: "Default", id: "screen-1" });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels`,
        expect.objectContaining({ body: JSON.stringify({ name: "Default", id: "screen-1" }) }),
      );
    });

    it("update() PATCHes /channels/:id with a flat field body", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channel }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.channels.update({ channelID: channel.id, name: "Renamed" }),
      ).resolves.toEqual({ channel });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels/${channel.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Renamed" }),
        }),
      );
    });

    it("update() includes layout when supplied", async () => {
      const layout = [{
        artifactIds: [artifact.id],
        geometry: DEFAULT_PAGE_GEOMETRY,
        size: DEFAULT_PAGE_SIZE,
      }];
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channel }));
      const client = new TelevisionClient(SERVER_URL);

      await client.channels.update({ channelID: channel.id, layout });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels/${channel.id}`,
        expect.objectContaining({ body: JSON.stringify({ layout }) }),
      );
    });

    it("delete() DELETEs /channels/:id and returns the server payload", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ channelID: channel.id, metadataPath: "/tmp/state/channels/screen-1.json", artifactResults: [] }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.channels.remove({ channelID: channel.id })).resolves.toEqual({
        channelID: channel.id,
        metadataPath: "/tmp/state/channels/screen-1.json",
        artifactResults: [],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/channels/${channel.id}`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("themes", () => {
    it("lists and refreshes theme registry snapshots", async () => {
      const initial = {
        themes: [{
          id: "paper",
          name: "Paper",
          version: "1.2.3",
          colorScheme: "light dark",
        }],
        errors: [{ folder: "broken", error: "cannot read manifest.json" }],
      };
      const refreshed = {
        themes: [
          { id: "amber", name: "Amber", version: "2.0.0", colorScheme: "dark" },
          { id: "paper", name: "Paper", version: "1.2.3", colorScheme: "light dark" },
        ],
        errors: [],
      };
      fetchMock
        .mockResolvedValueOnce(createJsonResponse(initial))
        .mockResolvedValueOnce(createJsonResponse(refreshed));
      const client = new TelevisionClient(SERVER_URL, { token: "theme-token" });

      await expect(client.themes.list()).resolves.toEqual(initial);
      await expect(client.themes.refresh()).resolves.toEqual(refreshed);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `${SERVER_URL}/themes`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ Authorization: "Bearer theme-token" }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${SERVER_URL}/themes/refresh`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer theme-token" }),
        }),
      );
    });
  });

  describe("artifacts", () => {
    it("create() POSTs /artifacts for path artifacts and forwards channelID + path in the body", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse(
        { artifact, channelID: channel.id },
        201,
      ));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.artifacts.create({
          channelID: channel.id,
          kind: "path",
          title: "Hello",
          path: "/tmp/hello.txt" ,
        }),
      ).resolves.toEqual({ artifact, channelID: channel.id });

      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/artifacts`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
        kind: "path",
        title: "Hello",
        path: "/tmp/hello.txt" ,
        channelID: channel.id,
      });
    });

    it("create() POSTs /artifacts for URL artifacts and forwards channelID + url in the body", async () => {
      const urlArtifact = createArtifact({
        id: "artifact-url-1",
        kind: "url",
        title: "External URL",
        url: "https://example.com",
      });
      fetchMock.mockResolvedValueOnce(createJsonResponse(
        { artifact: urlArtifact, channelID: channel.id },
        201,
      ));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.artifacts.create({
          channelID: channel.id,
          kind: "url",
          title: "External URL",
          url: "https://example.com",
        }),
      ).resolves.toEqual({ artifact: urlArtifact, channelID: channel.id });

      expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
        kind: "url",
        title: "External URL",
        url: "https://example.com",
        channelID: channel.id,
      });
    });

    it("list() GETs /artifacts and unwraps the envelope", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ artifacts: [artifact] }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.artifacts.list()).resolves.toEqual({ artifacts: [artifact] });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/artifacts`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("list() forwards channelID filter as a query parameter", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ artifacts: [artifact] }));
      const client = new TelevisionClient(SERVER_URL);

      await client.artifacts.list({ channelID: channel.id });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/artifacts?channelID=${channel.id}`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("get() GETs /artifacts/:id", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ artifact }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.artifacts.get({ artifactID: artifact.id })).resolves.toEqual({ artifact });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/artifacts/${artifact.id}`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("update() PATCHes /artifacts/:id with flat title/path/url fields", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ artifact: { ...artifact, title: "Updated", path: "/tmp/updated.md" } }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.artifacts.update({ artifactID: artifact.id, title: "Updated", path: "/tmp/updated.md" }),
      ).resolves.toEqual({ artifact: { ...artifact, title: "Updated", path: "/tmp/updated.md" } });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/artifacts/${artifact.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "Updated", path: "/tmp/updated.md" }),
        }),
      );
    });

    it("delete() DELETEs /artifacts/:id and returns the deleted payload", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({
        outcome: "deleted",
        kind: "path",
        artifactID: artifact.id,
        path: "/tmp/hello.md",
      }));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.artifacts.delete({ artifactID: artifact.id }),
      ).resolves.toEqual({
        outcome: "deleted",
        kind: "path",
        artifactID: artifact.id,
        path: "/tmp/hello.md",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/artifacts/${artifact.id}`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("markdown", () => {
    it("get() GETs /markdown/:id and returns text", async () => {
      fetchMock.mockResolvedValueOnce(createTextResponse("hello world"));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.markdown.get({ artifactID: artifact.id })).resolves.toBe("hello world");
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/markdown/${artifact.id}`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("update() PUTs markdown text to /markdown/:id and returns void", async () => {
      fetchMock.mockResolvedValueOnce(createEmptyResponse(204));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.markdown.update({ artifactID: artifact.id, content: "hello world" }),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/markdown/${artifact.id}`,
        expect.objectContaining({
          method: "PUT",
          body: "hello world",
          headers: expect.objectContaining({ "content-type": "text/markdown; charset=utf-8" }),
        }),
      );
    });
  });

  describe("display", () => {
    it("get() GETs /display", async () => {
      fetchMock.mockResolvedValueOnce(
        createJsonResponse({
          focusedChannelId: "screen-1",
          pinnedChannelIds: ["screen-2", "screen-1"],
          activeThemeName: null,
          activeThemeColorScheme: null,
          appearanceMode: "system",
          themeJavaScriptConsentIds: ["Theme.ID", "theme.id"],
          acpEnabled: true,
        }),
      );
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.display.get()).resolves.toEqual({
        focusedChannelId: "screen-1",
        pinnedChannelIds: ["screen-2", "screen-1"],
        activeThemeName: null,
        activeThemeColorScheme: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: ["Theme.ID", "theme.id"],
        acpEnabled: true,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/display`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    // proofs/arch/themes/index.md#^themes-t-active-color-scheme-client
    it("preserves the derived scheme on reads without adding it to display patches", async () => {
      fetchMock
        .mockResolvedValueOnce(createJsonResponse({
          focusedChannelId: "screen-1",
          pinnedChannelIds: [],
          activeThemeName: "fixed-dark",
          activeThemeColorScheme: "dark",
          appearanceMode: "light",
          themeJavaScriptConsentIds: [],
          acpEnabled: false,
        }))
        .mockResolvedValueOnce(createEmptyResponse(204));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.display.get()).resolves.toMatchObject({
        activeThemeName: "fixed-dark",
        activeThemeColorScheme: "dark",
      });
      await client.display.patch({ appearanceMode: "system" });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${SERVER_URL}/display`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ appearanceMode: "system" }),
        }),
      );
    });

    it("patch() PATCHes /display with the provided fields", async () => {
      fetchMock.mockResolvedValueOnce(createEmptyResponse(204));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.display.patch({
          focusedChannelId: "screen-1",
          pinnedChannelIds: ["screen-2", "screen-1"],
          activeThemeName: "paperlike",
          appearanceMode: "dark",
          themeJavaScriptConsentIds: ["paperlike", "Theme.ID"],
        }),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/display`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            focusedChannelId: "screen-1",
            pinnedChannelIds: ["screen-2", "screen-1"],
            activeThemeName: "paperlike",
            appearanceMode: "dark",
            themeJavaScriptConsentIds: ["paperlike", "Theme.ID"],
          }),
        }),
      );
    });

    it("patch() sends focusedChannelId: null when clearing the focused channel", async () => {
      fetchMock.mockResolvedValueOnce(createEmptyResponse(204));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.display.patch({ focusedChannelId: null }),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/display`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ focusedChannelId: null }),
        }),
      );
    });

    it("focus() POSTs /display/focus", async () => {
      fetchMock.mockResolvedValueOnce(
        createJsonResponse({ channelID: "screen-1", artifactID: "artifact-1" }),
      );
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.display.focus({ artifactID: "artifact-1" })).resolves.toEqual({
        channelID: "screen-1",
        artifactID: "artifact-1",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/display/focus`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ artifactID: "artifact-1" }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("throws a clear error with serverURL and no status when the server is unreachable", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("connect ECONNREFUSED"));
      const client = new TelevisionClient(SERVER_URL);

      await expect(client.health()).rejects.toMatchObject({
        message: "connect ECONNREFUSED",
        serverURL: SERVER_URL,
      });
    });

    it("throws a clear error with message, serverURL, and status for non-ok responses", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ error: "Channel not found: ws-1" }, 404));
      const client = new TelevisionClient(SERVER_URL);

      await expect(
        client.channels.get({ channelID: "ws-1" }),
      ).rejects.toMatchObject({
        message: "Channel not found: ws-1",
        serverURL: SERVER_URL,
        status: 404,
      });
    });

    it("sends an Authorization header when constructed with a token", async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ status: "ok", bindAddresses: ["127.0.0.1"], port: 32848 }));
      const client = new TelevisionClient(SERVER_URL, { token: "secret-token" });

      await expect(client.health()).resolves.toEqual({ status: "ok", bindAddresses: ["127.0.0.1"], port: 32848 });

      expect(fetchMock).toHaveBeenCalledWith(
        `${SERVER_URL}/health`,
        expect.objectContaining({
          method: "GET",
          headers: { Authorization: "Bearer secret-token" },
        }),
      );
    });
  });
});
