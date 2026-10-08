import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error — repository build scripts have no declaration files
import { buildTelevision } from "../scripts/build.mjs";

const TOKEN_SHEETS = ["tokens/fonts.css", "colors.css", "text.css", "spacing.css", "shadows.css", "layers.css", "app.css"];
const TOKEN_GROUPS = ["Foundation tokens — fonts", "Foundation tokens — colors", "Foundation tokens — text sizes and line heights", "Foundation tokens — spacing and corners", "Foundation tokens — shadows", "Foundation tokens — layers", "Application tokens — grouped by component"];
const VOCABULARY_MARKER = "{{INJECT_FOUNDATION_VOCABULARY}}";

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "television-skill-build-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeSourceFixture(theming: string): Promise<string> {
  const sourceDirectory = path.join(work, "src");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    path.join(sourceDirectory, "skill-intro.md"),
    "---\ndescription: Fixture Television guidance.\n---\n\n# Television fixture\n",
  );
  await writeFile(path.join(sourceDirectory, "cli-capabilities.md"), "# CLI fixture\n");
  await writeFile(path.join(sourceDirectory, "artifact-workflow.md"), "# Workflow fixture\n");
  await writeFile(path.join(sourceDirectory, "html-artifact-style.md"), "# HTML fixture\n");
  await writeFile(path.join(sourceDirectory, "theming.md"), theming);
  await writeFile(path.join(sourceDirectory, "resources.md"), "# Resources fixture\n\nKept as written: $& {{INJECT_FOUNDATION_VOCABULARY}}\n");
  await writeFile(path.join(sourceDirectory, "app-shell-reference.md"), "Authored fixture reference.\n");
  return sourceDirectory;
}

async function writeFoundationFixture(): Promise<{
  foundationSourceRoot: string;
  generatedVocabulary: string;
}> {
  const foundationSourceRoot = path.join(work, "foundation");
  await mkdir(foundationSourceRoot, { recursive: true });
  const sections: string[] = [];
  for (const [index, filename] of TOKEN_SHEETS.entries()) {
    const replacementSyntax = index === 0
      ? "/* String.replace replacement syntax remains literal: $& $' $` $$ */\n"
      : "";
    const content = `${replacementSyntax}:where(:root) {\n  --fixture-${path.basename(filename, ".css")}: ${index + 1};\n}\n`;
    await mkdir(path.dirname(path.join(foundationSourceRoot, filename)), { recursive: true });
    await writeFile(path.join(foundationSourceRoot, filename), content);
    sections.push(`/* ${TOKEN_GROUPS[index]} */\n${content.trimEnd()}`);
  }
  return {
    foundationSourceRoot,
    generatedVocabulary: sections.join("\n\n"),
  };
}

test("inserts generated foundation fixture bytes at the vocabulary marker", async () => {
  const sourceDirectory = await writeSourceFixture(
    `# Theme fixture\n\nBefore vocabulary.\n\n${VOCABULARY_MARKER}\n\nAfter vocabulary.\n`,
  );
  const { foundationSourceRoot, generatedVocabulary } = await writeFoundationFixture();
  const outputDir = path.join(work, "dist");

  buildTelevision({
    sourceDirectory,
    foundationSourceRoot,
    outputDir,
  });

  const builtSkill = await readFile(path.join(outputDir, "SKILL.md"), "utf8");
  const builtTheming = await readFile(path.join(outputDir, "theming.md"), "utf8");
  expect(await readFile(path.join(outputDir, "resources.md"), "utf8")).toBe(
    "# Resources fixture\n\nKept as written: $& {{INJECT_FOUNDATION_VOCABULARY}}\n",
  );
  expect(builtSkill).toContain("# Television fixture");
  expect(builtSkill).toContain("# CLI fixture");
  expect(builtSkill).toContain("# Workflow fixture");
  expect(builtSkill).toContain("# HTML fixture");
  expect(builtTheming).toBe(
    `# Theme fixture\n\nBefore vocabulary.\n\n${generatedVocabulary}\n\nAfter vocabulary.\n`,
  );
  expect(builtTheming).toContain("/* String.replace replacement syntax remains literal: $& $' $` $$ */");
  expect(builtTheming).not.toContain(VOCABULARY_MARKER);
});

test("rejects theming source without the vocabulary marker", async () => {
  const sourceDirectory = await writeSourceFixture("# Theme fixture\n");
  const outputDir = path.join(work, "dist");

  expect(() => buildTelevision({ sourceDirectory, outputDir })).toThrow(
    `television/src/theming.md must contain the ${VOCABULARY_MARKER} marker.`,
  );
});

test("inserts the complete production token sheets in foundation order in the ordinary build", async () => {
  const outputDir = path.join(work, "dist");
  buildTelevision({
    outputDir,
  });

  const builtTheming = await readFile(path.join(outputDir, "theming.md"), "utf8");
  const catalogs = [...builtTheming.matchAll(/^### Token catalog\n\n```css\n([\s\S]*?)\n```/gm)];
  expect(catalogs).toHaveLength(1);
  const catalog = catalogs[0][1];
  expect(catalog).not.toContain("packages/web/src/foundation/");
  for (const group of TOKEN_GROUPS) expect(catalog).toContain(`/* ${group} */`);
  let previousIndex = -1;
  for (const filename of TOKEN_SHEETS) {
    const content = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../../../..",
        "packages",
        "web",
        "src",
        "foundation",
        filename,
      ),
      "utf8",
    );
    const section = content.trimEnd();
    const sectionIndex = catalog.indexOf(section);
    expect(sectionIndex, filename).toBeGreaterThan(previousIndex);
    previousIndex = sectionIndex;
  }
  expect(builtTheming).not.toContain("Placeholder — foundation token vocabulary");
  expect(builtTheming).not.toContain(VOCABULARY_MARKER);
});

test("inserts the authored application reference without interpreting its contents", async () => {
  const sourceDirectory = await writeSourceFixture(`${VOCABULARY_MARKER}\n{{INJECT_APP_SHELL_REFERENCE}}\n`);
  const { foundationSourceRoot } = await writeFoundationFixture();
  const outputDir = path.join(work, "dist");
  buildTelevision({ sourceDirectory, foundationSourceRoot, outputDir });
  const output = await readFile(path.join(outputDir, "theming.md"), "utf8");
  expect(output).toContain("Authored fixture reference.");
  expect(output).not.toContain("{{INJECT_APP_SHELL_REFERENCE}}");
});

test("omits reference freshness metadata while preserving authored guidance", async () => {
  const sourceDirectory = await writeSourceFixture(`${VOCABULARY_MARKER}\n{{INJECT_APP_SHELL_REFERENCE}}\n`);
  const sourceHash = "d0ed6512d721f5e41b8b00ed1ba5231cf24a28d8ff5671270ea5fb75dd25a5e9";
  const reference = "Before reference.\n\n<!-- Authority freshness: review sources. -->\n<!-- app-reference-source: specs/ui/app/index.md sha256: " + sourceHash + " -->\n\n<!-- Keep this authored comment. -->\nAfter reference. $&\n";
  await writeFile(path.join(sourceDirectory, "app-shell-reference.md"), reference);
  const { foundationSourceRoot } = await writeFoundationFixture();
  const outputDir = path.join(work, "dist");
  buildTelevision({ sourceDirectory, foundationSourceRoot, outputDir });
  const output = await readFile(path.join(outputDir, "theming.md"), "utf8");
  expect(output).not.toContain("app-reference-source");
  expect(output).not.toContain("Authority freshness:");
  expect(output).not.toContain(sourceHash);
  expect(output).toContain("Before reference.");
  expect(output).toContain("<!-- Keep this authored comment. -->\nAfter reference. $&");
  expect(await readFile(path.join(sourceDirectory, "app-shell-reference.md"), "utf8")).toBe(reference);
});
