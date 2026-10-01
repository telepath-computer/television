import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  getPageArtifactIds,
  isPageReorder,
  preservesPageMembership,
  removeArtifactFromPages,
  type SinglePageGeometry,
  type TabPage,
  validatePageLayout,
} from "@telepath-computer/television-shared";
import { describe, expect, it } from "vitest";

function page(
  artifactIds: string[],
  geometry: SinglePageGeometry = DEFAULT_PAGE_GEOMETRY,
): TabPage {
  return { artifactIds, geometry: { ...geometry }, size: { ...DEFAULT_PAGE_SIZE } };
}

describe("page layout validation", () => {
  it("defines the shared stage-one geometry and reference-pixel size defaults", () => {
    expect(DEFAULT_PAGE_GEOMETRY).toEqual({
      kind: "single",
      full_screen: false,
    });
    expect(DEFAULT_PAGE_SIZE).toEqual({ width: 560, height: 740 });
  });

  it("accepts empty layouts and ordered multi-artifact page membership", () => {
    expect(validatePageLayout([])).toEqual({ valid: true, errors: [] });
    expect(validatePageLayout([
      page(["artifact-a", "artifact-b"]),
      page(["artifact-c"], { kind: "single", full_screen: true }),
    ])).toEqual({ valid: true, errors: [] });
  });

  it("rejects empty page membership", () => {
    const result = validatePageLayout([page([])]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Page 0 must contain at least one artifact id");
  });

  it("rejects unknown geometry without inventing a fallback", () => {
    const result = validatePageLayout([{
      artifactIds: ["artifact-a"],
      geometry: { kind: "split", full_screen: false },
      size: { ...DEFAULT_PAGE_SIZE },
    }]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Page 0 has unknown geometry kind: split");
  });

  it("rejects malformed artifact ids and single-page geometry", () => {
    expect(validatePageLayout([{
      artifactIds: [""],
      geometry: { kind: "single", full_screen: "false" },
      size: { ...DEFAULT_PAGE_SIZE },
    }])).toEqual({
      valid: false,
      errors: [
        "Page 0 artifact ids must be non-empty strings",
        "Page 0 single geometry must include a boolean full_screen",
      ],
    });
  });

  it("rejects fields from otherwise unknown models", () => {
    expect(validatePageLayout([{
      artifactIds: ["artifact-a"],
      geometry: { kind: "single", full_screen: false, width: 4 },
      size: { ...DEFAULT_PAGE_SIZE },
      stack: [],
    }])).toEqual({
      valid: false,
      errors: [
        "Page 0 has unknown field: stack",
        "Page 0 geometry has unknown field: width",
      ],
    });
  });

  describe("stored page size (^ly-ac-size-invalid)", () => {
    it("accepts a valid fractional pair", () => {
      expect(validatePageLayout([{
        ...page(["artifact-a"]),
        size: { width: 560.25, height: 740.75 },
      }])).toEqual({ valid: true, errors: [] });
    });

    it.each([
      ["missing size", ({ size: _size, ...withoutSize }: TabPage) => withoutSize],
      ["missing width", (value: TabPage) => ({ ...value, size: { height: DEFAULT_PAGE_SIZE.height } })],
      ["missing height", (value: TabPage) => ({ ...value, size: { width: DEFAULT_PAGE_SIZE.width } })],
      ["a non-numeric axis", (value: TabPage) => ({ ...value, size: { ...DEFAULT_PAGE_SIZE, width: "560" } })],
      ["NaN", (value: TabPage) => ({ ...value, size: { ...DEFAULT_PAGE_SIZE, width: Number.NaN } })],
      ["Infinity", (value: TabPage) => ({ ...value, size: { ...DEFAULT_PAGE_SIZE, height: Number.POSITIVE_INFINITY } })],
      ["zero", (value: TabPage) => ({ ...value, size: { ...DEFAULT_PAGE_SIZE, width: 0 } })],
      ["a negative axis", (value: TabPage) => ({ ...value, size: { ...DEFAULT_PAGE_SIZE, height: -1 } })],
      ["an extra size key", (value: TabPage) => ({ ...value, size: { ...DEFAULT_PAGE_SIZE, unit: "px" } })],
    ] as const)("rejects %s", (_label, invalid) => {
      const result = validatePageLayout([invalid(page(["artifact-a"]))]);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe("page membership", () => {
  const pages = [page(["artifact-a", "artifact-b"]), page(["artifact-c"])];

  it("reads artifact membership without narrowing pages to one artifact", () => {
    expect(getPageArtifactIds(pages)).toEqual([
      "artifact-a",
      "artifact-b",
      "artifact-c",
    ]);
  });

  it("removes an artifact while preserving every remaining page as a unit", () => {
    expect(removeArtifactFromPages(pages, "artifact-a")).toEqual([
      page(["artifact-b"]),
      page(["artifact-c"]),
    ]);
    expect(removeArtifactFromPages(pages, "artifact-c")).toEqual([
      page(["artifact-a", "artifact-b"]),
    ]);
  });

  it("accepts page reorder and geometry changes without regrouping membership", () => {
    expect(preservesPageMembership(pages, [
      page(["artifact-c"], { kind: "single", full_screen: true }),
      page(["artifact-a", "artifact-b"]),
    ])).toBe(true);
  });

  it("rejects split, merged, or internally reordered page membership", () => {
    expect(preservesPageMembership(pages, [
      page(["artifact-a"]),
      page(["artifact-b", "artifact-c"]),
    ])).toBe(false);
    expect(preservesPageMembership(pages, [page(["artifact-a", "artifact-b", "artifact-c"])]))
      .toBe(false);
    expect(preservesPageMembership(pages, [
      page(["artifact-b", "artifact-a"]),
      page(["artifact-c"]),
    ])).toBe(false);
  });
});

describe("page reorder", () => {
  const pages = [page(["artifact-a", "artifact-b"]), page(["artifact-c"])];

  it("reports only a change in page order", () => {
    expect(isPageReorder(pages, [page(["artifact-c"]), page(["artifact-a", "artifact-b"])]))
      .toBe(true);
    expect(isPageReorder(pages, [
      page(["artifact-a", "artifact-b"], { kind: "single", full_screen: true }),
      page(["artifact-c"]),
    ])).toBe(false);
    expect(isPageReorder(pages, [...pages, page(["artifact-d"])]))
      .toBe(false);
  });
});
