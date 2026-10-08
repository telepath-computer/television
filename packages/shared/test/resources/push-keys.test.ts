import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePushKey } from "@telepath-computer/television-shared/resources";

const ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

function decodeTime(key: string): number {
  let time = 0;
  for (const character of key.slice(0, 8)) time = time * 64 + ALPHABET.indexOf(character);
  return time;
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-push-keys
describe("push keys", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("are 20 characters from the alphabet, whose ASCII order is its sort order", () => {
    expect([...ALPHABET].sort().join("")).toBe(ALPHABET);
    vi.setSystemTime(1_700_000_000_000);
    const key = generatePushKey();
    expect(key).toHaveLength(20);
    expect([...key].every((character) => ALPHABET.includes(character))).toBe(true);
  });

  it("encode the clock in their first 8 characters and sort in the order of increasing times", () => {
    const times = [1_700_000_000_000, 1_700_000_000_001, 1_700_000_064_000, 1_800_000_000_000, 2_000_000_000_000];
    const keys = times.map((time) => {
      vi.setSystemTime(time);
      return generatePushKey();
    });
    expect(keys.map(decodeTime)).toEqual(times);
    expect([...keys].sort()).toEqual(keys);
  });

  it("generated within one millisecond are distinct and sort in generation order", () => {
    vi.setSystemTime(2_100_000_000_000);
    const keys = Array.from({ length: 2_000 }, () => generatePushKey());
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys.map((key) => key.slice(0, 8))).size).toBe(1);
  });
});
