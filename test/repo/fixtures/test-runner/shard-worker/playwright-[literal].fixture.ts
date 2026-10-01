import { expect, test } from "@playwright/test";
test("treats punctuation as a literal file path", () => {
  expect("playwright-[literal].fixture.ts").toContain("[literal]");
});
