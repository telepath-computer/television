export type LicenseSurfaceDeclaration =
  | { surface: "cli"; producesInventory: true; packageDirectory: "packages/cli" }
  | { surface: "desktop"; producesInventory: true; packageDirectory: "packages/desktop" }
  | { surface: "skill:tv-calendar"; producesInventory: true; parentSurface: "cli" }
  | { surface: "skill:tv-tasks"; producesInventory: true; parentSurface: "cli" }
  | { surface: "source"; producesInventory: false }
  | { surface: "view:markdown"; producesInventory: true; parentSurface: "cli" }
  | { surface: "web"; producesInventory: true; parentSurface: "cli" };

export type LicenseSurface = LicenseSurfaceDeclaration["surface"];
export type InventorySurface = Extract<
  LicenseSurfaceDeclaration,
  { producesInventory: true }
>["surface"];

export const LICENSE_SURFACE_DECLARATIONS: readonly LicenseSurfaceDeclaration[];
export const LICENSE_SURFACES: readonly LicenseSurface[];
export const LICENSE_INVENTORY_SURFACES: readonly InventorySurface[];
export function includedLicenseSurfaces(surface: InventorySurface): InventorySurface[];
export function includedLicenseSurfaces(surface: LicenseSurface): LicenseSurface[];
export function licenseSurfaceForPackageDirectory(packageDirectory: string): LicenseSurfaceDeclaration | null;
export function isDeclaredLicenseSurface(surface: unknown): surface is LicenseSurface;
export function requireDeclaredLicenseSurface(
  surface: unknown,
  options: { inventory: true },
): Extract<LicenseSurfaceDeclaration, { producesInventory: true }>;
export function requireDeclaredLicenseSurface(
  surface: unknown,
  options?: { inventory?: false },
): LicenseSurfaceDeclaration;
