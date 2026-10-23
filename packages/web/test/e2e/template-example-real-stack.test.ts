import path from "node:path";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";

const exampleBundle = path.resolve(import.meta.dirname, "../../../server/assets/templates");

// proofs/arch/templates/bundled-templates.md#^templates-example-ac-live
test("bundled Example renders unwritten and caller-supplied stores and live agent values without writing defaults", async ({ page, context }) => {
  const product = await launchProductServer({ bundledTemplatesBundle: exampleBundle });
  try {
    const client = new TelevisionClient(product.serverURL);
    const { channels } = await client.channels.list();
    const channelID = channels[0]?.id;
    expect(channelID).toBeDefined();
    const created = await client.templates.create({ templateID: "example", channelID: channelID!, source: "cli" });
    expect(created).toEqual({ artifactID: expect.any(String), path: path.join(product.home, "templates/example") });
    const store = { artifactID: created.artifactID };
    expect(await client.resources.json.get({ store, path: "" })).toEqual({ exists: false });
    expect(await client.resources.list({ artifactID: created.artifactID })).toEqual([]);
    const stylesheet = page.waitForResponse((response) =>
      response.url().includes("/canonical/v2/styles.css?authoredForAppVersion=1.5.4") && response.status() === 200);
    await page.goto(new URL(`/artifact/${created.artifactID}/index.html`, product.serverURL).toString());
    await stylesheet;
    await expect(page.getByRole("heading", { name: "Example" })).toBeVisible();
    await expect(page.locator("#message")).toHaveText("Hello from a template.");
    await expect(page.locator('link[href="/canonical/v2/styles.css?authoredForAppVersion=1.5.4"]')).toHaveCount(1);
    await expect(page.locator("button, input, textarea, [contenteditable=true]")).toHaveCount(0);
    expect(await client.resources.json.get({ store, path: "" })).toEqual({ exists: false });
    expect(await client.resources.list({ artifactID: created.artifactID })).toEqual([]);

    const seeded = await client.templates.create({
      templateID: "example", channelID: channelID!, data: { message: "Supplied at creation." }, source: "cli",
    });
    const seededPage = await context.newPage();
    await seededPage.goto(new URL(`/artifact/${seeded.artifactID}/index.html`, product.serverURL).toString());
    await expect(seededPage.locator("#message")).toHaveText("Supplied at creation.");
    await seededPage.close();

    expect(product.runCLI(["resource", "json", "set", "--artifact", created.artifactID, "message", '"Changed by an agent."']))
      .toContain(`JSON store of artifact ${created.artifactID} updated.`);
    await expect(page.locator("#message")).toHaveText("Changed by an agent.");

    const safeText = '<img src=x onerror="document.body.dataset.executed=1">';
    product.runCLI(["resource", "json", "set", "--artifact", created.artifactID, "message", JSON.stringify(safeText)]);
    await expect(page.locator("#message")).toHaveText(safeText);
    await expect(page.locator("#message img")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-executed");

    product.runCLI(["resource", "json", "set", "--artifact", created.artifactID, "message", '""']);
    await expect(page.locator("#message")).toHaveText("");

    for (const value of [{ message: 42 }, {}, null]) {
      product.runCLI(["resource", "json", "set", "--artifact", created.artifactID, "message", '"A string before the fallback."']);
      await expect(page.locator("#message")).toHaveText("A string before the fallback.");
      product.runCLI(["resource", "json", "set", "--artifact", created.artifactID, "", JSON.stringify(value)]);
      await expect(page.locator("#message")).toHaveText("Hello from a template.");
      expect(await client.resources.json.get({ store, path: "" })).toEqual({ exists: true, value });
    }
    expect(await client.resources.json.get({ store: { artifactID: seeded.artifactID }, path: "" }))
      .toEqual({ exists: true, value: { message: "Supplied at creation." } });
  } finally {
    await product.dispose();
  }
});
