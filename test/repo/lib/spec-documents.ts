import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const TEST_CODE_CITATION = /\b(specs|proofs)\/((?:product|arch|ui)\/[^#\s"'`()\]}>]+\.mdx?)#\^([A-Za-z0-9-]+)/g;

export function authorityDocuments(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return authorityDocuments(file);
    return entry.isFile() && /\.mdx?$/.test(file) ? [file] : [];
  });
}

export function proofBearingSpecs(root: string): string[] {
  return ["product", "arch", "ui"].flatMap(area => authorityDocuments(path.join(root, area)))
    .filter(file => !/^(runbook-|explainer-)/.test(path.basename(file)))
    .filter(file => path.relative(root, file).split(path.sep)[0] !== "ui"
      || path.basename(file) === "index.md" || file.endsWith(".mdx"));
}

/** MDX surfaces have Markdown proofs; retained specs keep their Markdown path. */
export function relativeMirror(file: string, fromRoot: string, toRoot: string): string {
  const mirror = path.join(toRoot, path.relative(fromRoot, file)).replace(/\.mdx$/, ".md");
  return path.basename(toRoot) === "specs" && !existsSync(mirror) && existsSync(`${mirror}x`)
    ? `${mirror}x` : mirror;
}
