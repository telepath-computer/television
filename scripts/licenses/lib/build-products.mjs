import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Run both publishable product builds against the repository inventory root. */
export function buildProducts(options = {}) {
  const resolvedRoot = path.resolve(options.root ?? repositoryRoot);
  run("npm", ["run", "build"], { cwd: resolvedRoot });
  run("npm", ["run", "build:desktop"], { cwd: resolvedRoot });
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status ?? "signal"})`);
  }
}
