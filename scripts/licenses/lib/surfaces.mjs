const declarations = [
  { surface: "cli", producesInventory: true, packageDirectory: "packages/cli" },
  { surface: "desktop", producesInventory: true, packageDirectory: "packages/desktop" },
  { surface: "sdk:resources", producesInventory: true, parentSurface: "cli" },
  { surface: "skill:tv-calendar", producesInventory: true, parentSurface: "cli" },
  { surface: "skill:tv-tasks", producesInventory: true, parentSurface: "cli" },
  { surface: "source", producesInventory: false },
  { surface: "view:markdown", producesInventory: true, parentSurface: "cli" },
  { surface: "web", producesInventory: true, parentSurface: "cli" },
];

/** Every shipped licensing surface, including asset-only source distribution. */
export const LICENSE_SURFACE_DECLARATIONS = Object.freeze(
  declarations.map((declaration) => Object.freeze(declaration)),
);

export const LICENSE_SURFACES = Object.freeze(
  LICENSE_SURFACE_DECLARATIONS.map((declaration) => declaration.surface),
);

export const LICENSE_INVENTORY_SURFACES = Object.freeze(
  LICENSE_SURFACE_DECLARATIONS
    .filter((declaration) => declaration.producesInventory)
    .map((declaration) => declaration.surface),
);

/** Return the named surface and every child surface folded into its package. */
export function includedLicenseSurfaces(surface) {
  requireDeclaredSurface(surface);
  return LICENSE_SURFACE_DECLARATIONS
    .filter((declaration) => declaration.surface === surface || declaration.parentSurface === surface)
    .map((declaration) => declaration.surface);
}

/** Find the published-package surface declared for one repository-relative directory. */
export function licenseSurfaceForPackageDirectory(packageDirectory) {
  return LICENSE_SURFACE_DECLARATIONS.find(
    (declaration) => declaration.packageDirectory === packageDirectory,
  ) ?? null;
}

export function isDeclaredLicenseSurface(surface) {
  return LICENSE_SURFACES.includes(surface);
}

/** Reject a surface absent from the declaration or one that cannot emit an inventory. */
export function requireDeclaredLicenseSurface(surface, { inventory = false } = {}) {
  const declaration = LICENSE_SURFACE_DECLARATIONS.find((candidate) => candidate.surface === surface);
  if (declaration === undefined) {
    throw new Error(`Undeclared license surface ${JSON.stringify(surface)}`);
  }
  if (inventory && !declaration.producesInventory) {
    throw new Error(`License surface ${JSON.stringify(surface)} does not produce an inventory`);
  }
  return declaration;
}

function requireDeclaredSurface(surface) {
  requireDeclaredLicenseSurface(surface);
}
