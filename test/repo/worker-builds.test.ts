import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { WorkerBuilds } from "../helpers/worker-builds.ts";

const roots: string[] = [];
function rendezvous<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(): { root: string; builds: WorkerBuilds } {
  const root = mkdtempSync(path.join(os.tmpdir(), "worker-build-contract-"));
  roots.push(root);
  return { root, builds: new WorkerBuilds("output-", root) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// proofs/arch/testing-policy.md#^testing-t-build-lifetime
test("concurrent and completed requests reuse a build while version keys remain distinct", async () => {
  const { root, builds } = fixture();
  const ready = rendezvous<void>();
  let calls = 0;
  const first = builds.get("v1", async (directory) => {
    calls += 1;
    writeFileSync(path.join(directory, "entry.js"), "version one");
    await ready.promise;
  });
  const concurrent = builds.get("v1", () => { throw new Error("prepared twice"); });
  expect(concurrent).toBe(first);
  ready.resolve();
  const directory = await first;
  expect(await builds.get("v1", () => { throw new Error("prepared again"); })).toBe(directory);
  const second = await builds.get("v2", (output) => { writeFileSync(path.join(output, "entry.js"), "version two"); });
  expect(second).not.toBe(directory);
  expect(calls).toBe(1);
  expect(existsSync(path.join(directory, "entry.js"))).toBe(true);
  await builds.dispose();
  expect(readdirSync(root)).toEqual([]);
});

test("failed preparation removes partial output and permits a fresh build", async () => {
  const { root, builds } = fixture();
  let failedDirectory = "";
  await expect(builds.get("source", (directory) => {
    failedDirectory = directory;
    writeFileSync(path.join(directory, "partial.js"), "incomplete");
    throw new Error("asset preparation failed");
  })).rejects.toThrow("asset preparation failed");
  expect(readdirSync(root)).toEqual([]);
  const directory = await builds.get("source", (output) => { writeFileSync(path.join(output, "entry.js"), "complete"); });
  expect(directory).not.toBe(failedDirectory);
  expect(existsSync(path.join(directory, "entry.js"))).toBe(true);
  await builds.dispose();
});

test.each([false, true])("teardown waits for pending preparation, including rejection (%s)", async (reject) => {
  const { root, builds } = fixture();
  const started = rendezvous<string>();
  const ready = rendezvous<void>();
  const build = builds.get("pending", async (directory) => {
    writeFileSync(path.join(directory, "partial.js"), "pending");
    started.resolve(directory);
    await ready.promise;
    if (reject) throw new Error("late preparation failure");
  });
  const settled = Promise.allSettled([build]);
  const directory = await started.promise;
  let disposed = false;
  const cleanup = builds.dispose().then(() => { disposed = true; });
  await Promise.resolve();
  expect(disposed).toBe(false);
  expect(existsSync(directory)).toBe(true);
  ready.resolve();
  expect((await settled)[0]!.status).toBe(reject ? "rejected" : "fulfilled");
  await cleanup;
  expect(readdirSync(root)).toEqual([]);
});
