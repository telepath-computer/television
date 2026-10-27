import type { Plugin } from "vite";
import type { InventorySurface } from "./lib/surfaces.mjs";

export interface TelevisionLicensePluginOptions {
  surface: InventorySurface;
  mode?: "write" | "verify";
  root?: string;
  inventoryRoot?: string;
}

export function createTelevisionLicensePlugin(options: TelevisionLicensePluginOptions): Plugin;
