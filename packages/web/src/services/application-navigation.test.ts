// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  isNavigationKeyChord,
  type NavigationKeyChordInput,
} from "@telepath-computer/television-artifact/browser";
import type {
  ApplicationChannelSnapshot,
  ApplicationPageSnapshot,
  ApplicationSnapshot,
} from "./application-service.ts";
import { DEFAULT_PAGE_SIZE } from "@telepath-computer/television-shared";
import { handleApplicationNavigationKey } from "./application-navigation.ts";

const EMPTY_CONNECTION: ApplicationSnapshot["connection"] = {
  authorizationRequired: false,
  authorizationRejected: false,
  gateHalted: false,
  status: "connected",
  hasEverConnected: true,
  firstConnectError: null,
  nextRetryAt: null,
  upgradeInstructions: null,
};

function chord(
  overrides: Partial<NavigationKeyChordInput> = {},
): NavigationKeyChordInput {
  return {
    key: "ArrowLeft",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  };
}

function applicationPage(artifactId: string): ApplicationPageSnapshot {
  return {
    artifactIds: [artifactId],
    geometry: { kind: "single", full_screen: false },
    size: DEFAULT_PAGE_SIZE,
  };
}

function applicationChannel(
  id: string,
  artifactIds: readonly string[],
  selectedIndex = 0,
): ApplicationChannelSnapshot {
  const pages = artifactIds.map(applicationPage);
  return {
    id,
    name: id,
    pages,
    selectedPage: pages[selectedIndex] ?? null,
    artifacts: [],
  };
}

function applicationSnapshot(
  channels: readonly ApplicationChannelSnapshot[],
  focusedChannelId: string | null,
  pinnedChannelIds: readonly string[] = [],
): ApplicationSnapshot {
  return {
    ready: true,
    channels,
    display: {
      focusedChannelId,
      pinnedChannelIds,
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    },
    focusedChannel: channels.find(({ id }) => id === focusedChannelId) ?? null,
    connection: EMPTY_CONNECTION,
  };
}

function navigationTarget(snapshot: ApplicationSnapshot): {
  snapshot: ApplicationSnapshot;
  selectPage: Mock<(channelId: string, artifactId: string) => void>;
  focusChannel: Mock<(channelId: string) => Promise<void>>;
} {
  return {
    snapshot,
    selectPage: vi.fn(),
    focusChannel: vi.fn(async () => undefined),
  };
}

function focusInput(): HTMLInputElement {
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  expect(document.activeElement).toBe(input);
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("shell navigation chord predicate (^kbn-ac-shell-predicate)", () => {
  it("matches only the platform modifier and physical arrows, including repeat", () => {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
    const rows: Array<{
      platform: string;
      input: NavigationKeyChordInput;
      expected: boolean;
    }> = [];

    for (const platform of ["MacIntel", "darwin"]) {
      for (const key of arrows) {
        rows.push(
          { platform, input: chord({ key, altKey: true }), expected: true },
          { platform, input: chord({ key, altKey: true, repeat: true }), expected: true },
        );
      }
      rows.push(
        { platform, input: chord(), expected: false },
        { platform, input: chord({ ctrlKey: true }), expected: false },
        { platform, input: chord({ altKey: true, ctrlKey: true }), expected: false },
        { platform, input: chord({ altKey: true, shiftKey: true }), expected: false },
        { platform, input: chord({ altKey: true, metaKey: true }), expected: false },
        { platform, input: chord({ altKey: true, isComposing: true }), expected: false },
        { platform, input: chord({ altKey: true, key: "Enter" }), expected: false },
      );
    }

    for (const platform of ["Win32", "Linux x86_64"]) {
      for (const key of arrows) {
        rows.push(
          { platform, input: chord({ key, ctrlKey: true }), expected: true },
          { platform, input: chord({ key, ctrlKey: true, repeat: true }), expected: true },
        );
      }
      rows.push(
        { platform, input: chord(), expected: false },
        { platform, input: chord({ altKey: true }), expected: false },
        { platform, input: chord({ ctrlKey: true, altKey: true }), expected: false },
        { platform, input: chord({ ctrlKey: true, shiftKey: true }), expected: false },
        { platform, input: chord({ ctrlKey: true, metaKey: true }), expected: false },
        { platform, input: chord({ ctrlKey: true, isComposing: true }), expected: false },
        { platform, input: chord({ ctrlKey: true, key: "Home" }), expected: false },
      );
    }

    for (const row of rows) {
      expect(
        isNavigationKeyChord(row.input, row.platform),
        `${row.platform}: ${JSON.stringify(row.input)}`,
      ).toBe(row.expected);
    }
  });
});

describe("application navigation handler (^kbn-policy-point)", () => {
  it("steps bounded page order through selectPage and blurs only successful moves", () => {
    const channel = applicationChannel("channel-a", ["artifact-a", "artifact-b", "artifact-c"], 1);
    const application = navigationTarget(applicationSnapshot([channel], channel.id));

    const leftInput = focusInput();
    expect(handleApplicationNavigationKey(application, "ArrowLeft")).toBe(true);
    expect(application.selectPage).toHaveBeenLastCalledWith(channel.id, "artifact-a");
    expect(document.activeElement).not.toBe(leftInput);

    application.selectPage.mockClear();
    application.snapshot = applicationSnapshot([
      { ...channel, selectedPage: channel.pages[1]! },
    ], channel.id);
    const rightInput = focusInput();
    expect(handleApplicationNavigationKey(application, "ArrowRight")).toBe(true);
    expect(application.selectPage).toHaveBeenLastCalledWith(channel.id, "artifact-c");
    expect(document.activeElement).not.toBe(rightInput);

    for (const [selectedIndex, key] of [[0, "ArrowLeft"], [2, "ArrowRight"]] as const) {
      application.selectPage.mockClear();
      application.snapshot = applicationSnapshot([
        { ...channel, selectedPage: channel.pages[selectedIndex]! },
      ], channel.id);
      const input = focusInput();
      expect(handleApplicationNavigationKey(application, key)).toBe(false);
      expect(application.selectPage).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      input.remove();
    }
  });

  it("steps pinned then descending unpinned channel order through focusChannel", () => {
    const oldest = applicationChannel("01J00000000000000000000001", []);
    const pinnedSecond = applicationChannel("01J00000000000000000000004", []);
    const newest = applicationChannel("01J00000000000000000000009", []);
    const pinnedFirst = applicationChannel("01J00000000000000000000002", []);
    const middle = applicationChannel("01J00000000000000000000005", []);
    const channels = [oldest, pinnedSecond, newest, pinnedFirst, middle];
    const pins = [pinnedFirst.id, pinnedSecond.id];
    const application = navigationTarget(applicationSnapshot(channels, pinnedSecond.id, pins));

    const downInput = focusInput();
    expect(handleApplicationNavigationKey(application, "ArrowDown")).toBe(true);
    expect(application.focusChannel).toHaveBeenLastCalledWith(newest.id);
    expect(document.activeElement).not.toBe(downInput);

    application.focusChannel.mockClear();
    application.snapshot = applicationSnapshot(channels, newest.id, pins);
    const upInput = focusInput();
    expect(handleApplicationNavigationKey(application, "ArrowUp")).toBe(true);
    expect(application.focusChannel).toHaveBeenLastCalledWith(pinnedSecond.id);
    expect(document.activeElement).not.toBe(upInput);

    for (const [focusedId, key] of [
      [pinnedFirst.id, "ArrowUp"],
      [oldest.id, "ArrowDown"],
    ] as const) {
      application.focusChannel.mockClear();
      application.snapshot = applicationSnapshot(channels, focusedId, pins);
      const input = focusInput();
      expect(handleApplicationNavigationKey(application, key)).toBe(false);
      expect(application.focusChannel).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      input.remove();
    }
  });

  it("does nothing without a current page or focused channel", () => {
    const empty = applicationChannel("channel-empty", []);
    const application = navigationTarget(applicationSnapshot([empty], empty.id));
    const input = focusInput();

    expect(handleApplicationNavigationKey(application, "ArrowRight")).toBe(false);
    application.snapshot = applicationSnapshot([empty], null);
    expect(handleApplicationNavigationKey(application, "ArrowDown")).toBe(false);
    expect(application.selectPage).not.toHaveBeenCalled();
    expect(application.focusChannel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
});
