import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { generateIndexes } from "../../scripts/specs-index.mjs";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-specs-index-"));
  roots.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string, content: string): void {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("indexes primary UI MDX specs and reads descriptions after their Storybook preambles", () => {
  const root = tempRoot();
  writeFixture(root, "specs/index.md", "");
  writeFixture(root, "specs/ui/app/index.md", "*UI spec: the app surface.*\n\n# App\n");
  writeFixture(
    root,
    "specs/ui/app/toolbox.mdx",
    [
      'import { Meta } from "@storybook/addon-docs/blocks";',
      'import * as Stories from "./toolbox.stories.ts";',
      "",
      "<Meta of={Stories} />",
      "",
      "*UI spec: the Toolbox.*",
      "",
      "# Toolbox",
      "",
    ].join("\n"),
  );
  writeFixture(
    root,
    "specs/ui/templates/checklist.mdx",
    [
      'import { Meta } from "@storybook/addon-docs/blocks";',
      'import * as Stories from "./checklist.stories.ts";',
      "",
      "<Meta of={Stories} />",
      "",
      "{/* Story wrapper. */}",
      "export const Artifact = ({ children }) => <div>{children}</div>;",
      "",
      "*UI spec: the Checklist template page.*",
      "",
      "# Checklist template",
      "",
    ].join("\n"),
  );

  generateIndexes(root);

  const index = readFileSync(path.join(root, "specs/index.md"), "utf8");
  expect(index).toMatch(/`toolbox\.mdx` \(\d+ lines\) — \*UI spec: the Toolbox\.\*/);
  expect(index).toMatch(/`checklist\.mdx` \(\d+ lines\) — \*UI spec: the Checklist template page\.\*/);
});

test("does not treat MDX files in the proof tree as proofs", () => {
  const root = tempRoot();
  writeFixture(root, "proofs/index.md", "");
  writeFixture(root, "proofs/ui/app/index.md", "*Proof of the app UI spec.*\n");
  writeFixture(root, "proofs/ui/app/toolbox.md", "*Proof of the Toolbox UI spec.*\n");
  writeFixture(root, "proofs/ui/app/not-a-proof.mdx", "*This MDX file is not a proof.*\n");

  generateIndexes(root);

  const index = readFileSync(path.join(root, "proofs/index.md"), "utf8");
  expect(index).toContain("`toolbox.md`");
  expect(index).not.toContain("not-a-proof.mdx");
});
