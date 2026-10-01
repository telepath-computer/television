// Investigation-only instrumentation; execute exclusively on Blaxel.
import fs from "node:fs";
import type { BrowserContext, Request } from "@playwright/test";

function read(file: string): string {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return "unavailable"; }
}

export function resources(detailed = false) {
  const processes = [];
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    const command = read(`/proc/${pid}/cmdline`).replaceAll("\0", " ");
    if (!/chrome|chromium|node|vite|electron/.test(command)) continue;
    try {
      const status = read(`/proc/${pid}/status`);
      const descriptors = fs.readdirSync(`/proc/${pid}/fd`);
      const descriptorKinds: Record<string, number> = {};
      const sharedMemorySizes: Record<string, number> = {};
      let sharedMemoryAllocated = 0;
      if (detailed) for (const fd of descriptors) {
        let target: string;
        try { target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
        const kind = target.startsWith("socket:") ? "socket"
          : target.startsWith("pipe:") ? "pipe"
          : /memfd|shm|\.org\.chromium/.test(target) ? "shared-memory"
          : target.startsWith("anon_inode:") ? target : "file";
        descriptorKinds[kind] = (descriptorKinds[kind] ?? 0) + 1;
        if (kind === "shared-memory") {
          try {
            const stat = fs.statSync(`/proc/${pid}/fd/${fd}`);
            sharedMemorySizes[stat.size] = (sharedMemorySizes[stat.size] ?? 0) + 1;
            sharedMemoryAllocated += stat.blocks * 512;
          } catch { /* Descriptor closed during inspection. */ }
        }
      }
      processes.push({
        pid: Number(pid),
        command: command.slice(0, 350),
        status: status.split("\n").filter((line) => /^(Name|PPid|VmRSS|VmSize|Threads|FDSize):/.test(line)),
        fdCount: descriptors.length,
        limits: read(`/proc/${pid}/limits`).split("\n").filter((line) => /open files|processes|address space/.test(line)),
        ...(detailed ? { descriptorKinds, sharedMemorySizes, sharedMemoryAllocated } : {}),
      });
    } catch { /* Process exited during inspection. */ }
  }
  return {
    at: new Date().toISOString(),
    processes,
    memory: read("/proc/meminfo").split("\n").filter((line) => /^(MemAvailable|MemFree|MemTotal|Shmem|SwapFree):/.test(line)),
    fileNr: read("/proc/sys/fs/file-nr"),
    oomKills: read("/proc/vmstat").split("\n").find((line) => line.startsWith("oom_kill ")),
    filesystems: Object.fromEntries(["/tmp", "/dev/shm"].map((directory) => {
      const stat = fs.statfsSync(directory);
      return [directory, { total: stat.bsize * stat.blocks, available: stat.bsize * stat.bavail }];
    })),
    cgroup: Object.fromEntries(["memory.current", "memory.max", "memory.events", "pids.current", "pids.max", "cpu.stat"].map((file) => [file, read(`/sys/fs/cgroup/${file}`)])),
  };
}

export function observeResources(context: BrowserContext, label: string) {
  const pending = new Set<Request>();
  let maximumPending = 0;
  let failures = 0;
  let maximumFD = 0;
  let peak = resources();
  let minimumDiskAvailable = Number.MAX_SAFE_INTEGER;
  let minimumMemoryAvailableKB = Number.MAX_SAFE_INTEGER;
  let lowestResources = peak;
  const emit = (kind: string, data: unknown) => console.log(`ROSE_RESOURCE ${JSON.stringify({ kind, label, data })}`);
  emit("start", resources(true));
  const onRequest = (request: Request) => { pending.add(request); maximumPending = Math.max(maximumPending, pending.size); };
  const onFinished = (request: Request) => { pending.delete(request); };
  const onFailed = (request: Request) => {
    if (request.failure()?.errorText.includes("INSUFFICIENT_RESOURCES")) {
      failures += 1;
      emit("request-failed", { url: request.url(), pending: pending.size, maximumPending });
      if (failures === 1) emit("failure-resources", resources(true));
    }
    pending.delete(request);
  };
  context.on("request", onRequest);
  context.on("requestfinished", onFinished);
  context.on("requestfailed", onFailed);
  const interval = setInterval(() => {
    const sample = resources();
    const count = Math.max(0, ...sample.processes.map((process) => process.fdCount));
    if (count > maximumFD) { maximumFD = count; peak = sample; }
    const available = sample.filesystems["/tmp"]!.available;
    if (available < minimumDiskAvailable) { minimumDiskAvailable = available; lowestResources = sample; }
    const memoryAvailable = Number(sample.memory.find((line) => line.startsWith("MemAvailable:"))?.match(/\d+/)?.[0]);
    minimumMemoryAvailableKB = Math.min(minimumMemoryAvailableKB, memoryAvailable);
  }, 250);
  return () => {
    clearInterval(interval);
    context.off("request", onRequest);
    context.off("requestfinished", onFinished);
    context.off("requestfailed", onFailed);
    emit("peak", { maximumFD, maximumPending, failures, sample: peak });
    emit("lowest-resources", { minimumDiskAvailable, minimumMemoryAvailableKB, sample: lowestResources });
    emit("end", resources(true));
  };
}
