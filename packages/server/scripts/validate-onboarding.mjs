#!/usr/bin/env node
// Full build-time validation of an onboarding content tree
// (specs/arch/onboarding/content.md#^build-validation). Exits non-zero on any
// validation failure so the build fails when the shipped bundle is broken.
//
// Usage: node scripts/validate-onboarding.mjs [content-tree-root]
// Defaults to this package's assets/onboarding-channels/.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateOnboardingContentTree } from "../src/onboarding-content.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "..", "assets", "onboarding-channels");

const result = validateOnboardingContentTree(contentRoot);
if (!result.valid) {
  console.error(`onboarding content tree is invalid: ${contentRoot}`);
  for (const error of result.errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}
console.log(`onboarding content tree is valid: ${contentRoot}`);
