// The artifact frame's measures, read from the spec's authored data
// (specs/ui/app/artifact-frame/measures.yml) so nothing here can drift from it.
import raw from "../../specs/ui/app/artifact-frame/measures.yml?raw";

export const ARTIFACT_MIN_WIDTH_PX = Number(raw.match(/^\s+min_width_px:\s*(\d+)/m)![1]);
export const ARTIFACT_MIN_HEIGHT_PX = Number(raw.match(/^\s+min_height_px:\s*(\d+)/m)![1]);
