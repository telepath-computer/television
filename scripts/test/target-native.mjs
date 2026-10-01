import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { exactPlaywrightFiles, writeVitestRunnerConfig } from "./execution-groups.mjs";

// Runs inside the targeted worker's existing supervised process/service scope.
const target = JSON.parse(process.argv[2]);
if (!["vitest", "playwright"].includes(target.runner)) throw new Error("target runner must be vitest or playwright");
if (target.command && target.runner !== "playwright") throw new Error("target commands currently support Playwright surfaces only");
const native = path.resolve(process.env.TV_TARGET_NATIVE_RESULT);
const cwd = path.resolve(target.cwd);
const env = { ...process.env, FLAKY_TEST_RETRIES: process.env.FLAKY_TEST_RETRIES ?? "5" };
let command;
if (target.runner === "vitest") {
  const configPath = `${native}.runner.mjs`;
  env.TV_VITEST_ATTEMPT_FILE = `${native}.attempts.ndjson`;
  fs.rmSync(env.TV_VITEST_ATTEMPT_FILE, { force: true });
  writeVitestRunnerConfig({ configPath, baseConfigPath: path.resolve(cwd, target.config), runnerPath: "scripts/test/vitest-attempt-reporter.mjs", files: target.files });
  command = ["npx", "vitest", "run", "--config", configPath, ...(target.files ? [] : target.file ? [target.file] : []), ...(target.grep ? ["-t", target.grep] : []), `--retry=${target.retries}`, "--reporter=json", "--outputFile", native];
} else {
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = native;
  command = [...(target.command ?? ["npx", "playwright", "test", "--config", target.config]), ...(target.files ? exactPlaywrightFiles(target.files) : target.file ? [target.file] : []), ...(target.grep ? ["-g", target.grep] : []), `--retries=${target.retries}`, "--reporter=json"];
}
const result = spawnSync(command[0], command.slice(1), { cwd, env, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
