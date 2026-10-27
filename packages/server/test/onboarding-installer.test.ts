import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ServerStore } from "../src/server-store.ts";
import {
  getAgentArtifactsDir,
  getArtifactLiveMetadataPath,
  getDisplayStatePath,
  getOnboardingArtifactSentinelPath,
  getOnboardingStatePath,
  getChannelsDir,
  getTokenPath,
} from "../src/artifact-paths.ts";
import {
  readOnboardingStateFile,
  type OnboardingStateV2,
  type OnboardingStateV3,
} from "../src/onboarding-state.ts";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type Channel,
  type TabPage,
} from "@telepath-computer/television-shared";
import type { ServerStoreTelemetryHooks } from "../src/telemetry/emitters.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-onboarding-installer-"));
}

function bundle(name: string): string {
  return path.join(here, "fixtures", "onboarding-bundles", name);
}

// Installed content is named by copy name; installed artifacts get generated
// IDs (specs/arch/onboarding/installer.md#^artifact-ids).
const ALPHA_COPY = "television-onboarding--first--alpha";
const BETA_COPY = "television-onboarding--second--beta";
const GUIDE_COPY = "television-onboarding--notes--guide";
const STUDIO_ARTIFACT_SLUGS = ["main", "side", "left", "right"] as const;
const STUDIO_TITLES = ["Main", "Side", "Left", "Right"];
const STUDIO_COPY_NAMES = STUDIO_ARTIFACT_SLUGS.map(
  (slug) => `television-onboarding--studio--${slug}`,
);
/** An installation day four calendar days after the `declared-stores` list's shiftDatesFrom, at noon. */
const INSTALL_DAY = new Date(2026, 6, 12, 12, 0);
/** The `declared-stores` list's starting value, installed on INSTALL_DAY. */
const SHIFTED_LIST = { items: { milk: true }, due: "2026-07-12", plan: [{ on: "2026-08-03" }, "2026-08-06", "2026-07-08T10:00:00", "2026-02-30", "due soon", 7, null] };
/** An artifact ID in the generated form: a ULID, 26 Crockford base-32 characters. */
const GENERATED_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
function page(
  artifactID: string,
  configured: Partial<Pick<TabPage, "geometry" | "size">> = {},
): TabPage {
  return {
    artifactIds: [artifactID],
    geometry: { ...(configured.geometry ?? DEFAULT_PAGE_GEOMETRY) },
    size: { ...(configured.size ?? DEFAULT_PAGE_SIZE) },
  };
}

/** The studio channel's configured pages, over the installed artifacts `ids` in config order. */
function studioPages(ids: readonly string[]): TabPage[] {
  return [
    page(ids[0]!, { size: { width: 960.5, height: 640.25 } }),
    page(ids[1]!, { geometry: { kind: "single", full_screen: true } }),
    page(ids[2]!, {
      geometry: { kind: "single", full_screen: true },
      size: { width: 720, height: 480 },
    }),
    page(ids[3]!),
  ];
}

function channelBySlug(store: ServerStore, slug: string): Channel {
  const channel = store.listChannels().find((candidate) => candidate.onboarding?.slug === slug);
  if (!channel) throw new Error(`no channel carries the onboarding slug ${slug}`);
  return channel;
}

/** The artifacts on an installed channel's pages, in page order. */
function pageArtifactIDs(store: ServerStore, slug: string): string[] {
  return channelBySlug(store, slug).layout.flatMap((tabPage) => tabPage.artifactIds);
}

/** The resource ID that an artifact's record points to as its store's. */
function storePointer(store: ServerStore, artifactID: string): string | undefined {
  const artifact = store.getArtifact(artifactID);
  return artifact?.kind === "path" ? artifact.store : undefined;
}

function copyPath(storagePath: string, name: string): string {
  return path.join(getAgentArtifactsDir(storagePath), name);
}

describe("Onboarding installer", () => {
  const dirs: string[] = [];
  const stores: ServerStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function storage(): string {
    const storagePath = tempDir();
    dirs.push(storagePath);
    return storagePath;
  }

  function boot(storagePath: string, bundleName?: string): ServerStore {
    const store = new ServerStore({
      storagePath,
      installOnboardingChannels: true,
      ...(bundleName ? { onboardingContentPath: bundle(bundleName) } : {}),
    });
    stores.push(store);
    return store;
  }

  /** Boots with the local clock at `now`, so that the installation day is its local day. */
  function bootOnDay(storagePath: string, bundleName: string, now: Date): ServerStore {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      return boot(storagePath, bundleName);
    } finally {
      vi.useRealTimers();
    }
  }

  /** Forgets a store the test disposed itself. */
  function disposeLater(store: ServerStore): void {
    stores.splice(stores.indexOf(store), 1);
  }

  function readState(storagePath: string): OnboardingStateV3 {
    const result = readOnboardingStateFile(storagePath);
    if (result.status !== "ok") throw new Error(`expected onboarding state, got ${result.status}`);
    return result.state;
  }

  function seedStateDir(storagePath: string): void {
    mkdirSync(path.join(storagePath, "state"), { recursive: true });
  }

  // proofs/arch/onboarding/installer.md#^t-token-only
  describe("Token-only construction is inert", () => {
    it("creates the storage structure and token but no channels, display state, or onboarding state", () => {
      const storagePath = storage();
      const store = new ServerStore({ storagePath, installOnboardingChannels: false });
      stores.push(store);
      expect(store.authToken.length).toBeGreaterThan(0);
      expect(existsSync(getTokenPath(storagePath))).toBe(true);
      expect(existsSync(getAgentArtifactsDir(storagePath))).toBe(true);
      expect(store.listChannels()).toEqual([]);
      expect(readdirSync(getChannelsDir(storagePath))).toEqual([]);
      expect(existsSync(getDisplayStatePath(storagePath))).toBe(false);
      expect(existsSync(getOnboardingStatePath(storagePath))).toBe(false);
      expect(existsSync(getOnboardingArtifactSentinelPath(storagePath))).toBe(false);
      expect(store.listArtifacts()).toEqual([]);
    });

    it("a serving boot immediately after treats the directory as no-content", () => {
      const storagePath = storage();
      const tokenOnly = new ServerStore({ storagePath, installOnboardingChannels: false });
      stores.push(tokenOnly);
      const token = tokenOnly.authToken;

      // Serving with a bundle: the pre-initialized directory is fresh in the
      // no-content sense, so onboarding installs and focus moves.
      const serving = boot(storagePath, "two-channels");
      expect(serving.authToken).toBe(token);
      const channels = serving.listChannels();
      expect(channels.map((channel) => channel.name).sort()).toEqual(["First Screen", "Second Screen"]);
      expect(channels.some((channel) => channel.name === "Default")).toBe(false);
      const first = channels.find((channel) => channel.onboarding?.slug === "first")!;
      expect(serving.getFocusedChannelId()).toBe(first.id);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-default-invariant
  describe("Default-channel invariant", () => {
    it("a serving boot with no content root and zero channels creates Default", () => {
      const storagePath = storage();
      const store = boot(storagePath);
      const channels = store.listChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0]!.name).toBe("Default");
      expect(channels[0]!.onboarding).toBeUndefined();
      expect(existsSync(getDisplayStatePath(storagePath))).toBe(true);
      expect(store.getFocusedChannelId()).toBe(channels[0]!.id);
    });

    it("a serving boot with existing channels creates nothing", () => {
      const storagePath = storage();
      const first = boot(storagePath);
      const existing = first.createChannel({ name: "Mine" });
      first.dispose();

      const second = boot(storagePath);
      expect(second.listChannels().map((channel) => channel.name).sort()).toEqual(["Default", "Mine"]);
      expect(second.getChannel(existing.id)).toBeDefined();
    });

    it("deleting all installed channels yields Default on the next boot, never a reinstall", () => {
      const storagePath = storage();
      const installed = boot(storagePath, "two-channels");
      for (const channel of installed.listChannels()) {
        installed.removeChannel(channel.id);
      }
      installed.dispose();

      const next = boot(storagePath, "two-channels");
      const channels = next.listChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0]!.name).toBe("Default");
      expect(channels[0]!.layout).toEqual([]);
      expect(next.listArtifacts()).toEqual([]);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-exactly-once
  describe("Exactly-once per slug", () => {
    it("installs each configured channel once with slug-only markers and its artifacts' content at their copy names", () => {
      const storagePath = storage();
      const store = boot(storagePath, "two-channels");
      const channels = store.listChannels();
      expect(channels).toHaveLength(2);
      expect(store.listArtifacts()).toHaveLength(2);

      const first = channelBySlug(store, "first");
      expect(first.name).toBe("First Screen");
      expect(first.onboarding).toEqual({ slug: "first" });
      const [alphaID] = pageArtifactIDs(store, "first");
      expect(first.layout).toEqual([page(alphaID!)]);

      const second = channelBySlug(store, "second");
      expect(second.name).toBe("Second Screen");
      expect(second.onboarding).toEqual({ slug: "second" });
      const [betaID] = pageArtifactIDs(store, "second");
      expect(second.layout).toEqual([page(betaID!)]);

      expect(store.getArtifact(alphaID!)).toEqual(expect.objectContaining({
        kind: "path",
        title: "Alpha",
        path: copyPath(storagePath, `${ALPHA_COPY}.html`),
      }));
      expect(readFileSync(copyPath(storagePath, `${ALPHA_COPY}.html`), "utf8")).toContain("alpha content");

      expect(store.getArtifact(betaID!)).toEqual(expect.objectContaining({
        kind: "path",
        title: "Beta",
        path: copyPath(storagePath, BETA_COPY) + path.sep,
      }));
      expect(readFileSync(path.join(copyPath(storagePath, BETA_COPY), "index.html"), "utf8")).toContain("beta content");
      expect(readFileSync(path.join(copyPath(storagePath, BETA_COPY), "beta.css"), "utf8")).toContain("teal");

      expect(Object.keys(readState(storagePath).channels).sort()).toEqual(["first", "second"]);
    });

    it("a second boot against the same storage creates and modifies nothing", () => {
      const storagePath = storage();
      const first = boot(storagePath, "two-channels");
      const channelsBefore = first.listChannels().map((channel) => structuredClone(channel));
      first.dispose();
      const stateBefore = readFileSync(getOnboardingStatePath(storagePath), "utf8");

      const second = boot(storagePath, "two-channels");
      const channelsAfter = second.listChannels();
      expect(channelsAfter).toHaveLength(2);
      expect(channelsAfter.map((channel) => channel.id).sort()).toEqual(channelsBefore.map((channel) => channel.id).sort());
      for (const before of channelsBefore) {
        expect(channelsAfter.find((channel) => channel.id === before.id)).toEqual(before);
      }
      expect(readFileSync(getOnboardingStatePath(storagePath), "utf8")).toBe(stateBefore);
      expect(second.listArtifacts()).toHaveLength(2);
    });
  });

  describe("Migration", () => {
    const V1_TIMESTAMP = "2025-05-05T05:05:05.000Z";

    function writeV1Sentinel(storagePath: string, installedAt: unknown = V1_TIMESTAMP): string {
      seedStateDir(storagePath);
      const payload = `{ "version": 1,\n  "artifactID": "television-onboarding",\n  "installedAt": ${JSON.stringify(installedAt)} }\n`;
      writeFileSync(getOnboardingArtifactSentinelPath(storagePath), payload);
      return payload;
    }

    // proofs/arch/onboarding/installer.md#^t-migrate-v1
    it("migrates a v1 sentinel to v3 with tv-guide marked and the timestamp preserved", () => {
      const storagePath = storage();
      const sentinelBytes = writeV1Sentinel(storagePath);

      const store = boot(storagePath, "tv-guide-plus");
      const state = readState(storagePath);
      expect(state.channels["tv-guide"]).toEqual({ installedAt: V1_TIMESTAMP });
      expect(state.channels.extras).toBeDefined();
      // tv-guide is marked, so it does not install; only the newer channel does.
      expect(store.listChannels().map((channel) => channel.name)).toEqual(["Extras"]);
      expect(readFileSync(getOnboardingArtifactSentinelPath(storagePath), "utf8")).toBe(sentinelBytes);
    });

    it("uses migration time when the v1 timestamp is unusable", () => {
      const storagePath = storage();
      writeV1Sentinel(storagePath, "not-a-date");

      boot(storagePath, "tv-guide-plus");
      const record = readState(storagePath).channels["tv-guide"]!;
      expect(record.installedAt).not.toBe("not-a-date");
      expect(Number.isNaN(Date.parse(record.installedAt))).toBe(false);
    });

    // proofs/arch/onboarding/installer.md#^t-migrate-v2-field
    it("migrates authoritative v2 screens to v3 channels and makes the second boot byte-stable", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      const records = {
        "tv-guide": { installedAt: V1_TIMESTAMP },
        extras: { installedAt: "2026-01-01T00:00:00.000Z" },
      };
      writeFileSync(
        getOnboardingStatePath(storagePath),
        `{ "version": 2,\n  "screens": ${JSON.stringify(records)}\n}\n`,
      );

      boot(storagePath);
      const migrated = JSON.parse(readFileSync(getOnboardingStatePath(storagePath), "utf8"));
      expect(migrated).toEqual({ version: 3, channels: records });
      const migratedBytes = readFileSync(getOnboardingStatePath(storagePath), "utf8");

      boot(storagePath);
      expect(readFileSync(getOnboardingStatePath(storagePath), "utf8")).toBe(migratedBytes);
    });

    // proofs/arch/onboarding/installer.md#^t-migrate-legacy-v2
    it("adopts a valid v2 payload held at the legacy path with records unchanged", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      const legacyState: OnboardingStateV2 = {
        version: 2,
        screens: {
          "tv-guide": { installedAt: V1_TIMESTAMP },
          extras: { installedAt: "2026-01-01T00:00:00.000Z" },
        },
      };
      const legacyBytes = JSON.stringify(legacyState);
      writeFileSync(getOnboardingArtifactSentinelPath(storagePath), legacyBytes);

      const store = boot(storagePath, "tv-guide-plus");
      expect(readState(storagePath)).toEqual({ version: 3, channels: legacyState.screens });
      expect(readFileSync(getOnboardingArtifactSentinelPath(storagePath), "utf8")).toBe(legacyBytes);
      // Every configured slug is marked: nothing installs, Default appears.
      expect(store.listChannels().map((channel) => channel.name)).toEqual(["Default"]);
    });

    // proofs/arch/onboarding/installer.md#^t-migrate-artifact
    it("marks tv-guide when only the legacy artifact exists, without duplicating its content", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      mkdirSync(getChannelsDir(storagePath), { recursive: true });
      mkdirSync(path.join(storagePath, "state", "artifacts"), { recursive: true });
      const legacyContentDir = path.join(getAgentArtifactsDir(storagePath), "television-onboarding") + path.sep;
      mkdirSync(legacyContentDir, { recursive: true });
      writeFileSync(path.join(legacyContentDir, "index.html"), "<!doctype html>legacy welcome");
      writeFileSync(
        getArtifactLiveMetadataPath(storagePath, "television-onboarding"),
        JSON.stringify({ id: "television-onboarding", kind: "path", title: "Welcome to Television", path: legacyContentDir }),
      );
      writeFileSync(
        path.join(getChannelsDir(storagePath), "legacy-screen.json"),
        JSON.stringify({
          id: "legacy-screen",
          name: "TV Guide",
          layoutVersion: 2,
          layout: [page("television-onboarding")],
        }),
      );

      const store = boot(storagePath, "tv-guide-plus");
      expect(readState(storagePath).channels["tv-guide"]).toBeDefined();
      // No duplicate TV Guide: the only new channel is the newer one.
      expect(store.listChannels().map((channel) => channel.name).sort()).toEqual(["Extras", "TV Guide"]);
      expect(store.getArtifact("television-onboarding")!.title).toBe("Welcome to Television");
      expect(readFileSync(path.join(legacyContentDir, "index.html"), "utf8")).toBe("<!doctype html>legacy welcome");
      expect(existsSync(getOnboardingArtifactSentinelPath(storagePath))).toBe(false);
    });

    // proofs/arch/onboarding/installer.md#^t-migrate-no-bundle
    it.each(["v1", "v2"] as const)("migrates without a bundle from %s state", (version) => {
      const storagePath = storage();
      const expectedChannels: OnboardingStateV3["channels"] = version === "v1"
        ? { "tv-guide": { installedAt: V1_TIMESTAMP } }
        : {
            "tv-guide": { installedAt: V1_TIMESTAMP },
            extras: { installedAt: "2026-01-01T00:00:00.000Z" },
          };
      if (version === "v1") {
        writeV1Sentinel(storagePath);
      } else {
        seedStateDir(storagePath);
        writeFileSync(
          getOnboardingStatePath(storagePath),
          JSON.stringify({ version: 2, screens: expectedChannels } satisfies OnboardingStateV2),
        );
      }

      boot(storagePath);
      expect(readState(storagePath)).toEqual({ version: 3, channels: expectedChannels });
    });
  });

  // proofs/arch/onboarding/installer.md#^t-invalid-state
  describe("Invalid state file", () => {
    it("an unparseable onboarding.json disables installation and is left untouched", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      const torn = '{"version":3,"channels":{"tv-gu';
      writeFileSync(getOnboardingStatePath(storagePath), torn);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "two-channels");
        expect(store.listChannels().map((channel) => channel.name)).toEqual(["Default"]);
        expect(store.listArtifacts()).toEqual([]);
        expect(readFileSync(getOnboardingStatePath(storagePath), "utf8")).toBe(torn);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("an invalid legacy file, when it is the only state present, disables installation", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      writeFileSync(getOnboardingArtifactSentinelPath(storagePath), "not json");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "two-channels");
        expect(store.listChannels().map((channel) => channel.name)).toEqual(["Default"]);
        expect(existsSync(getOnboardingStatePath(storagePath))).toBe(false);
        expect(readFileSync(getOnboardingArtifactSentinelPath(storagePath), "utf8")).toBe("not json");
      } finally {
        warn.mockRestore();
      }
    });

    // Schema-invalid payloads are not install evidence either
    // (specs/arch/onboarding/installer.md#^invalid-state-conservative): they
    // disable installation for the boot and are left untouched.
    it("a schema-invalid legacy sentinel disables installation and migrates nothing", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      const wrongArtifact = JSON.stringify({ version: 1, artifactID: "something-else", installedAt: "2025-05-05T05:05:05.000Z" });
      writeFileSync(getOnboardingArtifactSentinelPath(storagePath), wrongArtifact);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "two-channels");
        expect(store.listChannels().map((channel) => channel.name)).toEqual(["Default"]);
        expect(store.listArtifacts()).toEqual([]);
        expect(existsSync(getOnboardingStatePath(storagePath))).toBe(false);
        expect(readFileSync(getOnboardingArtifactSentinelPath(storagePath), "utf8")).toBe(wrongArtifact);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("a schema-invalid onboarding.json disables installation and is left untouched", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      const badTimestamp = JSON.stringify({ version: 2, screens: { "tv-guide": { installedAt: "not-a-date" } } });
      writeFileSync(getOnboardingStatePath(storagePath), badTimestamp);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "two-channels");
        expect(store.listChannels().map((channel) => channel.name)).toEqual(["Default"]);
        expect(store.listArtifacts()).toEqual([]);
        expect(readFileSync(getOnboardingStatePath(storagePath), "utf8")).toBe(badTimestamp);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("a mixed screens/channels onboarding.json is rejected without a write", () => {
      const storagePath = storage();
      seedStateDir(storagePath);
      const mixed = JSON.stringify({
        version: 3,
        channels: { first: { installedAt: "2026-01-01T00:00:00.000Z" } },
        screens: { second: { installedAt: "2026-02-02T00:00:00.000Z" } },
      });
      writeFileSync(getOnboardingStatePath(storagePath), mixed);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "two-channels");
        expect(store.listChannels().map((channel) => channel.name)).toEqual(["Default"]);
        expect(store.listArtifacts()).toEqual([]);
        expect(readFileSync(getOnboardingStatePath(storagePath), "utf8")).toBe(mixed);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  // specs/arch/onboarding/installer.md#^bootstrap-sequence step 8: content
  // watchers start once, at the end of the serving bootstrap — never during
  // the install loop.
  describe("Watchers start last", () => {
    function recordingWatcher(starts: string[]) {
      return (watchPath: string) => {
        starts.push(watchPath);
        return { close: () => {}, on: () => undefined };
      };
    }

    it("a serving boot with an onboarding install starts exactly one watcher per artifact", () => {
      const storagePath = storage();
      const starts: string[] = [];
      const store = new ServerStore({
        storagePath,
        installOnboardingChannels: true,
        onboardingContentPath: bundle("two-channels"),
        watchContentFile: recordingWatcher(starts),
      });
      stores.push(store);
      expect(store.listArtifacts()).toHaveLength(2);
      expect(starts).toHaveLength(2);
    });

    it("token-only construction starts no watchers even over existing artifacts", () => {
      const storagePath = storage();
      const installed = boot(storagePath, "two-channels");
      installed.dispose();
      stores.splice(stores.indexOf(installed), 1);

      const starts: string[] = [];
      const store = new ServerStore({
        storagePath,
        installOnboardingChannels: false,
        watchContentFile: recordingWatcher(starts),
      });
      stores.push(store);
      expect(store.listArtifacts()).toHaveLength(2);
      expect(starts).toEqual([]);
    });
  });

  describe("Relative storage path", () => {
    // A store constructed directly with a relative storage path must still
    // install: artifact destinations derived from the path verbatim would be
    // rejected by the store's absolute-path rule. The constructor resolves the
    // storage path once, so every derived path (artifact destinations,
    // metadata, watchers, state files) is absolute. The CLI's relative --home
    // crossing is proofs/arch/cli/index.md#^cli-relative-home-seam.
    it("installs onboarding against a relative storage path", () => {
      const storagePath = storage();
      const relative = path.relative(process.cwd(), storagePath);
      expect(path.isAbsolute(relative)).toBe(false);

      const store = new ServerStore({
        storagePath: relative,
        installOnboardingChannels: true,
        onboardingContentPath: bundle("two-channels"),
      });
      stores.push(store);

      expect(store.listChannels().map((channel) => channel.name).sort()).toEqual(["First Screen", "Second Screen"]);
      const [alphaID] = pageArtifactIDs(store, "first");
      const alpha = store.getArtifact(alphaID!)!;
      expect(alpha.kind).toBe("path");
      expect(alpha.kind === "path" && path.isAbsolute(alpha.path)).toBe(true);
      expect(Object.keys(readState(storagePath).channels).sort()).toEqual(["first", "second"]);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-layout-install
  describe("Configured artifact order", () => {
    it("installs each configured artifact as one configured-or-default page in authored order", () => {
      const storagePath = storage();
      const store = boot(storagePath, "ordered-artifacts");

      const ids = pageArtifactIDs(store, "studio");
      expect(channelBySlug(store, "studio").layout).toEqual(studioPages(ids));
      expect(ids.map((id) => store.getArtifact(id)?.title)).toEqual(STUDIO_TITLES);
      expect(readState(storagePath).channels.studio).toBeDefined();
    });
  });

  // proofs/arch/onboarding/installer.md#^t-crash-retry
  describe("Crash retry converges", () => {
    function seedUnmarkedStudio(storagePath: string, layout: TabPage[] = []): void {
      seedStateDir(storagePath);
      mkdirSync(getChannelsDir(storagePath), { recursive: true });
      writeFileSync(
        path.join(getChannelsDir(storagePath), "crashed.json"),
        JSON.stringify({
          id: "crashed",
          name: "Studio",
          layoutVersion: 2,
          layout,
          onboarding: { slug: "studio" },
        }),
      );
    }

    /** An artifact an interrupted attempt created: its own ID, with content at its copy name. */
    function seedInterruptedArtifact(storagePath: string, id: string, copyName: string, title: string): void {
      mkdirSync(path.join(storagePath, "state", "artifacts"), { recursive: true });
      mkdirSync(getAgentArtifactsDir(storagePath), { recursive: true });
      const copied = copyPath(storagePath, `${copyName}.html`);
      writeFileSync(copied, `<!doctype html>partial ${title}`);
      writeFileSync(
        getArtifactLiveMetadataPath(storagePath, id),
        JSON.stringify({ id, kind: "path", title, path: copied }),
      );
    }

    function seedInterruptedStudioArtifact(
      storagePath: string,
      slug: typeof STUDIO_ARTIFACT_SLUGS[number],
    ): string {
      const id = `interrupted-${slug}`;
      seedInterruptedArtifact(storagePath, id, STUDIO_COPY_NAMES[STUDIO_ARTIFACT_SLUGS.indexOf(slug)]!, `Existing ${slug}`);
      return id;
    }

    /**
     * The retry created every configured artifact again, with generated IDs
     * none of the `interrupted` ones, configured titles and content at copy
     * names, and wrote the configured pages over them.
     */
    function expectRecreatedStudio(store: ServerStore, storagePath: string, interrupted: string[]): string[] {
      const ids = pageArtifactIDs(store, "studio");
      expect(channelBySlug(store, "studio").layout).toEqual(studioPages(ids));
      for (const [index, id] of ids.entries()) {
        expect(id).toMatch(GENERATED_ID);
        expect(interrupted).not.toContain(id);
        expect(store.getArtifact(id)).toEqual(expect.objectContaining({
          title: STUDIO_TITLES[index],
          path: copyPath(storagePath, `${STUDIO_COPY_NAMES[index]!}.html`),
        }));
      }
      return ids;
    }

    it("reuses a marker-carrying channel with no artifacts or pages", () => {
      const storagePath = storage();
      seedUnmarkedStudio(storagePath);

      const store = boot(storagePath, "ordered-artifacts");
      expect(store.listChannels()).toHaveLength(1);
      expect(channelBySlug(store, "studio").id).toBe("crashed");
      const ids = expectRecreatedStudio(store, storagePath, []);
      expect(store.listArtifacts().map((artifact) => artifact.id).sort()).toEqual([...ids].sort());
      expect(readState(storagePath).channels.studio).toBeDefined();
    });

    it("creates every configured artifact again beside some of an interrupted attempt's, and replaces partial pages whole", () => {
      const storagePath = storage();
      const main = seedInterruptedStudioArtifact(storagePath, "main");
      const left = seedInterruptedStudioArtifact(storagePath, "left");
      seedUnmarkedStudio(storagePath, [page(main)]);

      const store = boot(storagePath, "ordered-artifacts");
      expect(store.listChannels()).toHaveLength(1);
      expect(channelBySlug(store, "studio").id).toBe("crashed");
      const ids = expectRecreatedStudio(store, storagePath, [main, left]);
      // The interrupted attempt's artifacts stay, untouched and without pages.
      expect(store.getArtifact(main)!.title).toBe("Existing main");
      expect(store.getArtifact(left)!.title).toBe("Existing left");
      expect(store.listArtifacts().map((artifact) => artifact.id).sort()).toEqual([...ids, main, left].sort());
      expect(readState(storagePath).channels.studio).toBeDefined();
    });

    it("creates every configured artifact again when all of an interrupted attempt's exist, and replaces a partial page list", () => {
      const storagePath = storage();
      const interrupted = STUDIO_ARTIFACT_SLUGS.map((slug) => seedInterruptedStudioArtifact(storagePath, slug));
      seedUnmarkedStudio(storagePath, [page(interrupted[3]!), page(interrupted[1]!)]);

      const store = boot(storagePath, "ordered-artifacts");
      expect(channelBySlug(store, "studio").id).toBe("crashed");
      const ids = expectRecreatedStudio(store, storagePath, interrupted);
      for (const [index, slug] of STUDIO_ARTIFACT_SLUGS.entries()) {
        expect(store.getArtifact(interrupted[index]!)!.title).toBe(`Existing ${slug}`);
      }
      expect(store.listArtifacts()).toHaveLength(ids.length + interrupted.length);
      expect(readState(storagePath).channels.studio).toBeDefined();
    });

    it("marks a complete unmarked slug, creating its artifacts again without duplicating its channel or pages", () => {
      const storagePath = storage();
      const complete = boot(storagePath, "ordered-artifacts");
      const channelBefore = structuredClone(channelBySlug(complete, "studio"));
      const artifactsBefore = complete.listArtifacts().map((artifact) => structuredClone(artifact));
      complete.dispose();
      stores.splice(stores.indexOf(complete), 1);

      // Simulate a crash after the channel completed durably but before its
      // install record was committed.
      const stateWithoutStudio = readState(storagePath);
      delete stateWithoutStudio.channels.studio;
      writeFileSync(getOnboardingStatePath(storagePath), JSON.stringify(stateWithoutStudio));

      const store = boot(storagePath, "ordered-artifacts");
      expect(store.listChannels()).toHaveLength(1);
      expect(channelBySlug(store, "studio").id).toBe(channelBefore.id);
      const ids = expectRecreatedStudio(store, storagePath, artifactsBefore.map((artifact) => artifact.id));
      // The earlier attempt's artifacts stay as they were, without pages.
      for (const before of artifactsBefore) expect(store.getArtifact(before.id)).toEqual(before);
      expect(store.listArtifacts()).toHaveLength(ids.length + artifactsBefore.length);
      expect(readState(storagePath).channels.studio).toBeDefined();
    });

    it("neither reuses nor writes to the store of an earlier release's predictable-ID artifact for a slug that declares a store", () => {
      const storagePath = storage();
      // An earlier release's interrupted install: the marker-carrying channel,
      // and an artifact whose ID is the predictable form it was given then.
      const predictable = "television-onboarding--kitchen--list";
      seedStateDir(storagePath);
      seedInterruptedArtifact(storagePath, predictable, predictable, "List");
      mkdirSync(getChannelsDir(storagePath), { recursive: true });
      writeFileSync(
        path.join(getChannelsDir(storagePath), "crashed.json"),
        JSON.stringify({ id: "crashed", name: "Kitchen", layoutVersion: 2, layout: [page(predictable)], onboarding: { slug: "kitchen" } }),
      );

      const store = bootOnDay(storagePath, "declared-stores", INSTALL_DAY);
      const [listID, , notesID] = pageArtifactIDs(store, "kitchen");
      expect(listID).toMatch(GENERATED_ID);
      expect(store.getArtifact(predictable)).toEqual(expect.objectContaining({ title: "List" }));
      expect(storePointer(store, predictable)).toBeUndefined();
      expect(store.resources.list().map((resource) => resource.ownerArtifactID).sort()).toEqual([listID, notesID].sort());
      expect(store.resources.json.get({ artifactID: listID! }, "")).toEqual({ exists: true, value: SHIFTED_LIST });
      expect(readState(storagePath).channels.kitchen).toBeDefined();
    });
  });

  // The copy destination's extension follows the source file's
  // (specs/arch/onboarding/installer.md#^copy-overwrite-unmarked), so an
  // installed markdown source is an ordinary markdown path artifact.
  describe("Markdown file artifact", () => {
    it("installs a .md source at a .md destination as a path artifact", () => {
      const storagePath = storage();
      const store = boot(storagePath, "markdown-channel");

      const destination = copyPath(storagePath, `${GUIDE_COPY}.md`);
      const [guideID] = pageArtifactIDs(store, "notes");
      expect(store.getArtifact(guideID!)).toMatchObject({ kind: "path", title: "Guide", path: destination });
      expect(readFileSync(destination, "utf8"))
        .toBe(readFileSync(path.join(bundle("markdown-channel"), "notes", "guide.md"), "utf8"));
      expect(existsSync(copyPath(storagePath, `${GUIDE_COPY}.html`))).toBe(false);
      expect(readState(storagePath).channels.notes).toBeDefined();
    });
  });

  // proofs/arch/onboarding/installer.md#^t-overwrite-unmarked
  describe("Unmarked content is copied fresh", () => {
    it("replaces a truncated destination file under an unmarked slug", () => {
      const storagePath = storage();
      mkdirSync(getAgentArtifactsDir(storagePath), { recursive: true });
      writeFileSync(copyPath(storagePath, `${ALPHA_COPY}.html`), "<!doct");

      boot(storagePath, "two-channels");
      expect(readFileSync(copyPath(storagePath, `${ALPHA_COPY}.html`), "utf8"))
        .toContain("alpha content");
    });

    it("replaces a truncated .md destination file under an unmarked slug", () => {
      const storagePath = storage();
      mkdirSync(getAgentArtifactsDir(storagePath), { recursive: true });
      writeFileSync(copyPath(storagePath, `${GUIDE_COPY}.md`), "# Gu");

      boot(storagePath, "markdown-channel");
      expect(readFileSync(copyPath(storagePath, `${GUIDE_COPY}.md`), "utf8"))
        .toContain("Markdown onboarding fixture content");
    });

    it("replaces a file squatting at a directory artifact's destination", () => {
      // The wrong-kind overwrite works in both directions
      // (specs/arch/onboarding/installer.md#^copy-overwrite-unmarked): a file
      // left at the deterministic directory path is copied fresh too.
      const storagePath = storage();
      mkdirSync(getAgentArtifactsDir(storagePath), { recursive: true });
      const squattingFile = copyPath(storagePath, BETA_COPY);
      writeFileSync(squattingFile, "junk");

      const store = boot(storagePath, "two-channels");
      expect(readFileSync(path.join(squattingFile, "index.html"), "utf8")).toContain("beta");
      expect(Object.keys(readState(storagePath).channels).sort()).toEqual(["first", "second"]);
      expect(store.getArtifact(pageArtifactIDs(store, "second")[0]!)).toEqual(
        expect.objectContaining({ path: squattingFile + path.sep }),
      );
    });

    it("replaces a directory squatting at a file artifact's destination", () => {
      // The overwrite rule protects nothing under an unmarked slug: even a
      // directory left at the deterministic `.html` path (crash, manual edit,
      // or source-shape change) is copied fresh, not stuck retrying
      // (specs/arch/onboarding/installer.md#^copy-overwrite-unmarked).
      const storagePath = storage();
      const squattingDir = copyPath(storagePath, `${ALPHA_COPY}.html`);
      mkdirSync(squattingDir, { recursive: true });
      writeFileSync(path.join(squattingDir, "junk.txt"), "leftover");

      const store = boot(storagePath, "two-channels");
      expect(readFileSync(squattingDir, "utf8")).toContain("alpha content");
      expect(Object.keys(readState(storagePath).channels).sort()).toEqual(["first", "second"]);
      expect(store.getArtifact(pageArtifactIDs(store, "first")[0]!)).toEqual(
        expect.objectContaining({ path: squattingDir }),
      );
    });
  });

  // proofs/arch/onboarding/installer.md#^t-fire-forget
  describe("Fire-and-forget", () => {
    it("recreates, repairs, and overwrites nothing for marked slugs", () => {
      const storagePath = storage();
      const installed = boot(storagePath, "ordered-artifacts");
      const studio = channelBySlug(installed, "studio");
      const ids = pageArtifactIDs(installed, "studio");
      installed.updateChannel({ channelID: studio.id, fields: { name: "Renamed by user" } });
      installed.deleteArtifact(ids[2]!);
      const authoredPages = [
        page(ids[3]!),
        page(ids[0]!),
        page(ids[1]!),
      ];
      installed.updateChannel({ channelID: studio.id, fields: { layout: authoredPages } });
      const mainPath = copyPath(storagePath, `${STUDIO_COPY_NAMES[0]!}.html`);
      writeFileSync(mainPath, "<!doctype html>user edited");
      installed.dispose();
      stores.splice(stores.indexOf(installed), 1);

      const next = boot(storagePath, "ordered-artifacts");
      const unchanged = next.listChannels().find((channel) => channel.id === studio.id)!;
      expect(unchanged.name).toBe("Renamed by user");
      expect(unchanged.layout).toEqual(authoredPages);
      expect(next.getArtifact(ids[2]!)).toBeUndefined();
      expect(readFileSync(mainPath, "utf8")).toBe("<!doctype html>user edited");

      // A later deletion is equally final: the state mark outlives the user
      // content and suppresses another install on the following boot.
      next.removeChannel(studio.id);
      next.dispose();
      stores.splice(stores.indexOf(next), 1);
      const afterDeletion = boot(storagePath, "ordered-artifacts");
      expect(afterDeletion.listChannels()).toHaveLength(1);
      expect(afterDeletion.listChannels()[0]!.name).toBe("Default");
      expect(afterDeletion.listChannels()[0]!.onboarding).toBeUndefined();
      expect(afterDeletion.listArtifacts()).toEqual([]);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-fire-forget, for declared stores
  describe("Fire-and-forget for declared stores", () => {
    it("writes nothing to a marked slug's store that was changed or emptied", () => {
      const storagePath = storage();
      const installed = boot(storagePath, "declared-stores");
      const [listID, , notesID] = pageArtifactIDs(installed, "kitchen");
      installed.resources.json.write({ artifactID: listID! }, { kind: "set", path: "", value: { mine: true } });
      installed.resources.json.write({ artifactID: notesID! }, { kind: "remove", path: "" });
      const storeIDs = installed.resources.list().map((resource) => resource.resourceID).sort();
      installed.dispose();
      disposeLater(installed);

      const next = boot(storagePath, "declared-stores");
      expect(next.resources.json.get({ artifactID: listID! }, "")).toEqual({ exists: true, value: { mine: true } });
      expect(next.resources.json.get({ artifactID: notesID! }, "")).toEqual({ exists: false });
      expect(next.resources.list().map((resource) => resource.resourceID).sort()).toEqual(storeIDs);
      expect(next.listArtifacts()).toHaveLength(3);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-generated-ids
  describe("Generated artifact IDs", () => {
    it("gives each installed artifact a generated ID, different across installations and from its copy name, with its content at the copy name", () => {
      const installs = [storage(), storage()].map((storagePath) => {
        const store = boot(storagePath, "two-channels");
        const ids = [...pageArtifactIDs(store, "first"), ...pageArtifactIDs(store, "second")];
        const paths = ids.map((id) => {
          const artifact = store.getArtifact(id);
          return artifact?.kind === "path" ? artifact.path : undefined;
        });
        return { storagePath, ids, paths };
      });
      for (const { storagePath, ids, paths } of installs) {
        expect(ids).toHaveLength(2);
        for (const id of ids) {
          expect(id).toMatch(GENERATED_ID);
          expect([ALPHA_COPY, BETA_COPY]).not.toContain(id);
        }
        expect(paths).toEqual([copyPath(storagePath, `${ALPHA_COPY}.html`), copyPath(storagePath, BETA_COPY) + path.sep]);
        expect(readFileSync(paths[0]!, "utf8")).toContain("alpha content");
        expect(readFileSync(path.join(paths[1]!, "index.html"), "utf8")).toContain("beta content");
      }
      expect(installs[0]!.ids.filter((id) => installs[1]!.ids.includes(id))).toEqual([]);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-onboarding-stores
  describe("Declared stores", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function recordWarnings(): () => string[] {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      return () => warn.mock.calls.map((call) => call.map(String).join(" "));
    }

    it("writes each declared starting value as its artifact's store's first write, which a restart finds", () => {
      const warnings = recordWarnings();
      const storagePath = storage();
      const store = bootOnDay(storagePath, "declared-stores", INSTALL_DAY);
      const [listID, boardID, notesID] = pageArtifactIDs(store, "kitchen");
      expect(store.resources.json.get({ artifactID: listID! }, "")).toEqual({ exists: true, value: SHIFTED_LIST });
      // Without shiftDatesFrom, a date stays as declared.
      expect(store.resources.json.get({ artifactID: notesID! }, "")).toEqual({ exists: true, value: [1, "2026-07-08", {}] });
      // The artifact that declares no store has none written.
      expect(storePointer(store, boardID!)).toBeUndefined();
      expect(store.resources.json.get({ artifactID: boardID! }, "")).toEqual({ exists: false });
      // Each write was its store's first: the record points to the store, whose manifest names the artifact.
      for (const artifactID of [listID!, notesID!]) {
        const resourceID = storePointer(store, artifactID)!;
        const manifest = JSON.parse(readFileSync(path.join(storagePath, "resources", "json", resourceID, "manifest.json"), "utf8")) as { ownerArtifactID?: string };
        expect(manifest.ownerArtifactID).toBe(artifactID);
      }
      expect(store.resources.list().map((resource) => resource.ownerArtifactID).sort()).toEqual([listID, notesID].sort());
      expect(warnings()).toEqual([]);
      expect(readState(storagePath).channels.kitchen).toBeDefined();

      // Written durably: a restart, which installs nothing more, finds them.
      store.dispose();
      disposeLater(store);
      const restarted = boot(storagePath, "declared-stores");
      expect(restarted.resources.json.get({ artifactID: listID! }, "")).toEqual({ exists: true, value: SHIFTED_LIST });
      expect(restarted.resources.json.get({ artifactID: notesID! }, "")).toEqual({ exists: true, value: [1, "2026-07-08", {}] });
      expect(restarted.listArtifacts()).toHaveLength(3);
    });

    it("moves the starting value's calendar dates from shiftDatesFrom to the installation day, at every depth, leaving every other value as declared", () => {
      const storagePath = storage();
      const store = bootOnDay(storagePath, "declared-stores", new Date(2026, 6, 12, 23, 30));
      const [listID] = pageArtifactIDs(store, "kitchen");
      // Four calendar days, across a month's end; a date with a time, an
      // impossible date, other strings, a number and null stay as written.
      expect(store.resources.json.get({ artifactID: listID! }, "")).toEqual({
        exists: true,
        value: { items: { milk: true }, due: "2026-07-12", plan: [{ on: "2026-08-03" }, "2026-08-06", "2026-07-08T10:00:00", "2026-02-30", "due soon", 7, null] },
      });
      const backwards = bootOnDay(storage(), "declared-stores", new Date(2026, 6, 1, 0, 30));
      const [earlierID] = pageArtifactIDs(backwards, "kitchen");
      expect(backwards.resources.json.get({ artifactID: earlierID! }, "")).toEqual({
        exists: true,
        value: { items: { milk: true }, due: "2026-07-01", plan: [{ on: "2026-07-23" }, "2026-07-26", "2026-07-08T10:00:00", "2026-02-30", "due soon", 7, null] },
      });
    });

    it("installs and marks the channel when a starting value cannot be written, leaving the store with no value, and warns naming the artifact", () => {
      const storagePath = storage();
      // A file where the stores' directories must go: a real storage state.
      mkdirSync(path.join(storagePath, "resources"), { recursive: true });
      writeFileSync(path.join(storagePath, "resources", "json"), "not a directory");

      const warnings = recordWarnings();
      const store = boot(storagePath, "declared-stores");
      const [listID, , notesID] = pageArtifactIDs(store, "kitchen");
      expect(pageArtifactIDs(store, "kitchen")).toHaveLength(3);
      expect(readState(storagePath).channels.kitchen).toBeDefined();
      expect(store.resources.json.get({ artifactID: listID! }, "")).toEqual({ exists: false });
      expect(store.resources.json.get({ artifactID: notesID! }, "")).toEqual({ exists: false });
      const warned = warnings();
      expect(warned).toEqual([expect.stringContaining(listID!), expect.stringContaining(notesID!)]);
      expect(warned[0]).toContain('"list"');
      expect(readFileSync(path.join(storagePath, "resources", "json"), "utf8")).toBe("not a directory");
    });
  });

  // proofs/arch/onboarding/installer.md#^t-per-channel-persistence and
  // #^failure-containment
  describe("Per-channel persistence and failure containment", () => {
    it("marks exactly the completed channels when a later channel fails", () => {
      const storagePath = storage();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "second-broken");
        expect(Object.keys(readState(storagePath).channels)).toEqual(["good"]);
        expect(store.listChannels().map((channel) => channel.name)).toEqual(["Good Screen", "Broken Screen"]);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("a failing channel does not block later channels or startup", () => {
      const storagePath = storage();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const store = boot(storagePath, "first-broken");
        expect(Object.keys(readState(storagePath).channels)).toEqual(["good"]);
        const good = store.listChannels().find((channel) => channel.onboarding?.slug === "good")!;
        expect(good.layout).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });

    it("the failed channel retries and converges on the next boot once the source exists", () => {
      const storagePath = storage();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        boot(storagePath, "second-broken");
      } finally {
        warn.mockRestore();
      }
      // Same bundle, with the missing source now present: the retry completes
      // using the channel the failed attempt left behind.
      const repaired = storage();
      cpSync(bundle("second-broken"), repaired, { recursive: true });
      writeFileSync(path.join(repaired, "broken", "gone.html"), "<!doctype html>now present");

      const store = new ServerStore({
        storagePath,
        installOnboardingChannels: true,
        onboardingContentPath: repaired,
      });
      stores.push(store);
      expect(Object.keys(readState(storagePath).channels).sort()).toEqual(["broken", "good"]);
      const broken = store.listChannels().filter((channel) => channel.onboarding?.slug === "broken");
      expect(broken).toHaveLength(1);
      expect(broken[0]!.layout).toHaveLength(1);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-focus-matrix
  describe("Focus rule matrix", () => {
    it("moves focus to the designated channel on a no-content boot with zero channels", () => {
      const storagePath = storage();
      const store = boot(storagePath, "two-channels");
      const first = store.listChannels().find((channel) => channel.onboarding?.slug === "first")!;
      expect(store.getFocusedChannelId()).toBe(first.id);
    });

    it("moves focus when the store has only empty channels, including an earlier Default", () => {
      const storagePath = storage();
      const missingBundleBoot = boot(storagePath);
      expect(missingBundleBoot.listChannels()[0]!.name).toBe("Default");
      missingBundleBoot.createChannel({ name: "Empty user screen" });
      missingBundleBoot.dispose();
      stores.splice(stores.indexOf(missingBundleBoot), 1);

      const store = boot(storagePath, "two-channels");
      const first = store.listChannels().find((channel) => channel.onboarding?.slug === "first")!;
      expect(store.getFocusedChannelId()).toBe(first.id);
      expect(store.listChannels().map((channel) => channel.name).sort()).toEqual(
        ["Default", "Empty user screen", "First Screen", "Second Screen"],
      );
    });

    it("keeps focus when any artifact exists", () => {
      const storagePath = storage();
      const seeded = boot(storagePath);
      const defaultChannel = seeded.listChannels()[0]!;
      const target = path.join(storagePath, "user.html");
      writeFileSync(target, "<!doctype html>");
      seeded.createArtifact({ kind: "path", title: "User content", path: target, channelID: defaultChannel.id });
      seeded.dispose();
      stores.splice(stores.indexOf(seeded), 1);

      const store = boot(storagePath, "two-channels");
      expect(store.getFocusedChannelId()).toBe(defaultChannel.id);
      expect(store.listChannels()).toHaveLength(3);
    });

    it("keeps focus when the designated channel failed to install", () => {
      const storagePath = storage();
      // Establish real prior display state: an empty Default, active.
      const seeded = boot(storagePath);
      const defaultChannel = seeded.listChannels()[0]!;
      expect(seeded.getFocusedChannelId()).toBe(defaultChannel.id);
      seeded.dispose();
      stores.splice(stores.indexOf(seeded), 1);

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // first-broken designates "broken" as focusChannel; its install fails.
        // The store is no-content (only the empty Default), so the focus rule
        // would fire — but the designated channel did not install.
        const store = boot(storagePath, "first-broken");
        expect(store.getFocusedChannelId()).toBe(defaultChannel.id);
        expect(readState(storagePath).channels.good).toBeDefined();
      } finally {
        warn.mockRestore();
      }
    });
  });

  // proofs/arch/onboarding/installer.md#^t-datadir-capture
  describe("dataDirCreated capture parity", () => {
    it("captures the same values with and without a bundle", () => {
      const withBundle = storage();
      const firstWith = boot(withBundle, "two-channels");
      expect(firstWith.dataDirCreated).toBe(true);
      firstWith.dispose();
      const secondWith = boot(withBundle, "two-channels");
      expect(secondWith.dataDirCreated).toBe(false);

      const withoutBundle = storage();
      const firstWithout = boot(withoutBundle);
      expect(firstWithout.dataDirCreated).toBe(true);
      firstWithout.dispose();
      const secondWithout = boot(withoutBundle);
      expect(secondWithout.dataDirCreated).toBe(false);
    });
  });

  // proofs/arch/onboarding/installer.md#^t-no-telemetry — recording double at
  // the production attach point (hooks attach after construction).
  describe("No telemetry from install", () => {
    it("produces zero CRUD hook invocations for installer-created entities", () => {
      const storagePath = storage();
      const store = boot(storagePath, "two-channels");
      const calls: string[] = [];
      const recorder: ServerStoreTelemetryHooks = {
        appearanceModeChanged: () => {},
        artifactCreated: () => calls.push("artifactCreated"),
        artifactUpdated: () => calls.push("artifactUpdated"),
        artifactDeleted: () => calls.push("artifactDeleted"),
        channelCreated: () => calls.push("channelCreated"),
        channelUpdated: () => calls.push("channelUpdated"),
        channelDeleted: () => calls.push("channelDeleted"),
        channelLayoutChanged: () => calls.push("channelLayoutChanged"),
        channelPinsChanged: () => calls.push("channelPinsChanged"),
        themeChanged: () => calls.push("themeChanged"),
      };
      store.setTelemetryHooks(recorder);
      expect(calls).toEqual([]);

      // The recorder is live: an ordinary user action is captured.
      store.createChannel({ name: "User screen" });
      expect(calls).toEqual(["channelCreated"]);
    });
  });
});
