#!/usr/bin/env node
import { SandboxInstance } from "@blaxel/core";

try {
  await SandboxInstance.list();
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
