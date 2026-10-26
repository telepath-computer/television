import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "../../../../test/helpers/playwright.ts";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { configureTestMotion } from "./helpers.ts";

function templatePage(version: string): string {
  return `<!doctype html><html><body><p id="version">${version}</p><p id="message"></p>
<script type="module">
import { getStore, onValue, ref } from "/sdk/v1/resources.js";
onValue(ref(getStore()), (snapshot) => {
  document.querySelector("#message").textContent = snapshot.val()?.message ?? "Unwritten";
});
</script></body></html>`;
}

// proofs/product/templates.md#^templates-ac-cli-create
test("copied CLI artifacts use starting data and remain independent of template edits and removal", async ({ page }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const run = (args: string[]) => product.runCLI(args);
    const json = (args: string[]) => JSON.parse(run(args));
    const channelID = json(["list-channels"]).channels[0].id;
    const source = path.join(product.home, "templates", "message");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ name: "Message", description: "Per-artifact messages", version: "1.0.0" }));
    writeFileSync(path.join(source, "index.html"), templatePage("Version one"));
    writeFileSync(path.join(source, "data.json"), '{"message":"Template value","extra":true}');
    writeFileSync(path.join(source, "README.md"), "Edit the copied page.");
    const create = (extra: string[]) => {
      const output = run(["create-artifact", "--channel", channelID, "--template", "message", ...extra, "--no-focus"]);
      const match = /^Artifact (\S+) created\.\nTelevision registered (.+)\.\n$/.exec(output);
      expect(match).not.toBeNull();
      return { id: match![1]!, target: match![2]! };
    };
    const first = create([]);
    const second = create(["--title", "Second page", "--data", '{"message":"Caller value"}']);
    expect(first.id).not.toBe(second.id);
    expect(first.target).not.toBe(second.target);
    const record = (id: string) => json(["get-artifact", "--id", id]).artifact;
    const value = (id: string) => json(["resource", "json", "get", "--artifact", id]);
    for (const entry of [first, second]) {
      expect(path.dirname(entry.target)).toBe(path.join(product.home, "artifacts"));
      expect(existsSync(path.join(entry.target, "manifest.json"))).toBe(false);
      expect(existsSync(path.join(entry.target, "data.json"))).toBe(false);
      expect(readFileSync(path.join(entry.target, "README.md"), "utf8")).toBe("Edit the copied page.");
      expect(record(entry.id)).toMatchObject({ kind: "path" });
      expect(record(entry.id)).not.toHaveProperty("templateID");
      expect(record(entry.id)).not.toHaveProperty("origin");
    }
    expect(record(first.id).title).toBe("Message");
    expect(record(second.id).title).toBe("Second page");
    expect(record(first.id).store).not.toBe(record(second.id).store);
    expect(value(first.id)).toEqual({ exists: true, value: { message: "Template value", extra: true } });
    expect(value(second.id)).toEqual({ exists: true, value: { message: "Caller value" } });

    const connect = new URL("/", product.serverURL);
    connect.searchParams.set("token", product.token);
    await page.goto(connect.href);
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    await configureTestMotion(page);
    const frame = (id: string) => page.locator(`.stage .page[data-page-key="${id}"] iframe.artifact-content`).contentFrame();
    await expect(frame(first.id).locator("#message")).toHaveText("Template value");
    await expect(frame(second.id).locator("#message")).toHaveText("Caller value");

    writeFileSync(path.join(source, "index.html"), templatePage("Version two"));
    writeFileSync(path.join(source, "data.json"), '{"message":"Next template value"}');
    const third = create([]);
    await expect(frame(third.id).locator("#version")).toHaveText("Version two");
    await expect(frame(third.id).locator("#message")).toHaveText("Next template value");
    renameSync(source, path.join(product.home, "moved-template"));
    // Reload makes independence observable even if no watcher event arrives.
    await page.reload();
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    await expect(frame(first.id).locator("#version")).toHaveText("Version one");
    await expect(frame(second.id).locator("#version")).toHaveText("Version one");
    await expect(frame(third.id).locator("#version")).toHaveText("Version two");
    await expect(frame(first.id).locator("#message")).toHaveText("Template value");
    await expect(frame(second.id).locator("#message")).toHaveText("Caller value");

    run(["resource", "json", "set", "--artifact", first.id, "message", '"First changed"']);
    await expect(frame(first.id).locator("#message")).toHaveText("First changed");
    await expect(frame(second.id).locator("#message")).toHaveText("Caller value");
    writeFileSync(path.join(second.target, "index.html"), templatePage("Edited copy"));
    await expect(frame(second.id).locator("#version")).toHaveText("Edited copy", { timeout: 15_000 });
    await expect(frame(first.id).locator("#version")).toHaveText("Version one");
    expect(readFileSync(path.join(product.home, "moved-template", "index.html"), "utf8")).toBe(templatePage("Version two"));
  } finally { await product.dispose(); }
});

// proofs/product/resources/resources.md#^rs-ac-shared-folder
test("ordinary path artifacts sharing a folder keep separate stores when one path changes", async ({ page }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const run = (args: string[]) => product.runCLI(args);
    const json = (args: string[]) => JSON.parse(run(args));
    const channelID = json(["list-channels"]).channels[0].id;
    const folder = path.join(product.home, "shared-page");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "index.html"), templatePage("Shared version"));
    const create = (title: string) => {
      const output = run(["create-artifact", "--path", folder, "--title", title, "--channel", channelID, "--no-focus"]);
      const id = /^Artifact (\S+) created\./m.exec(output)![1]!;
      run(["resource", "json", "set", "--artifact", id, "", JSON.stringify({ message: title })]);
      return id;
    };
    const first = create("First"), second = create("Second");
    const record = () => json(["get-artifact", "--id", second]).artifact;
    const before = record();
    const connect = new URL("/", product.serverURL);
    connect.searchParams.set("token", product.token);
    await page.goto(connect.href);
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    await configureTestMotion(page);
    const frame = (id: string) => page.locator(`.stage .page[data-page-key="${id}"] iframe.artifact-content`).contentFrame();
    await expect(frame(first).locator("#message")).toHaveText("First");
    await expect(frame(second).locator("#message")).toHaveText("Second");
    run(["resource", "json", "set", "--artifact", first, "message", '"Changed first"']);
    await expect(frame(first).locator("#message")).toHaveText("Changed first");
    await expect(frame(second).locator("#message")).toHaveText("Second");
    writeFileSync(path.join(folder, "index.html"), templatePage("Shared edit"));
    await expect(frame(first).locator("#version")).toHaveText("Shared edit", { timeout: 15_000 });
    await expect(frame(second).locator("#version")).toHaveText("Shared edit", { timeout: 15_000 });
    const copy = path.join(product.home, "other-page");
    cpSync(folder, copy, { recursive: true });
    run(["update-artifact", "--id", second, "--path", copy]);
    expect(record()).toMatchObject({ id: second, store: before.store });
    expect(path.resolve(record().path)).toBe(copy);
    expect(json(["resource", "json", "get", "--artifact", second])).toEqual({ exists: true, value: { message: "Second" } });
    await expect(frame(second).locator("#message")).toHaveText("Second");
    writeFileSync(path.join(copy, "index.html"), templatePage("Other page"));
    await expect(frame(second).locator("#version")).toHaveText("Other page", { timeout: 15_000 });
    await expect(frame(first).locator("#version")).toHaveText("Shared edit");
  } finally { await product.dispose(); }
});
