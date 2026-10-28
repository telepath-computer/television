#!/usr/bin/env node
/** Launches the installed Playwright WebKit once, then closes it. */

import { webkit } from "@playwright/test";

const browser = await webkit.launch();
await browser.close();
