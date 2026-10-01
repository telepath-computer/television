export interface PrebuiltBuild {
  id: string;
  command: string[];
  coversPreCommands: string[];
}

export interface PrebuiltManifest {
  artifactName: "prebuilt-dists";
  builds: PrebuiltBuild[];
}

export function prebuiltManifest(): PrebuiltManifest;
export function checkManifestCoversRegistry(config: unknown, manifest?: PrebuiltManifest): string[];
export function runRecipes(options?: { root?: string; manifest?: PrebuiltManifest }): void;
export function packUntrackedFiles(root: string, archivePath: string): void;
export function shouldSkipPreCommands(options: Record<string, unknown>, env?: Record<string, string | undefined>): boolean;
