// The stage's measures, read from the spec's authored data
// (specs/ui/app/stage/measures.yml) so nothing here can drift from it.
import raw from "../../specs/ui/app/stage/measures.yml?raw";

const px = (key: string) => Number(raw.match(new RegExp(`^\\s+${key}:\\s*(\\d+)`, "m"))![1]);

export const PAGE_INITIAL_WIDTH_PX = px("initial_width_px");
export const PAGE_INITIAL_HEIGHT_PX = px("initial_height_px");
export const HANDLE_EDGE_BAND_PX = px("edge_band_px");
export const HANDLE_CORNER_REACH_PX = px("corner_reach_px");
export const HANDLE_CORNER_THICKNESS_PX = px("corner_thickness_px");
export const SNAP_ARM_PX = px("arm_px");
export const CROSSING_DURATION_MS = Number(raw.match(/crossing:\n\s+duration_ms:\s*(\d+)/)![1]);

const drawback = raw.match(/drawback:\n\s+scale:\s*([\d.]+)[^\n]*\n\s+duration_ms:\s*(\d+)/)!;
export const DRAWBACK_SCALE = Number(drawback[1]);
export const DRAWBACK_DURATION_MS = Number(drawback[2]);

const num = (key: string) => Number(raw.match(new RegExp(`^\\s+${key}:\\s*([\\d.]+)`, "m"))![1]);
export const SIZING_REFERENCE_WIDTH_PX = num("reference_width_px");
export const SIZING_REFERENCE_HEIGHT_PX = num("reference_height_px");
export const SIZING_WIDTH_SHARE = num("width_share");
export const SIZING_HEIGHT_SHARE = num("height_share");
