import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string { return mkdtempSync(path.join(os.tmpdir(), "television-url-artifacts-")); }

describe("URL artifacts", () => {
  it("rejects non-http(s) URL schemes", () => {
    const storagePath = tempDir();
    const store = createServingStore(storagePath);
    try {
      expect(() => store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "url", title: "x", url: "javascript:alert(1)" })).toThrow(/http\(s\) URL/);
      expect(() => store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "url", title: "x", url: "file:///etc/passwd" })).toThrow(/http\(s\) URL/);
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  it("attaches no watcher", () => {
    const storagePath = tempDir();
    const watchContentFile = vi.fn();
    const store = createServingStore(storagePath, { watchContentFile });
    try {
      store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "url", title: "Linear", url: "https://linear.app/foo" });
      expect(watchContentFile).not.toHaveBeenCalled();
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  it("persist as pointer records and delete without touching the remote URL", () => {
    const storagePath = tempDir();
    const store = createServingStore(storagePath);
    try {
      const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "url", title: "Linear", url: "https://linear.app/foo" });
      const metadataPath = path.join(storagePath, "state", "artifacts", `${artifact.id}.json`);
      expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toEqual(artifact);
      expect(store.deleteArtifact(artifact.id)).toEqual({ outcome: "deleted", kind: "url", artifactID: artifact.id, url: "https://linear.app/foo" });
      expect(existsSync(metadataPath)).toBe(false);
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
