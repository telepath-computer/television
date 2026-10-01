import { expect, test } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/skill-selector.html";

interface SkillSignal {
  event: string;
  properties: Record<string, string>;
}

const SKILLS = ["calendar", "table", "tasks", "markdown"] as const;

test.describe("skill selector telemetry (^ss-ac-telemetry)", () => {
  test("signals each fixed skill prompt click exactly once without prompt content", async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(
      () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
    );

    await page.locator(".skill-trigger").click();
    await expect(page.locator(".skill-popover")).toBeVisible();

    const buttons = page.locator(".skill-card > button.copy-button");
    await expect(buttons).toHaveCount(SKILLS.length);
    for (let index = 0; index < SKILLS.length; index += 1) {
      await buttons.nth(index).click();
    }
    await buttons.first().click();

    const signals = await page.evaluate(
      () => (window as unknown as { __skillSelectorSignals: SkillSignal[] }).__skillSelectorSignals,
    );
    expect(signals).toEqual([
      ...SKILLS.map((artifactSkill) => ({
        event: "artifact_skill_prompt_copy_clicked",
        properties: { artifact_skill: artifactSkill },
      })),
      {
        event: "artifact_skill_prompt_copy_clicked",
        properties: { artifact_skill: "calendar" },
      },
    ]);
    expect(JSON.stringify(signals)).not.toContain("put it on TV");
  });
});
