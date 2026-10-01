import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { DEFAULT_PAGE_SIZE } from "@telepath-computer/television-shared";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import {
  getChannelsDir,
  getDisplayMigrationTempPath,
  getDisplayStatePath,
  getLegacyScreensDir,
} from "../src/artifact-paths.ts";
import {
  migrateChannelMetadataDirectory,
  migrateDisplayStateField,
} from "../src/storage-name-migration.ts";
import { getRedesignRecordMigrationTempPath } from "../src/redesign-storage-migration.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-storage-name-migration-"));
}

function write(pathname: string, contents: string | Buffer): void {
  mkdirSync(path.dirname(pathname), { recursive: true });
  writeFileSync(pathname, contents);
}

function displayBytes(storagePath: string): string {
  return readFileSync(getDisplayStatePath(storagePath), "utf8");
}

describe("server storage-name migration", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function storagePath(): string {
    const dir = tempDir();
    dirs.push(dir);
    return dir;
  }

  describe("channel metadata directory contract", () => {
    it("moves legacy-only empty and populated directories without changing entries or bytes", () => {
      for (const populated of [false, true]) {
        const storage = storagePath();
        const legacy = getLegacyScreensDir(storage);
        mkdirSync(legacy, { recursive: true });
        if (populated) {
          write(path.join(legacy, "channel-a.json"), Buffer.from([0, 1, 2, 255]));
          write(path.join(legacy, ".unknown", "nested.bin"), Buffer.from([9, 8, 7]));
        }

        migrateChannelMetadataDirectory(storage);

        expect(existsSync(legacy)).toBe(false);
        expect(existsSync(getChannelsDir(storage))).toBe(true);
        if (populated) {
          expect(readFileSync(path.join(getChannelsDir(storage), "channel-a.json"))).toEqual(Buffer.from([0, 1, 2, 255]));
          expect(readFileSync(path.join(getChannelsDir(storage), ".unknown", "nested.bin"))).toEqual(Buffer.from([9, 8, 7]));
        }
      }
    });

    it("leaves a current-only directory and its bytes unchanged", () => {
      const storage = storagePath();
      const current = getChannelsDir(storage);
      write(path.join(current, "channel-a.json"), "current bytes");

      migrateChannelMetadataDirectory(storage);

      expect(readFileSync(path.join(current, "channel-a.json"), "utf8")).toBe("current bytes");
      expect(existsSync(getLegacyScreensDir(storage))).toBe(false);
    });

    it("atomically replaces an empty current directory with a populated legacy directory", () => {
      const storage = storagePath();
      mkdirSync(getChannelsDir(storage), { recursive: true });
      write(path.join(getLegacyScreensDir(storage), "channel-a.json"), "legacy bytes");

      migrateChannelMetadataDirectory(storage);

      expect(existsSync(getLegacyScreensDir(storage))).toBe(false);
      expect(readdirSync(getChannelsDir(storage))).toEqual(["channel-a.json"]);
      expect(readFileSync(path.join(getChannelsDir(storage), "channel-a.json"), "utf8")).toBe("legacy bytes");
    });

    it("rejects two non-empty directories without changing either", () => {
      const storage = storagePath();
      write(path.join(getLegacyScreensDir(storage), "legacy.json"), "legacy bytes");
      write(path.join(getChannelsDir(storage), "current.json"), "current bytes");

      expect(() => migrateChannelMetadataDirectory(storage)).toThrow(
        new RegExp(`${getLegacyScreensDir(storage)}.*${getChannelsDir(storage)}`),
      );

      expect(readFileSync(path.join(getLegacyScreensDir(storage), "legacy.json"), "utf8")).toBe("legacy bytes");
      expect(readFileSync(path.join(getChannelsDir(storage), "current.json"), "utf8")).toBe("current bytes");
    });

    it("removes an empty legacy directory when the current directory exists, including when both are empty", () => {
      for (const currentPopulated of [false, true]) {
        const storage = storagePath();
        mkdirSync(getLegacyScreensDir(storage), { recursive: true });
        mkdirSync(getChannelsDir(storage), { recursive: true });
        if (currentPopulated) {
          write(path.join(getChannelsDir(storage), "current.json"), "current bytes");
        }

        migrateChannelMetadataDirectory(storage);

        expect(existsSync(getLegacyScreensDir(storage))).toBe(false);
        expect(existsSync(getChannelsDir(storage))).toBe(true);
        if (currentPopulated) {
          expect(readFileSync(path.join(getChannelsDir(storage), "current.json"), "utf8")).toBe("current bytes");
        }
      }
    });

    it("does nothing when neither directory exists", () => {
      const storage = storagePath();

      migrateChannelMetadataDirectory(storage);

      expect(existsSync(getLegacyScreensDir(storage))).toBe(false);
      expect(existsSync(getChannelsDir(storage))).toBe(false);
    });
  });

  describe("display document contract", () => {
    it("rewrites a legacy-only record and preserves the active value and every sibling", () => {
      const storage = storagePath();
      write(
        getDisplayStatePath(storage),
        JSON.stringify({ activeScreenID: "channel-a", activeThemeName: "paper", futureSibling: { order: [3, 1, 2] } }, null, 2),
      );

      migrateDisplayStateField(storage);

      expect(JSON.parse(displayBytes(storage))).toEqual({
        activeChannelID: "channel-a",
        activeThemeName: "paper",
        futureSibling: { order: [3, 1, 2] },
      });
    });

    it("normalizes equal dual keys and leaves a current-only record byte-stable", () => {
      const storage = storagePath();
      write(
        getDisplayStatePath(storage),
        JSON.stringify({ activeScreenID: null, activeChannelID: null, activeThemeName: null, sibling: true }, null, 4),
      );
      migrateDisplayStateField(storage);
      expect(JSON.parse(displayBytes(storage))).toEqual({ activeChannelID: null, activeThemeName: null, sibling: true });

      const currentBytes = '{"activeChannelID":"channel-a","activeThemeName":null,"sibling":[2,1]}';
      write(getDisplayStatePath(storage), currentBytes);
      migrateDisplayStateField(storage);
      expect(displayBytes(storage)).toBe(currentBytes);
    });

    it("rejects different dual keys without changing the file", () => {
      const storage = storagePath();
      const original = JSON.stringify({ activeScreenID: "channel-a", activeChannelID: "channel-b", activeThemeName: null }, null, 2);
      write(getDisplayStatePath(storage), original);

      expect(() => migrateDisplayStateField(storage)).toThrow(/conflicting activeScreenID and activeChannelID/);
      expect(displayBytes(storage)).toBe(original);
    });

    it("leaves invalid JSON and invalid known-field shapes to existing loader behavior", () => {
      for (const original of [
        "{",
        JSON.stringify({ activeScreenID: 42, activeThemeName: null }),
        JSON.stringify({ activeScreenID: "channel-a", activeThemeName: false }),
      ]) {
        const storage = storagePath();
        write(getDisplayStatePath(storage), original);
        migrateDisplayStateField(storage);
        expect(displayBytes(storage)).toBe(original);
      }
    });

    it("replaces a stale temporary file and retries cleanly after a pre-rename failure", () => {
      const storage = storagePath();
      const original = JSON.stringify({ activeScreenID: "channel-a", activeThemeName: null }, null, 2);
      write(getDisplayStatePath(storage), original);
      write(getDisplayMigrationTempPath(storage), "stale");
      migrateDisplayStateField(storage);
      expect(JSON.parse(displayBytes(storage))).toEqual({ activeChannelID: "channel-a", activeThemeName: null });

      write(getDisplayStatePath(storage), original);
      rmSync(getDisplayMigrationTempPath(storage), { force: true });
      mkdirSync(getDisplayMigrationTempPath(storage));
      expect(() => migrateDisplayStateField(storage)).toThrow();
      expect(displayBytes(storage)).toBe(original);

      rmSync(getDisplayMigrationTempPath(storage), { recursive: true });
      migrateDisplayStateField(storage);
      expect(JSON.parse(displayBytes(storage))).toEqual({ activeChannelID: "channel-a", activeThemeName: null });
    });
  });

  describe("serving-store seam", () => {
    const TOKEN_ONLY_THEN_SERVING_TITLE =
      "leaves legacy names intact during token-only construction and migrates them on the later serving boot";
    const SECOND_BOOT_TITLE =
      "migrates legacy metadata and display names before loading, preserving values and second-boot bytes";

    it(TOKEN_ONLY_THEN_SERVING_TITLE, () => {
        const storage = storagePath();
        const channelRecord = JSON.stringify({ id: "channel-a", name: "A", layoutVersion: 2, layout: [] });
        const displayRecord = JSON.stringify({ activeScreenID: "channel-a", activeThemeName: "paper" });
        write(path.join(getLegacyScreensDir(storage), "channel-a.json"), channelRecord);
        write(getDisplayStatePath(storage), displayRecord);
        seedThemePackage(storage, "paper");

        const tokenOnly = new ServerStore({ storagePath: storage });
        expect(tokenOnly.dataDirCreated).toBe(false);
        expect(tokenOnly.listChannels()).toEqual([]);
        expect(readFileSync(path.join(getLegacyScreensDir(storage), "channel-a.json"), "utf8")).toBe(channelRecord);
        expect(readdirSync(getChannelsDir(storage))).toEqual([]);
        expect(displayBytes(storage)).toBe(displayRecord);
        expect(existsSync(path.join(storage, "state", "token"))).toBe(true);
        tokenOnly.dispose();

        const serving = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
        expect(serving.getChannel("channel-a")?.channel).toEqual({ id: "channel-a", name: "A", layout: [] });
        expect(serving.getFocusedChannelId()).toBe("channel-a");
        expect(existsSync(getLegacyScreensDir(storage))).toBe(false);
        expect(JSON.parse(displayBytes(storage))).toEqual({
          focusedChannelId: "channel-a",
          pinnedChannelIds: [],
          activeThemeName: "paper",
          appearanceMode: "system",
        });
        serving.dispose();
      });

      it(SECOND_BOOT_TITLE, () => {
        const storage = storagePath();
        const channelRecord = JSON.stringify({
          id: "channel-a",
          name: "A",
          layoutVersion: 2,
          layout: [{
            artifactIds: ["artifact-a"],
            geometry: { kind: "single", full_screen: false },
            size: DEFAULT_PAGE_SIZE,
          }],
          onboarding: { slug: "starter", order: 7 },
        }, null, 3);
        write(path.join(getLegacyScreensDir(storage), "channel-a.json"), channelRecord);
        write(path.join(storage, "state", "artifacts", "artifact-a.json"), JSON.stringify({
          id: "artifact-a",
          kind: "url",
          title: "A",
          url: "https://example.com",
        }));
        write(
          getDisplayStatePath(storage),
          JSON.stringify({ activeScreenID: "channel-a", activeThemeName: null, sibling: { preserved: true } }, null, 2),
        );

        const first = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
        expect(first.dataDirCreated).toBe(false);
        expect(first.getChannel("channel-a")).toEqual({
          channel: {
            id: "channel-a",
            name: "A",
            layout: [{
              artifactIds: ["artifact-a"],
              geometry: { kind: "single", full_screen: false },
              size: DEFAULT_PAGE_SIZE,
            }],
            onboarding: { slug: "starter" },
          },
          artifacts: [{ id: "artifact-a", kind: "url", title: "A", url: "https://example.com" }],
        });
        expect(first.getFocusedChannelId()).toBe("channel-a");
        expect(JSON.parse(readFileSync(path.join(getChannelsDir(storage), "channel-a.json"), "utf8"))).toEqual({
          id: "channel-a",
          name: "A",
          layoutVersion: 2,
          layout: [{
            artifactIds: ["artifact-a"],
            geometry: { kind: "single", full_screen: false },
            size: DEFAULT_PAGE_SIZE,
          }],
          onboarding: { slug: "starter" },
        });
        expect(existsSync(getLegacyScreensDir(storage))).toBe(false);
        expect(JSON.parse(displayBytes(storage))).toEqual({
          focusedChannelId: "channel-a",
          pinnedChannelIds: [],
          activeThemeName: null,
          appearanceMode: "system",
          sibling: { preserved: true },
        });
        first.dispose();

        const metadataBytes = readFileSync(path.join(getChannelsDir(storage), "channel-a.json"));
        const migratedDisplayBytes = readFileSync(getDisplayStatePath(storage));
        const second = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
        second.dispose();
        expect(readFileSync(path.join(getChannelsDir(storage), "channel-a.json"))).toEqual(metadataBytes);
        expect(readFileSync(getDisplayStatePath(storage))).toEqual(migratedDisplayBytes);
      });

    // proofs/arch/layout/migration.md#^t-size-backfill
    it("serves and persists missing page sizes, preserves authored sizes, and makes the second boot byte-stable", async () => {
      const storage = storagePath();
      const channelPath = path.join(getChannelsDir(storage), "channel-a.json");
      const authoredSize = { width: 612.5, height: 701.25 };
      const ignoredMarker = { slug: "not-legacy", order: 7, extra: true };
      const futureSibling = { preserved: [3, 1, 2] };
      const expectedLayout = [
        {
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
          size: DEFAULT_PAGE_SIZE,
        },
        {
          artifactIds: ["artifact-b"],
          geometry: { kind: "single", full_screen: true },
          size: authoredSize,
        },
      ];
      write(channelPath, JSON.stringify({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [
          {
            artifactIds: ["artifact-a"],
            geometry: { kind: "single", full_screen: false },
          },
          expectedLayout[1],
        ],
        onboarding: ignoredMarker,
        futureSibling,
      }, null, 2));

      const firstStore = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      const firstServer = new Server({ store: firstStore, host: "127.0.0.1", port: 0, auth: true });
      try {
        await firstServer.start();
        await request(firstServer.httpServer)
          .get("/channels/channel-a")
          .set({ Authorization: `Bearer ${firstStore.authToken}` })
          .expect(200)
          .expect(({ body }) => expect(body.channel.layout).toEqual(expectedLayout));
      } finally {
        await firstServer.dispose();
      }

      expect(JSON.parse(readFileSync(channelPath, "utf8"))).toEqual({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: expectedLayout,
        onboarding: ignoredMarker,
        futureSibling,
      });
      const firstBootBytes = readFileSync(channelPath);
      const secondStore = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(secondStore.getChannel("channel-a")?.channel.layout).toEqual(expectedLayout);
      secondStore.dispose();
      expect(readFileSync(channelPath)).toEqual(firstBootBytes);
    });

    // proofs/arch/layout/migration.md#^mig-t-appearance
    it("migrates appearance atomically, retries while blocked, and leaves completed bytes stable", () => {
      const storage = storagePath();
      for (const id of ["channel-a", "channel-b"]) {
        write(path.join(getChannelsDir(storage), `${id}.json`), JSON.stringify({
          id,
          name: id,
          layoutVersion: 2,
          layout: [],
        }));
      }
      seedThemePackage(storage, "paper");
      const original = JSON.stringify({
        focusedChannelId: "channel-b",
        pinnedChannelIds: ["channel-a"],
        activeThemeName: "paper",
        sibling: { preserved: true },
      }, null, 2);
      write(getDisplayStatePath(storage), original);
      const obstruction = getRedesignRecordMigrationTempPath(getDisplayStatePath(storage));
      mkdirSync(obstruction);

      expect(() => new ServerStore({ installOnboardingChannels: true, storagePath: storage })).toThrow();
      expect(displayBytes(storage)).toBe(original);
      expect(() => new ServerStore({ installOnboardingChannels: true, storagePath: storage })).toThrow();
      expect(displayBytes(storage)).toBe(original);

      rmSync(obstruction, { recursive: true });
      const first = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(first.getDisplayState()).toEqual({
        focusedChannelId: "channel-b",
        pinnedChannelIds: ["channel-a"],
        activeThemeName: "paper",
        activeThemeColorScheme: "light dark",
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
      expect(JSON.parse(displayBytes(storage))).toEqual({
        focusedChannelId: "channel-b",
        pinnedChannelIds: ["channel-a"],
        activeThemeName: "paper",
        sibling: { preserved: true },
        appearanceMode: "system",
      });
      first.dispose();

      const completed = readFileSync(getDisplayStatePath(storage));
      const second = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      second.dispose();
      expect(readFileSync(getDisplayStatePath(storage))).toEqual(completed);
    });

    it("leaves an invalid appearance mode to strict display initialization", () => {
      const storage = storagePath();
      for (const id of ["channel-a", "channel-b"]) {
        write(path.join(getChannelsDir(storage), `${id}.json`), JSON.stringify({
          id,
          name: id,
          layoutVersion: 2,
          layout: [],
        }));
      }
      seedThemePackage(storage, "paper");
      write(getDisplayStatePath(storage), JSON.stringify({
        focusedChannelId: "channel-b",
        pinnedChannelIds: ["channel-b"],
        activeThemeName: "paper",
        appearanceMode: "sepia",
        sibling: { discarded: true },
      }));

      const store = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(store.getDisplayState()).toEqual({
        focusedChannelId: "channel-a",
        pinnedChannelIds: [],
        activeThemeName: null,
        activeThemeColorScheme: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
      expect(JSON.parse(displayBytes(storage))).toEqual({
        focusedChannelId: "channel-a",
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
      store.dispose();
    });

    it.each([
      ["a non-array layout", { not: "an array" }],
      ["a null page", [null]],
    ])("leaves %s unchanged and reaches the normal malformed-channel warning", (_label, layout) => {
      const storage = storagePath();
      const channelPath = path.join(getChannelsDir(storage), "malformed.json");
      const malformedBytes = JSON.stringify({
        id: "channel-malformed",
        name: "Malformed",
        layoutVersion: 2,
        layout,
        sibling: { preserved: true },
      });
      write(channelPath, malformedBytes);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const store = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
        expect(store.getChannel("channel-malformed")).toBeUndefined();
        store.dispose();
        expect(readFileSync(channelPath, "utf8")).toBe(malformedBytes);
        expect(warn).toHaveBeenCalledWith(
          `Skipping malformed channel file: ${channelPath}`,
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("resumes a partial batch of version-1, intermediate, and current channel records before display conversion", () => {
      const storage = storagePath();
      const channelAPath = path.join(getChannelsDir(storage), "channel-a.json");
      const channelBPath = path.join(getChannelsDir(storage), "channel-b.json");
      const channelCPath = path.join(getChannelsDir(storage), "channel-c.json");
      const channelDPath = path.join(getChannelsDir(storage), "channel-d.json");
      write(channelAPath, JSON.stringify({
        id: "channel-a",
        name: "Legacy row",
        layout: [{
          id: "row-a",
          type: "row",
          height: "auto",
          children: [
            { type: "card", artifactID: "left", width: 2, height: "auto" },
            { type: "card", artifactID: "right", width: 2, height: "auto" },
          ],
        }],
        onboarding: { slug: "legacy", order: 4 },
      }, null, 4));
      write(channelBPath, JSON.stringify({
        id: "channel-b",
        name: "Intermediate",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["kept-a", "kept-b"],
          geometry: { kind: "single", full_screen: true },
          size: DEFAULT_PAGE_SIZE,
        }],
        onboarding: { slug: "intermediate", order: 8 },
      }, null, 3));
      const currentBytes = '{"id":"channel-c","name":"Current","layoutVersion":2,"layout":[],"onboarding":{"slug":"current"}}';
      const malformedMarkerBytes = '{"id":"channel-d","name":"Current with ignored marker","layoutVersion":2,"layout":[],"onboarding":{"slug":"not-current","extra":true}}';
      write(channelCPath, currentBytes);
      write(channelDPath, malformedMarkerBytes);
      write(
        getDisplayStatePath(storage),
        JSON.stringify({ activeChannelID: "channel-d", activeThemeName: "paper" }),
      );
      seedThemePackage(storage, "paper");

      const first = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(first.getChannel("channel-a")?.channel).toEqual({
        id: "channel-a",
        name: "Legacy row",
        layout: ["left", "right"].map((artifactId) => ({
          artifactIds: [artifactId],
          geometry: { kind: "single", full_screen: false },
          size: DEFAULT_PAGE_SIZE,
        })),
        onboarding: { slug: "legacy" },
      });
      expect(first.getChannel("channel-b")?.channel).toEqual({
        id: "channel-b",
        name: "Intermediate",
        layout: [{
          artifactIds: ["kept-a", "kept-b"],
          geometry: { kind: "single", full_screen: true },
          size: DEFAULT_PAGE_SIZE,
        }],
        onboarding: { slug: "intermediate" },
      });
      expect(first.getChannel("channel-c")?.channel).toEqual({
        id: "channel-c",
        name: "Current",
        layout: [],
        onboarding: { slug: "current" },
      });
      expect(first.getChannel("channel-d")?.channel).toEqual({
        id: "channel-d",
        name: "Current with ignored marker",
        layout: [],
      });
      expect(readFileSync(channelCPath, "utf8")).toBe(currentBytes);
      expect(readFileSync(channelDPath, "utf8")).toBe(malformedMarkerBytes);
      expect(JSON.parse(displayBytes(storage))).toEqual({
        focusedChannelId: "channel-d",
        pinnedChannelIds: [],
        activeThemeName: "paper",
        appearanceMode: "system",
      });
      first.dispose();

      const completedBytes = new Map([
        [channelAPath, readFileSync(channelAPath)],
        [channelBPath, readFileSync(channelBPath)],
        [channelCPath, readFileSync(channelCPath)],
        [channelDPath, readFileSync(channelDPath)],
        [getDisplayStatePath(storage), readFileSync(getDisplayStatePath(storage))],
      ]);
      const second = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      second.dispose();
      for (const [pathname, bytes] of completedBytes) {
        expect(readFileSync(pathname)).toEqual(bytes);
      }
    });

    it("stops at a channel replacement obstruction and resumes without rolling back completed records", () => {
      const storage = storagePath();
      const channelAPath = path.join(getChannelsDir(storage), "channel-a.json");
      const channelBPath = path.join(getChannelsDir(storage), "channel-b.json");
      const channelA = JSON.stringify({
        id: "channel-a",
        name: "A",
        layout: [{ type: "card", artifactID: "artifact-a", width: 4, height: 6 }],
      });
      const channelB = JSON.stringify({
        id: "channel-b",
        name: "B",
        layout: [{ type: "card", artifactID: "artifact-b", width: 4, height: 6 }],
      });
      const display = JSON.stringify({ activeChannelID: "channel-b", activeThemeName: null });
      write(channelAPath, channelA);
      write(channelBPath, channelB);
      write(getDisplayStatePath(storage), display);
      const obstruction = getRedesignRecordMigrationTempPath(channelBPath);
      mkdirSync(obstruction);

      expect(() => new ServerStore({ installOnboardingChannels: true, storagePath: storage })).toThrow();
      expect(JSON.parse(readFileSync(channelAPath, "utf8"))).toEqual({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
        }],
      });
      expect(readFileSync(channelBPath, "utf8")).toBe(channelB);
      expect(displayBytes(storage)).toBe(display);
      expect(existsSync(path.join(storage, "state", "token"))).toBe(false);

      const completedChannelA = readFileSync(channelAPath);
      rmSync(obstruction, { recursive: true });
      const retry = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(readFileSync(channelAPath)).not.toEqual(completedChannelA);
      expect(JSON.parse(readFileSync(channelAPath, "utf8"))).toEqual({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
          size: DEFAULT_PAGE_SIZE,
        }],
      });
      expect(JSON.parse(readFileSync(channelBPath, "utf8"))).toMatchObject({ id: "channel-b", layoutVersion: 2 });
      expect(JSON.parse(displayBytes(storage))).toEqual({
        focusedChannelId: "channel-b",
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
      });
      retry.dispose();
    });

    it("stops at the final display replacement obstruction and resumes without rolling back channels", () => {
      const storage = storagePath();
      const channelPath = path.join(getChannelsDir(storage), "channel-a.json");
      write(channelPath, JSON.stringify({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
        }],
        onboarding: { slug: "starter", order: 7 },
      }));
      const display = JSON.stringify({ activeChannelID: "channel-a", activeThemeName: "paper" });
      write(getDisplayStatePath(storage), display);
      seedThemePackage(storage, "paper");
      const obstruction = getRedesignRecordMigrationTempPath(getDisplayStatePath(storage));
      mkdirSync(obstruction);

      expect(() => new ServerStore({ installOnboardingChannels: true, storagePath: storage })).toThrow();
      expect(JSON.parse(readFileSync(channelPath, "utf8"))).toEqual({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
        }],
        onboarding: { slug: "starter" },
      });
      expect(displayBytes(storage)).toBe(display);
      expect(existsSync(path.join(storage, "state", "token"))).toBe(false);

      const completedChannel = readFileSync(channelPath);
      rmSync(obstruction, { recursive: true });
      const retry = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(readFileSync(channelPath)).not.toEqual(completedChannel);
      expect(existsSync(getRedesignRecordMigrationTempPath(channelPath))).toBe(false);
      expect(JSON.parse(readFileSync(channelPath, "utf8"))).toEqual({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
          size: DEFAULT_PAGE_SIZE,
        }],
        onboarding: { slug: "starter" },
      });
      expect(JSON.parse(displayBytes(storage))).toEqual({
        focusedChannelId: "channel-a",
        pinnedChannelIds: [],
        activeThemeName: "paper",
        appearanceMode: "system",
      });
      retry.dispose();
    });

    it("leaves step-2 version-1 output sizeless when display replacement fails, then backfills on retry", () => {
      const storage = storagePath();
      const channelPath = path.join(getChannelsDir(storage), "channel-v1.json");
      write(channelPath, JSON.stringify({
        id: "channel-v1",
        name: "Legacy",
        layout: [{
          type: "card",
          artifactID: "artifact-v1",
          width: "auto",
          height: 4,
        }],
        onboarding: { slug: "legacy", order: 3 },
      }));
      const display = JSON.stringify({ activeChannelID: "channel-v1", activeThemeName: null });
      write(getDisplayStatePath(storage), display);
      const obstruction = getRedesignRecordMigrationTempPath(getDisplayStatePath(storage));
      mkdirSync(obstruction);

      expect(() => new ServerStore({ installOnboardingChannels: true, storagePath: storage })).toThrow();
      expect(JSON.parse(readFileSync(channelPath, "utf8"))).toEqual({
        id: "channel-v1",
        name: "Legacy",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-v1"],
          geometry: { kind: "single", full_screen: false },
        }],
        onboarding: { slug: "legacy" },
      });
      expect(displayBytes(storage)).toBe(display);

      rmSync(obstruction, { recursive: true });
      const retry = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(JSON.parse(readFileSync(channelPath, "utf8"))).toEqual({
        id: "channel-v1",
        name: "Legacy",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-v1"],
          geometry: { kind: "single", full_screen: false },
          size: DEFAULT_PAGE_SIZE,
        }],
        onboarding: { slug: "legacy" },
      });
      expect(JSON.parse(displayBytes(storage))).toEqual({
        focusedChannelId: "channel-v1",
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
      });
      retry.dispose();
    });

    it("recognizes populated legacy metadata as prior serving evidence without another state signal", () => {
      const storage = storagePath();
      write(
        path.join(getLegacyScreensDir(storage), "channel-a.json"),
        JSON.stringify({ id: "channel-a", name: "A", layout: [] }),
      );

      const store = new ServerStore({ installOnboardingChannels: true, storagePath: storage });
      expect(store.dataDirCreated).toBe(false);
      store.dispose();
    });

    it("stops a directory conflict before token, display, onboarding, or current-state writes", () => {
      const storage = storagePath();
      write(path.join(getLegacyScreensDir(storage), "legacy.json"), "legacy bytes");
      write(path.join(getChannelsDir(storage), "current.json"), "current bytes");
      const display = JSON.stringify({ activeScreenID: "legacy", activeThemeName: null });
      write(getDisplayStatePath(storage), display);
      const watcherStarts: string[] = [];
      const onboardingContentPath = fileURLToPath(
        new URL("./fixtures/onboarding-bundles/two-channels", import.meta.url),
      );

      expect(() => new ServerStore({
        installOnboardingChannels: true,
        onboardingContentPath,
        storagePath: storage,
        watchContentFile: (watchPath) => {
          watcherStarts.push(watchPath);
          return { close: () => {}, on: () => undefined };
        },
      })).toThrow(/state.*screens.*state.*channels/s);

      expect(readFileSync(path.join(getLegacyScreensDir(storage), "legacy.json"), "utf8")).toBe("legacy bytes");
      expect(readFileSync(path.join(getChannelsDir(storage), "current.json"), "utf8")).toBe("current bytes");
      expect(displayBytes(storage)).toBe(display);
      expect(existsSync(path.join(storage, "state", "token"))).toBe(false);
      expect(existsSync(path.join(storage, "state", "artifacts"))).toBe(false);
      expect(watcherStarts).toEqual([]);
    });
  });
});
