#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getElectronE2EInvocation,
  getElectronE2EPlan,
  prepareElectronE2EEnv,
  printElectronE2EFailures,
} from "./electron-e2e-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.SKIP_ELECTRON_E2E === "1") {
  console.log("Skipping electron e2e (SKIP_ELECTRON_E2E=1)");
  process.exit(0);
}

const plan = getElectronE2EPlan();
if (plan.failures.length > 0) {
  printElectronE2EFailures(plan);
  process.exit(1);
}

const env = prepareElectronE2EEnv(process.env, plan);

const { command, args } = getElectronE2EInvocation(plan, process.argv.slice(2));

for (const note of plan.notes) {
  console.error(note);
}

const child = spawn(command, args, {
  stdio: "inherit",
  env,
  cwd: repoRoot,
});

child.on("exit", (status, signal) => {
  if (status !== null) {
    process.exit(status);
  }
  console.error(`Electron e2e terminated by signal ${signal}`);
  process.exit(1);
});

child.on("error", (error) => {
  console.error(`Failed to launch Electron e2e: ${error.message}`);
  process.exit(1);
});
