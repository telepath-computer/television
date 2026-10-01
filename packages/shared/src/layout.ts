import type { TabPage } from "./types.ts";

type PageLayoutValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validatePageLayout(value: unknown): PageLayoutValidationResult {
  if (!Array.isArray(value)) {
    return { valid: false, errors: ["Layout must be an array of pages"] };
  }

  const errors: string[] = [];
  for (const [index, page] of value.entries()) {
    validatePage(page, index, errors);
  }
  return { valid: errors.length === 0, errors };
}

export function getPageArtifactIds(pages: readonly TabPage[]): string[] {
  return pages.flatMap((page) => page.artifactIds);
}

export function removeArtifactFromPages(
  pages: readonly TabPage[],
  artifactId: string,
): TabPage[] {
  return pages.flatMap((page) => {
    if (!page.artifactIds.includes(artifactId)) {
      return [page];
    }

    const artifactIds = page.artifactIds.filter((candidate) => candidate !== artifactId);
    return artifactIds.length === 0 ? [] : [{ ...page, artifactIds }];
  });
}

export function preservesPageMembership(
  previousPages: readonly TabPage[],
  nextPages: readonly TabPage[],
): boolean {
  if (previousPages.length !== nextPages.length) {
    return false;
  }

  const unmatched = [...nextPages];
  for (const previousPage of previousPages) {
    const matchIndex = unmatched.findIndex((nextPage) =>
      haveSameArtifactMembership(previousPage, nextPage)
    );
    if (matchIndex === -1) {
      return false;
    }
    unmatched.splice(matchIndex, 1);
  }
  return true;
}

export function isPageReorder(
  previousPages: readonly TabPage[],
  nextPages: readonly TabPage[],
): boolean {
  return preservesPageMembership(previousPages, nextPages) &&
    previousPages.some((page, index) =>
      !haveSameArtifactMembership(page, nextPages[index]!)
    );
}

function validatePage(value: unknown, index: number, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`Page ${index} must be an object`);
    return;
  }

  for (const key of Object.keys(value)) {
    if (key !== "artifactIds" && key !== "geometry" && key !== "size") {
      errors.push(`Page ${index} has unknown field: ${key}`);
    }
  }

  if (!Array.isArray(value.artifactIds) || value.artifactIds.length === 0) {
    errors.push(`Page ${index} must contain at least one artifact id`);
  } else if (value.artifactIds.some((artifactId) =>
    typeof artifactId !== "string" || artifactId.length === 0
  )) {
    errors.push(`Page ${index} artifact ids must be non-empty strings`);
  }

  if (!isRecord(value.geometry)) {
    errors.push(`Page ${index} geometry must be an object`);
    return;
  }
  for (const key of Object.keys(value.geometry)) {
    if (key !== "kind" && key !== "full_screen") {
      errors.push(`Page ${index} geometry has unknown field: ${key}`);
    }
  }
  if (value.geometry.kind !== "single") {
    errors.push(`Page ${index} has unknown geometry kind: ${String(value.geometry.kind)}`);
    return;
  }
  if (typeof value.geometry.full_screen !== "boolean") {
    errors.push(`Page ${index} single geometry must include a boolean full_screen`);
  }

  if (!isRecord(value.size)) {
    errors.push(`Page ${index} size must be an object`);
    return;
  }
  for (const key of Object.keys(value.size)) {
    if (key !== "width" && key !== "height") {
      errors.push(`Page ${index} size has unknown field: ${key}`);
    }
  }
  for (const axis of ["width", "height"] as const) {
    const size = value.size[axis];
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      errors.push(`Page ${index} size ${axis} must be a finite positive number`);
    }
  }
}

function haveSameArtifactMembership(left: TabPage, right: TabPage): boolean {
  return left.artifactIds.length === right.artifactIds.length &&
    left.artifactIds.every((artifactId, index) => artifactId === right.artifactIds[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
