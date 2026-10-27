import { expect, test } from "vitest";
import { activeFixture, mode } from "./support.ts";

test("bounded active owned process", activeFixture);
let attempt = 0;
test("recovers a deliberate first attempt", () => { if (mode() === "normal") expect(++attempt).toBeGreaterThan(1); });
test("retains a deliberate native failure", () => { if (mode() === "normal") expect("fixture failure").toBe("fixture success"); });
