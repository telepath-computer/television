import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { runCLI } from "../../packages/cli/src/index.ts";
import { Server } from "../../packages/server/src/server.ts";
import type { ServerStore } from "@telepath-computer/television-server";
import type { ResourceEvent } from "@telepath-computer/television-shared/resources";
import { createServingStore } from "../helpers/serving-store.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

/*
 * The share commands' and the `tv resource` commands' actions against a
 * really-running in-process server, through the shared client's real HTTP and
 * WebSocket transports: [[arch/resources/index.md#^rs-arch-t-cli-seam]] and
 * [[arch/resources/json-store.md#^js-arch-t-cli-seam]]. Commands receive the
 * server's home and port; injected output writers replace the process
 * streams. The bindings hook turns the flag on in both the CLI environment
 * and the server where a test names it.
 */

const TOKENLESS_BIND_WARNING =
  "WARNING: this Television server runs without an auth token, so any client that can reach it can change resource bindings.";

class BufferOutput {
  chunks: string[] = [];
  write(chunk: string | Uint8Array): void { this.chunks.push(String(chunk)); }
  toString(): string { return this.chunks.join(""); }
  lines(): string[] { return this.toString().split("\n").filter(Boolean); }
}

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** A long-running command (`events`, `watch`) with its output so far, ended by its SIGINT handler. */
interface Running {
  stdout: BufferOutput;
  stderr: BufferOutput;
  interrupt(): void;
  done: Promise<number>;
}

interface ServerOptions {
  /** The bindings hook, on in both the server and the CLI environment. */
  resourceBindings?: boolean;
  auth?: boolean;
}

interface TestServer {
  server: Server;
  store: ServerStore;
  /** Resolves once the server has one more `/events` client than when it was called. */
  eventsSubscribed(): Promise<void>;
  home: string;
  port: number;
  /** Runs `tv --home <home> <argv> --port <port>` in process. */
  tv(argv: string[]): Promise<Result>;
  /** Starts a long-running command and waits until it has registered its signal handlers. */
  start(argv: string[]): Promise<Running>;
  /** Registers an HTML file as a path artifact, which has its own store, and returns its ID. */
  htmlArtifact(title: string): string;
}

const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

interface RunOptions {
  resourceBindings?: boolean;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
  stdout?: BufferOutput;
  stderr?: BufferOutput;
}

/** Runs the CLI in process with `home`, passing `port`, and with signal handlers kept rather than installed on the process. */
function runCLIInProcess(home: string, port: number, argv: string[], options: RunOptions = {}): Promise<number> {
  return runCLI(["--home", home, ...argv, "--port", String(port)], {
    stdout: options.stdout ?? new BufferOutput(),
    stderr: options.stderr ?? new BufferOutput(),
    onSignal: options.onSignal ?? (() => undefined),
    ...(options.resourceBindings === undefined ? {} : { resourceBindings: options.resourceBindings }),
  });
}

async function runInProcess(home: string, port: number, argv: string[], options: RunOptions = {}): Promise<Result> {
  const stdout = new BufferOutput();
  const stderr = new BufferOutput();
  const exitCode = await runCLIInProcess(home, port, argv, { ...options, stdout, stderr });
  return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

// The server binds port 0; its home's config file sets port 0, so commands pass the bound port.
async function startServer(options: ServerOptions = {}): Promise<TestServer> {
  const home = temporaryDirectory("television-resource-cli-seam-");
  writeHomeConfig(home, { port: 0 });
  const store = createServingStore(home);
  const server = new Server({
    store,
    host: "127.0.0.1",
    port: 0,
    auth: options.auth ?? true,
    ...(options.resourceBindings === undefined ? {} : { resourceBindings: options.resourceBindings }),
  });
  // The server sends a client every resource event emitted once it counts it, after the stream's first message.
  const eventClients = () => (server as unknown as { events: { getConnectedClientCount(): number } }).events.getConnectedClientCount();
  servers.push(server);
  await server.start();
  const port = Number.parseInt(new URL(server.getBaseURL()).port, 10);
  const cli: RunOptions = options.resourceBindings === undefined ? {} : { resourceBindings: options.resourceBindings };
  const channelID = store.listChannels()[0]!.id;
  return {
    server,
    store,
    eventsSubscribed: async () => {
      const before = eventClients();
      await vi.waitFor(() => expect(eventClients()).toBeGreaterThan(before));
    },
    home,
    port,
    tv: (argv) => runInProcess(home, port, argv, cli),
    start: async (argv) => {
      const stdout = new BufferOutput();
      const stderr = new BufferOutput();
      const handlers = new Map<NodeJS.Signals, () => void>();
      const onSignal = (signal: NodeJS.Signals, handler: () => void) => { handlers.set(signal, handler); };
      const done = runCLIInProcess(home, port, argv, { ...cli, stdout, stderr, onSignal });
      await vi.waitFor(() => expect(handlers.has("SIGINT")).toBe(true));
      return { stdout, stderr, interrupt: () => handlers.get("SIGINT")!(), done };
    },
    htmlArtifact: (title) => {
      const file = path.join(temporaryDirectory("television-resource-cli-page-"), "index.html");
      writeFileSync(file, `<!doctype html><title>${title}</title><h1>${title}</h1>`);
      return store.createArtifact({ kind: "path", title, channelID, path: file }).id;
    },
  };
}

/** The resource ID an artifact's record points to, once its store has been written. */
function ownStoreOf(store: ServerStore, artifactID: string): string {
  const artifact = store.getArtifact(artifactID);
  const resourceID = artifact?.kind === "path" ? artifact.store : undefined;
  expect(resourceID, `the store of ${artifactID}`).toBeDefined();
  return resourceID!;
}

/** A loopback port where nothing listens. */
async function unusedPort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const { port } = listener.address() as net.AddressInfo;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

function ok(stdout: string): Result {
  return { exitCode: 0, stdout, stderr: "" };
}

/** The resource ID a `json create` printed, after checking that its output is exactly that. */
function createdID(result: Result): string {
  expect(result.exitCode, result.stderr).toBe(0);
  const { resourceID } = JSON.parse(result.stdout) as { resourceID: string };
  expect(result).toEqual(ok(`${JSON.stringify({ resourceID })}\n`));
  return resourceID;
}

/** A home whose config file sets port 0 and whose token file holds a token no server has. */
function wrongTokenHome(): string {
  const home = temporaryDirectory("television-resource-cli-wrong-token-");
  writeHomeConfig(home, { port: 0 });
  mkdirSync(path.join(home, "state"));
  writeFileSync(path.join(home, "state", "token"), "wrong-token\n");
  return home;
}

/** Expects `results` to fail as a rejected token does, each with the same output as `reference`. */
function expectUnauthorized(home: string, port: number, reference: Result, results: Result[]): void {
  expect(reference.exitCode).toBe(1);
  expect(reference.stdout).toBe("");
  expect(reference.stderr.startsWith(
    `Television server at http://localhost:${port} rejected the request as unauthorized. Check the token in ${path.join(home, "state", "token")}.\n`,
  )).toBe(true);
  for (const result of results) {
    expect(result.stderr).toBe(reference.stderr);
    expect(result).toEqual(reference);
  }
}

/** An event as `[event, resourceID]`, with the artifact for a binding's events. */
function eventKey(line: string): string[] {
  expect(line).toBe(JSON.stringify(JSON.parse(line)));
  const event = JSON.parse(line) as ResourceEvent;
  switch (event.event) {
    case "created":
    case "updated":
      return [event.event, event.resource.resourceID];
    case "bound":
    case "unbound":
      return [event.event, event.resourceID, event.artifactID];
    case "changed":
    case "destroyed":
      return [event.event, event.resourceID];
  }
}

describe("the share commands against a running server", () => {
  it("share-artifact reaches the administrative routes, sharing at read without --access and refusing a read-write link then, and prints a link whose address the server serves as the artifact, and unshare-artifact revokes it", async () => {
    const { store, tv, port, htmlArtifact } = await startServer();
    const artifactID = htmlArtifact("Shared page");

    const shared = await tv(["share-artifact", "--id", artifactID]);
    expect(shared.exitCode, shared.stderr).toBe(0);
    expect(shared.stderr).toBe("");
    const link = /^http:\/\/127\.0\.0\.1:(\d+)\/artifact\/([^/]+)\/\n$/.exec(shared.stdout);
    expect(link, shared.stdout).not.toBeNull();
    expect(link![1]).toBe(String(port));
    const record = store.getArtifact(artifactID);
    expect(record?.kind === "path" ? record.share : undefined).toEqual({ id: link![2], access: "read" });
    const served = await fetch(shared.stdout.trim());
    expect(served.status).toBe(200);
    expect(await served.text()).toContain("<h1>Shared page</h1>");

    // Once the link is read-write, leaving out --access fails with the server's refusal and changes nothing.
    expect(await tv(["share-artifact", "--id", artifactID, "--access", "read-write"])).toEqual(ok(shared.stdout));
    const refused = await tv(["share-artifact", "--id", artifactID]);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain(`Artifact ${artifactID} already has a read-write share link.`);
    expect(refused.stderr).toMatch(/--access read-write\b/);
    expect(refused.stderr).toMatch(/--access read\b(?!-)/);
    const after = store.getArtifact(artifactID);
    expect(after?.kind === "path" ? after.share : undefined).toEqual({ id: link![2], access: "read-write" });

    expect(await tv(["unshare-artifact", "--id", artifactID])).toEqual(ok(`Artifact ${artifactID} is no longer shared.\n`));
    expect((await fetch(shared.stdout.trim())).status).toBe(404);
  });
});

describe("created stores and bindings against a running server", () => {
  it("with the flag on, take two created stores and an artifact's own store through their bindings, descriptions and destruction, with events printing each change in order", async () => {
    const { store, tv, start, eventsSubscribed, htmlArtifact } = await startServer({ resourceBindings: true });
    const channelID = store.listChannels()[0]!.id;
    const a = htmlArtifact("A");
    const b = htmlArtifact("B");
    expect(await tv(["resource", "json", "set", "--artifact", b, '{"b":1}'])).toEqual(ok(`JSON store of artifact ${b} updated.\n`));
    const bOwn = ownStoreOf(store, b);

    // The server writes a token to the home, so every command, and the event stream, carries it.
    const subscribed = eventsSubscribed();
    const events = await start(["resource", "events"]);
    await subscribed;
    const tasks = createdID(await tv(["resource", "json", "create", "--description", "Tasks", '{"a":1}']));
    const notesUsage = "Content: {text: string}.\nReplace text with set.";
    const notes = createdID(await tv(["resource", "json", "create", "--description", "Notes", "--usage", notesUsage]));
    // The stream's other messages, such as an artifact's creation, print nothing.
    store.createArtifact({ kind: "url", title: "Unrelated", channelID, url: "https://example.com/" });

    expect(await tv(["resource", "bind", tasks, a, "--access", "read-write"])).toEqual(ok(`Artifact ${a} bound to resource ${tasks} with read-write access.\n`));
    expect(await tv(["resource", "bind", bOwn, a, "--access", "read"])).toEqual(ok(`Artifact ${a} bound to resource ${bOwn} with read access.\n`));

    const forArtifact = await tv(["resource", "list", "--artifact", a]);
    expect(forArtifact.stdout).toBe(`${JSON.stringify({ resources: store.resources.list({ artifactID: a }) })}\n`);
    expect((JSON.parse(forArtifact.stdout) as { resources: Array<{ resourceID: string; access: string }> }).resources.map(({ resourceID, access }) => [resourceID, access])).toEqual(
      [[tasks, "read-write"], [bOwn, "read"]].sort(([left], [right]) => (left! < right! ? -1 : 1)),
    );
    const listed = await tv(["resource", "list"]);
    expect(listed.stdout).toBe(`${JSON.stringify({ resources: store.resources.list({}) })}\n`);
    expect(JSON.parse(listed.stdout).resources.find((resource: { resourceID: string }) => resource.resourceID === notes)).toMatchObject({ description: "Notes", usage: notesUsage });

    expect(await tv(["resource", "describe", tasks, "Open tasks"])).toEqual(ok(`Resource ${tasks} description updated.\n`));
    const stepsUsage = "Content: {text: string}.\nAppend with update.";
    expect(await tv(["resource", "describe", notes, "--usage", stepsUsage])).toEqual(ok(`Resource ${notes} usage updated.\n`));
    const tasksUsage = "Content: {a: number}.\nCount with increment.";
    expect(await tv(["resource", "describe", tasks, "Tasks for the launch", "--usage", tasksUsage])).toEqual(ok(`Resource ${tasks} description and usage updated.\n`));
    const info = await tv(["resource", "info", tasks]);
    expect(info.stdout).toBe(`${JSON.stringify({ resource: store.resources.info(tasks) })}\n`);
    expect(JSON.parse(info.stdout).resource).toMatchObject({
      resourceID: tasks,
      description: "Tasks for the launch",
      usage: tasksUsage,
      bindings: [{ artifactID: a, access: "read-write" }],
    });
    expect(JSON.parse((await tv(["resource", "info", notes])).stdout).resource).toMatchObject({ description: "Notes", usage: stepsUsage, bindings: [] });

    expect(await tv(["resource", "unbind", bOwn, a])).toEqual(ok(`Artifact ${a} unbound from resource ${bOwn}.\n`));
    expect(await tv(["resource", "json", "set", "--resource", tasks, "a", "2"])).toEqual(ok(`JSON store ${tasks} updated.\n`));

    const refused = await tv(["resource", "destroy", tasks]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain(`${a} (read-write)`);
    expect(refused.stderr).toContain("--force");
    expect(await tv(["resource", "json", "get", "--resource", tasks])).toEqual(ok('{"exists":true,"value":{"a":2}}\n'));
    expect(await tv(["resource", "destroy", tasks, "--force"])).toEqual(ok(`Resource ${tasks} destroyed; removed bindings for ${a}.\n`));

    // Deleting an artifact removes its bindings.
    expect(await tv(["resource", "bind", bOwn, a, "--access", "read"])).toEqual(ok(`Artifact ${a} bound to resource ${bOwn} with read access.\n`));
    expect((await tv(["delete-artifact", "--id", a])).exitCode).toBe(0);
    expect(JSON.parse((await tv(["resource", "info", bOwn])).stdout).resource.bindings).toEqual([{ artifactID: b, access: "read-write" }]);

    // An artifact is always bound to its own store.
    for (const argv of [["resource", "bind", bOwn, b, "--access", "read"], ["resource", "unbind", bOwn, b]]) {
      const owner = await tv(argv);
      expect(owner.exitCode, argv.join(" ")).toBe(1);
      expect(owner.stdout, argv.join(" ")).toBe("");
      expect(owner.stderr, argv.join(" ")).toContain("always bound to its own store");
    }

    const missing = "01JBNOSUCHSTORE00000000000";
    const unknown = await tv(["resource", "info", missing]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr.startsWith(`Resource not found: ${missing}\n`)).toBe(true);
    const before = store.resources.list({});
    const undescribed = await tv(["resource", "json", "create", '{"a":1}']);
    expect(undescribed.exitCode).toBe(1);
    expect(undescribed.stderr).toContain("--description");
    const empty = await tv(["resource", "json", "create", "--description", "", '{"a":1}']);
    expect(empty.exitCode).toBe(1);
    expect(empty.stdout).toBe("");
    expect(store.resources.list({})).toEqual(before);

    const expected = [
      ["created", tasks],
      ["created", notes],
      ["bound", tasks, a],
      ["bound", bOwn, a],
      ["updated", tasks],
      ["updated", notes],
      ["updated", tasks],
      ["unbound", bOwn, a],
      ["changed", tasks],
      ["destroyed", tasks],
      ["bound", bOwn, a],
      ["unbound", bOwn, a],
    ];
    await vi.waitFor(() => expect(events.stdout.lines().map(eventKey)).toEqual(expected));
    const changed = events.stdout.lines().map((line) => JSON.parse(line) as ResourceEvent).filter((event) => event.event === "changed");
    expect(changed).toEqual([{ event: "changed", resourceID: tasks, paths: ["a"] }]);
    events.interrupt();
    expect(await events.done).toBe(0);
    expect(events.stderr.toString()).toBe("");
  });

  it("with the flag on, bind on a tokenless server succeeds and writes exactly the product's warning to stderr", async () => {
    const { tv, htmlArtifact } = await startServer({ resourceBindings: true, auth: false });
    const artifactID = htmlArtifact("Page");
    const tasks = createdID(await tv(["resource", "json", "create", "--description", "Tasks"]));
    expect(await tv(["resource", "bind", tasks, artifactID, "--access", "read"])).toEqual({
      exitCode: 0,
      stdout: `Artifact ${artifactID} bound to resource ${tasks} with read access.\n`,
      stderr: `${TOKENLESS_BIND_WARNING}\n`,
    });
  });

  it("events fails like an unreachable server when the server ends its connection", async () => {
    const { server, port, start, eventsSubscribed } = await startServer();
    const subscribed = eventsSubscribed();
    const events = await start(["resource", "events"]);
    await subscribed;
    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
    expect(await events.done).toBe(1);
    expect(events.stderr.toString()).toMatch(new RegExp(`^Could not reach Television server at http://localhost:${port}: `));
  });

  it("events reports a rejected token as the other commands do", async () => {
    const { port } = await startServer();
    const home = wrongTokenHome();
    const listed = await runInProcess(home, port, ["resource", "list"]);
    expectUnauthorized(home, port, listed, [await runInProcess(home, port, ["resource", "events"])]);
  });
});

describe("the JSON store commands against a running server", () => {
  it("reach an artifact's store by --artifact and by --resource, and each change appears in the next get and on a running watch", async () => {
    const { store, tv, start, htmlArtifact } = await startServer();
    const artifactID = htmlArtifact("Tasks");
    expect(await tv(["resource", "json", "get", "--artifact", artifactID])).toEqual(ok('{"exists":false}\n'));
    expect(await tv(["resource", "json", "set", "--artifact", artifactID, '{"items":{"a":1},"other":0}'])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    const resourceID = ownStoreOf(store, artifactID);
    const byArtifact = ["--artifact", artifactID];
    const byResource = ["--resource", resourceID];
    const updated = (address: string[]) => ok(address === byArtifact ? `JSON store of artifact ${artifactID} updated.\n` : `JSON store ${resourceID} updated.\n`);

    const watch = await start(["resource", "json", "watch", ...byArtifact, "items"]);
    const watched: string[] = ['{"exists":true,"value":{"a":1}}'];
    await vi.waitFor(() => expect(watch.stdout.lines()).toEqual(watched));
    // A write elsewhere in the store prints nothing; the next change at its path prints its line after the first.
    expect(await tv(["resource", "json", "set", ...byResource, "other", "1"])).toEqual(updated(byResource));

    const steps: Array<[string[], string[], string]> = [
      [byArtifact, ["set", "items/b", "2"], '{"a":1,"b":2}'],
      [byResource, ["update", "items", '{"a":3,"c/d":4}'], '{"a":3,"b":2,"c":{"d":4}}'],
      [byArtifact, ["remove", "items/c"], '{"a":3,"b":2}'],
    ];
    for (const [address, [verb, ...args], value] of steps) {
      expect(await tv(["resource", "json", verb!, ...address, ...args]), `${verb} ${address[0]}`).toEqual(updated(address));
      for (const reader of [byArtifact, byResource]) {
        expect(await tv(["resource", "json", "get", ...reader, "items"])).toEqual(ok(`{"exists":true,"value":${value}}\n`));
      }
      watched.push(`{"exists":true,"value":${value}}`);
      await vi.waitFor(() => expect(watch.stdout.lines()).toEqual(watched));
    }
    const pushed = await tv(["resource", "json", "push", ...byResource, "items", '"pushed"']);
    expect(pushed.exitCode).toBe(0);
    const { key } = JSON.parse(pushed.stdout) as { key: string };
    expect(pushed.stdout).toBe(`${JSON.stringify({ key })}\n`);
    expect(await tv(["resource", "json", "get", ...byArtifact, `items/${key}`])).toEqual(ok('{"exists":true,"value":"pushed"}\n'));
    await vi.waitFor(() => expect(watch.stdout.lines().at(-1)).toBe(`{"exists":true,"value":{"a":3,"b":2,"${key}":"pushed"}}`));

    // After a burst of writes at its path ends, its last line is what get returns.
    await Promise.all(Array.from({ length: 8 }, (_, index) => tv(["resource", "json", "set", ...(index % 2 === 0 ? byArtifact : byResource), `items/n${index % 3}`, String(index)])));
    const settled = await tv(["resource", "json", "get", ...byArtifact, "items"]);
    await vi.waitFor(() => expect(`${watch.stdout.lines().at(-1)}\n`).toBe(settled.stdout));

    expect(await tv(["resource", "json", "set", ...byArtifact, "[1]"])).toEqual(updated(byArtifact));
    await vi.waitFor(() => expect(watch.stdout.lines().at(-1)).toBe('{"exists":false}'));
    expect(await tv(["resource", "json", "get", ...byResource, "/"])).toEqual(ok('{"exists":true,"value":[1]}\n'));
    watch.interrupt();
    expect(await watch.done).toBe(0);
    expect(watch.stderr.toString()).toBe("");
  });

  it("with the flag on, create makes a store that the same commands reach by --resource, a running watch included", async () => {
    const { tv, start } = await startServer({ resourceBindings: true });
    const resourceID = createdID(await tv(["resource", "json", "create", "--description", "Counts", '{"n":{"a":1}}']));
    const byResource = ["--resource", resourceID];
    const watch = await start(["resource", "json", "watch", ...byResource, "n"]);
    await vi.waitFor(() => expect(watch.stdout.lines()).toEqual(['{"exists":true,"value":{"a":1}}']));
    expect(await tv(["resource", "json", "set", ...byResource, "n/b", "2"])).toEqual(ok(`JSON store ${resourceID} updated.\n`));
    expect(await tv(["resource", "json", "update", ...byResource, "n", '{"c":3}'])).toEqual(ok(`JSON store ${resourceID} updated.\n`));
    expect(await tv(["resource", "json", "remove", ...byResource, "n/a"])).toEqual(ok(`JSON store ${resourceID} updated.\n`));
    const { key } = JSON.parse((await tv(["resource", "json", "push", ...byResource, "n", "4"])).stdout) as { key: string };
    const value = `{"b":2,"c":3,"${key}":4}`;
    expect(await tv(["resource", "json", "get", ...byResource, "n"])).toEqual(ok(`{"exists":true,"value":${value}}\n`));
    await vi.waitFor(() => expect(watch.stdout.lines().at(-1)).toBe(`{"exists":true,"value":${value}}`));
    watch.interrupt();
    expect(await watch.done).toBe(0);
  });

  it("watch reports a rejected token as the other commands do", async () => {
    const { port, tv, htmlArtifact } = await startServer();
    const artifactID = htmlArtifact("Tasks");
    await tv(["resource", "json", "set", "--artifact", artifactID, '{"a":1}']);
    const home = wrongTokenHome();
    const read = await runInProcess(home, port, ["resource", "json", "get", "--artifact", artifactID]);
    expectUnauthorized(home, port, read, [await runInProcess(home, port, ["resource", "json", "watch", "--artifact", artifactID])]);
  });

  it("refuses a number beyond the finite range, at the top of a value or nested in it, with invalid-value, and changes nothing", async () => {
    const { tv, store, htmlArtifact } = await startServer({ resourceBindings: true });
    const artifactID = htmlArtifact("Tasks");
    await tv(["resource", "json", "set", "--artifact", artifactID, '{"a":1}']);
    const resources = store.resources.list({});
    // JSON text can write a number too large for a double, which parses as an infinity.
    const address = ["--artifact", artifactID];
    const refused: string[][] = [
      ["resource", "json", "create", "--description", "Large", "1e400"],
      ["resource", "json", "create", "--description", "Nested", '{"a":[-1e400]}'],
      ["resource", "json", "set", ...address, "a", "1e400"],
      ["resource", "json", "set", ...address, '{"b":{"c":-1e400}}'],
      ["resource", "json", "update", ...address, '{"a":2,"b":{"c":1e400}}'],
      ["resource", "json", "push", ...address, "list", "[1e400]"],
    ];
    const results: string[] = [];
    for (const argv of refused) {
      const result = await tv(argv);
      results.push(`${argv.join(" ")} -> ${result.exitCode} ${JSON.stringify(result.stdout)} ${JSON.stringify(result.stderr.split("\n")[0])}`);
    }
    expect(results).toEqual(refused.map((argv) => `${argv.join(" ")} -> 1 "" "A stored number must be finite."`));
    expect(await tv(["resource", "json", "get", ...address])).toEqual(ok('{"exists":true,"value":{"a":1}}\n'));
    expect(store.resources.list({})).toEqual(resources);
  });

  it("stores a command-line value with a .sv key as written", async () => {
    const { tv, htmlArtifact } = await startServer();
    const artifactID = htmlArtifact("Tasks");
    const written = { stamp: { ".sv": "timestamp" }, count: { ".sv": { increment: 1 } } };
    expect(await tv(["resource", "json", "set", "--artifact", artifactID, "a", JSON.stringify(written)])).toEqual(ok(`JSON store of artifact ${artifactID} updated.\n`));
    expect(await tv(["resource", "json", "get", "--artifact", artifactID, "a"])).toEqual(ok(`${JSON.stringify({ exists: true, value: written })}\n`));
  });

  it("refuses a set over the message limit with too-large without sending it, even where nothing listens", async () => {
    const home = temporaryDirectory("television-resource-cli-seam-");
    writeHomeConfig(home, { port: 0 });
    const valueFile = path.join(home, "large.json");
    writeFileSync(valueFile, JSON.stringify("x".repeat(17 * 1024 * 1024)));
    const result = await runInProcess(home, await unusedPort(), ["resource", "json", "set", "--artifact", "01JBPAGE00000000000000000A", "--file", valueFile]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith("A write is at most 16777216 bytes as sent.\n")).toBe(true);
  });

  it("events and watch fail like an unreachable server where nothing listens", async () => {
    const home = temporaryDirectory("television-resource-cli-seam-");
    writeHomeConfig(home, { port: 0 });
    const port = await unusedPort();
    for (const argv of [["resource", "events"], ["resource", "json", "watch", "--artifact", "01JBPAGE00000000000000000A"]]) {
      expect(await runInProcess(home, port, argv), argv.join(" ")).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `Could not reach Television server at http://localhost:${port}: Could not open the event stream.\n`,
      });
    }
  });
});
