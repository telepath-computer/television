import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// Enforces specs/spec-policy.md's procedural reference-integrity rules. Once
// that policy declares the proof system, the same checks cover the specs/proofs
// union and the mirror invariant becomes mandatory.

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SPECS_ROOT = path.join(REPO_ROOT, "specs");
const PROOFS_ROOT = path.join(REPO_ROOT, "proofs");
const PROOFS_ENABLED = readFileSync(path.join(SPECS_ROOT, "spec-policy.md"), "utf8")
  .includes("\n## Proofs\n");
const ASSERTION_HEADING = /^#{1,6}\s+(?:Test assertions?(?::.*)?|Acceptance (?:test )?criteria(?::.*)?|Architecture test assertions?(?::.*)?)\s*$/im;
const ANCHOR_DEFINITION = /(?<![#\w-])\^([A-Za-z0-9-]+)(?![\w-])[ \t]*$/gm;
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

function walk(dir: string, predicate: (file: string) => boolean = () => true): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return walk(absolute, predicate);
    }
    return entry.isFile() && predicate(absolute) ? [absolute] : [];
  });
}

const specMarkdown = walk(SPECS_ROOT, (file) => file.endsWith(".md"));
const proofMarkdown = walk(PROOFS_ROOT, (file) => file.endsWith(".md"));
const authorityMarkdown = [...specMarkdown, ...proofMarkdown];
// Guides are not authority; only their links are checked, so a moved guide fails loudly.
const guideMarkdown = [
  path.join(REPO_ROOT, "docs", "README.md"),
  ...walk(path.join(REPO_ROOT, "docs", "guides"), (file) => file.endsWith(".md")),
].filter(existsSync);

// Prose only: fenced code blocks and inline code spans may quote syntax.
// A code span inside link text remains prose so the link target is checked.
function proseSegments(source: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (const match of source.matchAll(
    /```[\s\S]*?```|~~~[\s\S]*?~~~|\[[^\]\n]*`[^`\n]*`[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`/g,
  )) {
    if (match[0].startsWith("[")) continue;
    const index = match.index!;
    segments.push(source.slice(start, index));
    start = index + match[0].length;
  }
  segments.push(source.slice(start));
  return segments;
}

function references(file: string): string[] {
  const out: string[] = [];
  for (const segment of proseSegments(readFileSync(file, "utf8"))) {
    for (const match of segment.matchAll(/\[[^\]]*\]\(([^)\s#]+(?:#[^)]*)?)\)/g)) {
      out.push(match[1]!.replace(/\\$/, ""));
    }
  }
  return out;
}

function proofBearingSpecs(): string[] {
  return ["product", "arch", "ui"]
    .flatMap((area) => walk(path.join(SPECS_ROOT, area), (file) => file.endsWith(".md")))
    .filter((file) => {
      const basename = path.basename(file);
      return !basename.startsWith("runbook-") && !basename.startsWith("explainer-");
    })
    .filter((file) => {
      const relative = path.relative(SPECS_ROOT, file).split(path.sep);
      return relative[0] !== "ui" || path.basename(file) === "index.md";
    });
}

function proofBearingProofs(): string[] {
  return ["product", "arch", "ui"]
    .flatMap((area) => walk(path.join(PROOFS_ROOT, area), (file) => file.endsWith(".md")));
}

function relativeMirror(file: string, fromRoot: string, toRoot: string): string {
  return path.join(toRoot, path.relative(fromRoot, file));
}

function blockAnchorExists(file: string, anchor: string): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![#\\w-])\\^${escaped}(?![\\w-])[ \\t]*$`, "m").test(readFileSync(file, "utf8"));
}

describe("spec and proof reference integrity", () => {
  test("authority documents carry no wikilink syntax", () => {
    const offenders = authorityMarkdown.flatMap((file) =>
      proseSegments(readFileSync(file, "utf8")).some((segment) => segment.includes("[["))
        ? [path.relative(REPO_ROOT, file)]
        : []
    );
    expect(offenders).toEqual([]);
  });

  test("every relative link resolves to an existing file", () => {
    const broken: string[] = [];
    for (const file of [...authorityMarkdown, ...guideMarkdown]) {
      for (const href of references(file)) {
        if (/^[a-z][a-z+.-]*:/i.test(href)) continue;
        const [target] = href.split("#");
        if (target === "") continue;
        if (path.isAbsolute(target!)) {
          broken.push(`${path.relative(REPO_ROOT, file)} -> ${href}`);
          continue;
        }
        const resolved = path.resolve(path.dirname(file), target!);
        if (!existsSync(resolved) || !statSync(resolved).isFile()) {
          broken.push(`${path.relative(REPO_ROOT, file)} -> ${href}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("every cited block ref exists in its target", () => {
    const dangling: string[] = [];
    for (const file of authorityMarkdown) {
      for (const href of references(file)) {
        if (/^[a-z][a-z+.-]*:/i.test(href)) continue;
        const hash = href.indexOf("#");
        if (hash === -1) continue;
        const anchor = href.slice(hash + 1);
        if (!anchor.startsWith("^")) continue;
        const target = href.slice(0, hash);
        if (path.isAbsolute(target)) continue;
        const resolved = target === "" ? file : path.resolve(path.dirname(file), target);
        if (!blockAnchorExists(resolved, anchor.slice(1))) {
          dangling.push(`${path.relative(REPO_ROOT, file)} -> ${href}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  test("block refs are unique across specs and proofs", () => {
    const owners = new Map<string, string[]>();
    for (const file of authorityMarkdown) {
      for (const segment of proseSegments(readFileSync(file, "utf8"))) {
        for (const match of segment.matchAll(ANCHOR_DEFINITION)) {
          const owner = `${path.relative(REPO_ROOT, file)}:${segment.slice(0, match.index).split("\n").length}`;
          owners.set(match[1]!, [...(owners.get(match[1]!) ?? []), owner]);
        }
      }
    }
    const duplicates = [...owners.entries()]
      .filter(([, locations]) => locations.length > 1)
      .map(([anchor, locations]) => `^${anchor}: ${locations.join(", ")}`)
      .sort();
    expect(duplicates).toEqual([]);
  });

  test("the proof tree mirrors every proof-bearing spec and has no orphan", () => {
    if (!PROOFS_ENABLED) return;
    const missing = proofBearingSpecs()
      .map((file) => relativeMirror(file, SPECS_ROOT, PROOFS_ROOT))
      .filter((file) => !existsSync(file))
      .map((file) => path.relative(REPO_ROOT, file));
    const orphaned = proofBearingProofs()
      .map((file) => relativeMirror(file, PROOFS_ROOT, SPECS_ROOT))
      .filter((file) => !existsSync(file))
      .map((file) => path.relative(REPO_ROOT, file));
    expect({ missing, orphaned }).toEqual({ missing: [], orphaned: [] });
  });

  test("every proof declares its exact mirrored spec", () => {
    if (!PROOFS_ENABLED) return;
    const broken: string[] = [];
    for (const proof of proofBearingProofs()) {
      const source = readFileSync(proof, "utf8");
      const match = source.match(/^Proves \[[^\]]+\]\(([^)\s]+)\)\.\s*$/m);
      const expected = relativeMirror(proof, PROOFS_ROOT, SPECS_ROOT);
      const resolved = match ? path.resolve(path.dirname(proof), match[1]!.split("#")[0]!) : null;
      if (resolved !== expected) broken.push(path.relative(REPO_ROOT, proof));
    }
    expect(broken).toEqual([]);
  });

  test("specs carry no assertion headings", () => {
    if (!PROOFS_ENABLED) return;
    const offenders = specMarkdown.flatMap((file) =>
      proseSegments(readFileSync(file, "utf8")).some((segment) => ASSERTION_HEADING.test(segment))
        ? [path.relative(REPO_ROOT, file)]
        : []
    );
    expect(offenders).toEqual([]);
  });

  test("test-code citations resolve to spec or proof anchors", () => {
    if (!PROOFS_ENABLED) return;
    const dangling: string[] = [];
    const code = [path.join(REPO_ROOT, "packages"), path.join(REPO_ROOT, "test")]
      .flatMap((root) => walk(root, (file) => CODE_EXTENSIONS.has(path.extname(file))));
    for (const file of code) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\b(specs|proofs)\/((?:product|arch|ui)\/[^#\s"'`()\]}>]+\.md)#\^([A-Za-z0-9-]+)/g)) {
        const target = path.join(REPO_ROOT, match[1]!, match[2]!);
        if (!blockAnchorExists(target, match[3]!)) {
          dangling.push(`${path.relative(REPO_ROOT, file)} -> ${match[0]}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});
