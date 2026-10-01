import fs from "node:fs";
import { firefox } from "@playwright/test";

export function playwrightFirefoxExecutablePath() {
  return firefox.executablePath();
}

export function isPlaywrightFirefoxAvailable() {
  return fs.existsSync(playwrightFirefoxExecutablePath());
}
