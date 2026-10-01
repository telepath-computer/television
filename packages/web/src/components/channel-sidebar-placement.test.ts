import { describe, expect, it } from "vitest";
import {
  calculateChannelSidebarPlacement,
  type ChannelSidebarPlacementInput,
} from "./channel-sidebar-placement.ts";

const defaultInput = (): ChannelSidebarPlacementInput => ({
  source: {
    channelId: "05",
    pinnedChannelIds: ["09", "05", "03"],
    unpinnedChannelIds: ["08", "06", "04", "02"],
  },
  current: {
    pinnedChannelIds: ["09", "05", "03"],
    unpinnedChannelIds: ["08", "06", "04", "02"],
  },
  pointer: { x: 100, y: 50 },
  geometry: {
    sidebar: { left: 0, right: 300, top: 0, bottom: 500 },
    pinnedRows: [
      { channelId: "09", top: 20, bottom: 40 },
      { channelId: "03", top: 60, bottom: 80 },
    ],
    unpinnedGroupTop: 150,
    pinnedContentBottom: 120,
    placeholder: null,
  },
});

const calculate = (
  update: (input: ChannelSidebarPlacementInput) => void,
) => {
  const input = defaultInput();
  update(input);
  return calculateChannelSidebarPlacement(input);
};

describe("calculateChannelSidebarPlacement", () => {
  const middlePointerY = 50;
  const afterLastPinnedPointerY = 140;

  it.each([
    ["beginning", 10, 0, ["05", "09", "03"]],
    ["middle", middlePointerY, 1, ["09", "05", "03"]],
    ["end", 100, 2, ["09", "03", "05"]],
    ["space after the last row", afterLastPinnedPointerY, 2, ["09", "03", "05"]],
  ] as const)("places a pinned row at the %s slot", (_label, y, index, pinnedChannelIds) => {
    const result = calculate((input) => {
      input.pointer.y = y;
    });

    expect(result).toEqual({
      kind: "placement",
      side: "pinned",
      placeholder: { side: "pinned", index },
      operation: pinnedChannelIds,
    });
  });

  it("keeps the current pinned placeholder while the pointer remains inside it", () => {
    const result = calculate((input) => {
      input.pointer.y = 72;
      input.geometry.placeholder = {
        side: "pinned",
        index: 1,
        top: 45,
        bottom: 75,
      };
    });

    expect(result).toMatchObject({
      kind: "placement",
      side: "pinned",
      placeholder: { side: "pinned", index: 1 },
    });
  });

  it("uses the unpinned heading as the group boundary", () => {
    const before = calculate((input) => {
      input.pointer.y = 149;
    });
    const at = calculate((input) => {
      input.pointer.y = 150;
    });

    expect(before).toMatchObject({ kind: "placement", side: "pinned" });
    expect(at).toEqual({
      kind: "placement",
      side: "unpinned",
      placeholder: { side: "unpinned", index: 2 },
      operation: ["09", "03"],
    });
  });

  it("uses the authored below-pinned distance when no unpinned group exists", () => {
    const before = calculate((input) => {
      input.current.unpinnedChannelIds = [];
      input.source.unpinnedChannelIds = [];
      input.geometry.unpinnedGroupTop = null;
      input.geometry.pinnedContentBottom = 120;
      input.pointer.y = 143;
    });
    const at = calculate((input) => {
      input.current.unpinnedChannelIds = [];
      input.source.unpinnedChannelIds = [];
      input.geometry.unpinnedGroupTop = null;
      input.geometry.pinnedContentBottom = 120;
      input.pointer.y = 144;
    });

    expect(before).toMatchObject({ kind: "placement", side: "pinned" });
    expect(at).toEqual({
      kind: "placement",
      side: "unpinned",
      placeholder: null,
      operation: ["09", "03"],
    });
  });

  it("creates the beginning pinned slot when the pinned group is absent", () => {
    const result = calculate((input) => {
      input.source = {
        channelId: "05",
        pinnedChannelIds: [],
        unpinnedChannelIds: ["08", "05", "02"],
      };
      input.current = {
        pinnedChannelIds: [],
        unpinnedChannelIds: ["08", "05", "02"],
      };
      input.geometry.pinnedRows = [];
      input.geometry.pinnedContentBottom = null;
      input.geometry.unpinnedGroupTop = 100;
      input.pointer.y = 50;
    });

    expect(result).toEqual({
      kind: "placement",
      side: "pinned",
      placeholder: { side: "pinned", index: 0 },
      operation: ["05"],
    });
  });

  it("handles each only-row group without inventing another group", () => {
    const onlyUnpinned = calculate((input) => {
      input.source = {
        channelId: "05",
        pinnedChannelIds: [],
        unpinnedChannelIds: ["05"],
      };
      input.current = {
        pinnedChannelIds: [],
        unpinnedChannelIds: ["05"],
      };
      input.geometry.pinnedRows = [];
      input.geometry.pinnedContentBottom = null;
      input.geometry.unpinnedGroupTop = 100;
      input.pointer.y = 100;
    });
    const onlyPinned = calculate((input) => {
      input.source = {
        channelId: "05",
        pinnedChannelIds: ["05"],
        unpinnedChannelIds: [],
      };
      input.current = {
        pinnedChannelIds: ["05"],
        unpinnedChannelIds: [],
      };
      input.geometry.pinnedRows = [];
      input.geometry.pinnedContentBottom = 80;
      input.geometry.unpinnedGroupTop = null;
      input.pointer.y = 104;
    });

    expect(onlyUnpinned).toEqual({
      kind: "placement",
      side: "unpinned",
      placeholder: { side: "unpinned", index: 0 },
      operation: null,
    });
    expect(onlyPinned).toEqual({
      kind: "placement",
      side: "unpinned",
      placeholder: null,
      operation: [],
    });
  });

  it("keeps an unpinned-origin row at its supplied slot", () => {
    const result = calculate((input) => {
      input.source = {
        channelId: "08",
        pinnedChannelIds: ["09", "03"],
        unpinnedChannelIds: ["04", "08", "02"],
      };
      input.current = {
        pinnedChannelIds: ["09", "03"],
        unpinnedChannelIds: ["04", "08", "02"],
      };
      input.pointer.y = 200;
    });

    expect(result).toEqual({
      kind: "placement",
      side: "unpinned",
      placeholder: { side: "unpinned", index: 1 },
      operation: null,
    });
  });

  it("returns a pinned channel to its descending creation-order slot", () => {
    const result = calculate((input) => {
      input.source.unpinnedChannelIds = ["08", "07", "04", "01"];
      input.current.unpinnedChannelIds = ["08", "07", "04", "01"];
      input.pointer.y = 200;
    });

    expect(result).toEqual({
      kind: "placement",
      side: "unpinned",
      placeholder: { side: "unpinned", index: 2 },
      operation: ["09", "03"],
    });
  });

  it("invalidates when group geometry provides no zone boundary", () => {
    const result = calculate((input) => {
      input.geometry.unpinnedGroupTop = null;
      input.geometry.pinnedContentBottom = null;
    });

    expect(result).toEqual({ kind: "invalidated" });
  });

  it.each([
    ["left", { x: -1, y: 50 }],
    ["right", { x: 301, y: 50 }],
    ["above", { x: 100, y: -1 }],
    ["below", { x: 100, y: 501 }],
  ] as const)("treats a pointer %s the sidebar as unpinned", (_label, pointer) => {
    const result = calculate((input) => {
      input.pointer = pointer;
    });

    expect(result).toMatchObject({
      kind: "placement",
      side: "unpinned",
      operation: ["09", "03"],
    });
  });

  it.each([
    ["pin order", (input: ChannelSidebarPlacementInput) => {
      input.current.pinnedChannelIds = ["05", "09", "03"];
    }],
    ["unpinned membership", (input: ChannelSidebarPlacementInput) => {
      input.current.unpinnedChannelIds = ["08", "06", "04", "02", "01"];
    }],
    ["pinned row geometry", (input: ChannelSidebarPlacementInput) => {
      input.geometry.pinnedRows = [
        { channelId: "03", top: 20, bottom: 40 },
        { channelId: "09", top: 60, bottom: 80 },
      ];
    }],
  ] as const)("invalidates instead of producing an operation after changed %s", (_label, update) => {
    const result = calculate(update);

    expect(result).toEqual({ kind: "invalidated" });
  });
});
