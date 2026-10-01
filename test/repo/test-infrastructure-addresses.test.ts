import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadTestConfig } from "../../scripts/test/config.mjs";
import { INERT_NUMERIC_LOOPBACK_URLS } from "./test-infrastructure-address-allowlist.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".html", ".json", ".yml", ".yaml", ".sh"]);
const NUMERIC_LOOPBACK_URL = /(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+/g;

interface SourceMatch {
  file: string;
  line: number;
  value: string;
}

describe("test infrastructure address contract", () => {
  test("keeps live test addresses runner-published", () => {
    const files = canonicalTestSources();
    const observed = uniqueMatches(findMatches(files, NUMERIC_LOOPBACK_URL));
    const allowed = INERT_NUMERIC_LOOPBACK_URLS.map(({ file, url }) => ({ file, value: url }))
      .sort(compareMatchIdentity);

    expect(INERT_NUMERIC_LOOPBACK_URLS.every(({ reason }) => reason.trim().length >= 20)).toBe(true);
    expect(observed.map(({ file, value }) => ({ file, value })).sort(compareMatchIdentity)).toEqual(allowed);
  });

  test("has no fixed-listener fallback in canonical test sources", () => {
    const files = canonicalTestSources();
    const forbidden = [
      { name: "Playwright webServer", pattern: /^\s*(?:["']webServer["']|webServer)\s*:/gm },
      { name: "existing-server reuse", pattern: /^\s*(?:["']reuseExistingServer["']|reuseExistingServer)\s*:/gm },
      { name: "numeric --port", pattern: /--port(?:=|\s+)[1-9][0-9]{0,4}\b/g },
      { name: "adjacent-port arithmetic", pattern: /\b(?:host|view|server|base|artifact)?port\s*[+-]\s*1\b/gi },
      { name: "reserve-close-rebind helper", pattern: /\b(?:reservePort|findFreePort|getFreePort)\b/g },
    ];

    const violations = forbidden.flatMap(({ name, pattern }) =>
      findMatches(files, pattern).map((match) => ({ name, ...match })),
    );
    expect(violations).toEqual([]);
  });

  test("deletes compatibility cleanup and process-name cleanup from runner code", () => {
    expect(existsSync(path.join(ROOT, "scripts/test/cleanup-servers.mjs"))).toBe(false);
    const files = sourceFiles(path.join(ROOT, "scripts"));
    const forbidden = /\b(?:cleanupKnownTestServers|KNOWN_TEST_SERVER_PORTS|cleanup_test_processes|fuser|psmisc|pkill)\b/g;

    expect(findMatches(files, forbidden)).toEqual([]);
  });
});

function canonicalTestSources(): string[] {
  const config = loadTestConfig({ root: ROOT });
  const inputs = new Set([
    "test.config.mjs",
    "scripts/test",
    "scripts/run-test-shard.mjs",
    "scripts/run-blaxel-testshards.mjs",
    ".github/actions",
    ".github/workflows",
  ]);
  for (const surface of config.surfaces) {
    if (surface.kind !== "e2e" && surface.kind !== "experiment") continue;
    inputs.add(surface.config);
    for (const root of surface.roots) inputs.add(root);
    for (const service of surface.services) inputs.add(service.config);
  }
  return [...inputs].flatMap((input) => sourceFiles(path.join(ROOT, input)));
}

function sourceFiles(input: string): string[] {
  if (!existsSync(input)) return [];
  if (statSync(input).isFile()) return SOURCE_EXTENSIONS.has(path.extname(input)) ? [input] : [];
  return readdirSync(input, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".test-runs") return [];
    const child = path.join(input, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : SOURCE_EXTENSIONS.has(path.extname(child)) ? [child] : [];
  });
}

function findMatches(files: string[], pattern: RegExp): SourceMatch[] {
  const matches: SourceMatch[] = [];
  for (const absolute of [...new Set(files)].sort()) {
    const source = readFileSync(absolute, "utf8");
    const expression = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of source.matchAll(expression)) {
      matches.push({
        file: path.relative(ROOT, absolute).split(path.sep).join("/"),
        line: source.slice(0, match.index ?? 0).split("\n").length,
        value: match[0],
      });
    }
  }
  return matches;
}

function uniqueMatches(matches: SourceMatch[]): SourceMatch[] {
  const byIdentity = new Map(matches.map((match) => [`${match.file}\0${match.value}`, match]));
  return [...byIdentity.values()];
}

function compareMatchIdentity(left: { file: string; value: string }, right: { file: string; value: string }): number {
  return left.file.localeCompare(right.file) || left.value.localeCompare(right.value);
}
