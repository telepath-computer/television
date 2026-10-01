import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ServerStore } from "../src/server-store.ts";
import { getAgentArtifactsDir, getArtifactLiveMetadataPath, getLegacyScreensDir, getTelemetryStatePath } from "../src/artifact-paths.ts";
import { getThemeEntryPath, getThemesDir } from "../src/themes.ts";

function tempDir(): string { return mkdtempSync(path.join(os.tmpdir(), "television-store-bootstrap-")); }

describe("ServerStore bootstrap", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("creates default channel, state token, themes, and top-level artifacts directory", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = new ServerStore({ installOnboardingChannels: true, storagePath });
    const [channel] = store.listChannels();
    expect(store.listChannels()).toHaveLength(1);
    expect(channel?.name).toBe("Default");
    expect(channel?.layout).toEqual([]);
    expect(existsSync(path.join(storagePath, "state", "token"))).toBe(true);
    expect(existsSync(path.join(storagePath, "themes"))).toBe(true);
    expect(existsSync(path.join(storagePath, "artifacts"))).toBe(true);
    expect(store.listArtifacts()).toEqual([]);
    store.dispose();
  });

  it("reports whether this bootstrap created the Television data directory structure", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    const first = new ServerStore({ installOnboardingChannels: true, storagePath });
    expect(first.dataDirCreated).toBe(true);
    first.dispose();

    const second = new ServerStore({ installOnboardingChannels: true, storagePath });
    expect(second.dataDirCreated).toBe(false);
    second.dispose();
  });

  describe("served-evidence dataDirCreated classification", () => {
    it("classifies token-only construction against fresh storage as fresh", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);

      const store = new ServerStore({ installOnboardingChannels: false, storagePath });
      expect(store.dataDirCreated).toBe(true);
      store.dispose();
    });

    it("classifies state/display.json as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      mkdirSync(path.join(storagePath, "state"), { recursive: true });
      writeFileSync(path.join(storagePath, "state", "display.json"), JSON.stringify({
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: null,
      }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies state/onboarding.json as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      mkdirSync(path.join(storagePath, "state"), { recursive: true });
      writeFileSync(path.join(storagePath, "state", "onboarding.json"), JSON.stringify({ version: 2, channels: {} }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies the legacy onboarding sentinel as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      mkdirSync(path.join(storagePath, "state"), { recursive: true });
      writeFileSync(path.join(storagePath, "state", "onboarding-artifact.json"), JSON.stringify({ version: 1, artifactID: "television-onboarding" }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies a non-empty state/channels directory as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      const channelsDir = path.join(storagePath, "state", "channels");
      mkdirSync(channelsDir, { recursive: true });
      writeFileSync(path.join(channelsDir, "seeded-channel.json"), JSON.stringify({ id: "seeded-channel", name: "Seeded", layout: [] }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies non-empty legacy channel metadata as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      const legacyChannelsDir = getLegacyScreensDir(storagePath);
      mkdirSync(legacyChannelsDir, { recursive: true });
      writeFileSync(path.join(legacyChannelsDir, "legacy-channel.json"), JSON.stringify({ id: "legacy-channel", name: "Legacy", layout: [] }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies a non-empty state/artifacts directory as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      const artifactsDir = path.join(storagePath, "state", "artifacts");
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(path.join(artifactsDir, "seeded-artifact.json"), JSON.stringify({ id: "seeded-artifact", kind: "path", title: "Seeded", path: "/tmp/seeded.html" }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies theme content as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      const themePath = getThemeEntryPath(storagePath, "paperlike");
      mkdirSync(path.dirname(themePath), { recursive: true });
      writeFileSync(themePath, "body { color: red; }");

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies agent-authored artifact content as served evidence", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      const artifactsDir = getAgentArtifactsDir(storagePath);
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(path.join(artifactsDir, "agent-authored.html"), "<p>authored</p>");

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("classifies empty storage subdirectories plus state/token as fresh", () => {
      const storagePath = tempDir();
      dirs.push(storagePath);
      for (const dir of [
        path.join(storagePath, "state", "channels"),
        path.join(storagePath, "state", "artifacts"),
        path.join(storagePath, "themes"),
        path.join(storagePath, "artifacts"),
      ]) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(path.join(storagePath, "state", "token"), "token-only\n");

      const store = new ServerStore({ installOnboardingChannels: true, storagePath });
      expect(store.dataDirCreated).toBe(true);
      store.dispose();
    });

    // proofs/arch/telemetry/server-telemetry-buffer.md#^tel-t-config-not-evidence
    it("classifies a home holding only its config file, or the config file with a token and empty directories, as fresh", () => {
      const configOnly = tempDir();
      dirs.push(configOnly);
      writeFileSync(path.join(configOnly, "config.json"), JSON.stringify({ port: 0, auth: false, installedByAgent: "Claude Code" }));

      const configWithToken = tempDir();
      dirs.push(configWithToken);
      writeFileSync(path.join(configWithToken, "config.json"), JSON.stringify({ port: 43123 }));
      for (const dir of [
        path.join(configWithToken, "state", "channels"),
        path.join(configWithToken, "state", "artifacts"),
        path.join(configWithToken, "themes"),
        path.join(configWithToken, "artifacts"),
      ]) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(path.join(configWithToken, "state", "token"), "token-only\n");

      for (const storagePath of [configOnly, configWithToken]) {
        const store = new ServerStore({ installOnboardingChannels: true, storagePath });
        expect(store.dataDirCreated, storagePath).toBe(true);
        store.dispose();
      }
    });
  });

  it("does not count a telemetry-only state file as an existing Television data directory", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    mkdirSync(path.dirname(getTelemetryStatePath(storagePath)), { recursive: true });
    writeFileSync(getTelemetryStatePath(storagePath), JSON.stringify({ schemaVersion: 1, userId: "pre-server", optedOut: false, lastVersion: "" }));

    const store = new ServerStore({ installOnboardingChannels: true, storagePath });
    expect(store.dataDirCreated).toBe(true);
    store.dispose();
  });

  it("leaves an existing themes directory and its contents alone on startup", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    mkdirSync(path.dirname(getThemeEntryPath(storagePath, "paperlike")), { recursive: true });
    writeFileSync(getThemeEntryPath(storagePath, "paperlike"), "body { color: red; }");
    const store = new ServerStore({ installOnboardingChannels: true, storagePath });
    expect(existsSync(getThemesDir(storagePath))).toBe(true);
    expect(readFileSync(getThemeEntryPath(storagePath, "paperlike"), "utf8")).toBe("body { color: red; }");
    store.dispose();
  });

  it("reuses the existing token across restarts", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const first = new ServerStore({ installOnboardingChannels: true, storagePath });
    const tokenOnDisk = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    expect(first.authToken).toBe(tokenOnDisk);
    first.dispose();
    const second = new ServerStore({ installOnboardingChannels: true, storagePath });
    expect(second.authToken).toBe(first.authToken);
    expect(second.authToken).toBe(tokenOnDisk);
    second.dispose();
  });

  it("rejects invalid persisted artifact metadata with a descriptive error", () => {
    for (const [name, body, message] of [
      ["bad-json", "{", "invalid or unreadable JSON"],
      ["id-mismatch", JSON.stringify({ id: "other", kind: "path", title: "A", path: "/tmp/a.html" }), "does not match filename"],
      ["relative-path", JSON.stringify({ id: "relative-path", kind: "path", title: "A", path: "relative.html" }), "path must be absolute"],
    ] as const) {
      const storagePath = tempDir();
      dirs.push(storagePath);
      mkdirSync(path.join(storagePath, "state", "artifacts"), { recursive: true });
      writeFileSync(getArtifactLiveMetadataPath(storagePath, name), body);
      let startupError: unknown;
      try {
        new ServerStore({ installOnboardingChannels: true, storagePath });
      } catch (error) {
        startupError = error;
      }
      expect(startupError).toBeInstanceOf(Error);
      const errorMessage = (startupError as Error).message;
      expect(errorMessage).toContain(message);
      expect(errorMessage).toContain(getArtifactLiveMetadataPath(storagePath, name));
      expect(errorMessage).toContain("Correct this metadata file and restart Television");
      expect(errorMessage).toContain("delete only this metadata file to unregister the artifact");
      expect(errorMessage).toContain("artifact content will remain untouched");
    }
  });

  it("loads persisted path and URL artifact metadata from state/artifacts", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    mkdirSync(path.join(storagePath, "state", "artifacts"), { recursive: true });
    writeFileSync(getArtifactLiveMetadataPath(storagePath, "a"), JSON.stringify({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" }));
    writeFileSync(getArtifactLiveMetadataPath(storagePath, "u"), JSON.stringify({ id: "u", kind: "url", title: "U", url: "https://example.com" }));
    const store = new ServerStore({ installOnboardingChannels: true, storagePath });
    expect(store.getArtifact("a")).toEqual({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" });
    expect(store.getArtifact("u")).toEqual({ id: "u", kind: "url", title: "U", url: "https://example.com" });
    store.dispose();
  });
});
