import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { log } from "../../src/logger.ts";

const storagePath = process.env.TV_LOG_STORAGE_PATH;
const msg = process.env.TV_LOG_MESSAGE;
const writer = process.env.TV_LOG_WRITER;
const startFile = process.env.TV_LOG_START_FILE;

if (!storagePath || !msg || !writer) {
  throw new Error("TV_LOG_STORAGE_PATH, TV_LOG_MESSAGE, and TV_LOG_WRITER are required");
}

if (startFile) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(startFile)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${startFile}`);
    }
    await sleep(5);
  }
}

log(storagePath, msg, { writer });
