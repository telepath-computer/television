import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PAGE_SIZE, NotFoundError } from "@telepath-computer/television-shared";
import type { PathArtifact } from "@telepath-computer/television-artifact";
import { ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-store-delete-"));
}

function createPathArtifact(store: ServerStore, storagePath: string, channelID: string, title = "A"): PathArtifact {
  const target = path.join(storagePath, `${title}.html`);
  writeFileSync(target, "<!doctype html><html><body>ok</body></html>");
  return store.createArtifact({ kind: "path", title, channelID, path: target }) as PathArtifact;
}

describe("ServerStore.deleteArtifact", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("deletes registry metadata without touching targets", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const channel = store.listChannels()[0]!;
    const artifact = createPathArtifact(store, storagePath, channel.id, "A");
    const metadataPath = path.join(storagePath, "state", "artifacts", `${artifact.id}.json`);

    const result = store.deleteArtifact(artifact.id);

    expect(result).toEqual({ outcome: "deleted", kind: "path", artifactID: artifact.id, path: artifact.path });
    expect(store.getArtifact(artifact.id)).toBeUndefined();
    expect(readFileSync(artifact.path, "utf8")).toContain("ok");
    expect(() => readFileSync(metadataPath, "utf8")).toThrow();
    expect(store.getChannel(channel.id)!.channel.layout).toEqual([]);
  });

  it("removes the emptied page and fires one artifact-removed event", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const channel = store.listChannels()[0]!;
    const artifact = createPathArtifact(store, storagePath, channel.id, "A");
    const events: Array<{ artifactID: string; channelID: string }> = [];
    store.addEventListener("artifact-removed", (event) => {
      events.push({ artifactID: event.artifactID, channelID: event.channelID });
    });

    store.deleteArtifact(artifact.id);

    expect(store.getChannel(channel.id)!.channel.layout).toEqual([]);
    expect(events).toEqual([{ artifactID: artifact.id, channelID: channel.id }]);
  });

  it("works for a URL artifact and echoes the URL pointer", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const channel = store.listChannels()[0]!;
    const artifact = store.createArtifact({ kind: "url", title: "URL", channelID: channel.id, url: "https://example.com" });
    const events: string[] = [];
    store.addEventListener("artifact-removed", (event) => events.push(event.channelID));

    const result = store.deleteArtifact(artifact.id);

    expect(result).toEqual({ outcome: "deleted", kind: "url", artifactID: artifact.id, url: "https://example.com" });
    expect(events).toEqual([channel.id]);
    expect(store.getArtifact(artifact.id)).toBeUndefined();
  });

  it("persists the stripped layout to disk", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const channel = store.listChannels()[0]!;
    const artifact = createPathArtifact(store, storagePath, channel.id, "A");

    store.deleteArtifact(artifact.id);

    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "channels", `${channel.id}.json`), "utf8")).layout).toEqual([]);
  });

  it("deleting one of two artifacts pointing to the same path leaves the other intact", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const channelA = store.listChannels()[0]!;
    const channelB = store.createChannel({ name: "B" });
    const target = path.join(storagePath, "shared.md");
    writeFileSync(target, "# shared");
    const artifactA = store.createArtifact({ kind: "path", title: "A", channelID: channelA.id, path: target });
    const artifactB = store.createArtifact({ kind: "path", title: "B", channelID: channelB.id, path: target });

    store.deleteArtifact(artifactA.id);

    expect(store.getArtifact(artifactA.id)).toBeUndefined();
    expect(store.getArtifact(artifactB.id)).toEqual(artifactB);
    expect(store.getChannel(channelA.id)!.channel.layout).toEqual([]);
    expect(store.getChannel(channelB.id)!.channel.layout).toEqual([{
      artifactIds: [artifactB.id],
      geometry: { kind: "single", full_screen: false },
      size: DEFAULT_PAGE_SIZE,
    }]);
    expect(readFileSync(target, "utf8")).toBe("# shared");
  });

  it("rebuilds the ownership index from layouts on restart and resolves focus", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const first = createServingStore(storagePath);
    const channel = first.listChannels()[0]!;
    const artifact = createPathArtifact(first, storagePath, channel.id, "A");
    first.dispose();

    const restarted = createServingStore(storagePath);
    const focusEvents: Array<{ channelID: string; artifactID: string }> = [];
    restarted.addEventListener("artifact-focus", (event) => {
      focusEvents.push({ channelID: event.channelID, artifactID: event.artifactID });
    });

    expect(restarted.getArtifact(artifact.id)).toEqual(artifact);
    expect(restarted.focus({ artifactID: artifact.id })).toEqual({ channelID: channel.id, artifactID: artifact.id });
    expect(focusEvents).toEqual([{ channelID: channel.id, artifactID: artifact.id }]);
    restarted.dispose();
  });

  it("throws NotFoundError for an unknown artifact", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);

    expect(() => store.deleteArtifact("missing")).toThrow(NotFoundError);
  });
});
