import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function groupByExecutionGroup(items, { getMetadata = (item) => item.executionGroup, getFallbackId = (item) => item.id } = {}) {
  const groups = new Map();
  for (const item of items) {
    const metadata = getMetadata(item) ?? { id: getFallbackId(item), name: getFallbackId(item), order: Number.MAX_SAFE_INTEGER };
    const group = groups.get(metadata.id) ?? { id: metadata.id, name: metadata.name ?? metadata.id, order: metadata.order ?? Number.MAX_SAFE_INTEGER, items: [] };
    group.items.push(item);
    groups.set(metadata.id, group);
  }
  return [...groups.values()].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

export function vitestProjectsArgs({ configPath, configPaths }) {
  const runnerPath = fileURLToPath(new URL("./vitest-attempt-reporter.mjs", import.meta.url));
  const projects = configPaths.map((projectConfig) => ({
    extends: projectConfig,
    root: path.dirname(projectConfig),
    test: { runner: runnerPath },
  }));
  fs.writeFileSync(configPath, `import { defineConfig } from "vitest/config";\nexport default defineConfig(${JSON.stringify({ test: { projects } }, null, 2)});\n`);
  return ["vitest", "run", "--config", configPath];
}

export function writeVitestRunnerConfig({ configPath, baseConfigPath, runnerPath }) {
  fs.writeFileSync(configPath, [
    'import { defineConfig, mergeConfig } from "vitest/config";',
    `import base from ${JSON.stringify(path.resolve(baseConfigPath))};`,
    `export default mergeConfig(base, defineConfig({ test: { runner: ${JSON.stringify(path.resolve(runnerPath))} } }));`,
    "",
  ].join("\n"));
}

export function splitVitestWorkspaceResult({ nativeResultPath, tasks }) {
  const statuses = new Map(tasks.map((task) => [task.surfaceId, 0]));
  if (!fs.existsSync(nativeResultPath)) return new Map(tasks.map((task) => [task.surfaceId, 1]));
  const native = JSON.parse(fs.readFileSync(nativeResultPath, "utf8"));
  for (const task of tasks) {
    const testResults = (native.testResults ?? []).filter((result) => taskOwnsFile(task, result.name));
    const split = summarizeVitestResult({ ...native, testResults });
    fs.writeFileSync(task.nativeResultPath, `${JSON.stringify(split, null, 2)}\n`);
    statuses.set(task.surfaceId, split.success ? 0 : 1);
  }
  return statuses;
}

export function summarizeVitestResult(native) {
  const testResults = native.testResults ?? [];
  const assertions = testResults.flatMap((result) => result.assertionResults ?? []);
  return {
    ...native,
    testResults,
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: testResults.filter((result) => result.status === "passed").length,
    numFailedTestSuites: testResults.filter((result) => result.status === "failed").length,
    numTotalTests: assertions.length,
    numPassedTests: assertions.filter((assertion) => assertion.status === "passed").length,
    numFailedTests: assertions.filter((assertion) => assertion.status === "failed").length,
    numPendingTests: assertions.filter((assertion) => assertion.status === "pending" || assertion.status === "skipped" || assertion.status === "todo").length,
    success: testResults.every((result) => result.status !== "failed") && assertions.every((assertion) => assertion.status !== "failed"),
  };
}

export function taskOwnsFile(task, file, { repoRoot = process.cwd() } = {}) {
  const candidates = repoRelativeCandidates(file, task.cwd, repoRoot);
  return candidates.some((candidate) => {
    if ((task.excludeRoots ?? []).some((rootPath) => pathContains(rootPath, candidate))) return false;
    return (task.roots ?? []).some((rootPath) => pathContains(rootPath, candidate));
  });
}

function repoRelativeCandidates(file, cwd, repoRoot) {
  if (!file) return [];
  const normalized = path.normalize(file);
  const out = new Set();
  if (path.isAbsolute(normalized)) out.add(path.normalize(path.relative(repoRoot, normalized)));
  else {
    out.add(normalized);
    out.add(path.normalize(path.join(path.relative(repoRoot, cwd), normalized)));
    out.add(path.normalize(path.join(cwd, normalized)));
  }
  return [...out];
}

function pathContains(rootPath, file) {
  const normalizedRoot = path.normalize(rootPath);
  const normalizedFile = path.normalize(file);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}
