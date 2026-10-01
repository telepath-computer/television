#!/usr/bin/env node
import { getElectronE2EPlan, printElectronE2EFailures } from "./electron-e2e-env.mjs";

const plan = getElectronE2EPlan();
if (plan.failures.length > 0) {
  printElectronE2EFailures(plan);
  process.exit(1);
}
