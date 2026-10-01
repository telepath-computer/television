#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Inspect the exact artifact without starting the CLI or sending telemetry.
process.env.VITEST = "true";
const require = createRequire(import.meta.url);
const bundlePath = path.resolve(process.argv[2] ?? "packages/cli/dist/cli.cjs");
const { inspectTelemetryBuildConfig } = require(bundlePath);
assert.equal(inspectTelemetryBuildConfig({}).telemetryBuild, "production", "Publication requires an npm-release telemetry build");
console.log("Release telemetry configuration verified.");
