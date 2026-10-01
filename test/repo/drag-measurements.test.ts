import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { expect, test } from "vitest";
import {
  DRAG_AUTOSCROLL_SPEED_PX_S,
  DRAG_AUTOSCROLL_ZONE_PX,
  DRAG_DISPLACEMENT_DURATION_MS,
  DRAG_PRESS_THRESHOLD_PX,
} from "../../packages/web/src/views/drag-measurements.ts";

interface AuthoredDragMeasurements {
  readonly press: { readonly threshold_px: number };
  readonly displacement: { readonly duration_ms: number };
  readonly autoscroll: {
    readonly zone_px: number;
    readonly speed_px_s: number;
  };
}

test("production drag measurements match the authored values", () => {
  const authored = parseYaml(
    readFileSync(
      path.resolve(process.cwd(), "specs/ui/app/drag.yml"),
      "utf8",
    ),
  ) as AuthoredDragMeasurements;

  for (const [key, production, specified] of [
    ["press.threshold_px", DRAG_PRESS_THRESHOLD_PX, authored.press.threshold_px],
    [
      "displacement.duration_ms",
      DRAG_DISPLACEMENT_DURATION_MS,
      authored.displacement.duration_ms,
    ],
    ["autoscroll.zone_px", DRAG_AUTOSCROLL_ZONE_PX, authored.autoscroll.zone_px],
    [
      "autoscroll.speed_px_s",
      DRAG_AUTOSCROLL_SPEED_PX_S,
      authored.autoscroll.speed_px_s,
    ],
  ] as const) {
    expect.soft(production, key).toBe(specified);
  }
});
