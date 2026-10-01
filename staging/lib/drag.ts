// The drag measures, read from the spec's authored data
// (specs/ui/app/drag.yml) so nothing here can drift from it.
import raw from "../../specs/ui/app/drag.yml?raw";

export const DRAG_THRESHOLD_PX = Number(raw.match(/^\s+threshold_px:\s*(\d+)/m)![1]);
export const DRAG_DISPLACEMENT_MS = Number(raw.match(/^\s+duration_ms:\s*(\d+)/m)![1]);
export const AUTOSCROLL_ZONE_PX = Number(raw.match(/^\s+zone_px:\s*(\d+)/m)![1]);
export const BELOW_PINNED_PX = Number(raw.match(/^\s+below_pinned_px:\s*(\d+)/m)![1]);
export const AUTOSCROLL_SPEED_PX_S = Number(raw.match(/^\s+speed_px_s:\s*(\d+)/m)![1]);
