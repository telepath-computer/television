import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { authorityDocuments, proofBearingSpecs, relativeMirror, TEST_CODE_CITATION } from "./lib/spec-documents.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-mdx-specs-"));
  roots.push(root);
  const files = [
    "specs/ui/app/toolbox.mdx", "proofs/ui/app/toolbox.md",
    "specs/ui/retained/index.md", "proofs/ui/retained/index.md",
    "specs/ui/retained/details.md", "specs/ui/workshop/readme.md",
    "specs/product/templates.md", "proofs/product/templates.md",
  ];
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "*A fixture document.*\n\n# Fixture\n");
  }
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("indexes standalone MDX specs and Markdown proofs while retaining prose selection", () => {
  const root = fixture();
  execFileSync(process.execPath, ["--input-type=module", "-e", "import { generateIndexes } from './scripts/specs-index.mjs'; generateIndexes(process.argv[1]);", root], { cwd: path.resolve(import.meta.dirname, "../..") });
  const specs = readFileSync(path.join(root, "specs/index.md"), "utf8");
  const proofs = readFileSync(path.join(root, "proofs/index.md"), "utf8");
  expect(specs).toContain("`toolbox.mdx`");
  expect(specs).toContain("`details.md`");
  expect(specs).not.toContain("`readme.md`");
  expect(proofs).toContain("`toolbox.md`");
  expect(proofs).toContain("`templates.md`");
});

test("checks MDX authority, citations and mirrors in both directions alongside retained specs", () => {
  const root = fixture();
  const specs = path.join(root, "specs"), proofs = path.join(root, "proofs");
  expect(authorityDocuments(specs)).toContain(path.join(specs, "ui/app/toolbox.mdx"));
  expect(proofBearingSpecs(specs).map(file => path.relative(specs, file)).sort()).toEqual([
    "product/templates.md", "ui/app/toolbox.mdx", "ui/retained/index.md",
  ]);
  for (const file of proofBearingSpecs(specs)) {
    const proof = relativeMirror(file, specs, proofs);
    expect(proof.endsWith(".md")).toBe(true);
    expect(relativeMirror(proof, proofs, specs)).toBe(file);
  }
  expect(relativeMirror(path.join(proofs, "ui/orphan.md"), proofs, specs)).toBe(path.join(specs, "ui/orphan.md"));
  writeFileSync(path.join(proofs, "ui/invalid.mdx"), "*A wrong proof extension.*\n");
  expect(relativeMirror(path.join(specs, "ui/invalid.mdx"), specs, proofs)).toBe(path.join(proofs, "ui/invalid.md"));
  const citations = [..."specs/ui/app/toolbox.mdx#^toolbox-search proofs/ui/app/toolbox.md#^toolbox-t-search-state".matchAll(TEST_CODE_CITATION)];
  expect(citations.map(match => match[2])).toEqual(["ui/app/toolbox.mdx", "ui/app/toolbox.md"]);
});
