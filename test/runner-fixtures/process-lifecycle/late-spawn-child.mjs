import { spawn } from "node:child_process";
import process from "node:process";

const generation = Number.parseInt(process.argv[2] ?? "0", 10);
const script = new URL(import.meta.url).pathname;

function spawnNext() {
  const child = spawn(process.execPath, [script, String(generation + 1)], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
}

if (generation === 0) {
  spawnNext();
  process.exit(0);
}

if (generation <= 3) {
  let spawned = false;
  process.on("SIGTERM", () => {
    if (spawned) return;
    spawned = true;
    spawnNext();
  });
} else {
  process.on("SIGTERM", () => {});
}

setInterval(() => {}, 1_000);
