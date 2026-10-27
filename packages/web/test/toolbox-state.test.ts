import { describe, expect, test } from "vitest";
import { ToolboxSelection, defaultToolboxIcon, isToolboxShortcut } from "../src/views/toolbox-state.ts";

describe("Toolbox consumer contracts", () => {
  // proofs/ui/app/toolbox.md#^toolbox-t-search-state
  test("matches trimmed names in discovery order and navigates the three-column grid", () => {
    const selection = new ToolboxSelection();
    const items = [
      { id: "b", name: "Beta", description: "Alpha" },
      { id: "a", name: "Alpha", description: "Other" },
      { id: "c", name: "Alphabet", description: "Other" },
    ];
    selection.update(items);
    expect(selection.matches).toEqual(items);
    expect(selection.highlighted).toBeNull();
    selection.search("  ALP  ");
    expect(selection.matches.map(item => item.id)).toEqual(["a", "c"]);
    expect(selection.highlighted).toBe("a");
    selection.search("");
    expect(selection.matches).toEqual(items);
    expect(selection.highlighted).toBeNull();
    selection.search("  ALP  ");
    selection.move("right");
    selection.update([items[2]!, items[0]!, items[1]!]);
    expect(selection.query).toBe("  ALP  ");
    expect(selection.highlighted).toBe("c");
    selection.update([items[1]!]);
    expect(selection.highlighted).toBeNull();
    const grid = Array.from({ length: 8 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item ${index}`,
      description: "Other",
    }));
    selection.update(grid);
    expect(selection.highlighted).toBeNull();
    selection.search("   ");
    expect(selection.matches).toEqual(grid);
    expect(selection.highlighted).toBeNull();
    selection.move("left");
    expect(selection.highlighted).toBeNull();
    selection.move("right");
    expect(selection.highlighted).toBeNull();
    selection.move("up");
    expect(selection.highlighted).toBeNull();
    selection.move("down");
    expect(selection.highlighted).toBe("item-0");
    selection.move("left");
    expect(selection.highlighted).toBe("item-0");
    selection.move("right");
    selection.move("right");
    expect(selection.highlighted).toBe("item-2");
    selection.move("right");
    expect(selection.highlighted).toBe("item-3");
    selection.move("left");
    expect(selection.highlighted).toBe("item-2");
    selection.move("up");
    expect(selection.highlighted).toBeNull();
    selection.move("down");
    selection.move("down");
    expect(selection.highlighted).toBe("item-3");
    selection.move("right");
    expect(selection.highlighted).toBe("item-4");
    selection.move("left");
    expect(selection.highlighted).toBe("item-3");
    selection.move("up");
    expect(selection.highlighted).toBe("item-0");
    selection.move("up");
    expect(selection.highlighted).toBeNull();
    selection.move("down");
    selection.move("down");
    selection.move("down");
    expect(selection.highlighted).toBe("item-6");
    selection.move("down");
    expect(selection.highlighted).toBe("item-7");
    selection.move("right");
    expect(selection.highlighted).toBe("item-7");
    selection.move("up");
    expect(selection.highlighted).toBe("item-4");
    selection.search("missing");
    selection.move("down");
    expect(selection.highlighted).toBeNull();
  });

  // proofs/ui/app/toolbox.md#^toolbox-t-default-icon
  test("uses Unicode code points and the ordered palette with unsigned 32-bit wrapping", () => {
    const palette = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "neutral"];
    for (const [id, name, letter] of [["a", "alpha", "A"], ["🚀", "𐐨name", "𐐀"], ["long-id-".repeat(20), "ßeta", "SS"], ["<id>", "<img>", "<"]]) {
      let hash = 7n;
      for (const point of id!) hash = (hash * 31n + BigInt(point.codePointAt(0)!)) % (2n ** 32n);
      expect(defaultToolboxIcon(id!, name!)).toEqual({ letter, color: `var(--${palette[Number(hash % 9n)]}-600)` });
      expect(defaultToolboxIcon(id!, "Other").color).toBe(defaultToolboxIcon(id!, name!).color);
    }
    for (let index = 0; index < palette.length; index++) {
      // Starting hash 7 * 31 = 217; code points 107…115 cover the palette in order.
      expect(defaultToolboxIcon(String.fromCodePoint(107 + index), "Name").color).toBe(`var(--${palette[index]}-600)`);
    }
  });

  // proofs/ui/app/toolbox.md#^toolbox-t-shortcut-contract
  test.each(["MacIntel", "MacPPC", "Win32", "Linux x86_64"])("claims only the host shortcut on %s", platform => {
    const mac = platform.startsWith("Mac");
    const event = { key: "k", metaKey: mac, ctrlKey: !mac, altKey: false, shiftKey: false, isComposing: false };
    expect(isToolboxShortcut(event, platform)).toBe(true);
    expect(isToolboxShortcut({ ...event, key: "K" }, platform)).toBe(true);
    expect(isToolboxShortcut({ ...event, metaKey: !mac, ctrlKey: mac }, platform)).toBe(false);
    expect(isToolboxShortcut({ ...event, key: "j" }, platform)).toBe(false);
    expect(isToolboxShortcut({ ...event, altKey: true }, platform)).toBe(false);
    expect(isToolboxShortcut({ ...event, isComposing: true }, platform)).toBe(false);
  });
});
