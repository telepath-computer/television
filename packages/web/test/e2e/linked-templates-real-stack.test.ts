import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
// proofs/product/templates.md#^templates-ac-copy-detach
// proofs/product/resources/resources.md#^rs-ac-shared-folder
test("linked CLI artifacts share live files, keep separate stores, recover and detach", async ({ page }) => {
  const product = await launchProductServer({ auth: true });
  try {
    const run = (args: string[]) => product.runCLI(args);
    const json = (args: string[]) => JSON.parse(run(args));
    const channelID = json(["list-channels"]).channels[0].id;
    const source = path.join(product.home, "templates", "shared");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ name: "Shared page", description: "Per-artifact messages", version: "1.0.0" }));
    writeFileSync(path.join(source, "index.html"), templatePage("Version one"));
    writeFileSync(path.join(source, "data.json"), '{"message":"Supporting file"}');
    const create = (extra: string[]) => {
      const output = run(["create-artifact", "--channel", channelID, "--template", "shared", ...extra, "--no-focus"]);
      const match = /^Artifact (\S+) created\.\nTelevision registered (.+)\.\n$/.exec(output);
      expect(match).not.toBeNull();
      return { id: match![1]!, target: match![2]! };
    };
    const first = create(["--data", '{"message":"First value"}']);
    const second = create(["--title", "Second page", "--data", '{"message":"Second value"}']);
    const unwritten = create(["--title", "Unwritten page"]);
    expect(new Set([first.id, second.id, unwritten.id]).size).toBe(3);
    expect([first, second, unwritten].map((entry) => path.resolve(entry.target))).toEqual([source, source, source]);
    expect(readdirSync(path.join(product.home, "artifacts"))).toEqual([]);
    const record = (id: string) => json(["get-artifact", "--id", id]).artifact;
    const value = (id: string) => json(["resource", "json", "get", "--artifact", id]);
    const before = [record(first.id), record(second.id)];
    expect(before[0].title).toBe("Shared page");
    expect(before[1].title).toBe("Second page");
    expect(before[0].store).not.toBe(before[1].store);
    for (const artifact of before) {
      expect(artifact.kind).toBe("path");
      expect(artifact).not.toHaveProperty("templateID");
      expect(artifact).not.toHaveProperty("origin");
    }
    expect(value(unwritten.id)).toEqual({ exists: false });
    expect(record(unwritten.id)).not.toHaveProperty("store");
    const copied = create(["--copy", "--title", "Copied page", "--data", '{"message":"Copy value"}']);
    expect(path.dirname(copied.target)).toBe(path.join(product.home, "artifacts"));
    expect(existsSync(path.join(copied.target, "manifest.json"))).toBe(false);
    expect(readFileSync(path.join(copied.target, "data.json"), "utf8")).toBe('{"message":"Supporting file"}');

    const connect = new URL("/", product.serverURL);
    connect.searchParams.set("token", product.token);
    await page.goto(connect.href);
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    await configureTestMotion(page);
    const frame = (id: string) => page.locator(`.stage .page[data-page-key="${id}"] iframe.artifact-content`).contentFrame();
    await expect(frame(first.id).locator("#message")).toHaveText("First value");
    await expect(frame(second.id).locator("#message")).toHaveText("Second value");
    await expect(frame(copied.id).locator("#message")).toHaveText("Copy value");
    await expect(frame(unwritten.id).locator("#message")).toHaveText("Unwritten");
    expect(value(unwritten.id)).toEqual({ exists: false });

    run(["resource", "json", "set", "--artifact", first.id, "message", '"First changed"']);
    await expect(frame(first.id).locator("#message")).toHaveText("First changed");
    await expect(frame(second.id).locator("#message")).toHaveText("Second value");
    writeFileSync(path.join(source, "index.html"), templatePage("Version two"));
    await expect(frame(first.id).locator("#version")).toHaveText("Version two", { timeout: 15_000 });
    await expect(frame(second.id).locator("#version")).toHaveText("Version two", { timeout: 15_000 });
    await expect(frame(first.id).locator("#message")).toHaveText("First changed");
    await expect(frame(second.id).locator("#message")).toHaveText("Second value");
    await expect(frame(copied.id).locator("#version")).toHaveText("Version one");

    const moved = path.join(product.home, "moved-template");
    renameSync(source, moved);
    await expect(frame(first.id).locator("#missing-title")).toHaveText("Artifact file not found", { timeout: 15_000 });
    await expect(frame(second.id).locator("#missing-title")).toHaveText("Artifact file not found", { timeout: 15_000 });
    expect(record(first.id)).toEqual(before[0]);
    expect(record(second.id)).toEqual(before[1]);
    expect(value(first.id)).toEqual({ exists: true, value: { message: "First changed" } });
    expect(value(second.id)).toEqual({ exists: true, value: { message: "Second value" } });
    renameSync(moved, source);
    await expect(frame(first.id).locator("#version")).toHaveText("Version two", { timeout: 20_000 });
    await expect(frame(second.id).locator("#message")).toHaveText("Second value", { timeout: 20_000 });

    const detached = path.join(product.home, "detached-page");
    cpSync(source, detached, { recursive: true });
    run(["update-artifact", "--id", second.id, "--path", detached]);
    expect(record(second.id)).toMatchObject({ id: second.id, store: before[1].store });
    expect(path.resolve(record(second.id).path)).toBe(detached);
    expect(value(second.id)).toEqual({ exists: true, value: { message: "Second value" } });
    await expect(frame(second.id).locator("#message")).toHaveText("Second value");
    writeFileSync(path.join(source, "index.html"), templatePage("Version three"));
    await expect(frame(first.id).locator("#version")).toHaveText("Version three", { timeout: 15_000 });
    await expect(frame(second.id).locator("#version")).toHaveText("Version two");
    run(["resource", "json", "set", "--artifact", second.id, "message", '"Detached value"']);
    await expect(frame(second.id).locator("#message")).toHaveText("Detached value");
    await expect(frame(first.id).locator("#message")).toHaveText("First changed");
    writeFileSync(path.join(copied.target, "index.html"), templatePage("Copy edit"));
    await expect(frame(copied.id).locator("#version")).toHaveText("Copy edit", { timeout: 15_000 });
    await expect(frame(first.id).locator("#version")).toHaveText("Version three");
  } finally {
    await product.dispose();
  }
});
