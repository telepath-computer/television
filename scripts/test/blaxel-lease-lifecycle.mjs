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
