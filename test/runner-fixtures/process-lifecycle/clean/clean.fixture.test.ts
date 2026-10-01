import { expect, test } from "vitest";

test("exits without a process leak", () => {
  expect(process.env.TV_TEST_SURFACE_OWNER).toMatch(/^tv1\./);
});
