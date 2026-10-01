import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const referencePath = "packages/skills/skills/television/src/app-shell-reference.md";

// spec: proofs/arch/themes/authoring.md#^theme-authoring-t-app-shell-freshness
test("the authored theme reference covers current application authorities", () => {
  const reference = readFileSync(path.join(root, referencePath), "utf8");
  const sources = [...reference.matchAll(/<!-- app-reference-source: (\S+) sha256: ([a-f0-9]{64}) -->/g)];
  const authorities = [
    // The document root marker is owned by the app composition prose.
    "specs/ui/app/index.md",
    ...globSync("specs/ui/app/**/*", { cwd: root }).filter(file => /\.(frame|css)$/.test(file)),
  ].sort();
  expect(sources.map(match => match[1]).sort()).toEqual(authorities);
  const contents = sources.map(([, source, digest]) => {
    const bytes = readFileSync(path.join(root, source!));
    expect(createHash("sha256").update(bytes).digest("hex"),
      `${source} changed: review the authored reference before updating its fingerprint`,
    ).toBe(digest);
    return bytes.toString();
  }).join("\n");
  // Check names in both authored HTML and inline selector prose. These bounded
  // checks do not parse frame templates or judge selector meaning and nesting.
  const named = new Set<string>();
  for (const [, classes] of reference.matchAll(/\bclass="([^"]+)"/g)) {
    for (const name of classes!.split(/\s+/)) named.add(name);
  }
  for (const [, id] of reference.matchAll(/\bid="([^"]+)"/g)) named.add(id!);
  for (const [, tag] of reference.matchAll(/<(tv-[a-z-]+)\b/g)) named.add(tag!);
  for (const [, snippet] of reference.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
    for (const [, name] of snippet!.matchAll(/[.#]([a-z][a-z0-9-]*)/g)) named.add(name!);
    for (const [name] of snippet!.matchAll(/\btv-[a-z-]+\b/g)) named.add(name);
    for (const [, name, value] of snippet!.matchAll(/\[([a-z][a-z-]*)(?:="([^"]*)")?\]/g)) {
      named.add(name!);
      if (value) named.add(value);
    }
  }
  // Attribute names and literal state values in structural outlines must also
  // occur in authority. Ellipses stand for omitted, runtime-provided text.
  for (const [tag] of reference.matchAll(/<[a-z][^>]*>/g)) {
    for (const [, name, value] of tag.matchAll(/\s([a-z][a-z-]*)(?:="([^"]*)")?/g)) {
      named.add(name!);
      if (value && /^(?:aria-|data-|role$|type$|trigger$|id$)/.test(name!) && !value.includes("…")) {
        named.add(value);
      }
    }
  }
  for (const name of named) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect.soft(contents, `reference name ${name}`).toMatch(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`));
  }
});
