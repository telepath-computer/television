#!/usr/bin/env node
import {
  isPlaywrightWebKitAvailable,
  playwrightWebKitExecutablePath,
} from "./playwright-webkit-availability.mjs";

if (!isPlaywrightWebKitAvailable()) {
  console.log(
    `SKIP: Playwright WebKit executable does not exist at ${playwrightWebKitExecutablePath()}`,
  );
}
