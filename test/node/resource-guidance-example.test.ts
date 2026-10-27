import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NetworkProxy } from "../../packages/server/test/e2e/network-proxy.ts";
import { agentCommands, artifactExample } from "../helpers/resource-guidance.ts";
import {
  ProductContext,
  artifactURL,
  createPathArtifact,
  focusedChannel,
  frameAt,
  ok,
  openApp,
  share,
} from "./resource-product-harness.ts";

/*
 * The resource guidance's complete artifact example runs as written: taken
 * unchanged from the `resources.md` that this surface's build just packaged
 * into the CLI, registered through the built CLI, using its own store, and
 * shown in the app in a real browser at a mapped plain-HTTP host name. The example then also opens as a page of its own
 * through a network proxy, which lets the walk cut that page's connection
 * without the app's. Proves [[arch/resources/guidance.md#^rg-t-example]].
 */

const REPO_ROOT = path.resolve(process.cwd());
const PACKAGED_GUIDANCE = path.join(REPO_ROOT, "packages", "cli", "dist", "skills", "television", "resources.md");
const HOST = "tv-example.test";
const context = new ProductContext();
let proxy: NetworkProxy | undefined;

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  await context.cleanup();
});

function eventually(check: () => unknown): Promise<unknown> {
  return vi.waitFor(check, { timeout: 10_000, interval: 50 });
}

interface Task {
  title: string;
  done: boolean;
  createdAt?: number;
}

describe("the resource guidance's example", () => {
  it("loads without errors, renders its store, changes it through its own controls, shows changes from the shell, the guidance's own agent commands included, says when it is disconnected, with its writing controls disabled until the connection returns, and says that a change cut off by the loss may not have been saved, and turns read-only through a read share link", async () => {
    const example = artifactExample(readFileSync(PACKAGED_GUIDANCE, "utf8"));
    const folder = context.temporaryDirectory("television-resource-example-");
    writeFileSync(path.join(folder, "index.html"), example);

    const server = await context.serve(context.temporaryDirectory("television-resource-example-home-"));
    const channelID = await focusedChannel(server, "Example");
    const artifactID = await createPathArtifact(server, channelID, "Example", folder);
    const byArtifact = ["--artifact", artifactID];
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":false}\n'));
    const items = async () => {
      const read = JSON.parse((await server.tv(["resource", "json", "get", ...byArtifact, "items"])).stdout) as { exists: boolean; value?: Record<string, Task> };
      return read.value ?? {};
    };

    const browser = await context.launch("chromium", [HOST]);
    const { page, errors } = await openApp(browser, server, HOST);
    const frame = await frameAt(page, artifactURL(server, HOST, artifactID));
    // The store has no value yet: the page renders an empty list with its controls ready.
    await expect.poll(() => frame.getByRole("button", { name: "Add" }).isEnabled(), { timeout: 10_000 }).toBe(true);
    expect(await frame.getByRole("checkbox").count()).toBe(0);
    await frame.evaluate(() => { (window as unknown as { loadMarker: string }).loadMarker = "first load"; });

    await frame.getByRole("textbox", { name: "New task" }).fill("Buy milk");
    await frame.getByRole("button", { name: "Add" }).click();
    await eventually(async () => expect(Object.values(await items())).toContainEqual({ title: "Buy milk", done: false, createdAt: expect.any(Number) }));
    await expect.poll(() => frame.getByRole("checkbox", { name: "Buy milk" }).count(), { timeout: 10_000 }).toBe(1);

    await frame.getByRole("checkbox", { name: "Buy milk" }).check();
    await eventually(async () => expect(Object.values(await items())).toContainEqual({ title: "Buy milk", done: true, createdAt: expect.any(Number) }));

    await frame.getByRole("button", { name: "Clear done" }).click();
    await eventually(async () => expect(await items()).toEqual({}));
    await expect.poll(() => frame.getByRole("checkbox", { name: "Buy milk" }).count(), { timeout: 10_000 }).toBe(0);

    expect(await server.tv(["resource", "json", "set", ...byArtifact, "items/seed", '{"title":"Water the garden","done":false}'])).toEqual(
      ok(`JSON store of artifact ${artifactID} updated.\n`),
    );
    await expect.poll(() => frame.getByRole("checkbox", { name: "Water the garden" }).count(), { timeout: 10_000 }).toBe(1);

    // The guidance's own commands for adding and completing a task, as the agent runs them, with only their placeholders filled.
    const fill = (argv: string[], key?: string) => argv.slice(1).map((word) => word.replace("<artifact-id>", artifactID).replace("<key>", key ?? "<key>"));
    const [add, complete] = agentCommands(readFileSync(PACKAGED_GUIDANCE, "utf8"));
    expect(add!.slice(0, 6)).toEqual(["tv", "resource", "json", "push", "--artifact", "<artifact-id>"]);
    const pushed = await server.tv(fill(add!));
    expect(pushed.exitCode, pushed.stderr).toBe(0);
    const { key } = JSON.parse(pushed.stdout) as { key: string };
    const title = (JSON.parse(add!.at(-1)!) as Task).title;
    await expect.poll(() => frame.getByRole("checkbox", { name: title }).count(), { timeout: 10_000 }).toBe(1);
    expect(complete!.slice(0, 6)).toEqual(["tv", "resource", "json", "set", "--artifact", "<artifact-id>"]);
    expect((await server.tv(fill(complete!, key))).exitCode).toBe(0);
    await expect.poll(() => frame.getByRole("checkbox", { name: title }).isChecked(), { timeout: 10_000 }).toBe(true);
    expect(await frame.evaluate(() => (window as unknown as { loadMarker?: string }).loadMarker)).toBe("first load");
    expect(await frame.getByRole("alert").textContent()).toBe("");
    expect(errors.list()).toEqual([]);

    // The example as a page of its own, reaching the server through the proxy,
    // so that cutting the connection leaves the app's alone: the app reloads
    // its artifact frames when its own connection returns.
    proxy = await NetworkProxy.start(server.port);
    const alone = await browser.newPage();
    const aloneErrors: string[] = [];
    alone.on("pageerror", (error) => aloneErrors.push(`pageerror: ${error.message}`));
    alone.on("console", (message) => {
      if (message.type() === "error") aloneErrors.push(`console: ${message.text()}`);
    });
    await alone.goto(artifactURL({ ...server, port: proxy.port }, HOST, artifactID));
    await expect.poll(() => alone.getByRole("checkbox", { name: title }).isChecked(), { timeout: 10_000 }).toBe(true);
    const writingControls = () => [
      alone.getByRole("textbox", { name: "New task" }),
      alone.getByRole("button", { name: "Add" }),
      alone.getByRole("button", { name: "Clear done" }),
      ...["Water the garden", title].map((name) => alone.getByRole("checkbox", { name })),
    ];
    for (const control of writingControls()) await expect.poll(() => control.isDisabled(), { timeout: 10_000 }).toBe(false);

    // A chore added while the server cannot confirm it shows at once.
    proxy.holdWrites();
    await alone.getByRole("textbox", { name: "New task" }).fill("Mop the kitchen");
    await alone.getByRole("button", { name: "Add" }).click();
    await proxy.waitFor(() => proxy!.heldWriteCount === 1);
    await expect.poll(() => alone.getByRole("checkbox", { name: "Mop the kitchen" }).count(), { timeout: 10_000 }).toBe(1);

    // The connection drops with that write unconfirmed and stays down: the page
    // says it is disconnected, disables every control that writes, and says
    // that the change may not have been saved, since it cannot know.
    proxy.refuse(true);
    proxy.sever();
    proxy.releaseWrites();
    await expect.poll(() => alone.getByText(/disconnected/i).count(), { timeout: 10_000 }).toBe(1);
    for (const control of writingControls()) await expect.poll(() => control.isDisabled(), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => alone.getByRole("checkbox", { name: "Mop the kitchen" }).count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => alone.getByRole("alert").textContent(), { timeout: 10_000 }).toMatch(/may not have been saved/);

    // A change from the shell meanwhile shows once the connection returns, and the controls work again.
    expect((await server.tv(["resource", "json", "set", ...byArtifact, "items/seed/done", "true"])).exitCode).toBe(0);
    proxy.refuse(false);
    await expect.poll(() => alone.getByRole("checkbox", { name: "Water the garden" }).isChecked(), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => alone.getByText(/disconnected/i).count(), { timeout: 10_000 }).toBe(0);
    for (const control of writingControls()) await expect.poll(() => control.isDisabled(), { timeout: 10_000 }).toBe(false);
    await alone.getByRole("textbox", { name: "New task" }).fill("Sweep the porch");
    await alone.getByRole("button", { name: "Add" }).click();
    await eventually(async () => expect(Object.values(await items()).map((task) => task.title)).toContain("Sweep the porch"));
    // The cut-off chore never reached the server, and the warning about it stays.
    expect(Object.values(await items()).map((task) => task.title)).not.toContain("Mop the kitchen");
    expect(await alone.getByRole("checkbox", { name: "Mop the kitchen" }).count()).toBe(0);
    expect(await alone.getByRole("alert").textContent()).toMatch(/may not have been saved/);
    // The browser logs each connection attempt the proxy refused; nothing else may go wrong.
    expect(aloneErrors.filter((error) => !/WebSocket connection to '[^']*' failed/.test(error))).toEqual([]);

    // The example through a read share link, in a browser context that holds no token: the list
    // shows, its checkboxes are disabled, and the controls that only write are not shown at all.
    const { link } = await share(server, artifactID, "read", HOST);
    const reader = await browser.newPage();
    const readerErrors: string[] = [];
    reader.on("pageerror", (error) => readerErrors.push(`pageerror: ${error.message}`));
    reader.on("console", (message) => {
      if (message.type() === "error") readerErrors.push(`console: ${message.text()}`);
    });
    await reader.goto(link);
    const readerTasks = () => ["Water the garden", title, "Sweep the porch"].map((name) => reader.getByRole("checkbox", { name }));
    await expect.poll(() => reader.getByRole("checkbox", { name: title }).isChecked(), { timeout: 10_000 }).toBe(true);
    const onlyWriting = () => [
      { name: "New task", control: reader.getByRole("textbox", { name: "New task", includeHidden: true }) },
      { name: "Add", control: reader.getByRole("button", { name: "Add", includeHidden: true }) },
      { name: "Clear done", control: reader.getByRole("button", { name: "Clear done", includeHidden: true }) },
    ];
    for (const { name, control } of onlyWriting()) {
      expect(await control.count(), name).toBe(1);
      await expect.poll(() => control.isVisible(), { timeout: 10_000, message: `${name} shown` }).toBe(false);
    }
    for (const task of readerTasks()) await expect.poll(() => task.isDisabled(), { timeout: 10_000 }).toBe(true);

    // The link's level changes to read-write while the page is open: the controls show, enabled.
    await share(server, artifactID, "read-write", HOST);
    for (const control of [...onlyWriting().map((entry) => entry.control), ...readerTasks()]) {
      await expect.poll(() => control.isVisible(), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => control.isDisabled(), { timeout: 10_000 }).toBe(false);
    }

    // The link is revoked: the page says that it no longer has access, and the controls are gone again.
    expect((await server.tv(["unshare-artifact", "--id", artifactID])).exitCode).toBe(0);
    await expect.poll(() => reader.getByText("This page no longer has access to the list.").count(), { timeout: 10_000 }).toBe(1);
    for (const { name, control } of onlyWriting()) await expect.poll(() => control.isVisible(), { timeout: 10_000, message: `${name} shown` }).toBe(false);
    expect(readerErrors).toEqual([]);
  });
});
