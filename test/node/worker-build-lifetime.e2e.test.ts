import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { spawnOwnedProcess } from "../helpers/owned-process.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
type Observation = { caseNumber: number; pid: number; source: string; webBundle: string };

// proofs/arch/testing-policy.md#^testing-t-build-worker-seam
test.each(["playwright", "vitest"] as const)("%s workers reuse builds and remove them at teardown", async (runner) => {
  let previous: Observation | undefined;
  for (let worker = 0; worker < 2; worker += 1) {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "television-worker-build-seam-"));
    const record = path.join(temporaryRoot, "observations.jsonl");
    // Nested fixtures belong to this acceptance, not independently runnable surfaces.
    // Their native configs are temporary, as in the runner-reporting acceptance.
    const config = path.join(temporaryRoot, `${runner}.config.mjs`);
    writeFileSync(config, `export default ${JSON.stringify(runner === "playwright" ? {
      testDir: path.join(root, "test/fixtures/worker-builds"),
      testMatch: "playwright.fixture.ts", workers: 1, fullyParallel: false,
      retries: 0, timeout: 90_000, reporter: "line", outputDir: path.join(temporaryRoot, "results"),
    } : { test: {
      include: ["test/fixtures/worker-builds/vitest.fixture.ts"], maxWorkers: 1,
      fileParallelism: false, retry: 0, testTimeout: 90_000,
    } })};\n`);
    const cli = runner === "playwright"
      ? require.resolve("@playwright/test/cli")
      : path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const owned = spawnOwnedProcess(process.execPath, [
      cli, runner === "playwright" ? "test" : "run",
      "--config", config,
    ], {
      cwd: root,
      env: { ...process.env, TMPDIR: temporaryRoot, TV_WORKER_BUILD_RECORD: record },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    owned.child.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    owned.child.stderr!.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        owned.child.once("error", reject);
        owned.child.once("close", resolve);
      });
      expect(exitCode, output).toBe(0);
      const observations = readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Observation);
      expect(observations).toHaveLength(2);
      const [first, second] = observations as [Observation, Observation];
      expect(first.caseNumber).toBe(1);
      expect(second).toEqual({ ...first, caseNumber: 2 });
      if (previous) {
        expect(first.source).not.toBe(previous.source);
        expect(first.webBundle).not.toBe(previous.webBundle);
      }
      previous = first;

      const remaining = readdirSync(temporaryRoot).filter((name) =>
        name.startsWith("television-source-cli-e2e-") ||
        name.startsWith("television-web-bundle-") ||
        name.startsWith("television-product-e2e-")
      );
      expect(remaining, `${runner} left worker builds or failed-launch copies after teardown`).toEqual([]);
    } finally {
      const cleanup = await owned.dispose();
      expect(cleanup.outcome, output).not.toBe("survived");
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
});
