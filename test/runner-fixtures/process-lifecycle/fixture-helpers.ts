import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export async function spawnLeakedListener({ ignoreTerm = false } = {}): Promise<{ pid: number; url: string; ownerToken: string }> {
  const readyFile = process.env.TV_LIFECYCLE_READY_FILE;
  if (!readyFile) throw new Error("TV_LIFECYCLE_READY_FILE is required");
  const childScript = path.resolve(import.meta.dirname, "listener-child.mjs");
  const child = spawn(process.execPath, [childScript, ...(ignoreTerm ? ["--ignore-term"] : [])], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  const deadline = Date.now() + 5_000;
  while (!existsSync(readyFile)) {
    if (Date.now() >= deadline) throw new Error(`listener PID ${child.pid} did not publish ${readyFile}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return JSON.parse(readFileSync(readyFile, "utf8"));
}
