import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

test("must not start after the pre-command leaks", () => {
  const fixtureDir = process.env.TV_LIFECYCLE_FIXTURE_DIR;
  if (!fixtureDir) throw new Error("TV_LIFECYCLE_FIXTURE_DIR is required");
  writeFileSync(path.join(fixtureDir, "test-started"), "unexpected\n");
});
