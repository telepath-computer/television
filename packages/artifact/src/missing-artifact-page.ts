export function missingArtifactTitle(): string {
  return "Artifact file not found";
}

export function missingArtifactDescription(): string {
  return "This artifact is still registered, but the file or directory it points at is missing.";
}

export function missingArtifactRecoveryHint(): string {
  return "Recreate the file at this path, update the artifact path, or remove the artifact.";
}
