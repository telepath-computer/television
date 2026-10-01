import { expect, test } from "vitest";
import { spawnLeakedListener } from "../fixture-helpers.ts";

let attempt = 0;
test("recovers natively and then leaves a listener", async () => {
  attempt += 1;
  if (attempt === 1) throw new Error("intentional first-attempt failure");
  const listener = await spawnLeakedListener();
  expect(listener.ownerToken).toBe(process.env.TV_TEST_SURFACE_OWNER);
});
