import { expect, test } from "vitest";
import { spawnLeakedListener } from "../fixture-helpers.ts";

test("keeps the runner active until its supervisor is interrupted", async () => {
  const listener = await spawnLeakedListener({ ignoreTerm: true });
  expect(listener.ownerToken).toBe(process.env.TV_TEST_SURFACE_OWNER);
  await new Promise(() => {});
});
