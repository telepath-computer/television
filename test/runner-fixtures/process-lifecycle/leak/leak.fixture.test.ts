import { expect, test } from "vitest";
import { spawnLeakedListener } from "../fixture-helpers.ts";

test("leaves an ordinary listener for the outer supervisor", async () => {
  const listener = await spawnLeakedListener();
  expect(listener.ownerToken).toBe(process.env.TV_TEST_SURFACE_OWNER);
});
