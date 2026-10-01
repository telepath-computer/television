import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_PAGE_SIZE } from "@telepath-computer/television-shared";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import {
  WINDOW_MIN_HEIGHT_PX,
  WINDOW_MIN_WIDTH_PX,
} from "../../packages/desktop/src/window-measures.ts";
import {
  ARTIFACT_MIN_HEIGHT_PX,
  ARTIFACT_MIN_WIDTH_PX,
  CROSSING_DURATION_MS,
  HANDLE_CORNER_REACH_PX,
  HANDLE_CORNER_THICKNESS_PX,
  HANDLE_EDGE_BAND_PX,
  SIDEBAR_COLLAPSE_DURATION_MS,
  SIZING_HEIGHT_SHARE,
  SIZING_REFERENCE_HEIGHT_PX,
  SIZING_REFERENCE_WIDTH_PX,
  SIZING_WIDTH_SHARE,
  SNAP_ARM_PX,
  TAB_COMPRESSION_FLOOR_PX,
  TAB_COMPRESSION_FLOOR_SLACK_PX,
} from "../../packages/web/src/constants.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function readYaml(relativePath: string): unknown {
  return parseYaml(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

describe("desktop window measure crossings", () => {
  test("window minimum constants equal the authoritative app measures", () => {
    const measures = readYaml("specs/ui/app/measures.yml") as {
      window: unknown;
    };

    expect({
      min_width_px: WINDOW_MIN_WIDTH_PX,
      min_height_px: WINDOW_MIN_HEIGHT_PX,
    }).toEqual(measures.window);
  });
});

describe("app/sidebar measure crossings", () => {
  test("sidebar collapse duration equals the authoritative app measure", () => {
    const measures = readYaml("specs/ui/app/measures.yml") as {
      sidebar: { collapse: { duration_ms: number; easing: string } };
    };

    expect(SIDEBAR_COLLAPSE_DURATION_MS).toEqual(measures.sidebar.collapse.duration_ms);
  });
});

describe("production page-sizing measure crossings", () => {
  test("stage constants equal the authoritative sizing, handle, and snap measures", () => {
    const measures = readYaml("specs/ui/app/stage/measures.yml") as {
      page: unknown;
      sizing: unknown;
      handles: unknown;
      snap: unknown;
    };

    expect({
      page: {
        initial_width_px: DEFAULT_PAGE_SIZE.width,
        initial_height_px: DEFAULT_PAGE_SIZE.height,
      },
      sizing: {
        reference_width_px: SIZING_REFERENCE_WIDTH_PX,
        reference_height_px: SIZING_REFERENCE_HEIGHT_PX,
        width_share: SIZING_WIDTH_SHARE,
        height_share: SIZING_HEIGHT_SHARE,
      },
      handles: {
        edge_band_px: HANDLE_EDGE_BAND_PX,
        corner_reach_px: HANDLE_CORNER_REACH_PX,
        corner_thickness_px: HANDLE_CORNER_THICKNESS_PX,
      },
      snap: { arm_px: SNAP_ARM_PX },
    }).toEqual({
      page: measures.page,
      sizing: measures.sizing,
      handles: measures.handles,
      snap: measures.snap,
    });
  });

  test("artifact minimum constants equal the authoritative frame measures", () => {
    const measures = readYaml("specs/ui/app/artifact-frame/measures.yml") as {
      artifact: unknown;
    };

    expect({
      min_width_px: ARTIFACT_MIN_WIDTH_PX,
      min_height_px: ARTIFACT_MIN_HEIGHT_PX,
    }).toEqual(measures.artifact);
  });

  test("selection crossing duration equals the authoritative stage measure", () => {
    const measures = readYaml("specs/ui/app/stage/measures.yml") as {
      crossing: { duration_ms: number };
    };

    expect(CROSSING_DURATION_MS).toBe(measures.crossing.duration_ms);
  });

  test("tab compression constants equal the authoritative tab-strip measures", () => {
    const measures = readYaml("specs/ui/app/tab-strip/measures.yml") as {
      tab: { floor_px: number; floor_slack_px: number };
    };

    expect({
      floor_px: TAB_COMPRESSION_FLOOR_PX,
      floor_slack_px: TAB_COMPRESSION_FLOOR_SLACK_PX,
    }).toEqual(measures.tab);
  });
});
