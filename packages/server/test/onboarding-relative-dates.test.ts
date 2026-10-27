import { expect, it } from "vitest";
// @ts-expect-error — the browser asset has no TypeScript declaration file.
import { localDayShift, shiftDate } from "../assets/onboarding-relative-dates.js";

// proofs/ui/onboarding-artifacts/index.md#^oa-ac-date-arithmetic
it("shifts authored dates by whole local calendar days", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "Australia/Sydney";
  try {
    const today = new Date("2026-10-02T08:00:00+10:00");
    expect(today.toISOString().startsWith("2026-10-01")).toBe(true);
    const days = localDayShift(today);
    expect(days).toBe(86);
    expect(shiftDate("2026-07-04", days)).toBe("2026-09-28");
    expect(shiftDate("2026-07-08", days)).toBe("2026-10-02");
    expect(shiftDate("2026-07-10", days)).toBe("2026-10-04");
    expect(shiftDate("2026-07-08T09:30", days)).toBe("2026-10-02T09:30");

    expect(localDayShift(new Date("2026-10-03T08:00:00+10:00"))).toBe(87);
    expect(localDayShift(new Date("2026-10-04T08:00:00+11:00"))).toBe(88);
    expect(shiftDate("2026-07-08T09:30", 88)).toBe("2026-10-04T09:30");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("2028-02-29", 1)).toBe("2028-03-01");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-07-08", -1)).toBe("2026-07-07");
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
