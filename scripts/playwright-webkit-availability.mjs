import fs from "node:fs";
import { webkit } from "@playwright/test";

/** Returns the executable path chosen by the installed Playwright package. */
export function playwrightWebKitExecutablePath() {
  return webkit.executablePath();
}

/** Whether the installed Playwright WebKit executable is present on this host. */
export function isPlaywrightWebKitAvailable() {
  return fs.existsSync(playwrightWebKitExecutablePath());
}
