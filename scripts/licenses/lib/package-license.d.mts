import type { SurfaceInventoryPackage } from "./inventory.mjs";

export interface PackageInfo {
  name: string;
  version: string;
  declaredLicense: string | null;
  packageRoot: string;
  manifestPath: string;
  licenseFilePath: string | null;
}

export function findOwningPackage(inputPath: string): PackageInfo | null;
export function findInstalledPackage(
  name: string,
  version: string,
  options: { root: string; searchRoots?: string[] },
): PackageInfo | null;
export function findInstalledDependency(
  name: string,
  options: { fromDirectory: string },
): PackageInfo | null;
export function findPackageLicenseFile(packageRoot: string): string | null;
export function findPackageNoticeFile(packageRoot: string): string | null;
export function packageInfoToInventoryRecord(
  packageInfo: PackageInfo,
  options: { root: string },
): SurfaceInventoryPackage;
