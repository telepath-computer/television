import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const readyFile = process.env.TV_LIFECYCLE_READY_FILE;
if (!readyFile) throw new Error("TV_LIFECYCLE_READY_FILE is required");
const child = spawn(process.execPath, [path.resolve(import.meta.dirname, "../listener-child.mjs")], {
  detached: true,
  stdio: "ignore",
  env: process.env,
});
child.unref();
const deadline = Date.now() + 5_000;
while (!existsSync(readyFile)) {
  if (Date.now() >= deadline) throw new Error(`pre-command listener PID ${child.pid} did not publish`);
  await new Promise((resolve) => setTimeout(resolve, 10));
}
