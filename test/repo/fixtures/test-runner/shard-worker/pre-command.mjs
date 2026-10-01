import fs from "node:fs";
import path from "node:path";
for (const file of [process.env.SHARD_SENTINEL, process.env.PREBUILT_PATH].filter(Boolean)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, file === process.env.PREBUILT_PATH ? "ready" : "ran");
}
