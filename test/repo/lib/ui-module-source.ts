import path from "node:path";

export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

/** Whether a module imports the requested sibling sheet through a production route. */
export function hasSiblingStylesheet(
  file: SourceFile,
  stylesheet = path.join(path.dirname(file.path), `${path.basename(file.path, ".ts")}.css`),
): boolean {
  if (path.dirname(file.path) !== path.dirname(stylesheet)) return false;
  const expectedSpecifier = `./${path.basename(stylesheet)}`;
  const escapedSpecifier = expectedSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\bimport\\s+(?:[^"']*?\\bfrom\\s*)?["']${escapedSpecifier}(?:\\?inline)?["']`,
  ).test(file.source);
}
