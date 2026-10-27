/** The manager's SDK seam; fresh/unavailable states retain pool identity. */
export async function publishWorker(sandbox, { provision, verify, update }) {
  await sandbox.wait();
  await provision(sandbox);
  await verify(sandbox);
  return update(sandbox.metadata.name, { labels: { ...sandbox.metadata.labels, purpose: "testshards" } });
}

export async function deleteWorker(sandbox, { reserve, update, remove }) {
  // A fresh sandbox was never eligible, so no coordinator can own its checkout.
  if (sandbox.metadata.labels.purpose !== "testshards-provisioning") {
    await reserve(sandbox);
    await update(sandbox.metadata.name, { labels: { ...sandbox.metadata.labels, purpose: "testshards-unavailable" } });
  }
  // Keep the never-published state if deletion fails: provisioning may have
  // failed before installing the runtime needed by the ownership check.
  await remove(sandbox.metadata.name);
}
