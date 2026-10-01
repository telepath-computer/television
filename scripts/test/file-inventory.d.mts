import type { TestSurface, TestConfig } from "./config.mjs";
export const TEST_FILE_PATTERN: RegExp;
export interface InventoryFile { path: string; surfaceId: string; runner: "vitest" | "playwright" }
export function enumerateTestInventory(options: { repoRoot?: string; surfaces: TestSurface[]; selectedSurfaceIds?: string[]; commit?: string | null }): InventoryFile[];
export function enumerateTrackedPaths(options?: { repoRoot?: string; commit?: string | null }): string[];
export function loadRegistrySnapshotAtCommit(options?: { repoRoot?: string; commit?: string }): Promise<TestConfig & { registryDigest: string }>;
