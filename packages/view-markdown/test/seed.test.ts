import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.resolve(testDir, "../fixtures/seed.md");

/**
 * Lock the canonical seed fixture so future iterations can rely on it
 * without re-deriving "what coverage do we have." Each iteration's
 * decoration tests will look up specific patterns inside this document;
 * dropping any pattern silently from the seed would weaken downstream
 * coverage. This test fails loudly instead.
 */
describe("seed.md fixture", () => {
  const seed = readFileSync(seedPath, "utf-8");

  it("exercises every ATX heading level h1–h6", () => {
    expect(seed).toMatch(/^# /m);
    expect(seed).toMatch(/^## /m);
    expect(seed).toMatch(/^### /m);
    expect(seed).toMatch(/^#### /m);
    expect(seed).toMatch(/^##### /m);
    expect(seed).toMatch(/^###### /m);
  });

  it("contains every inline pattern", () => {
    expect(seed).toMatch(/\*\*[^*]+\*\*/);
    expect(seed).toMatch(/(?<!\*)\*[^*\n]+\*(?!\*)/);
    expect(seed).toMatch(/`[^`\n]+`/);
    expect(seed).toMatch(/\[[^\]]+\]\([^)]+\)/);
  });

  it("contains every list variant", () => {
    expect(seed).toMatch(/^- (?!\[)/m);
    expect(seed).toMatch(/^\d+\. /m);
    expect(seed).toMatch(/^- \[ \]/m);
    expect(seed).toMatch(/^- \[x\]/m);
  });

  it("contains every block pattern", () => {
    expect(seed).toMatch(/^> /m);
    expect(seed).toMatch(/^```/m);
    expect(seed).toMatch(/^---$/m);
  });
});
