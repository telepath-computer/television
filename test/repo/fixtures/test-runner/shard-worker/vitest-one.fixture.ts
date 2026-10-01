import fs from "node:fs";
import { expect, test } from "vitest";

test("runs first assigned workspace file", () => {
  if (process.env.REQUIRE_PREBUILT === "1") expect(fs.readFileSync(process.env.PREBUILT_PATH!, "utf8")).toBe("ready");
  if (process.env.RUNNER_CHILD_ENV_OUTPUT) {
    expect(process.env.TV_TEST_RUNNER_SELFTEST).toBe("1");
    fs.writeFileSync(process.env.RUNNER_CHILD_ENV_OUTPUT, JSON.stringify({
      hasForceColor: Object.hasOwn(process.env, "FORCE_COLOR"),
      hasNoColor: Object.hasOwn(process.env, "NO_COLOR"),
    }));
  }
  expect(1 + 1).toBe(2);
});
