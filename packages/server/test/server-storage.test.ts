import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-storage-"));
}

describe("ServerStore storage layout", () => {
  it("persists channels, artifacts, display state, and token under state/", () => {
    const storagePath = tempDir();
    const target = path.join(storagePath, "target.html");
    writeFileSync(target, "<!doctype html>");
    try {
      const store = createServingStore(storagePath);
      const channel = store.listChannels()[0]!;
      const artifact = store.createArtifact({ kind: "path", title: "A", path: target, channelID: channel.id });
      const urlArtifact = store.createArtifact({ kind: "url", title: "U", url: "https://example.com", channelID: channel.id });
      expect(existsSync(path.join(storagePath, "state", "channels", `${channel.id}.json`))).toBe(true);
      expect(existsSync(path.join(storagePath, "state", "screens"))).toBe(false);
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "artifacts", `${artifact.id}.json`), "utf8"))).toEqual(artifact);
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "artifacts", `${urlArtifact.id}.json`), "utf8"))).toEqual(urlArtifact);
      expect(existsSync(path.join(storagePath, "state", "display.json"))).toBe(true);
      expect(existsSync(path.join(storagePath, "state", "token"))).toBe(true);
      expect(existsSync(path.join(storagePath, "channels"))).toBe(false);
      expect(existsSync(path.join(storagePath, "token"))).toBe(false);
      store.dispose();
    } finally {
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});
