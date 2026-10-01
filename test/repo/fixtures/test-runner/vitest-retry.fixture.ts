import fs from "node:fs";
import { expect, test } from "vitest";

const sentinel = new URL("./vitest-retry.sentinel", import.meta.url);

test("fails once and recovers", async () => {
  await new Promise((resolve) => setTimeout(resolve, 12));
  if (!fs.existsSync(sentinel)) {
    fs.writeFileSync(sentinel, "seen");
    throw new Error("intentional first attempt");
  }
  await new Promise((resolve) => setTimeout(resolve, 6));
  expect(fs.readFileSync(sentinel, "utf8")).toBe("seen");
});
