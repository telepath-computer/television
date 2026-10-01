import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The CLI tests spawn the built bin (dist/cli.js), so build it once per run.
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default function buildDist(): void {
  execFileSync("npm", ["run", "build"], { cwd: packageDir, stdio: "pipe" });
}
