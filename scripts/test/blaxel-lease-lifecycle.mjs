import fs from "node:fs";
import path from "node:path";

/** Coordinator-local lifecycle; transport operations are supplied at one seam. */
export function renewLease({ renew, intervalMs, onLost }) {
  let stopped = false;
  let pending = Promise.resolve();
  const tick = () => {
    if (stopped) return;
    pending = renew().catch((error) => { stopped = true; clearInterval(timer); onLost(error); });
    pending.finally(() => { if (!stopped) timer = setTimeout(tick, intervalMs); });
  };
  let timer = setTimeout(tick, intervalMs);
  return async () => { stopped = true; clearTimeout(timer); await pending; };
}

export async function finishLease({ settleWrites, teardown, download, release, assertOwned, attempts = 3 }) {
  await settleWrites();
  assertOwned();
  // Failed teardown still allows evidence retrieval, but can never release.
  let teardownError = null;
  try { await teardown(); } catch (error) { teardownError = error; }
  let retrievalError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    assertOwned();
    try { await download(); retrievalError = null; break; } catch (error) { retrievalError = error; }
  }
  if (teardownError) throw teardownError;
  if (retrievalError) throw retrievalError;
  assertOwned();
  await release();
}

export async function retainAttemptEvidence(lease, directory) {
  if (!lease.preparationRequested && !lease.executionRequested) { lease.retrieved = true; return; }
  const root = "/workspace/television/.testshards/results";
  const identity = JSON.parse(await lease.sandbox.fs.read(`${root}/attempt.json`));
  for (const key of ["lockId", "runId", "shardIndex", "attemptId"]) if (identity[key] !== lease.input[key]) throw new Error(`attempt evidence identity mismatch: ${key}`);
  let evidence;
  try { evidence = JSON.parse(await lease.sandbox.fs.read(`${root}/evidence.json`)); }
  catch (error) {
    if (lease.teardownConfirmed || error?.status !== 404) throw error;
    // Teardown uncertainty must not prevent retaining already-produced evidence.
    const files = [];
    const collect = async (directory) => {
      const listing = await lease.sandbox.fs.ls(directory);
      for (const file of listing.files ?? []) files.push(path.posix.relative(root, `${directory}/${file.name}`));
      for (const child of listing.subdirectories ?? []) await collect(`${directory}/${child.name}`);
    };
    await collect(root);
    evidence = { runId: lease.input.runId, attemptId: lease.input.attemptId, files };
  }
  if (evidence.runId !== lease.input.runId || evidence.attemptId !== lease.input.attemptId || !Array.isArray(evidence.files)) throw new Error("invalid retained-evidence inventory");
  for (const name of evidence.files) {
    // Optional diagnostic reads use their bounded, warning-only transport below.
    // They must not make a native result fail or bypass its retention budget.
    if (typeof name === "string" && name.startsWith("resources/")) continue;
    if (typeof name !== "string" || name.startsWith("/") || name.split("/").includes("..")) throw new Error("invalid evidence path");
    const raw = await lease.sandbox.fs.read(`${root}/${name}`);
    const target = path.join(directory, "artifacts", `shard-${lease.shardIndex}`, name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, raw);
  }
}

