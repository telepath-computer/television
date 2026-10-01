#!/usr/bin/env node
import process from "node:process";
import { processIdentityMatches, scanLinuxProcesses } from "./process-lifecycle.mjs";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_WORKFLOW !== "Process Lifecycle Fault Injection" || process.env.TV_TEST_ISOLATED_GITHUB !== "1") {
  throw new Error("isolated GitHub lifecycle cleanup is restricted to the dedicated GitHub workflow");
}
if (process.platform !== "linux") throw new Error("isolated GitHub lifecycle cleanup requires Linux procfs");

const owned = () => scanLinuxProcesses().filter((entry) => entry.ownerToken);
const initial = owned();
for (const entry of initial) signal(entry, "SIGTERM");
await wait(2_000);
for (const entry of initial) signal(entry, "SIGKILL");
await wait(250);
const remaining = owned();
if (remaining.length > 0) throw new Error(`owner-token cleanup retained: ${remaining.map((entry) => `${entry.pid}:${entry.ownerToken}`).join(", ")}`);
console.log(`isolated GitHub lifecycle cleanup complete; found=${initial.length}; remaining=0`);

function signal(expected, name) {
  const current = owned().find((entry) => processIdentityMatches(entry, expected) && entry.ownerToken === expected.ownerToken);
  if (!current) return;
  try { process.kill(current.pid, name); } catch (error) { if (error?.code !== "ESRCH") throw error; }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
