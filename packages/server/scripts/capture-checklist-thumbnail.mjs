#!/usr/bin/env node
// Capture the specified WithItems pose at its starting CSS size, scaled to 400×500 pixels.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const [baseURL = "http://127.0.0.1:6007", executablePath = "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"] = process.argv.slice(2);
const folder = new URL("../assets/templates/checklist/", import.meta.url);
const require = createRequire(import.meta.url);
const { PNG } = require("playwright-core/lib/utilsBundle");
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 0.625 });
  await page.goto(new URL("/iframe.html?id=spec-templates-checklist--with-items&viewMode=story", baseURL).href);
  await page.locator(".checklist-page").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".checklist-item").length === 6);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(639, 799);
  const bytes = await page.screenshot({ scale: "device" });
  const image = PNG.sync.read(bytes);
  if (image.width !== 400 || image.height !== 500) throw new Error(`Unexpected PNG size ${image.width}×${image.height}`);
  mkdirSync(folder, { recursive: true });
  const destination = new URL("thumbnail.png", folder);
  writeFileSync(destination, bytes);
  console.log(`Captured ${image.width}×${image.height} PNG at ${fileURLToPath(destination)}`);
} finally {
  await browser.close();
}
