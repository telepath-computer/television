#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { reapStaleOwnerProcesses } from "./stale-owner-reaper.mjs";

const options = parseArgs(process.argv.slice(2));
const result = await reapStaleOwnerProcesses();
if (options.output) {
  const output = path.resolve(options.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result));
process.exit(!result.cleanupConfirmed ? 2 : result.staleDetected ? 1 : 0);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output" && args[index + 1]) parsed.output = args[++index];
    else throw new Error(`Unknown stale-owner reaper argument ${args[index]}`);
  }
  return parsed;
}
