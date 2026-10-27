import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guidanceCheckout } from "./guidance-checkout.ts";

interface MutexChild {
  child: ReturnType<typeof spawn>;
  ready: string;
  release: string;
  exited: Promise<number | null>;
  output(): string;
}

// Cooperative native work only: the test releases every child in finally.
export function mutexCheckout() {
  const f = guidanceCheckout();
  const file = `${f.testsRoot}/one.test.ts`;
  f.surface.kind = "unit";
  f.writeRegistry();
  f.write(file, `import fs from "node:fs";
import { test, expect } from "vitest";
test("cooperative mutex fixture", async () => {
  if (process.env.TV_MUTEX_READY) fs.writeFileSync(process.env.TV_MUTEX_READY, String(process.pid));
  const deadline = Date.now() + 60000;
  while (process.env.TV_MUTEX_RELEASE && !fs.existsSync(process.env.TV_MUTEX_RELEASE)) {
    if (Date.now() > deadline) throw new Error("fixture was not released");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  expect(process.env.TV_MUTEX_FAIL).not.toBe("1");
}, 65000);
`);
  const children: MutexChild[] = [];
  function start(args = ["local", "--file", file], extra: NodeJS.ProcessEnv = {}): MutexChild {
    const id = children.length;
    const ready = path.join(f.root, `ready-${id}`);
    const release = path.join(f.root, `release-${id}`);
    const child = spawn(process.execPath, ["scripts/test/cli.mjs", ...args], {
      cwd: f.root, env: { ...f.env, TV_MUTEX_READY: ready, TV_MUTEX_RELEASE: release, ...extra }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("exit", code => resolve(code));
      child.once("error", reject);
    });
    const entry = { child, ready, release, exited, output: () => output };
    children.push(entry);
    return entry;
  }
  async function cleanup() {
    for (const child of children) writeFileSync(child.release, "release");
    await Promise.all(children.map(child => child.exited));
    f.cleanup();
  }
  return { ...f, file, start, cleanup, args: ["local", "--file", file] };
}

export async function waitFor(check: () => boolean, diagnostic: () => string = () => "fixture did not become ready") {
  const deadline = Date.now() + 30_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(diagnostic());
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export async function ready(child: { ready: string; output(): string }) {
  await waitFor(() => existsSync(child.ready), child.output);
}
