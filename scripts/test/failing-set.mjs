#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

try {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) throw new Error("Usage: node scripts/test/failing-set.mjs <run-directory-or-summary.json>");

  const resolvedInput = path.resolve(input);
  const summaryPath = path.basename(resolvedInput) === "summary.json" ? resolvedInput : path.join(resolvedInput, "summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  if (!Array.isArray(summary.failedTests)) throw new Error(`${summaryPath} has no failedTests array`);

  const lines = summary.failedTests.map((test, index) => {
    const fields = [test.surfaceId, test.file, test.title];
    if (fields.some((field) => typeof field !== "string" || field.length === 0)) {
      throw new Error(`${summaryPath} failedTests[${index}] has an invalid surfaceId, file, or title`);
    }
    if (fields.some((field) => /[\t\r\n]/u.test(field))) {
      throw new Error(`${summaryPath} failedTests[${index}] cannot be represented as one tab-separated line`);
    }
    return fields.join("\t");
  });

  if (new Set(lines).size !== lines.length) throw new Error(`${summaryPath} has duplicate surface, file, and title identities`);
  lines.sort();
  process.stdout.write(lines.length ? `${lines.join("\n")}\n` : "");
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
