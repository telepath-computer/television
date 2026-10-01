import type {
  InventorySurface as DeclaredInventorySurface,
  LicenseSurface,
} from "./surfaces.mjs";

export type Surface = LicenseSurface;
export type InventorySurface = DeclaredInventorySurface;

export interface SurfaceInventoryPackage {
  name: string;
  version: string;
  declaredLicense: string | null;
  licenseFilePath: string | null;
}

/** In-memory input accepted by notice rendering, including the asset-only source surface. */
export interface NoticeInventory {
  surface: Surface;
  packages: SurfaceInventoryPackage[];
}

/** Persisted inventory emitted only by inventory-producing build surfaces. */
export interface SurfaceInventory extends NoticeInventory {
  surface: InventorySurface;
}

export interface ResolveInventoryRootOptions {
  root?: string;
}

export function resolveInventoryRoot(options?: ResolveInventoryRootOptions): string;
export function prepareInventoryRoot(inventoryRoot: string): void;
export function surfaceInventoryPath(inventoryRoot: string, surface: InventorySurface): string;
export function writeSurfaceInventory(inventoryRoot: string, inventory: SurfaceInventory): string;
export function readSurfaceInventory(inventoryRoot: string, surface: InventorySurface): SurfaceInventory;
export function mergeSurfaceInventories(
  surface: InventorySurface,
  inventories: SurfaceInventory[],
): SurfaceInventory;
export function normalizePackageRecords(
  records: SurfaceInventoryPackage[],
  location?: string,
): SurfaceInventoryPackage[];
