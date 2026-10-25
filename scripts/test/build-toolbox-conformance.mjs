import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

for (const args of [
  ["run", "build:web-and-artifact-documents"],
  ["--workspace", "@telepath-computer/storybook", "run", "build"],
]) {
  const result = spawnSync("npm", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed (exit ${result.status ?? "signal"})`);
}
