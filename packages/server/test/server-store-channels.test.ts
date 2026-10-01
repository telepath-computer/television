import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ConflictError,
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type TabPage,
} from "@telepath-computer/television-shared";
import { ServerStore } from "../src/server-store.ts";
import { getArtifactLiveMetadataPath } from "../src/artifact-paths.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-store-channels-"));
}

function page(artifactIds: string[], fullScreen = false): TabPage {
  return {
    artifactIds,
    geometry: fullScreen
      ? { kind: "single", full_screen: true }
      : { ...DEFAULT_PAGE_GEOMETRY },
    size: { ...DEFAULT_PAGE_SIZE },
  };
}

function createPathArtifact(store: ServerStore, storagePath: string, channelID: string, title = "A") {
  const target = path.join(storagePath, `${title}.md`);
  writeFileSync(target, `# ${title}`);
  return store.createArtifact({ kind: "path", title, path: target, channelID: channelID });
}

describe("ServerStore channels", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports channel CRUD and whole-page layout updates", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    const store = createServingStore(storagePath);
    const channel = store.createChannel({ name: "Remote" });
    const first = createPathArtifact(store, storagePath, channel.id, "A");
    const second = createPathArtifact(store, storagePath, channel.id, "B");
    const layout = [page([second.id]), page([first.id], true)];

    const updated = store.updateChannel({ channelID: channel.id, fields: { name: "Renamed", layout } });

    expect(updated.name).toBe("Renamed");
    expect(updated.layout).toEqual(layout);

    store.removeChannel(channel.id);
    expect(store.getChannel(channel.id)).toBeUndefined();
  });

  it("updateChannel rejects changed page membership", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    const store = createServingStore(storagePath);
    const channel = store.createChannel({ name: "Remote" });
    const first = createPathArtifact(store, storagePath, channel.id, "A");
    const second = createPathArtifact(store, storagePath, channel.id, "B");

    expect(() => store.updateChannel({
      channelID: channel.id,
      fields: { layout: [page([first.id, second.id])] },
    })).toThrow(ConflictError);
    expect(() => store.updateChannel({
      channelID: channel.id,
      fields: { layout: [page([first.id]), page(["missing"])] },
    })).toThrow(ConflictError);
  });

  it("createChannel persists channels", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    const store = createServingStore(storagePath);
    const channel = store.createChannel({ name: "Fresh" });

    const persisted = JSON.parse(
      readFileSync(path.join(storagePath, "state", "channels", `${channel.id}.json`), "utf8"),
    );
    expect(persisted).toEqual({
      id: channel.id,
      name: "Fresh",
      layoutVersion: 2,
      layout: [],
    });
  });

  it("returns path/url artifact records in channel snapshots", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const channel = store.listChannels()[0]!;
    const artifact = createPathArtifact(store, storagePath, channel.id, "note");
    expect(store.getChannel(channel.id)?.artifacts).toEqual([artifact]);
  });

  it("removeChannel removes the channel metadata", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    const store = createServingStore(storagePath);
    const channelA = store.createChannel({ name: "Remote" });

    const result = store.removeChannel(channelA.id);

    const metadataPath = path.join(storagePath, "state", "channels", `${channelA.id}.json`);
    expect(result).toEqual({
      channelID: channelA.id,
      metadataPath,
      artifactResults: [],
    });
    expect(store.getChannel(channelA.id)).toBeUndefined();
    expect(existsSync(metadataPath)).toBe(false);
  });

  it("removeChannel deletes every artifact on the removed channel before channel-removed", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    const store = createServingStore(storagePath);
    const channel = store.createChannel({ name: "Removed" });
    const pathArtifact = createPathArtifact(store, storagePath, channel.id, "A");
    const urlArtifact = store.createArtifact({ kind: "url", title: "URL", channelID: channel.id, url: "https://example.com" });
    const events: string[] = [];
    store.addEventListener("artifact-removed", (event) => events.push(`artifact:${event.artifactID}`));
    store.addEventListener("channel-removed", (event) => events.push(`channel:${event.channelID}`));

    const result = store.removeChannel(channel.id);

    expect(pathArtifact.kind).toBe("path");
    expect(urlArtifact.kind).toBe("url");
    if (pathArtifact.kind !== "path" || urlArtifact.kind !== "url") {
      throw new Error("unexpected artifact kinds");
    }
    expect(result.artifactResults).toEqual([
      { outcome: "deleted", kind: "path", artifactID: pathArtifact.id, path: pathArtifact.path },
      { outcome: "deleted", kind: "url", artifactID: urlArtifact.id, url: urlArtifact.url },
    ]);
    expect(store.getArtifact(pathArtifact.id)).toBeUndefined();
    expect(store.getArtifact(urlArtifact.id)).toBeUndefined();
    expect(existsSync(getArtifactLiveMetadataPath(storagePath, pathArtifact.id))).toBe(false);
    expect(existsSync(getArtifactLiveMetadataPath(storagePath, urlArtifact.id))).toBe(false);
    expect(existsSync(path.join(storagePath, "state", "channels", `${channel.id}.json`))).toBe(false);
    expect(events).toEqual([
      `artifact:${pathArtifact.id}`,
      `artifact:${urlArtifact.id}`,
      `channel:${channel.id}`,
    ]);
  });
});
