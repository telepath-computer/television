import { ulid } from "ulid";
import { describe, expect, it } from "vitest";
import {
  isResourceID,
  validateResourceDescription,
  validateResourceUsage,
} from "@telepath-computer/television-shared/resources";
import { refusalCode } from "./helpers.ts";

// spec: proofs/arch/resources/index.md#^rs-arch-t-validation
describe("resource descriptions", () => {
  it("accepts a description of exactly 1,024 UTF-8 bytes including multibyte characters", () => {
    const multibyte = `${"€".repeat(341)}a`;
    expect(new TextEncoder().encode(multibyte).length).toBe(1024);
    expect(refusalCode(() => validateResourceDescription(multibyte))).toBeUndefined();
    expect(refusalCode(() => validateResourceDescription("é".repeat(512)))).toBeUndefined();
  });

  it("refuses an empty description, one of 1,025 bytes, and one with a line feed or carriage return, with invalid-description", () => {
    expect(refusalCode(() => validateResourceDescription(""))).toBe("invalid-description");
    expect(refusalCode(() => validateResourceDescription(`${"é".repeat(512)}a`))).toBe("invalid-description");
    expect(refusalCode(() => validateResourceDescription("first line\nsecond line"))).toBe("invalid-description");
    expect(refusalCode(() => validateResourceDescription("first line\rsecond line"))).toBe("invalid-description");
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-validation
describe("resource usages", () => {
  it("accepts an empty usage and one of exactly 16,384 UTF-8 bytes with line feeds, carriage returns and multibyte characters", () => {
    const lines = "Content: {\"tasks\": {}}.\r\nAdd a task with push.\n";
    const usage = `${lines}${"€".repeat(5_445)}aa`;
    expect(new TextEncoder().encode(usage).length).toBe(16_384);
    expect(refusalCode(() => validateResourceUsage(""))).toBeUndefined();
    expect(refusalCode(() => validateResourceUsage(usage))).toBeUndefined();
  });

  it("refuses a usage of 16,385 bytes with invalid-usage", () => {
    expect(refusalCode(() => validateResourceUsage(`${"é".repeat(8_192)}a`))).toBe("invalid-usage");
  });
});

// spec: proofs/arch/resources/index.md#^rs-arch-t-validation
describe("resource IDs", () => {
  it("accepts a generated resource ID and nothing of another form", () => {
    expect(isResourceID(ulid())).toBe(true);
    for (const value of [
      "",
      "01ARZ3NDEKTSV4RRFFQ69G5FA",
      "01ARZ3NDEKTSV4RRFFQ69G5FAVX",
      "01ARZ3NDEKTSV4RRFFQ69G5FAU",
      "..",
      "01ARZ3NDEKTSV4RRFFQ69/5FAV",
      "01ARZ3NDEKTSV4RRFFQ69\\5FAV",
    ]) {
      expect(isResourceID(value), value).toBe(false);
    }
  });
});
