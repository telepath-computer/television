import type { LicenseConfig, LicenseSurface, VendoredAsset } from "./config.mjs";
import type {
  InventorySurface,
  NoticeInventory,
  SurfaceInventory,
  SurfaceInventoryPackage,
} from "./inventory.mjs";

export interface EsbuildMetafile {
  inputs?: Record<string, unknown>;
  outputs: Record<string, {
    inputs: Record<string, { bytesInOutput: number }>;
    [key: string]: unknown;
  }>;
}

export interface BundleModuleRecord {
  id: string;
  renderedLength: number;
}

export interface OverrideDrift {
  kind: "election";
  expected: string;
  actual: string | null;
}

export interface PackageLicenseResolution {
  license: string | null;
  drift: OverrideDrift | null;
}

export interface PackageNoticeResolution {
  text: string;
  source: "package-license-file" | "reviewed-config";
  sourcePath: string;
  packageRoot: string | null;
}

export function inventoryFromEsbuildMetafile(options: {
  surface: InventorySurface;
  metafile: EsbuildMetafile;
  root: string;
  cwd?: string;
  config?: LicenseConfig;
}): SurfaceInventory;

export function inventoryFromModulePaths(options: {
  surface: InventorySurface;
  modules: BundleModuleRecord[];
  root: string;
  cwd?: string;
  config?: LicenseConfig;
}): SurfaceInventory;

export function resolvePackageLicense(
  packageRecord: SurfaceInventoryPackage,
  config: LicenseConfig,
): PackageLicenseResolution;

export function resolvePackageNotice(
  packageRecord: SurfaceInventoryPackage,
  options: { root: string; config: LicenseConfig },
): PackageNoticeResolution;

export function renderThirdPartyNotices(options: {
  surface: LicenseSurface;
  inventory: NoticeInventory;
  assetSurfaces?: LicenseSurface[];
  config: LicenseConfig;
  assets: VendoredAsset[];
  root: string;
}): string | null;

export function renderFolderNotices(options: {
  assets: VendoredAsset[];
}): { folder: string; text: string }[];
