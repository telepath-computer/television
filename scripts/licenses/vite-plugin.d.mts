import type { Plugin } from "vite";
import type { InventorySurface } from "./lib/surfaces.mjs";
import type { VendoredAsset } from "./lib/config.mjs";

export interface TelevisionLicensePluginOptions {
  surface: InventorySurface;
  mode?: "write" | "verify";
  root?: string;
  inventoryRoot?: string;
  assets?: VendoredAsset[];
  recordOutputPath?: string;
}

export function createTelevisionLicensePlugin(options: TelevisionLicensePluginOptions): Plugin;
