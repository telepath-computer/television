import { afterAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";

afterAll(() => writeFileSync(path.join(process.env.RESOURCE_FIXTURE_ROOT!, "teardown.json"), JSON.stringify({ observedAt: new Date().toISOString() })));
test("retains a failed attempt before recovery", (context) => {
  expect(context.task.result?.retryCount ?? 0).toBeGreaterThan(0);
});
