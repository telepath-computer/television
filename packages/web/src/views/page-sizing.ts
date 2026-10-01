import type { PageSize } from "@telepath-computer/television-shared";
import {
  ARTIFACT_MIN_HEIGHT_PX,
  ARTIFACT_MIN_WIDTH_PX,
  SIZING_HEIGHT_SHARE,
  SIZING_REFERENCE_HEIGHT_PX,
  SIZING_REFERENCE_WIDTH_PX,
  SIZING_WIDTH_SHARE,
} from "../constants.ts";

export type PageBox = PageSize;

/** The shared per-axis factor for the current stage page box. */
export function factorForPageBox(pageBox: PageBox): PageSize {
  return {
    width: 1 - SIZING_WIDTH_SHARE +
      SIZING_WIDTH_SHARE * pageBox.width / SIZING_REFERENCE_WIDTH_PX,
    height: 1 - SIZING_HEIGHT_SHARE +
      SIZING_HEIGHT_SHARE * pageBox.height / SIZING_REFERENCE_HEIGHT_PX,
  };
}

/** The artifact-frame floor on this stage; a smaller page box wins. */
export function renderedSizeFloor(pageBox: PageBox): PageSize {
  return {
    width: Math.min(ARTIFACT_MIN_WIDTH_PX, pageBox.width),
    height: Math.min(ARTIFACT_MIN_HEIGHT_PX, pageBox.height),
  };
}

/** Render a reference-pixel page size through the factor and both bounds. */
export function renderedPageSize(size: PageSize, pageBox: PageBox): PageSize {
  const factor = factorForPageBox(pageBox);
  const floor = renderedSizeFloor(pageBox);
  return {
    width: Math.min(pageBox.width, Math.max(floor.width, size.width * factor.width)),
    height: Math.min(pageBox.height, Math.max(floor.height, size.height * factor.height)),
  };
}

/** Convert an unclamped rendered size on this stage back to reference pixels. */
export function storedPageSize(rendered: PageSize, pageBox: PageBox): PageSize {
  const factor = factorForPageBox(pageBox);
  return {
    width: rendered.width / factor.width,
    height: rendered.height / factor.height,
  };
}
