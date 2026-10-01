import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(LIB_DIR, "../..");
const RUNTIME = resolve(LIB_DIR, "runtime.ts");

// The root bare references resolve against: {% render 'surface/name' %}
// looks here. './name' resolves against the referencing template's own
// directory — real filesystem semantics, applied entirely at transform time.
const SPEC_ROOT = "specs/ui";

const RENDER_RE = /\{%-?\s*render\s+(['"])([^'"]+)\1/g;
// `import` binds; a trailing kind (", raw") changes what binds, so the two are
// scanned separately — they resolve the same way but are emitted with
// different vite queries.
const IMPORT_RE = /\{%-?\s*import\s+(['"])([^'"]+)\1\s+as\s+\w+\s*%\}/g;
const IMPORT_RAW_RE = /\{%-?\s*import\s+(['"])([^'"]+)\1\s+as\s+\w+\s*,\s*raw\s*%\}/g;
const ATTACH_STYLES_RE = /\{%-?\s*attach_styles\s+(['"])([^'"]+)\1/g;
// `import_map` names a manifest rather than a file to bind, so it is scanned
// the same way but resolved twice: once to the manifest, then once per entry.
const IMPORT_MAP_RE = /\{%-?\s*import_map\s+(['"])([^'"]+)\1\s+as\s+\w+\s*%\}/g;
const IMPORT_MAP_RAW_RE = /\{%-?\s*import_map\s+(['"])([^'"]+)\1\s+as\s+\w+\s*,\s*raw\s*%\}/g;

// References are scanned only in executing template text: examples quoted
// inside doc/comment/raw blocks must not become imports.
const NON_EXECUTING_RE = /\{%-?\s*(doc|comment|raw)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g;

function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split("\\").join("/");
}

function resolveRef(ref: string, ext: string, fromFile: string): string {
  // A package-qualified reference is the bundler's to resolve — that is what
  // lets a spec point at material an installed dependency publishes without
  // copying it into the spec tree.
  if (ref.startsWith("@")) return ref;
  const withExt = ref.endsWith(ext) ? ref : ref + ext;
  return withExt.startsWith(".")
    ? resolve(dirname(fromFile), withExt)
    : resolve(REPO_ROOT, SPEC_ROOT, withExt);
}

function refs(code: string, re: RegExp, ext: string, file: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of code.replace(NON_EXECUTING_RE, "").matchAll(re)) {
    const ref = match[2]!;
    if (!found.has(ref)) found.set(ref, resolveRef(ref, ext, file));
  }
  return found;
}

/**
 * A manifest is read here, while transforming, rather than imported and read
 * at render time: its entries become real imports, so the module graph carries
 * the whole set and a malformed manifest fails the build rather than a render.
 */
function readManifest(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`import_map: cannot read manifest ${repoPath(path)}`);
  }
  const data: unknown = parseYaml(text);
  const entries =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.entries(data as Record<string, unknown>)
      : undefined;
  if (!entries || entries.some(([, ref]) => typeof ref !== "string")) {
    throw new Error(
      `import_map: ${repoPath(path)} must be a mapping of names to file references`,
    );
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * YAML is not importable without a loader, so one exists — but it belongs to
 * the file format, not to the spec tree. A manifest or a fixture is no less a
 * YAML file for living outside specs/, and scoping the loader by location only
 * pushed the exceptions into its callers.
 */
export function isYml(file: string): boolean {
  return file.endsWith(".yml");
}

export function transformYml(code: string): string {
  const data: unknown = parseYaml(code);
  if (data === undefined || data === null) throw new Error("empty YAML data file");
  return `export default ${JSON.stringify(data)};`;
}

/**
 * Compiles a .liquid file into a JS module: every file the template
 * references is resolved here, against the real filesystem layout, and
 * handed to compile() as the template's dependencies — the runtime resolves
 * nothing. Referenced files are imported, so the module graph tracks them
 * for hot reload.
 */
export function transformLiquid(code: string, file: string): string {
  const partials = [...refs(code, RENDER_RE, ".liquid", file)];
  // References are written in full, so pass ext "" throughout: the resolver
  // keeps each exactly as the template wrote it.
  const raw = [...refs(code, IMPORT_RAW_RE, "", file)];
  const rawRefs = new Set(raw.map(([ref]) => ref));
  const imports = [...refs(code, IMPORT_RE, "", file)].filter(([ref]) => !rawRefs.has(ref));
  const styles = [...refs(code, ATTACH_STYLES_RE, "", file)];
  const entries = (kind: string, list: [string, string][]) =>
    list.map(([ref], i) => `${JSON.stringify(ref)}: ${kind}${i}`).join(", ");

  // Each manifest expands to one import per entry, plus an import of the
  // manifest itself so that editing the set rebuilds everything that draws
  // on it.
  const rawMaps = [...refs(code, IMPORT_MAP_RAW_RE, "", file)];
  const rawMapRefs = new Set(rawMaps.map(([ref]) => ref));
  const mapDecls = [
    ...rawMaps.map(([ref, dep]) => ({ ref, dep, raw: true })),
    ...[...refs(code, IMPORT_MAP_RE, "", file)]
      .filter(([ref]) => !rawMapRefs.has(ref))
      .map(([ref, dep]) => ({ ref, dep, raw: false })),
  ];
  const mapImports: string[] = [];
  const maps = mapDecls.map((decl, i) => {
    const fields = Object.entries(readManifest(decl.dep)).map(([name, entryRef], j) => {
      const id = `m${i}e${j}`;
      const dep = resolveRef(entryRef, "", decl.dep) + (decl.raw ? "?raw" : "");
      mapImports.push(`import ${id} from ${JSON.stringify(dep)};`);
      return `${JSON.stringify(name)}: ${id}`;
    });
    mapImports.push(`import ${JSON.stringify(decl.dep)};`);
    return `${JSON.stringify(decl.ref)}: { ${fields.join(", ")} }`;
  });

  return [
    `import { compile } from ${JSON.stringify(RUNTIME)};`,
    ...partials.map(([, dep], i) => `import p${i} from ${JSON.stringify(dep)};`),
    ...imports.map(([, dep], i) => `import i${i} from ${JSON.stringify(dep)};`),
    ...raw.map(([, dep], i) => `import r${i} from ${JSON.stringify(dep + "?raw")};`),
    ...styles.map(([, dep], i) => `import s${i} from ${JSON.stringify(dep + "?inline")};`),
    ...mapImports,
    `export default compile(${JSON.stringify(code)}, {`,
    `  name: ${JSON.stringify(repoPath(file))},`,
    `  partials: { ${entries("p", partials)} },`,
    `  imports: { ${entries("i", imports)} },`,
    `  raw: { ${entries("r", raw)} },`,
    `  styles: { ${entries("s", styles)} },`,
    `  maps: { ${maps.join(", ")} },`,
    `});`,
  ].join("\n");
}
