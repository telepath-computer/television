#!/usr/bin/env node
// Vibe-mode check (specs/arch/test-runner/test-runner.md#^verify-vibe-mode).
// A branch in vibe mode carries specs/vibe-waiver.md and is never merged into
// main. Verify runs this as its last phase and CI's required join depends on
// it, so both report failure on a vibe branch while every other phase and job
// still reports its own result.
import { existsSync } from "node:fs";
import path from "node:path";

if (existsSync(path.join(process.cwd(), "specs", "vibe-waiver.md"))) {
  console.error("Vibe mode is active: specs/vibe-waiver.md is present. This check fails because a vibe branch is never merged into main. It is not a test failure; the other phases and jobs report their own results.");
  process.exitCode = 1;
} else {
  console.log("Not in vibe mode: no specs/vibe-waiver.md.");
}
