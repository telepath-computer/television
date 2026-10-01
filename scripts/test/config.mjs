import fs from "node:fs";
import path from "node:path";
import testConfig from "../../test.config.mjs";

export const CANONICAL_TEST_INCLUDE_ROOTS = ["packages", "test"];

export function loadTestConfig({ root = process.cwd() } = {}) {
  const packageDirs = discoverPackageDirs(root);
  const surfaces = rawSurfaces(testConfig).map((surface) => normalizeSurface(surface, root, packageDirs));
  return { ...testConfig, surfaces };
}

export function validateRegistry(config, { root = process.cwd() } = {}) {
  const errors = [];
  const ids = new Set();
  for (const surface of config.surfaces) {
    if (ids.has(surface.id)) errors.push(`duplicate surface id: ${surface.id}`);
    ids.add(surface.id);
    if (!fs.existsSync(path.join(root, surface.config))) errors.push(`surface ${surface.id} config does not exist: ${surface.config}`);
    for (const rootPath of surface.roots) {
      if (!fs.existsSync(path.join(root, rootPath))) errors.push(`surface ${surface.id} root does not exist: ${rootPath}`);
    }
    for (const rootPath of surface.excludeRoots ?? []) {
      if (!fs.existsSync(path.join(root, rootPath))) errors.push(`surface ${surface.id} excludeRoot does not exist: ${rootPath}`);
    }
    const serviceIds = new Set();
    const publishedVariables = new Set();
    for (const service of surface.services ?? []) {
      if (serviceIds.has(service.id)) errors.push(`surface ${surface.id} has duplicate service id: ${service.id}`);
      serviceIds.add(service.id);
      if (service.kind !== "vite") errors.push(`surface ${surface.id} service ${service.id} has unsupported kind: ${service.kind}`);
      if (!fs.existsSync(path.join(root, service.config))) errors.push(`surface ${surface.id} service ${service.id} config does not exist: ${service.config}`);
      if (!/^[A-Z_][A-Z0-9_]*$/.test(service.publishUrlEnv)) errors.push(`surface ${surface.id} service ${service.id} has invalid publishUrlEnv: ${service.publishUrlEnv}`);
      if (publishedVariables.has(service.publishUrlEnv)) errors.push(`surface ${surface.id} has duplicate service publishUrlEnv: ${service.publishUrlEnv}`);
      publishedVariables.add(service.publishUrlEnv);
    }
  }

  const registered = new Set(config.surfaces.map((surface) => path.normalize(surface.config)));
  for (const file of discoverConfigFiles(root)) {
    const relative = path.normalize(path.relative(root, file));
    if (!registered.has(relative)) {
      errors.push(`unregistered test config: ${relative}`);
    }
  }
  return errors;
}

export function selectSurfaces(config, options) {
  let selected = config.surfaces;
  if (options.all) selected = applySuite(config, selected, "all");
  if (options.suite) selected = applySuite(config, selected, options.suite);
  if (options.surface) {
    const wanted = splitList(options.surface);
    selected = selected.filter((surface) => wanted.includes(surface.id));
  }
  if (options.package) {
    const wanted = splitList(options.package);
    selected = selected.filter((surface) => wanted.includes(surface.package));
  }
  if (options.runner) selected = selected.filter((surface) => surface.runner === options.runner);
  if (options.tag) {
    const wanted = splitList(options.tag);
    selected = selected.filter((surface) => wanted.every((tag) => surface.tags.includes(tag)));
  }
  if (options.file) {
    const owners = owningSurfaces(config.surfaces, options.file);
    const ownerIds = new Set(owners.map((surface) => surface.id));
    const intersected = selected.filter((surface) => ownerIds.has(surface.id));
    if (owners.length > 0 && intersected.length === 0 && hasFileCoSelectors(options)) {
      throw new Error(`${options.file} is not part of the selected surfaces (${describeFileCoSelectors(options)}). Owning surface(s): ${owners.map((surface) => surface.id).join(", ")}.`);
    }
    selected = intersected;
  }
  return selected;
}

export function owningSurfaces(surfaces, file) {
  const normalizedFile = path.normalize(file);
  return surfaces.filter((surface) => {
    if ((surface.excludeRoots ?? []).some((rootPath) => pathContains(rootPath, normalizedFile))) return false;
    return surface.roots.some((rootPath) => pathContains(rootPath, normalizedFile));
  });
}

function rawSurfaces(config) {
  if (Array.isArray(config.executionGroups)) {
    return config.executionGroups.flatMap((group) => (group.surfaces ?? []).map((surface) => ({
      ...surface,
      executionGroup: { id: group.id, name: group.name, order: group.order },
    })));
  }
  return config.surfaces ?? [];
}

function applySuite(config, surfaces, suiteName) {
  const suite = config.suites[suiteName];
  if (!suite) throw new Error(`Unknown suite ${JSON.stringify(suiteName)}. Valid suites: ${Object.keys(config.suites).join(", ")}`);
  return surfaces.filter((surface) => matchesRules(surface, suite.include ?? [], true) && !matchesRules(surface, suite.exclude ?? [], false));
}

function matchesRules(surface, rules, emptyValue) {
  if (rules.length === 0) return emptyValue;
  return rules.some((rule) => {
    const [key, value] = rule.split(":");
    if (key === "kind") return surface.kind === value;
    if (key === "runner") return surface.runner === value;
    if (key === "tag") return surface.tags.includes(value);
    if (key === "agent") return String(Boolean(surface.agent)) === value;
    return false;
  });
}

function normalizeSurface(surface, root, packageDirs) {
  const config = slash(path.normalize(surface.config));
  const cwd = surface.cwd ?? (surface.package ? packageDirs.get(surface.package) : defaultCwd(config));
  return {
    ...surface,
    config,
    cwd: slash(path.normalize(cwd)),
    roots: (surface.roots ?? []).map((entry) => slash(path.normalize(entry))),
    excludeRoots: (surface.excludeRoots ?? []).map((entry) => slash(path.normalize(entry))),
    services: (surface.services ?? []).map((service) => ({ ...service, config: slash(path.normalize(service.config)) })),
    absoluteConfig: path.join(root, surface.config),
  };
}

function pathContains(rootPath, file) {
  const normalizedRoot = path.normalize(rootPath);
  return file === normalizedRoot || file.startsWith(`${normalizedRoot}${path.sep}`);
}

function defaultCwd(config) {
  if (config === "vitest.config.ts" || config.startsWith("test/")) return ".";
  return slash(path.dirname(config));
}

function discoverPackageDirs(root) {
  const dirs = new Map();
  for (const file of findPackageJson(root)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pkg.name) dirs.set(pkg.name, slash(path.relative(root, path.dirname(file))));
    } catch {}
  }
  return dirs;
}

function findPackageJson(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", ".blaxel-testshards", ".testshards", ".test-runs", "dist"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name === "package.json") out.push(full);
    }
  };
  visit(root);
  return out;
}

function discoverConfigFiles(root) {
  const out = [];
  for (const includeRoot of CANONICAL_TEST_INCLUDE_ROOTS) {
    const absoluteRoot = path.join(root, includeRoot);
    if (fs.existsSync(absoluteRoot)) walk(absoluteRoot, out);
  }
  return out;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".blaxel-testshards", ".testshards", ".test-runs", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/^(vitest(\.e2e)?\.config|playwright\.config)\.ts$/.test(entry.name)) out.push(full);
  }
}

function hasFileCoSelectors(options) {
  return Boolean(options.all || options.suite || options.surface || options.package || options.runner || options.tag);
}

function describeFileCoSelectors(options) {
  const parts = [];
  if (options.all) parts.push("--all");
  if (options.suite) parts.push(`--suite ${options.suite}`);
  if (options.surface) parts.push(`--surface ${options.surface}`);
  if (options.package) parts.push(`--package ${options.package}`);
  if (options.runner) parts.push(`--runner ${options.runner}`);
  if (options.tag) parts.push(`--tag ${options.tag}`);
  return parts.join(", ");
}

function splitList(value) {
  return String(value).split(",").map((part) => part.trim()).filter(Boolean);
}

function slash(value) {
  return value.split(path.sep).join("/");
}
