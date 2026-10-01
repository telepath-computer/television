import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const childScript = path.resolve(import.meta.dirname, "../late-spawn-child.mjs");

test("leaves a final-scan generation for the outer CLI supervisor", () => {
  const result = spawnSync(process.execPath, [childScript, "0"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
  });
  expect(result.status).toBe(0);
});
