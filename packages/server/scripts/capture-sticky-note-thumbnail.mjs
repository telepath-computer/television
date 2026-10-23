#!/usr/bin/env node
// Capture the WithText story at the declared 360×360 size, keeping its background transparent.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const [baseURL, executablePath] = process.argv.slice(2);
if (!baseURL) throw new Error("Pass the URL of an independently served Storybook build.");
const require = createRequire(import.meta.url);
const { PNG } = require("playwright-core/lib/utilsBundle");
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 1 });
  await page.goto(new URL("/iframe.html?id=spec-templates-sticky-note--with-text&viewMode=story", baseURL).href);
  await page.locator(".sticky-note-page").waitFor();
  await page.waitForFunction(() => document.querySelector(".sticky-note-text")?.value === "Buy milk\nCall the plumber\nBook Barcelona dinner");
  await page.evaluate(async () => {
    await document.fonts.load('500 24px "Sticky Note Caveat"');
    await document.fonts.ready;
  });
  await page.mouse.move(359, 359);
  const bytes = await page.screenshot({ omitBackground: true });
  const image = PNG.sync.read(bytes);
  if (image.width !== 360 || image.height !== 360) throw new Error(`Unexpected PNG size ${image.width}×${image.height}`);
  const destination = new URL("../assets/templates/sticky-note/thumbnail.png", import.meta.url);
  writeFileSync(destination, bytes);
  console.log(`Captured ${image.width}×${image.height} PNG at ${fileURLToPath(destination)}`);
} finally {
  await browser.close();
}
