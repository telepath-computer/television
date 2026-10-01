import { describe, expect, it } from "vitest";
import {
  SIZING_HEIGHT_SHARE,
  SIZING_REFERENCE_HEIGHT_PX,
  SIZING_REFERENCE_WIDTH_PX,
  SIZING_WIDTH_SHARE,
} from "../constants.ts";
import {
  factorForPageBox,
  renderedPageSize,
  renderedSizeFloor,
  storedPageSize,
} from "./page-sizing.ts";

describe("shared page sizing factor", () => {
  it("renders fractional reference sizes through one stage-owned factor", () => {
    expect(factorForPageBox({ width: 1_280, height: 800 })).toEqual({
      width: 1,
      height: 1,
    });

    const pageBox = { width: 976.5, height: 743.25 };
    const size = { width: 612.75, height: 702.25 };
    const factor = factorForPageBox(pageBox);
    const rendered = renderedPageSize(size, pageBox);

    expect(factor).toEqual({
      width: 1 - SIZING_WIDTH_SHARE +
        SIZING_WIDTH_SHARE * pageBox.width / SIZING_REFERENCE_WIDTH_PX,
      height: 1 - SIZING_HEIGHT_SHARE +
        SIZING_HEIGHT_SHARE * pageBox.height / SIZING_REFERENCE_HEIGHT_PX,
    });
    expect(rendered).toEqual({
      width: size.width * factor.width,
      height: size.height * factor.height,
    });
    expect(storedPageSize(rendered, pageBox)).toEqual(size);
    expect(Number.isInteger(rendered.width)).toBe(false);
    expect(Number.isInteger(rendered.height)).toBe(false);
  });

  it("floors each rendered axis at the frame minimum until the page box wins", () => {
    expect(renderedSizeFloor({ width: 640, height: 480 })).toEqual({
      width: 230,
      height: 230,
    });
    expect(renderedSizeFloor({ width: 180.5, height: 179.25 })).toEqual({
      width: 180.5,
      height: 179.25,
    });
    expect(renderedPageSize(
      { width: 1, height: 1 },
      { width: 180.5, height: 179.25 },
    )).toEqual({ width: 180.5, height: 179.25 });
  });

  it("keeps the page-box ceiling above oversized stored sizes", () => {
    expect(renderedPageSize(
      { width: 10_000.25, height: 9_000.75 },
      { width: 976.5, height: 643.25 },
    )).toEqual({ width: 976.5, height: 643.25 });
  });
});
