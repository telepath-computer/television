import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE } from "@telepath-computer/television-shared";
import {
  backfillStoredChannelPageSizes,
  convertStoredChannelRecord,
  convertStoredDisplayRecord,
  type CurrentStoredChannelRecord,
  type CurrentStoredDisplayRecord,
  type IntermediateStoredChannelRecord,
  type LegacyStoredChannelRecord,
  type LegacyStoredDisplayRecord,
} from "./redesign-record-migration.ts";

const DEFAULT_PRE_SIZE_PAGE = {
  geometry: { kind: "single", full_screen: false },
} as const;

describe("redesign record conversion", () => {
  describe("stored channel records", () => {
    it("converts a numeric-sized card to one default page without mutating the input", () => {
      const input: LegacyStoredChannelRecord = {
        id: "channel-a",
        name: "A",
        layout: [{ type: "card", artifactID: "artifact-a", width: 3, height: 4 }],
        futureSibling: { preserved: true },
      };
      const before = structuredClone(input);

      expect(convertStoredChannelRecord(input)).toEqual({
        id: "channel-a",
        name: "A",
        layoutVersion: 2,
        layout: [{ artifactIds: ["artifact-a"], ...DEFAULT_PRE_SIZE_PAGE }],
        futureSibling: { preserved: true },
      });
      expect(input).toEqual(before);
    });

    it("traverses a top-level row from left to right and drops auto sizing", () => {
      const input: LegacyStoredChannelRecord = {
        id: "channel-row",
        name: "Row",
        layout: [{
          id: "row-a",
          type: "row",
          height: "auto",
          children: [
            { type: "card", artifactID: "left", width: 2, height: "auto" },
            { type: "card", artifactID: "right", width: 2, height: "auto" },
          ],
        }],
      };

      expect(convertStoredChannelRecord(input).layout).toEqual([
        { artifactIds: ["left"], ...DEFAULT_PRE_SIZE_PAGE },
        { artifactIds: ["right"], ...DEFAULT_PRE_SIZE_PAGE },
      ]);
    });

    it("traverses stack children top to bottom and each nested row left to right", () => {
      const input: LegacyStoredChannelRecord = {
        id: "channel-stack",
        name: "Stack",
        layout: [{
          id: "stack-a",
          type: "stack",
          children: [
            { type: "card", artifactID: "top", width: "auto", height: 2 },
            {
              id: "row-a",
              type: "row",
              height: 2,
              children: [
                { type: "card", artifactID: "middle-left", width: 2, height: 2 },
                { type: "card", artifactID: "middle-right", width: 2, height: 2 },
              ],
            },
            { type: "card", artifactID: "bottom", width: "auto", height: "auto" },
          ],
        }],
      };

      expect(convertStoredChannelRecord(input).layout).toEqual([
        { artifactIds: ["top"], ...DEFAULT_PRE_SIZE_PAGE },
        { artifactIds: ["middle-left"], ...DEFAULT_PRE_SIZE_PAGE },
        { artifactIds: ["middle-right"], ...DEFAULT_PRE_SIZE_PAGE },
        { artifactIds: ["bottom"], ...DEFAULT_PRE_SIZE_PAGE },
      ]);
    });

    it("preserves mixed top-level traversal while slimming the onboarding marker to its slug", () => {
      const input: LegacyStoredChannelRecord = {
        id: "channel-mixed",
        name: "Mixed",
        layout: [
          { type: "card", artifactID: "first", width: "auto", height: "auto" },
          {
            id: "stack-a",
            type: "stack",
            children: [
              { type: "card", artifactID: "second", width: "auto", height: 3 },
              { type: "card", artifactID: "third", width: "auto", height: 3 },
            ],
          },
          { type: "card", artifactID: "fourth", width: 4, height: 6 },
        ],
        onboarding: { slug: "starter", order: 7 },
      };

      expect(convertStoredChannelRecord(input)).toEqual({
        id: "channel-mixed",
        name: "Mixed",
        layoutVersion: 2,
        layout: ["first", "second", "third", "fourth"].map((artifactID) => ({
          artifactIds: [artifactID],
          ...DEFAULT_PRE_SIZE_PAGE,
        })),
        onboarding: { slug: "starter" },
      });
    });

    it("converts an empty layout to an empty version-2 layout", () => {
      const input: LegacyStoredChannelRecord = { id: "channel-empty", name: "Empty", layout: [] };

      expect(convertStoredChannelRecord(input)).toEqual({
        id: "channel-empty",
        name: "Empty",
        layoutVersion: 2,
        layout: [],
      });
    });

    it("slims a legacy marker on a version-2 intermediate record without rebuilding its pages", () => {
      const input: IntermediateStoredChannelRecord = {
        id: "channel-intermediate",
        name: "Intermediate",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a", "artifact-b"],
          geometry: { kind: "single", full_screen: true },
          size: { width: 600, height: 700 },
        }],
        onboarding: { slug: "starter", order: 7 },
        futureSibling: { preserved: true },
      };

      const before = structuredClone(input);
      const converted = convertStoredChannelRecord(input);

      expect(converted).toEqual({
        id: "channel-intermediate",
        name: "Intermediate",
        layoutVersion: 2,
        layout: input.layout,
        onboarding: { slug: "starter" },
        futureSibling: { preserved: true },
      });
      expect(converted.layout).toBe(input.layout);
      expect(input).toEqual(before);
    });

    it("returns a version-2 sizeless record without a legacy marker unchanged", () => {
      const input = {
        id: "channel-pre-size",
        name: "Pre-size",
        layoutVersion: 2 as const,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single" as const, full_screen: false },
        }],
      };

      expect(convertStoredChannelRecord(input)).toBe(input);
    });

    it("backfills missing sizes without replacing pages that already carry one", () => {
      const sizedPage = {
        artifactIds: ["artifact-b"],
        geometry: { kind: "single", full_screen: true } as const,
        size: { width: 601.5, height: 702.25 },
      };
      const ignoredMarker = { slug: "not-legacy", order: 7, extra: true };
      const futureSibling = { preserved: true };
      const input = {
        id: "channel-pre-size",
        name: "Pre-size",
        layoutVersion: 2 as const,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single" as const, full_screen: false },
        }, sizedPage],
        onboarding: ignoredMarker,
        futureSibling,
      };
      const before = structuredClone(input);

      const converted = backfillStoredChannelPageSizes(input);

      expect(converted).toEqual({
        id: "channel-pre-size",
        name: "Pre-size",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a"],
          geometry: { kind: "single", full_screen: false },
          size: DEFAULT_PAGE_SIZE,
        }, sizedPage],
        onboarding: ignoredMarker,
        futureSibling,
      });
      expect(converted.layout[1]).toBe(sizedPage);
      expect(converted.onboarding).toBe(ignoredMarker);
      expect(converted.futureSibling).toBe(futureSibling);
      expect(input).toEqual(before);
    });

    it("returns an already-current channel record unchanged", () => {
      const input: CurrentStoredChannelRecord = {
        id: "channel-current",
        name: "Current",
        layoutVersion: 2,
        layout: [{
          artifactIds: ["artifact-a", "artifact-b"],
          geometry: { kind: "single", full_screen: true },
          size: { width: 601.5, height: 702.25 },
        }],
        onboarding: { slug: "starter" },
        futureSibling: [2, 1],
      };

      expect(convertStoredChannelRecord(input)).toBe(input);
    });
  });

  describe("pre-redesign display records", () => {
    it("carries valid focus, initializes empty pins, and preserves unrelated fields without mutation", () => {
      const input: LegacyStoredDisplayRecord = {
        activeChannelID: "channel-b",
        activeThemeName: "paper",
        acpEnabled: true,
        futureSibling: { preserved: true },
      };
      const before = structuredClone(input);

      expect(convertStoredDisplayRecord(input, ["channel-a", "channel-b"])).toEqual({
        focusedChannelId: "channel-b",
        pinnedChannelIds: [],
        activeThemeName: "paper",
        acpEnabled: true,
        futureSibling: { preserved: true },
      });
      expect(input).toEqual(before);
    });

    it("resolves dangling focus by the store's localeCompare successor independent of supplied order", () => {
      const input: LegacyStoredDisplayRecord = {
        activeChannelID: "missing",
        activeThemeName: null,
      };

      expect(convertStoredDisplayRecord(input, ["channel-middle", "channel-Z", "channel-a"])).toEqual({
        focusedChannelId: "channel-Z",
        pinnedChannelIds: [],
        activeThemeName: null,
      });
    });

    it("resolves null old focus through the same successor rule and yields null when no channel exists", () => {
      const input: LegacyStoredDisplayRecord = { activeChannelID: null, activeThemeName: null };

      expect(convertStoredDisplayRecord(input, ["channel-a", "channel-z"])).toMatchObject({
        focusedChannelId: "channel-z",
        pinnedChannelIds: [],
      });
      expect(convertStoredDisplayRecord(input, [])).toMatchObject({
        focusedChannelId: null,
        pinnedChannelIds: [],
      });
    });

    it("returns its own converted output unchanged", () => {
      const channelIds = ["channel-a", "channel-b"];
      const converted = convertStoredDisplayRecord({ activeChannelID: "channel-a" }, channelIds);

      expect(convertStoredDisplayRecord(converted, channelIds)).toBe(converted);
    });

    it("returns an already-current display record unchanged with its existing pin order", () => {
      const input: CurrentStoredDisplayRecord = {
        focusedChannelId: "channel-b",
        pinnedChannelIds: ["channel-b", "channel-a"],
        activeThemeName: "paper",
        acpEnabled: false,
      };

      expect(convertStoredDisplayRecord(input, ["channel-a", "channel-b"])).toBe(input);
    });
  });
});
