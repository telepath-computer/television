import path from "node:path";

export function getStateDir(storagePath: string): string { return path.join(storagePath, "state"); }
export function getChannelsDir(storagePath: string): string { return path.join(getStateDir(storagePath), "channels"); }
/** Legacy metadata directory. Read only by the screen-to-channel boot migration. */
export function getLegacyScreensDir(storagePath: string): string { return path.join(getStateDir(storagePath), "screens"); }
export function getArtifactsMetadataDir(storagePath: string): string { return path.join(getStateDir(storagePath), "artifacts"); }
export function getDisplayStatePath(storagePath: string): string { return path.join(getStateDir(storagePath), "display.json"); }
export function getDisplayMigrationTempPath(storagePath: string): string { return path.join(getStateDir(storagePath), ".display.json.screen-to-channel.tmp"); }
export function getTelemetryStatePath(storagePath: string): string { return path.join(getStateDir(storagePath), "telemetry.json"); }
export function getTokenPath(storagePath: string): string { return path.join(getStateDir(storagePath), "token"); }
export function getOnboardingStatePath(storagePath: string): string { return path.join(getStateDir(storagePath), "onboarding.json"); }
export function getBundledThemesStatePath(storagePath: string): string { return path.join(getStateDir(storagePath), "bundled-themes.json"); }
// Legacy single-artifact sentinel. Read for migration only; old binaries gate
// their install on its existence, so it is kept in place indefinitely
// (specs/arch/onboarding/installer.md#^legacy-file-kept).
export function getOnboardingArtifactSentinelPath(storagePath: string): string { return path.join(getStateDir(storagePath), "onboarding-artifact.json"); }
export function getAgentArtifactsDir(storagePath: string): string { return path.join(...[storagePath, "artifacts"]); }
export function getArtifactLiveMetadataPath(storagePath: string, artifactID: string): string { return path.join(getArtifactsMetadataDir(storagePath), `${artifactID}.json`); }
