import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("selected attempt", async ({}, info) => {
  if (process.env.TV_GUIDANCE_ATTEMPTS) appendFileSync(process.env.TV_GUIDANCE_ATTEMPTS, `${JSON.stringify({ title: "selected attempt", attempt: info.retry })}\n`);
  expect(info.retry).toBeGreaterThanOrEqual(Number(process.env.TV_GUIDANCE_FAIL_COUNT ?? "0"));
});
test("other title", async () => {});
// Live handoff probe: default retries recover; blanket zero deliberately fails.
test("deliberate first-attempt failure", async ({}, info) => {
  expect(info.retry).toBeGreaterThanOrEqual(1);
});
test.describe("annotated", () => {
  test.describe.configure({ retries: 1 });
  test("annotated retry", async ({}, info) => { expect(info.retry).toBeGreaterThanOrEqual(1); });
});
