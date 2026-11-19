import { appendFileSync } from "node:fs";
import { expect, test } from "vitest";

test("selected attempt", (context) => {
  const attempt = context.task.result?.retryCount ?? 0;
  if (process.env.TV_GUIDANCE_ATTEMPTS) appendFileSync(process.env.TV_GUIDANCE_ATTEMPTS, `${JSON.stringify({ title: "selected attempt", attempt })}\n`);
  expect(attempt).toBeGreaterThanOrEqual(Number(process.env.TV_GUIDANCE_FAIL_COUNT ?? "0"));
});
test("other title", () => {});
// Live handoff probe: default retries recover; blanket zero deliberately fails.
test("deliberate first-attempt failure", (context) => {
  expect(context.task.result?.retryCount ?? 0).toBeGreaterThanOrEqual(1);
});
test("annotated retry", { retry: 1 }, (context) => {
  expect(context.task.result?.retryCount ?? 0).toBeGreaterThanOrEqual(1);
});
