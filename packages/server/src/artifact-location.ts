import fs from "node:fs";
import path from "node:path";
import { hasTrailingSeparator, isAllowedArtifactFilePath } from "@telepath-computer/television-artifact";

export const DIRECTORY_INDEX_BASENAMES = ["index.html", "index.htm"] as const;

function isReadable(realPath: string): boolean {
  try {
    fs.accessSync(realPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * A path artifact's real location: where its stored path leads once symbolic
 * links are followed, when that is itself what a path artifact can be
 * created from. A stored path ending in a separator must lead to a readable
 * folder holding an index page, and any other to a readable file with an
 * artifact's extension; anything else, nothing there included, is null
 * (specs/product/artifacts.md#^af-real-location).
 */
export function artifactRealLocation(artifactPath: string): { path: string; stat: fs.Stats } | null {
  let realPath: string;
  let stat: fs.Stats;
  try {
    realPath = fs.realpathSync(artifactPath);
    stat = fs.statSync(realPath);
  } catch {
    return null;
  }
  if (hasTrailingSeparator(artifactPath)) {
    const holdsIndex = stat.isDirectory() && DIRECTORY_INDEX_BASENAMES.some((basename) => fs.existsSync(path.join(realPath, basename)));
    return holdsIndex && isReadable(realPath) ? { path: realPath, stat } : null;
  }
  return stat.isFile() && isAllowedArtifactFilePath(realPath) && isReadable(realPath) ? { path: realPath, stat } : null;
}
