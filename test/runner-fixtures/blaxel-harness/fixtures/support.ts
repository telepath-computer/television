import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnOwnedProcess } from "../../../helpers/owned-process.ts";

export const results = "/workspace/television/.testshards/results";
export function mode() {
  const file = "/tmp/rose-blaxel-harness-mode.json";
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).mode : "normal";
}
export function evidence(name: string, value: unknown) {
  mkdirSync(results, { recursive: true });
  writeFileSync(path.join(results, name), JSON.stringify(value));
}
export async function activeFixture() {
  if (mode() !== "active") return;
  const child = spawnOwnedProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),180000);setInterval(()=>{},1000)"], { stdio: "ignore" });
  evidence("active-fixture.json", { pid: child.pid, supervisor: process.pid, token: process.env.TV_TEST_SHARD_OWNER });
  try { await new Promise(resolve => setTimeout(resolve, 180_000)); }
  finally { await child.dispose(); }
}
