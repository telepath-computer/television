import type { LicenseConfig, LicenseSurface, VendoredAsset } from "./lib/config.mjs";
import type { InventorySurface, SurfaceInventory } from "./lib/inventory.mjs";
import type { EsbuildMetafile } from "./lib/notices.mjs";

interface CommonOptions {
  surface: InventorySurface;
  outputPath: string;
  root?: string;
  inventoryRoot?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
}

export function generateSourceNotices(options?: {
  root?: string;
  outputPath?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
}): string | null;

export function generateFolderNotices(options?: {
  root?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
  write?: boolean;
}): { folder: string; text: string }[];

export function generateNoticesFromEsbuild(options: CommonOptions & {
  metafile: EsbuildMetafile;
  cwd?: string;
}): string | null;

export function generateNoticesFromInventory(options: CommonOptions & {
  inventory: SurfaceInventory;
}): string | null;

export function generateAggregateNotices(options: {
  surface: InventorySurface;
  inventories: SurfaceInventory[];
  assetSurfaces: LicenseSurface[];
  outputPath: string;
  root?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
}): string | null;
