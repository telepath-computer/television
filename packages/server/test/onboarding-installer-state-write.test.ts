import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
} from "@telepath-computer/television-shared";
import {
  getAgentArtifactsDir,
  getArtifactLiveMetadataPath,
  getChannelsDir,
} from "../src/artifact-paths.ts";

// Contract on the installer-loop side of the installer → state-writer seam:
// a slug's completion mark is attempted only after its complete channel and
// artifact state is durable, and a transient mark-write failure cannot leak
// the failed slug into a later channel's successful write. In-memory state may
// only advance after its write is durable (specs/arch/onboarding/installer.md
// #^per-channel-persistence, #^failure-containment).
//
// The state writer is wrapped by a one-shot failing double (greenlit mock):
// a single write failure cannot be induced through real filesystem state —
// occupying the writer's temp path fails every write, not one. Forfeited by
// the wrapper: real-writer atomicity coverage, owned by
// onboarding-state.test.ts. Everything else (store, installer, filesystem)
// is real.

const writerControl = vi.hoisted(() => ({
  failuresRemaining: 0,
  writes: 0,
  beforeWrite: undefined as ((storagePath: string, state: unknown) => void) | undefined,
}));

vi.mock("../src/onboarding-state.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/onboarding-state.ts")>();
  return {
    ...actual,
    writeOnboardingStateFile: (storagePath: string, state: Parameters<typeof actual.writeOnboardingStateFile>[1]) => {
      writerControl.writes += 1;
      writerControl.beforeWrite?.(storagePath, state);
      if (writerControl.failuresRemaining > 0) {
        writerControl.failuresRemaining -= 1;
        throw new Error("injected one-shot state write failure");
      }
      actual.writeOnboardingStateFile(storagePath, state);
    },
  };
});

import { ServerStore } from "../src/server-store.ts";
import { readOnboardingStateFile } from "../src/onboarding-state.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function bundle(name: string): string {
  return path.join(here, "fixtures", "onboarding-bundles", name);
}

describe("Per-channel state writes stay consistent under transient failure", () => {
  const dirs: string[] = [];
  const stores: ServerStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    writerControl.failuresRemaining = 0;
    writerControl.writes = 0;
    writerControl.beforeWrite = undefined;
  });

  function boot(storagePath: string, options: { withBundle?: boolean } = {}): ServerStore {
    const store = new ServerStore({
      storagePath,
      installOnboardingChannels: true,
      ...(options.withBundle === false ? {} : { onboardingContentPath: bundle("two-channels") }),
    });
    stores.push(store);
    return store;
  }

  it("attempts a slug's completion mark only after all artifact metadata and pages are persisted", () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-onboarding-mark-last-"));
    dirs.push(storagePath);
    // An interrupted attempt's artifacts, which the retry creates again with
    // generated IDs (specs/arch/onboarding/installer.md#^artifact-create).
    const interruptedIDs = ["main", "side", "left", "right"].map((slug) => `interrupted-${slug}`);
    const copyNames = ["main", "side", "left", "right"].map((slug) => `television-onboarding--studio--${slug}`);
    const generatedID = expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/) as unknown as string;
    const expectedPages = [
      {
        artifactIds: [generatedID],
        geometry: { ...DEFAULT_PAGE_GEOMETRY },
        size: { width: 960.5, height: 640.25 },
      },
      {
        artifactIds: [generatedID],
        geometry: { kind: "single" as const, full_screen: true },
        size: { ...DEFAULT_PAGE_SIZE },
      },
      {
        artifactIds: [generatedID],
        geometry: { kind: "single" as const, full_screen: true },
        size: { width: 720, height: 480 },
      },
      {
        artifactIds: [generatedID],
        geometry: { ...DEFAULT_PAGE_GEOMETRY },
        size: { ...DEFAULT_PAGE_SIZE },
      },
    ];
    const interruptedPage = (artifactID: string) => ({
      artifactIds: [artifactID],
      geometry: { ...DEFAULT_PAGE_GEOMETRY },
      size: { ...DEFAULT_PAGE_SIZE },
    });

    // Make the whole-page write observable: the marker-matched channel has a
    // partial, misordered page list over the interrupted attempt's artifacts,
    // and createArtifact appends a page per new artifact, so only a whole
    // write leaves exactly the configured pages.
    mkdirSync(getChannelsDir(storagePath), { recursive: true });
    writeFileSync(
      path.join(getChannelsDir(storagePath), "crashed.json"),
      JSON.stringify({
        id: "crashed",
        name: "Studio",
        layoutVersion: 2,
        layout: [interruptedPage(interruptedIDs[3]!), interruptedPage(interruptedIDs[1]!)],
        onboarding: { slug: "studio" },
      }),
    );
    mkdirSync(path.dirname(getArtifactLiveMetadataPath(storagePath, interruptedIDs[0]!)), { recursive: true });
    mkdirSync(getAgentArtifactsDir(storagePath), { recursive: true });
    for (const [index, artifactID] of interruptedIDs.entries()) {
      const copied = path.join(getAgentArtifactsDir(storagePath), `${copyNames[index]!}.html`);
      writeFileSync(copied, "<!doctype html>partial");
      writeFileSync(
        getArtifactLiveMetadataPath(storagePath, artifactID),
        JSON.stringify({ id: artifactID, kind: "path", title: "Existing", path: copied }),
      );
    }

    let observation: {
      storagePath: string;
      state: unknown;
      layout: unknown;
      artifactMetadataExists: boolean[];
    } | undefined;
    writerControl.beforeWrite = (writtenStoragePath, state) => {
      const channelRecords = readdirSync(getChannelsDir(storagePath))
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => JSON.parse(readFileSync(path.join(getChannelsDir(storagePath), entry), "utf8")));
      const studio = channelRecords.find((channel) => channel.onboarding?.slug === "studio");
      const pageArtifactIDs: string[] = (studio?.layout ?? []).flatMap((tabPage: { artifactIds: string[] }) => tabPage.artifactIds);
      observation = {
        storagePath: writtenStoragePath,
        state: structuredClone(state),
        layout: structuredClone(studio?.layout),
        artifactMetadataExists: pageArtifactIDs.map(
          (artifactID) => existsSync(getArtifactLiveMetadataPath(storagePath, artifactID)),
        ),
      };
    };

    const store = new ServerStore({
      storagePath,
      installOnboardingChannels: true,
      onboardingContentPath: bundle("ordered-artifacts"),
    });
    stores.push(store);

    // Assertions must live outside the installer callback: production catches
    // callback failures to contain onboarding errors and keep startup alive.
    expect(observation).toEqual({
      storagePath,
      state: {
        version: 3,
        channels: { studio: { installedAt: expect.any(String) } },
      },
      layout: expectedPages,
      artifactMetadataExists: [true, true, true, true],
    });
    expect(writerControl.writes).toBe(1);
    const persisted = readOnboardingStateFile(storagePath);
    expect(persisted.status).toBe("ok");
    if (persisted.status === "ok") {
      expect(persisted.state.channels.studio).toEqual({ installedAt: expect.any(String) });
    }
  });

  it("a failed mark write is not persisted by a later channel's successful write", () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-onboarding-write-fail-"));
    dirs.push(storagePath);
    // Establish real prior display state (an empty Default, active) so the
    // focus assertion below is observable: on a fresh directory, display
    // *initialization* would pick a channel regardless of the focus rule.
    const seeded = boot(storagePath, { withBundle: false });
    const defaultChannel = seeded.listChannels()[0]!;
    expect(seeded.getFocusedChannelId()).toBe(defaultChannel.id);
    seeded.dispose();
    stores.splice(stores.indexOf(seeded), 1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writerControl.failuresRemaining = 1; // fail exactly the first channel's mark write
    try {
      const store = boot(storagePath);
      expect(writerControl.writes).toBe(2);
      // Both channels installed (the install itself succeeded; only the first
      // mark write failed transiently)...
      expect(store.listChannels().map((channel) => channel.onboarding?.slug).sort())
        .toEqual(["first", "second", undefined]);
      // ...but the persisted state marks exactly the channel whose own write
      // succeeded. The failed slug must not ride along on the later write.
      const persisted = readOnboardingStateFile(storagePath);
      expect(persisted.status).toBe("ok");
      if (persisted.status === "ok") {
        expect(Object.keys(persisted.state.channels)).toEqual(["second"]);
      }
      // Focus: "first" is the designated channel but did not complete its
      // install (the mark write failed), so the focus rule must not fire —
      // the pre-existing Default stays active
      // (specs/arch/onboarding/installer.md#^onboarding-focus-rule).
      expect(store.getFocusedChannelId()).toBe(defaultChannel.id);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("the unmarked slug retries and converges on the next boot", () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-onboarding-write-fail-"));
    dirs.push(storagePath);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writerControl.failuresRemaining = 1;
    try {
      const firstBoot = boot(storagePath);
      const channelsBefore = firstBoot.listChannels().map((channel) => structuredClone(channel));
      firstBoot.dispose();
      stores.splice(stores.indexOf(firstBoot), 1);

      const secondBoot = boot(storagePath);
      const persisted = readOnboardingStateFile(storagePath);
      expect(persisted.status).toBe("ok");
      if (persisted.status === "ok") {
        expect(Object.keys(persisted.state.channels).sort()).toEqual(["first", "second"]);
      }
      // Crash retry: no duplicate channels or pages. The marked channel is
      // untouched; the retried one keeps its identity and writes its one page
      // over the artifact it created again, leaving the earlier artifact
      // without a page (specs/arch/onboarding/installer.md#^artifact-ids).
      expect(secondBoot.listChannels()).toHaveLength(2);
      const firstBefore = channelsBefore.find((channel) => channel.onboarding?.slug === "first")!;
      const secondBefore = channelsBefore.find((channel) => channel.onboarding?.slug === "second")!;
      expect(secondBoot.listChannels().find((channel) => channel.id === secondBefore.id)).toEqual(secondBefore);
      const firstAfter = secondBoot.listChannels().find((channel) => channel.id === firstBefore.id)!;
      expect({ ...firstAfter, layout: [] }).toEqual({ ...firstBefore, layout: [] });
      expect(firstAfter.layout).toHaveLength(1);
      expect(firstAfter.layout[0]!.artifactIds).toHaveLength(1);
      expect(firstAfter.layout[0]!.artifactIds[0]).not.toBe(firstBefore.layout[0]!.artifactIds[0]);
    } finally {
      warn.mockRestore();
    }
  });
});
