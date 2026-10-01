#!/usr/bin/env node
import {
  isPlaywrightFirefoxAvailable,
  playwrightFirefoxExecutablePath,
} from "./playwright-firefox-availability.mjs";

if (!isPlaywrightFirefoxAvailable()) {
  console.log(
    `SKIP: Playwright Firefox executable does not exist at ${playwrightFirefoxExecutablePath()}`,
  );
}
