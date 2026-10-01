#!/usr/bin/env node
import { chromium } from "@playwright/test";

try {
  const browser = await chromium.launch({ headless: true });
  await browser.close();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n").find((line) => line.trim().length > 0)?.trim();

  console.error("Playwright Chromium preflight failed.");
  if (firstLine) {
    console.error(`Reason: ${firstLine}`);
  }
  console.error("");
  console.error("Run setup before browser e2e:");
  console.error("  npx playwright install --with-deps chromium");
  console.error("");
  console.error("To inspect platform-specific dependency actions:");
  console.error("  npx playwright install --with-deps chromium --dry-run");
  process.exit(1);
}
