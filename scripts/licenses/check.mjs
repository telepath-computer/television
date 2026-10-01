import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateLicenseGate,
  formatLicenseGateErrors,
} from "./lib/gate.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "../..");

export function runLicenseCheck({ root = repositoryRoot } = {}) {
  const result = evaluateLicenseGate({ root });
  for (const surface of result.surfaces) console.log(`checked license surface: ${surface}`);
  if (!result.ok) {
    console.error(formatLicenseGateErrors(result.errors));
    return 1;
  }
  console.log(`license gate passed for ${result.surfaces.length} surfaces`);
  return 0;
}

function parseArguments(argv) {
  let root = repositoryRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--root") throw new Error(`Unknown argument ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("--root requires a path");
    root = path.resolve(value);
    index += 1;
  }
  return { root };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runLicenseCheck(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
