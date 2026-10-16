import path from "node:path";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";

const exampleBundle = path.resolve(import.meta.dirname, "../../../server/assets/templates");

// proofs/arch/templates/bundled-templates.md#^templates-example-ac-live
test("bundled Example shows its seeded store value and a spawned tv write live", async ({ page }) => {
  const product = await launchProductServer({ bundledTemplatesBundle: exampleBundle });
  try {
    const client = new TelevisionClient(product.serverURL);
    const { channels } = await client.channels.list();
    const channelID = channels[0]?.id;
    expect(channelID).toBeDefined();
    const created = await client.templates.create({ templateID: "example", channelID: channelID!, source: "cli" });
    const stylesheet = page.waitForResponse((response) =>
      response.url().includes("/canonical/v2/styles.css?authoredForAppVersion=1.5.4") && response.status() === 200);
    await page.goto(new URL(`/artifact/${created.artifactID}/index.html`, product.serverURL).toString());
    await stylesheet;
    await expect(page.getByRole("heading", { name: "Example" })).toBeVisible();
    await expect(page.locator("#message")).toHaveText("Hello from a template.");
    await expect(page.locator('link[href="/canonical/v2/styles.css?authoredForAppVersion=1.5.4"]')).toHaveCount(1);
    await expect(page.locator("button, input, textarea, [contenteditable=true]")).toHaveCount(0);

    expect(product.runCLI(["resource", "json", "set", "--artifact", created.artifactID, "message", '"Changed by an agent."']))
      .toContain(`JSON store of artifact ${created.artifactID} updated.`);
    await expect(page.locator("#message")).toHaveText("Changed by an agent.");
  } finally {
    await product.dispose();
  }
});
