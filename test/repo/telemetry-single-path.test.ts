import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as serverModule from "../../packages/server/src/index.ts";

const REPO_ROOT = path.resolve(process.cwd());
const PRODUCTION_ROOTS = [path.join(REPO_ROOT, "packages")];
const TELEMETRY_SINK_PATH = path.join(REPO_ROOT, "packages/server/src/telemetry/sink.ts");
const TELEMETRY_RUNTIME_PATH = path.join(REPO_ROOT, "packages/server/src/telemetry/runtime.ts");
const ALLOWED_TELEMETRY_SINK_IMPORTERS = new Set([
  TELEMETRY_SINK_PATH,
  TELEMETRY_RUNTIME_PATH,
]);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (["node_modules", "dist", "out"].includes(entry)) continue;
      walkTsFiles(fullPath, out);
      continue;
    }
    if (!fullPath.endsWith(".ts")) continue;
    if (fullPath.endsWith(".test.ts") || fullPath.includes(`${path.sep}test${path.sep}`)) continue;
    out.push(fullPath);
  }
  return out;
}

describe("telemetry sink single path", () => {
  it("exports capture for producers without exposing sink factories or enqueue", () => {
    expect(serverModule).toHaveProperty("capture");
    expect(serverModule).not.toHaveProperty("enqueue");
    expect(serverModule).not.toHaveProperty("createTelemetrySink");
    expect(serverModule).not.toHaveProperty("createPostHogTransport");
  });

  it("keeps production code from importing the telemetry sink outside the chokepoint", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_ROOTS.flatMap((root) => walkTsFiles(root))) {
      if (ALLOWED_TELEMETRY_SINK_IMPORTERS.has(file)) continue;
      const source = readFileSync(file, "utf8");
      if (importsTelemetrySink(file, source)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders, `telemetry sink importers outside capture:\n${offenders.join("\n")}`).toEqual([]);
  });
});

function importsTelemetrySink(file: string, source: string): boolean {
  for (const specifier of importSpecifiers(source)) {
    if (resolveImport(file, specifier) === TELEMETRY_SINK_PATH) return true;
  }
  return false;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importExportPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(importExportPattern)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function resolveImport(file: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(file), specifier);
    return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
  }
  if (specifier === "@telepath-computer/television-server/telemetry/sink") return TELEMETRY_SINK_PATH;
  if (specifier.endsWith("/telemetry/sink") || specifier.endsWith("/telemetry/sink.ts")) return TELEMETRY_SINK_PATH;
  return null;
}
