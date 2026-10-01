import { SandboxInstance } from "@blaxel/core";

export async function listBlaxelPoolSandboxes({ pool, arch, deployedOnly = false }) {
  const sandboxes = await Array.fromAsync(await SandboxInstance.list());
  return sandboxes.filter((sandbox) => {
    const labels = sandbox.metadata?.labels ?? {};
    return labels.project === "television"
      && labels.purpose === "testshards"
      && labels.pool === pool
      && labels.arch === arch
      && (!deployedOnly || sandbox.status === "DEPLOYED");
  }).sort((a, b) => String(a.metadata?.name).localeCompare(String(b.metadata?.name)));
}
