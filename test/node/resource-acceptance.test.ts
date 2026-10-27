import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OWN_STORE_DESCRIPTION, adminRoutes } from "@telepath-computer/television-shared/resources";
import { writeHomeConfig } from "../helpers/television-home.ts";
import { canBindSecondaryLoopback, SECONDARY_LOOPBACK_ADDRESS, secondaryLoopbackTestName } from "./helpers/secondary-loopback.ts";
import { PROCESS_TIMEOUT_MS, ProductContext, ok, parse, type BuiltServer, type Result } from "./resource-product-harness.ts";

/*
 * The share commands and the resource commands as an agent uses them:
 * spawned built `tv` processes over temporary homes, against the server
 * `tv serve` starts, with the bindings flag off as shipped. Proves
 * [[product/resources/resources.md#^rs-ac-share-cli]],
 * [[product/resources/resources.md#^rs-ac-common-commands]],
 * [[product/resources/resources.md#^rs-ac-recovery]],
 * [[product/resources/resources.md#^rs-ac-flag-off]],
 * [[product/resources/json-store.md#^js-ac-cli]],
 * [[product/resources/json-store.md#^js-ac-unavailable]] and, for the
 * streaming commands, [[product/cli.md#^cli-ac-unauthorized]].
 */

const SECONDARY_LOOPBACK_AVAILABLE = await canBindSecondaryLoopback();

const context = new ProductContext();

afterEach(async () => {
  await context.cleanup();
});

function temporaryDirectory(prefix: string): string {
  return context.temporaryDirectory(prefix);
}

function serve(home: string, options: { auth?: boolean; listen?: string[] } = {}): Promise<BuiltServer> {
  return context.serve(home, options);
}

/** Writes an HTML file in a new folder and returns its path. */
function htmlFile(title: string): string {
  const file = path.join(temporaryDirectory("television-resource-artifact-"), "index.html");
  writeFileSync(file, `<!doctype html><title>${title}</title><h1>${title}</h1>`);
  return file;
}

/** Creates a channel, and returns its ID. */
async function createChannel(server: BuiltServer, name: string): Promise<string> {
  const channel = await server.tv(["create-channel", "--name", name, "--no-focus"]);
  expect(channel.exitCode, channel.stderr).toBe(0);
  return /Channel created: (\S+)/.exec(channel.stdout)![1]!;
}

/** Registers `file` as a path artifact on a new channel, and returns its ID. */
async function createArtifact(server: BuiltServer, title: string, file = htmlFile(title)): Promise<string> {
  const channelID = await createChannel(server, title);
  const created = await server.tv(["create-path-artifact", "--channel", channelID, "--title", title, "--path", file, "--no-focus"]);
  expect(created.exitCode, created.stderr).toBe(0);
  return /Path artifact (\S+) created\./.exec(created.stdout)![1]!;
}

/** An artifact's record, as `tv get-artifact` prints it. */
async function record(server: BuiltServer, artifactID: string): Promise<Record<string, unknown>> {
  return (parse(await server.tv(["get-artifact", "--id", artifactID])) as { artifact: Record<string, unknown> }).artifact;
}

/** The resource ID an artifact's record shows for its store. */
async function storeOf(server: BuiltServer, artifactID: string): Promise<string> {
  const store = (await record(server, artifactID)).store;
  expect(typeof store, `the store of ${artifactID}`).toBe("string");
  return store as string;
}

/** Expects a command to fail, writing nothing to stdout and `text` to stderr. */
function expectRefused(result: Result, label: string, text?: string): void {
  expect(result.exitCode, `${label}: ${result.stderr}`).not.toBe(0);
  expect(result.stdout, label).toBe("");
  if (text !== undefined) expect(result.stderr, label).toContain(text);
}

/** The lines of a long-running command's output. */
function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

/** The command names a help text's Commands section lists. */
function helpCommands(help: string): string[] {
  const section = help.split(/^Commands:\n/m)[1]?.split("\n\n")[0] ?? "";
  return section.split("\n").map((line) => /^ {2}(\S+)/.exec(line)?.[1]).filter((name): name is string => name !== undefined);
}

/** Every file and folder under `directory`, relative to it. */
function snapshot(directory: string): string[] {
  const entries: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      entries.push(path.relative(directory, full));
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  walk(directory);
  return entries;
}

describe("the share commands at the shell", () => {
  it.skipIf(!SECONDARY_LOOPBACK_AVAILABLE)(
    secondaryLoopbackTestName("share an artifact, change the link's level, revoke it, and refuse what cannot be shared", SECONDARY_LOOPBACK_AVAILABLE),
    async () => {
      const home = temporaryDirectory("television-share-walk-");
      const server = await serve(home, { listen: [SECONDARY_LOOPBACK_ADDRESS] });
      const artifactID = await createArtifact(server, "Shared page");

      const linkOrigins = lines((await server.tv(["links"])).stdout).map((line) => new URL(line).origin);
      expect(linkOrigins).toHaveLength(2);
      // Without --access, the link is read.
      const shared = await server.tv(["share-artifact", "--id", artifactID]);
      expect(shared.exitCode, shared.stderr).toBe(0);
      expect(shared.stderr).toBe("");
      const shareID = /\/artifact\/([^/]+)\/$/.exec(lines(shared.stdout)[0]!)![1]!;
      expect(shared.stdout).toBe(linkOrigins.map((origin) => `${origin}/artifact/${shareID}/\n`).join(""));
      expect(shareID).not.toBe(artifactID);
      expect(artifactID).not.toContain(shareID);
      expect(shareID).not.toContain(artifactID);
      expect((await record(server, artifactID)).share).toEqual({ id: shareID, access: "read" });
      const link = lines(shared.stdout)[0]!;
      const served = await fetch(link);
      expect(served.status).toBe(200);
      expect(await served.text()).toContain("<h1>Shared page</h1>");

      expect(await server.tv(["share-artifact", "--id", artifactID])).toEqual(shared);
      expect(await server.tv(["share-artifact", "--id", artifactID, "--access", "read"])).toEqual(shared);
      expect(await server.tv(["share-artifact", "--id", artifactID, "--access", "read-write"])).toEqual(shared);
      expect((await record(server, artifactID)).share).toEqual({ id: shareID, access: "read-write" });
      // A read-write link is never narrowed, or handed out, by leaving out --access.
      const unspecified = await server.tv(["share-artifact", "--id", artifactID]);
      expectRefused(unspecified, "without --access on a read-write link", `Artifact ${artifactID} already has a read-write share link.`);
      expect(unspecified.stderr).toMatch(/--access read-write\b/);
      expect(unspecified.stderr).toMatch(/--access read\b(?!-)/);
      expect((await record(server, artifactID)).share).toEqual({ id: shareID, access: "read-write" });

      expect(await server.tv(["unshare-artifact", "--id", artifactID])).toEqual(ok(`Artifact ${artifactID} is no longer shared.\n`));
      expect(await record(server, artifactID)).not.toHaveProperty("share");
      expect((await fetch(link)).status).toBe(404);
      expectRefused(await server.tv(["unshare-artifact", "--id", artifactID]), "unshare again", `Artifact ${artifactID} is not shared.`);
      const again = await server.tv(["share-artifact", "--id", artifactID, "--access", "read"]);
      expect(again.exitCode, again.stderr).toBe(0);
      expect(again.stdout).not.toContain(shareID);

      const unknownLevel = await server.tv(["share-artifact", "--id", artifactID, "--access", "write"]);
      expectRefused(unknownLevel, "with an unknown level", "--access");
      expect(unknownLevel.stderr).toContain("Television ships bundled skills.");
      const missing = "01JBNOSUCHARTIFACT00000000";
      expectRefused(await server.tv(["share-artifact", "--id", missing, "--access", "read"]), "share a missing artifact", `Artifact not found: ${missing}`);
      expectRefused(await server.tv(["unshare-artifact", "--id", missing]), "unshare a missing artifact", `Artifact not found: ${missing}`);
      const urlChannel = await createChannel(server, "Links");
      const urlArtifact = await server.tv(["create-url-artifact", "--channel", urlChannel, "--title", "Elsewhere", "--url", "https://example.com/", "--no-focus"]);
      const urlID = /URL artifact (\S+) created\./.exec(urlArtifact.stdout)?.[1];
      expect(urlID, urlArtifact.stdout).toBeDefined();
      expectRefused(
        await server.tv(["share-artifact", "--id", urlID!, "--access", "read"]),
        "share a URL artifact",
        "only artifacts this server serves from its own files can be shared",
      );

      // An artifact without a store, such as a Markdown file, can be shared only at read.
      const notesFile = path.join(temporaryDirectory("television-share-notes-"), "notes.md");
      writeFileSync(notesFile, "# Notes\n");
      const notes = await createArtifact(server, "Notes", notesFile);
      expectRefused(
        await server.tv(["share-artifact", "--id", notes, "--access", "read-write"]),
        "share a Markdown artifact at read-write",
        `Read-write sharing is not supported for artifact ${notes}`,
      );
      expect(await record(server, notes)).not.toHaveProperty("share");
      const notesShared = await server.tv(["share-artifact", "--id", notes]);
      expect(notesShared.exitCode, notesShared.stderr).toBe(0);
      expect((await record(server, notes)).share).toMatchObject({ access: "read" });

      // Restarted without its token, the server refuses a link but revokes the one made before.
      await server.stop();
      const tokenless = await serve(home, { auth: false });
      expectRefused(await tokenless.tv(["share-artifact", "--id", artifactID, "--access", "read"]), "share without a token", "needs the server's auth token");
      expect(await tokenless.tv(["unshare-artifact", "--id", artifactID])).toEqual(ok(`Artifact ${artifactID} is no longer shared.\n`));
      expect(await record(tokenless, artifactID)).not.toHaveProperty("share");

      // Deleting a shared artifact stops its link's address serving it.
      await tokenless.stop();
      const authenticated = await serve(home);
      const deleted = await createArtifact(authenticated, "Deleted page");
      const deletedLink = lines((await authenticated.tv(["share-artifact", "--id", deleted, "--access", "read"])).stdout)[0]!;
      expect((await fetch(deletedLink)).status).toBe(200);
      expect((await authenticated.tv(["delete-artifact", "--id", deleted])).exitCode).toBe(0);
      expect((await fetch(deletedLink)).status).toBe(404);
    },
  );
});

describe("resource commands at the shell", () => {
  it("list, describe, watch the events of and destroy an artifact's own store", async () => {
    const server = await serve(temporaryDirectory("television-resource-walk-"));
    const events = server.start(["resource", "events"]);
    // The events process has subscribed once a change made now reaches it.
    const probe = await createArtifact(server, "Probe");
    let attempt = 0;
    await vi.waitFor(async () => {
      attempt += 1;
      await server.tv(["resource", "json", "set", "--artifact", probe, "n", String(attempt)]);
      await vi.waitFor(() => expect(events.stdout()).toContain(`"artifactID":"${probe}"`), { timeout: 2_000 });
    }, { timeout: PROCESS_TIMEOUT_MS, interval: 200 });
    const eventsBefore = lines(events.stdout()).length;

    const artifactID = await createArtifact(server, "Launch");
    expect(await server.tv(["resource", "json", "set", "--artifact", artifactID, '{"items":{"a":1}}'])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    const resourceID = await storeOf(server, artifactID);
    const summary = {
      resourceID,
      type: "json",
      description: OWN_STORE_DESCRIPTION,
      usage: "",
      status: "available",
      createdAt: expect.any(String),
      ownerArtifactID: artifactID,
    };
    const listed = parse(await server.tv(["resource", "list"])) as { resources: Array<{ resourceID: string }> };
    expect(listed.resources.filter((resource) => resource.resourceID === resourceID)).toEqual([summary]);
    expect(parse(await server.tv(["resource", "list", "--artifact", artifactID]))).toEqual({ resources: [{ ...summary, access: "read-write" }] });
    expect(parse(await server.tv(["resource", "info", resourceID]))).toEqual({ resource: { ...summary, bindings: [{ artifactID, access: "read-write" }] } });

    const usage = "Content: {items: {[id]: number}}.\nCount with increment.";
    expect(await server.tv(["resource", "describe", resourceID, "Tasks for the launch"])).toEqual(ok(`Resource ${resourceID} description updated.\n`));
    expect(await server.tv(["resource", "describe", resourceID, "--usage", usage])).toEqual(ok(`Resource ${resourceID} usage updated.\n`));
    expect(await server.tv(["resource", "describe", resourceID, "Launch tasks", "--usage", `${usage}\nRemove done items.`])).toEqual(
      ok(`Resource ${resourceID} description and usage updated.\n`),
    );
    const described = { ...summary, description: "Launch tasks", usage: `${usage}\nRemove done items.` };
    expect(parse(await server.tv(["resource", "info", resourceID]))).toEqual({ resource: { ...described, bindings: [{ artifactID, access: "read-write" }] } });
    const neither = await server.tv(["resource", "describe", resourceID]);
    expectRefused(neither, "describe with neither", "--usage");
    expect(neither.stderr).toContain("Television ships bundled skills.");
    expectRefused(await server.tv(["resource", "describe", resourceID, ""]), "describe with an empty description");
    expect(parse(await server.tv(["resource", "info", resourceID])).resource).toMatchObject({ description: "Launch tasks" });

    const refused = await server.tv(["resource", "destroy", resourceID]);
    expectRefused(refused, "destroy while bound", `${artifactID} (read-write)`);
    expect(refused.stderr).toContain("--force");
    expect(parse(await server.tv(["resource", "json", "get", "--artifact", artifactID]))).toEqual({ exists: true, value: { items: { a: 1 } } });
    expect(await server.tv(["resource", "destroy", resourceID, "--force"])).toEqual(ok(`Resource ${resourceID} destroyed; removed bindings for ${artifactID}.\n`));
    expect(await record(server, artifactID)).not.toHaveProperty("store");
    expect(await server.tv(["resource", "json", "get", "--artifact", artifactID])).toEqual(ok('{"exists":false}\n'));
    expectRefused(await server.tv(["resource", "info", resourceID]), "info after destroy", `Resource not found: ${resourceID}`);
    expect(await server.tv(["resource", "json", "set", "--artifact", artifactID, "a", "1"])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    expect(await storeOf(server, artifactID)).not.toBe(resourceID);

    const heard = () => lines(events.stdout()).slice(eventsBefore).map((line) => {
      expect(line).toBe(JSON.stringify(JSON.parse(line)));
      return JSON.parse(line) as { event: string; resourceID?: string; artifactID?: string; resource?: { resourceID: string } };
    });
    const ofTheStore = () => heard().filter((event) => (event.resourceID ?? event.resource?.resourceID) === resourceID);
    await vi.waitFor(() => expect(ofTheStore().map((event) => event.event)).toEqual(["changed", "updated", "updated", "updated", "destroyed"]), { timeout: PROCESS_TIMEOUT_MS });
    expect(ofTheStore().filter((event) => event.event !== "updated").map((event) => event.artifactID)).toEqual([artifactID, artifactID]);

    // A deleted artifact's store needs no --force.
    const deleted = await createArtifact(server, "Deleted");
    expect((await server.tv(["resource", "json", "set", "--artifact", deleted, "1"])).exitCode).toBe(0);
    const deletedStore = await storeOf(server, deleted);
    expect((await server.tv(["delete-artifact", "--id", deleted])).exitCode).toBe(0);
    expect(await server.tv(["resource", "destroy", deletedStore])).toEqual(ok(`Resource ${deletedStore} destroyed.\n`));
    expect(await events.interrupt()).toBe(0);
    expect(events.stderr()).toBe("");
  });

  it("keep a deleted artifact's store, find it with list and copy its data into a new artifact's store", async () => {
    const server = await serve(temporaryDirectory("television-resource-recovery-"));
    const file = htmlFile("Recovered");
    const artifactID = await createArtifact(server, "Recovered", file);
    const value = { items: { a: { title: "Keep me", done: false } } };
    expect((await server.tv(["resource", "json", "set", "--artifact", artifactID, JSON.stringify(value)])).exitCode).toBe(0);
    const resourceID = await storeOf(server, artifactID);
    expect((await server.tv(["delete-artifact", "--id", artifactID])).exitCode).toBe(0);

    const listed = parse(await server.tv(["resource", "list"])) as { resources: Array<{ resourceID: string; ownerArtifactID?: string }> };
    expect(listed.resources.find((resource) => resource.resourceID === resourceID)).toMatchObject({ ownerArtifactID: artifactID, status: "available" });
    const read = await server.tv(["resource", "json", "get", "--resource", resourceID]);
    expect(parse(read)).toEqual({ exists: true, value });
    expectRefused(await server.tv(["resource", "json", "get", "--artifact", artifactID]), "the deleted artifact", `Artifact not found: ${artifactID}`);

    const recovered = await createArtifact(server, "Recovered again", file);
    const dataFile = path.join(temporaryDirectory("television-resource-recovery-data-"), "data.json");
    writeFileSync(dataFile, JSON.stringify((JSON.parse(read.stdout) as { value: unknown }).value));
    expect(await server.tv(["resource", "json", "set", "--artifact", recovered, "--file", dataFile])).toEqual(ok(`JSON store of artifact ${recovered} updated.\n`));
    expect(parse(await server.tv(["resource", "json", "get", "--artifact", recovered]))).toEqual({ exists: true, value });
    expect(await storeOf(server, recovered)).not.toBe(resourceID);
    expect(parse(await server.tv(["resource", "json", "get", "--resource", resourceID]))).toEqual({ exists: true, value });
  });

  it("offer and serve no created store and no binding while the flag is off", async () => {
    const home = temporaryDirectory("television-resource-flag-off-");
    const server = await serve(home);
    const artifactID = await createArtifact(server, "Page");
    expect((await server.tv(["resource", "json", "set", "--artifact", artifactID, "1"])).exitCode).toBe(0);
    const resourceID = await storeOf(server, artifactID);
    const before = { resources: snapshot(path.join(home, "resources")), state: snapshot(path.join(home, "state")) };

    for (const argv of [
      ["resource", "bind", resourceID, artifactID, "--access", "read"],
      ["resource", "unbind", resourceID, artifactID],
      ["resource", "json", "create", "--description", "x"],
    ]) {
      const result = await server.tv(argv);
      expectRefused(result, argv.join(" "), "Unknown tv command");
      expect(result.stderr, argv.join(" ")).toContain("Television ships bundled skills.");
    }

    const headers = { "content-type": "application/json", authorization: `Bearer ${server.token}` };
    const origin = `http://127.0.0.1:${server.port}`;
    const created = await fetch(`${origin}${adminRoutes.jsonCreate}`, { method: "POST", headers, body: JSON.stringify({ description: "x" }) });
    const bound = await fetch(`${origin}${adminRoutes.bind(resourceID)}`, { method: "POST", headers, body: JSON.stringify({ artifactID, access: "read" }) });
    for (const [label, response] of [["create", created], ["bind", bound]] as const) {
      expect(response.status, label).toBe(404);
      expect(await response.json(), label).toMatchObject({ code: "not-enabled" });
    }
    expect({ resources: snapshot(path.join(home, "resources")), state: snapshot(path.join(home, "state")) }).toEqual(before);
  });

  it("list no created-store or binding command in any help while the flag is off", async () => {
    const home = temporaryDirectory("television-resource-help-");
    /** Runs a command line that prints help, checking that the help lists and names none of the three. */
    const help = async (argv: string[]): Promise<Result & { label: string }> => {
      const result = await context.runBuilt(["--home", home, ...argv]);
      const label = `tv ${argv.join(" ")}`;
      const text = result.stdout + result.stderr;
      expect(text, label).toMatch(/^Usage: tv /m);
      expect(helpCommands(text).filter((name) => ["bind", "unbind", "create"].includes(name)), label).toEqual([]);
      expect(text, label).not.toMatch(/\b(un)?bind\b|\bjson create\b/);
      return { ...result, label };
    };

    for (const argv of [["--help"], ["help"]]) {
      const result = await help(argv);
      expect(result.exitCode, result.label).toBe(0);
      expect(helpCommands(result.stdout), result.label).toEqual(expect.arrayContaining(["resource", "share-artifact", "unshare-artifact"]));
    }
    for (const argv of [["resource", "--help"], ["help", "resource"], ["resource", "help"]]) {
      const result = await help(argv);
      expect(result.exitCode, result.label).toBe(0);
      expect(helpCommands(result.stdout), result.label).toEqual(["list", "info", "describe", "destroy", "events", "json", "help"]);
    }
    for (const argv of [["resource", "json", "--help"], ["resource", "help", "json"], ["resource", "json", "help"]]) {
      const result = await help(argv);
      expect(result.exitCode, result.label).toBe(0);
      expect(helpCommands(result.stdout), result.label).toEqual(["get", "set", "update", "push", "remove", "watch", "help"]);
    }
    // A command line naming one of them prints its parent's help instead, on stdout or stderr.
    for (const argv of [
      ["resource", "bind", "--help"],
      ["resource", "unbind", "--help"],
      ["resource", "json", "create", "--help"],
      ["resource", "help", "bind"],
      ["resource", "help", "unbind"],
      ["resource", "json", "help", "create"],
      ["help", "resource", "bind"],
    ]) {
      await help(argv);
    }
  });

  it("report a rejected token for events and watch as for the other commands", async () => {
    const server = await serve(temporaryDirectory("television-resource-token-"));
    const home = temporaryDirectory("television-resource-token-client-");
    writeHomeConfig(home, { port: 0 });
    mkdirSync(path.join(home, "state"));
    writeFileSync(path.join(home, "state", "token"), "wrong-token\n");
    const unauthorized = `Television server at http://localhost:${server.port} rejected the request as unauthorized. Check the token in ${path.join(home, "state", "token")}.`;
    for (const args of [["resource", "list"], ["resource", "events"], ["resource", "json", "watch", "--artifact", "01JBPAGE00000000000000000A"]]) {
      const result = await context.runBuilt(["--home", home, ...args, "--port", String(server.port)]);
      expect(result.exitCode, args.join(" ")).toBe(1);
      expect(result.stdout, args.join(" ")).toBe("");
      expect(result.stderr, args.join(" ")).toContain(unauthorized);
    }
  });
});

describe("JSON store commands at the shell", () => {
  it("read, write and watch an artifact's store by artifact and resource ID, and refuse bad values, wrong options and missing stores", async () => {
    const server = await serve(temporaryDirectory("television-json-walk-"));
    const valueFile = path.join(temporaryDirectory("television-json-walk-value-"), "value.json");
    writeFileSync(valueFile, '{"from":"file"}');
    const artifactID = await createArtifact(server, "Tasks");
    const byArtifact = ["--artifact", artifactID];

    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":false}\n'));
    const watch = server.start(["resource", "json", "watch", ...byArtifact, "items"]);
    // The store keeps keys in the order they were added, so values are compared parsed.
    const watched: unknown[] = [{ exists: false }];
    const watchLines = () => lines(watch.stdout());
    const watchValues = () => watchLines().map((line) => JSON.parse(line) as unknown);
    await vi.waitFor(() => expect(watchValues()).toEqual(watched), { timeout: PROCESS_TIMEOUT_MS });

    const updated = ok(`JSON store of artifact ${artifactID} updated.\n`);
    expect(await server.tv(["resource", "json", "set", ...byArtifact, '{"items":{"a":1}}'])).toEqual(updated);
    watched.push({ exists: true, value: { a: 1 } });
    await vi.waitFor(() => expect(watchValues()).toEqual(watched), { timeout: PROCESS_TIMEOUT_MS });
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":true,"value":{"items":{"a":1}}}\n'));
    expect(await server.tv(["resource", "json", "get", ...byArtifact, "/"])).toEqual(ok('{"exists":true,"value":{"items":{"a":1}}}\n'));
    expect(await server.tv(["resource", "json", "get", ...byArtifact, "items/a"])).toEqual(ok('{"exists":true,"value":1}\n'));
    expect(await server.tv(["resource", "json", "get", ...byArtifact, "items/zz"])).toEqual(ok('{"exists":false}\n'));

    const fromFile = { from: "file" };
    const fromStdin = { from: "stdin" };
    const changes: Array<[string[], Record<string, unknown>, string | undefined]> = [
      [["set", ...byArtifact, "items/b", "2"], { a: 1, b: 2 }, undefined],
      [["set", ...byArtifact, "items/f", "--file", valueFile], { a: 1, b: 2, f: fromFile }, undefined],
      [["set", ...byArtifact, "items/s", "--file", "-"], { a: 1, b: 2, f: fromFile, s: fromStdin }, JSON.stringify(fromStdin)],
      [["update", ...byArtifact, "items", '{"a":null,"c":3}'], { a: null, b: 2, f: fromFile, s: fromStdin, c: 3 }, undefined],
      [["remove", ...byArtifact, "items/a"], { b: 2, f: fromFile, s: fromStdin, c: 3 }, undefined],
    ];
    for (const [args, value, input] of changes) {
      expect(await server.tv(["resource", "json", ...args], input), args.join(" ")).toEqual(updated);
      expect(parse(await server.tv(["resource", "json", "get", ...byArtifact, "items"]))).toEqual({ exists: true, value });
      watched.push({ exists: true, value });
      await vi.waitFor(() => expect(watchValues()).toEqual(watched), { timeout: PROCESS_TIMEOUT_MS });
    }
    const pushed = parse(await server.tv(["resource", "json", "push", ...byArtifact, "items", '"new"'])) as { key: string };
    expect(Object.keys(pushed)).toEqual(["key"]);
    expect(parse(await server.tv(["resource", "json", "get", ...byArtifact, `items/${pushed.key}`]))).toEqual({ exists: true, value: "new" });
    await vi.waitFor(() => expect(watchLines().at(-1)).toContain(`"${pushed.key}":"new"`), { timeout: PROCESS_TIMEOUT_MS });

    // The same store by its resource ID, from the artifact's record.
    const resourceID = await storeOf(server, artifactID);
    const byResource = ["--resource", resourceID];
    expect(await server.tv(["resource", "json", "get", ...byResource, "items/b"])).toEqual(ok('{"exists":true,"value":2}\n'));
    expect(await server.tv(["resource", "json", "set", ...byResource, "items/b", "20"])).toEqual(ok(`JSON store ${resourceID} updated.\n`));
    await vi.waitFor(() => expect(watchLines().at(-1)).toContain('"b":20'), { timeout: PROCESS_TIMEOUT_MS });

    // After a burst of writes from other commands ends, watch's last line is what get returns.
    const burst = await Promise.all(Array.from({ length: 6 }, (_, index) => server.tv(["resource", "json", "set", ...byArtifact, `items/n${index % 3}`, String(index)])));
    for (const result of burst) expect(result).toEqual(updated);
    const settled = await server.tv(["resource", "json", "get", ...byArtifact, "items"]);
    expect(settled.exitCode).toBe(0);
    await vi.waitFor(() => expect(`${watchLines().at(-1)}\n`).toBe(settled.stdout), { timeout: PROCESS_TIMEOUT_MS });
    expect(await server.tv(["resource", "json", "set", ...byArtifact, '{"whole":true}'])).toEqual(updated);
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":true,"value":{"whole":true}}\n'));
    await vi.waitFor(() => expect(watchLines().at(-1)).toBe('{"exists":false}'), { timeout: PROCESS_TIMEOUT_MS });
    expect(await watch.interrupt()).toBe(0);

    // Refusals change nothing.
    const notJSON = await server.tv(["resource", "json", "set", ...byArtifact, "whole", "{oops"]);
    expectRefused(notJSON, "not JSON", "not JSON");
    expectRefused(await server.tv(["resource", "json", "set", ...byArtifact, "whole", "false", "--file", valueFile]), "value and --file", "--file");
    for (const options of [[], [...byArtifact, ...byResource], ["--name", "todos"], ["--resource-id", resourceID]]) {
      const result = await server.tv(["resource", "json", "set", ...options, "whole", "false"]);
      expectRefused(result, options.join(" ") || "no store option");
      expect(result.stderr).toContain("Television ships bundled skills.");
    }
    expect(await server.tv(["resource", "json", "get", ...byArtifact])).toEqual(ok('{"exists":true,"value":{"whole":true}}\n'));
    const missing = "01JBNOSUCHARTIFACT00000000";
    expectRefused(await server.tv(["resource", "json", "get", "--artifact", missing]), "a missing artifact", `Artifact not found: ${missing}`);
    const linkChannel = await createChannel(server, "Elsewhere");
    const link = await server.tv(["create-url-artifact", "--channel", linkChannel, "--title", "Elsewhere", "--url", "https://example.com/", "--no-focus"]);
    const linkID = /URL artifact (\S+) created\./.exec(link.stdout)![1]!;
    const noStore = await server.tv(["resource", "json", "get", "--artifact", linkID]);
    expectRefused(noStore, "a URL artifact", "only artifacts this server serves from its own files");
    expect(noStore.stderr, "no kind of file named").not.toMatch(/HTML|Markdown/);
    const missingStore = "01JBNOSUCHSTORE00000000000";
    expectRefused(await server.tv(["resource", "json", "get", "--resource", missingStore]), "a missing store", `Resource not found: ${missingStore}`);
  });

  it("print a value near the size limit whole through piped standard output", async () => {
    const server = await serve(temporaryDirectory("television-json-large-"));
    const artifactID = await createArtifact(server, "Large");
    const value = "x".repeat(1_000_000);
    expect(await server.tv(["resource", "json", "set", "--artifact", artifactID, "--file", "-"], JSON.stringify(value))).toEqual(
      ok(`JSON store of artifact ${artifactID} updated.\n`),
    );
    const read = await server.tv(["resource", "json", "get", "--artifact", artifactID]);
    const expected = `${JSON.stringify({ exists: true, value })}\n`;
    expect(read.exitCode, read.stderr).toBe(0);
    // Lengths, not the strings, so a failure does not print a megabyte.
    expect(read.stdout.length).toBe(expected.length);
    expect(read.stdout === expected).toBe(true);
  });

  it("report an artifact's store whose stored data cannot be read as unavailable, leave its file alone, and keep the other working", async () => {
    const home = temporaryDirectory("television-json-unavailable-");
    const first = await serve(home);
    const broken = await createArtifact(first, "Broken");
    const healthy = await createArtifact(first, "Healthy");
    await first.tv(["resource", "json", "set", "--artifact", broken, '{"a":1}']);
    await first.tv(["resource", "json", "set", "--artifact", healthy, '{"b":1}']);
    const brokenFile = path.join(home, "resources", "json", await storeOf(first, broken), "content.json");
    await first.stop();
    writeFileSync(brokenFile, "not json {");
    const bytes = readFileSync(brokenFile);

    const second = await serve(home);
    for (const args of [["resource", "json", "get", "--artifact", broken], ["resource", "json", "set", "--artifact", broken, "a", "2"]]) {
      expectRefused(await second.tv(args), args.join(" "), "unavailable");
    }
    expect(await second.tv(["resource", "json", "set", "--artifact", healthy, "b", "2"])).toEqual(ok(`JSON store of artifact ${healthy} updated.\n`));
    expect(await second.tv(["resource", "json", "get", "--artifact", healthy])).toEqual(ok('{"exists":true,"value":{"b":2}}\n'));
    expect(readFileSync(brokenFile).equals(bytes)).toBe(true);
    await second.stop();

    const third = await serve(home);
    expectRefused(await third.tv(["resource", "json", "get", "--artifact", broken]), "after another restart", "unavailable");
    expect(readFileSync(brokenFile).equals(bytes)).toBe(true);
  });
});
