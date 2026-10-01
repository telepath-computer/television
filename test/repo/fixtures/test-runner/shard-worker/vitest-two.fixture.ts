import { expect, test } from "vitest";

let attempts = 0;
test("runs second assigned workspace file", { retry: 1 }, () => {
  if (process.env.TV_SHARD_RETRY_FIXTURE === "1") expect(attempts++).toBeGreaterThan(0);
  expect("two").toHaveLength(3);
});
