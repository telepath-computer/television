import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { RequestError } from "@telepath-computer/television-shared";
import { resourceError, type ResourceEvent } from "@telepath-computer/television-shared/resources";
import { runCLI as runRawCLI, type CLIEnvironment } from "../src/index.ts";

// The share commands and the `tv resource` and `tv resource json` commands at
// the in-process dispatcher, ending at a fake client:
// [[arch/resources/index.md#^rs-arch-t-cli-contract]] and
// [[arch/resources/json-store.md#^js-arch-t-cli-contract]].

class BufferOutput {
  chunks: string[] = [];
  isTTY?: boolean;
  constructor(options: { isTTY?: boolean } = {}) {
    if (options.isTTY !== undefined) this.isTTY = options.isTTY;
  }
  write(chunk: string | Uint8Array): void { this.chunks.push(String(chunk)); }
  toString(): string { return this.chunks.join(""); }
}

const SKILL_POINTER = "Television ships bundled skills.";
const PORT = 43200;
const SERVER_URL = `http://localhost:${PORT}`;
const TOKENLESS_BIND_WARNING =
  "WARNING: this Television server runs without an auth token, so any client that can reach it can change resource bindings.";
const RESOURCE_ID = "01JBTASKS0000000000000000A";
const ARTIFACT_ID = "01JBPAGE00000000000000000A";
const SHARE_ID = "01JBSHARE0000000000000000A";
const SUMMARY = {
  resourceID: RESOURCE_ID,
  type: "json",
  description: "Tasks",
  usage: "",
  status: "available",
  createdAt: "2026-10-06T10:00:00.000Z",
} as const;

const temporaryDirectories: string[] = [];
afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** A home whose config file sets a fixed port, so commands construct a client for it. */
const home = (() => {
  const directory = temporaryDirectory("television-resource-cli-home-");
  writeFileSync(path.join(directory, "config.json"), JSON.stringify({ port: PORT }));
  return directory;
})();

type Fake = ReturnType<typeof vi.fn>;

interface FakeResources {
  share: Fake;
  unshare: Fake;
  list: Fake;
  info: Fake;
  describe: Fake;
  bind: Fake;
  unbind: Fake;
  destroy: Fake;
  events: Fake;
  json: { create: Fake; get: Fake; set: Fake; update: Fake; push: Fake; remove: Fake; watch: Fake };
}

function fakeResources(): FakeResources {
  return {
    share: vi.fn(async () => ({ shareID: SHARE_ID, access: "read", path: `/artifact/${SHARE_ID}/`, origins: [`http://127.0.0.1:${PORT}`] })),
    unshare: vi.fn(async () => undefined),
    list: vi.fn(async () => [SUMMARY]),
    info: vi.fn(async () => ({ ...SUMMARY, bindings: [{ artifactID: ARTIFACT_ID, access: "read" }] })),
    describe: vi.fn(async () => SUMMARY),
    bind: vi.fn(async () => ({ authRequired: true })),
    unbind: vi.fn(async () => undefined),
    destroy: vi.fn(async () => ({ removedBindings: [] })),
    events: vi.fn(async () => undefined),
    json: {
      create: vi.fn(async () => SUMMARY),
      get: vi.fn(async () => ({ exists: true, value: { a: 1 } })),
      set: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      push: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      watch: vi.fn(async () => undefined),
    },
  };
}

/** Every call the fake resources client received, as `method` or `json.method`. */
function calledMethods(resources: FakeResources): string[] {
  const top = Object.entries(resources).filter(([, value]) => typeof value === "function") as Array<[string, Fake]>;
  const json = Object.entries(resources.json).map(([name, fn]) => [`json.${name}`, fn] as [string, Fake]);
  return [...top, ...json].filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name);
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type Overrides = Omit<Partial<CLIEnvironment>, "stdout"> & { client?: Record<string, unknown>; stdout?: BufferOutput };

/** Runs `tv --home <home> <argv>` with the fake resources client and, when given, other client members. */
async function run(argv: string[], resources: FakeResources, overrides: Overrides = {}): Promise<Run & { createClient: Fake }> {
  const { client, stdout = new BufferOutput(), ...environment } = overrides;
  const stderr = new BufferOutput();
  const createClient = vi.fn(() => ({ resources, ...client }) as never);
  const operatingSystemHome = temporaryDirectory("television-resource-cli-os-home-");
  const exitCode = await runRawCLI(["--home", home, ...argv], {
    stdout,
    stderr,
    createClient,
    resolveHomeDir: () => operatingSystemHome,
    onSignal: vi.fn(),
    ...environment,
  });
  return { exitCode, stdout: stdout.toString(), stderr: stderr.toString(), createClient };
}

/** Runs with the bindings flag on, through the environment's hook. */
const flagOn: Overrides = { resourceBindings: true };

/** Expects a directive error that constructed no client and called nothing. */
function expectDirectiveError(result: Run & { createClient: Fake }, resources: FakeResources, label: string, mentions: string[] = []): void {
  expect(result.exitCode, label).toBe(1);
  expect(result.stdout, label).toBe("");
  expect(result.stderr, label).toContain(SKILL_POINTER);
  for (const text of mentions) expect(result.stderr, label).toContain(text);
  expect(result.createClient, label).not.toHaveBeenCalled();
  expect(calledMethods(resources), label).toEqual([]);
}

/** Lets `--file -` read `text` as standard input. */
function standardInput(text: string): void {
  vi.spyOn(process, "stdin", "get").mockReturnValue(Readable.from([text]) as unknown as typeof process.stdin);
}

/** Runs a long-running command until it has registered its signal handlers, then returns them with its completion. */
async function runUntilSignals(argv: string[], resources: FakeResources): Promise<{ handlers: Map<NodeJS.Signals, () => void>; done: Promise<Run> }> {
  const handlers = new Map<NodeJS.Signals, () => void>();
  const done = run(argv, resources, { onSignal: vi.fn((signal, handler) => { handlers.set(signal, handler); }) });
  await vi.waitFor(() => expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]));
  return { handlers, done };
}

/** A fake streaming call that resolves when its signal aborts, after `start` has run. */
function untilAborted(start: (input: Record<string, any>) => void) {
  return vi.fn((input: Record<string, any>) => new Promise<void>((resolve) => {
    start(input);
    input.signal.addEventListener("abort", () => resolve(), { once: true });
  }));
}

/** An OSC-8 terminal hyperlink to `url`, as `tv links` writes one. */
function hyperlink(url: string): string {
  return `\u001B]8;;${url}\u001B\\${url}\u001B]8;;\u001B\\`;
}

describe("the share commands", () => {
  it("share-artifact calls share with the artifact ID and level and nothing else, and prints each origin of the reply joined with its path, as hyperlinks exactly on a terminal", async () => {
    const health = vi.fn(async () => ({ status: "ok", version: "0.1.180", bindAddresses: ["0.0.0.0"], origins: [], port: PORT }));
    // Origins the CLI could not derive from anything but the reply, in the reply's order.
    const origins = [`http://192.168.1.20:${PORT}`, `http://127.0.0.1:${PORT}`, `http://100.64.0.7:${PORT}`];
    const links = origins.map((origin) => `${origin}/artifact/${SHARE_ID}/`);
    for (const [isTTY, lines] of [[false, links], [true, links.map(hyperlink)]] as const) {
      const resources = fakeResources();
      resources.share.mockResolvedValueOnce({ shareID: SHARE_ID, access: "read-write", path: `/artifact/${SHARE_ID}/`, origins });
      const result = await run(["share-artifact", "--id", ARTIFACT_ID, "--access", "read-write"], resources, { client: { health }, stdout: new BufferOutput({ isTTY }) });
      expect(result, `isTTY ${isTTY}`).toMatchObject({ exitCode: 0, stderr: "", stdout: lines.map((line) => `${line}\n`).join("") });
      expect(result.createClient).toHaveBeenCalledWith(SERVER_URL, undefined);
      expect(resources.share.mock.calls).toEqual([[{ artifactID: ARTIFACT_ID, access: "read-write" }]]);
      expect(calledMethods(resources)).toEqual(["share"]);
    }
    expect(health).not.toHaveBeenCalled();
  });

  it("share-artifact without --access calls share with the artifact ID alone, leaving the level to the server, and prints the link it answers with", async () => {
    const resources = fakeResources();
    resources.share.mockResolvedValueOnce({ shareID: SHARE_ID, access: "read", path: `/artifact/${SHARE_ID}/`, origins: [`http://127.0.0.1:${PORT}`] });
    expect(await run(["share-artifact", "--id", ARTIFACT_ID], resources)).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `http://127.0.0.1:${PORT}/artifact/${SHARE_ID}/\n`,
    });
    expect(resources.share.mock.calls).toEqual([[{ artifactID: ARTIFACT_ID }]]);
    expect(Object.keys(resources.share.mock.calls[0]![0] as object)).toEqual(["artifactID"]);
  });

  it("share-artifact with a level that is neither read nor read-write is a directive error that makes no call", async () => {
    const argv = ["share-artifact", "--id", ARTIFACT_ID, "--access", "write"];
    const resources = fakeResources();
    expectDirectiveError(await run(argv, resources), resources, argv.join(" "), ["--access"]);
  });

  it("unshare-artifact calls unshare with the artifact ID and prints the product's line", async () => {
    const resources = fakeResources();
    expect(await run(["unshare-artifact", "--id", ARTIFACT_ID], resources)).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `Artifact ${ARTIFACT_ID} is no longer shared.\n`,
    });
    expect(resources.unshare.mock.calls).toEqual([[{ artifactID: ARTIFACT_ID }]]);
    expect(calledMethods(resources)).toEqual(["unshare"]);
  });
});

describe("the common commands", () => {
  it("make the one call each command's name matches, passing the resource ID, and print the product's output", async () => {
    const cases: Array<[string[], string, unknown, string]> = [
      [["resource", "list"], "list", {}, `${JSON.stringify({ resources: [SUMMARY] })}\n`],
      [["resource", "list", "--artifact", ARTIFACT_ID], "list", { artifactID: ARTIFACT_ID }, `${JSON.stringify({ resources: [SUMMARY] })}\n`],
      [
        ["resource", "info", RESOURCE_ID],
        "info",
        { resourceID: RESOURCE_ID },
        `${JSON.stringify({ resource: { ...SUMMARY, bindings: [{ artifactID: ARTIFACT_ID, access: "read" }] } })}\n`,
      ],
      [["resource", "describe", RESOURCE_ID, "Open tasks"], "describe", { resourceID: RESOURCE_ID, description: "Open tasks" }, `Resource ${RESOURCE_ID} description updated.\n`],
      [
        ["resource", "describe", RESOURCE_ID, "--usage", "Content: {items}.\nMark done with set."],
        "describe",
        { resourceID: RESOURCE_ID, usage: "Content: {items}.\nMark done with set." },
        `Resource ${RESOURCE_ID} usage updated.\n`,
      ],
      [
        ["resource", "describe", RESOURCE_ID, "Open tasks", "--usage", "Two\nlines"],
        "describe",
        { resourceID: RESOURCE_ID, description: "Open tasks", usage: "Two\nlines" },
        `Resource ${RESOURCE_ID} description and usage updated.\n`,
      ],
      [["resource", "destroy", RESOURCE_ID], "destroy", { resourceID: RESOURCE_ID }, `Resource ${RESOURCE_ID} destroyed.\n`],
      [["resource", "destroy", RESOURCE_ID, "--force"], "destroy", { resourceID: RESOURCE_ID, force: true }, `Resource ${RESOURCE_ID} destroyed.\n`],
    ];
    for (const [argv, method, input, output] of cases) {
      const resources = fakeResources();
      const result = await run(argv, resources);
      expect(result, argv.join(" ")).toMatchObject({ exitCode: 0, stderr: "", stdout: output });
      expect(result.createClient).toHaveBeenCalledWith(SERVER_URL, undefined);
      expect(calledMethods(resources), argv.join(" ")).toEqual([method]);
      expect((resources as unknown as Record<string, Fake>)[method]!.mock.calls, argv.join(" ")).toEqual([[input]]);
    }

    const resources = fakeResources();
    resources.destroy.mockResolvedValueOnce({
      removedBindings: [
        { resourceID: RESOURCE_ID, artifactID: ARTIFACT_ID, access: "read-write" },
        { resourceID: RESOURCE_ID, artifactID: "01JBOTHER00000000000000000", access: "read" },
      ],
    });
    expect(await run(["resource", "destroy", RESOURCE_ID, "--force"], resources)).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `Resource ${RESOURCE_ID} destroyed; removed bindings for ${ARTIFACT_ID}, 01JBOTHER00000000000000000.\n`,
    });
  });

  it("describe with neither a description nor --usage is a directive error that makes no call", async () => {
    const resources = fakeResources();
    expectDirectiveError(await run(["resource", "describe", RESOURCE_ID], resources), resources, "describe", ["--usage"]);
  });

  it("print a refusal as other HTTP status errors are printed", async () => {
    const notFound = new RequestError(`Resource not found: ${RESOURCE_ID}`, { serverURL: SERVER_URL, status: 404 });
    const artifactRefusal = await run(["get-artifact", "--id", ARTIFACT_ID], fakeResources(), {
      client: { artifacts: { get: vi.fn(async () => { throw notFound; }) } },
    });
    expect(artifactRefusal.exitCode).toBe(1);
    expect(artifactRefusal.stderr.startsWith(`Resource not found: ${RESOURCE_ID}\n`)).toBe(true);
    expect(artifactRefusal.stderr).toContain(SKILL_POINTER);

    const resources = fakeResources();
    resources.info.mockRejectedValueOnce(notFound);
    expect(await run(["resource", "info", RESOURCE_ID], resources)).toMatchObject({ exitCode: 1, stdout: "", stderr: artifactRefusal.stderr });
    resources.share.mockRejectedValueOnce(notFound);
    expect(await run(["share-artifact", "--id", ARTIFACT_ID, "--access", "read"], resources)).toMatchObject({ exitCode: 1, stdout: "", stderr: artifactRefusal.stderr });
    // A refusal the shared client makes itself, before sending, prints the same way.
    const tooLarge = resourceError("too-large", "A write is at most 16777216 bytes as sent.");
    resources.json.set.mockRejectedValueOnce(tooLarge);
    expect(await run(["resource", "json", "set", "--artifact", ARTIFACT_ID, "1"], resources)).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: artifactRefusal.stderr.replace(`Resource not found: ${RESOURCE_ID}`, tooLarge.message),
    });
  });

  it("events prints each event as one compact JSON line and exits 0 on SIGINT and on SIGTERM", async () => {
    const events: ResourceEvent[] = [
      { event: "changed", resourceID: RESOURCE_ID, artifactID: ARTIFACT_ID, paths: ["items/a"] },
      { event: "updated", resource: SUMMARY },
      { event: "destroyed", resourceID: RESOURCE_ID, artifactID: ARTIFACT_ID },
    ];
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const resources = fakeResources();
      resources.events = untilAborted((input) => { for (const event of events) input.onEvent(event); });
      const { handlers, done } = await runUntilSignals(["resource", "events"], resources);
      handlers.get(signal)!();
      const result = await done;
      expect(result, signal).toMatchObject({ exitCode: 0, stderr: "", stdout: events.map((event) => `${JSON.stringify(event)}\n`).join("") });
      expect(resources.events).toHaveBeenCalledTimes(1);
    }
  });

  it("events fails like an unreachable server when its connection ends", async () => {
    const unreachable = new RequestError("fetch failed", { serverURL: SERVER_URL });
    const statusFailure = await run(["list-channels"], fakeResources(), {
      client: { channels: { list: vi.fn(async () => { throw unreachable; }) } },
    });
    expect(statusFailure.exitCode).toBe(1);
    expect(statusFailure.stderr).toBe(`Could not reach Television server at ${SERVER_URL}: fetch failed\n`);

    const resources = fakeResources();
    const destroyed: ResourceEvent = { event: "destroyed", resourceID: RESOURCE_ID };
    resources.events.mockImplementationOnce(async (input: { onEvent: (event: ResourceEvent) => void }) => {
      input.onEvent(destroyed);
      throw new RequestError("The event stream ended.", { serverURL: SERVER_URL });
    });
    expect(await run(["resource", "events"], resources)).toMatchObject({
      exitCode: 1,
      stdout: `${JSON.stringify(destroyed)}\n`,
      stderr: `Could not reach Television server at ${SERVER_URL}: The event stream ended.\n`,
    });
  });
});

/** The commands the bindings flag leaves out, with the arguments each would take. */
const FLAGGED_COMMANDS: string[][] = [
  ["resource", "bind", RESOURCE_ID, ARTIFACT_ID, "--access", "read"],
  ["resource", "unbind", RESOURCE_ID, ARTIFACT_ID],
  ["resource", "json", "create", "--description", "Tasks"],
];

/** The subcommand names the help a command line prints lists, from its Commands section. */
async function helpCommands(argv: string[], environment: Overrides = {}): Promise<string[]> {
  const result = await run(argv, fakeResources(), environment);
  expect(result.exitCode, argv.join(" ")).toBe(0);
  const section = result.stdout.split(/^Commands:\n/m)[1] ?? "";
  return section.split("\n").map((line) => /^ {2}(\S+)/.exec(line)?.[1]).filter((name): name is string => name !== undefined);
}

describe("the commands the flag leaves out", () => {
  it("with the flag off, bind, unbind and json create are unknown-command directive errors that make no call and appear in no help", async () => {
    for (const argv of FLAGGED_COMMANDS) {
      const resources = fakeResources();
      expectDirectiveError(await run(argv, resources), resources, argv.join(" "), ["Unknown tv command"]);
    }
    for (const argv of [["resource", "--help"], ["help", "resource"], ["resource", "help"]]) {
      expect(await helpCommands(argv), argv.join(" ")).toEqual(["list", "info", "describe", "destroy", "events", "json", "help"]);
    }
    for (const argv of [["resource", "json", "--help"], ["resource", "help", "json"], ["resource", "json", "help"]]) {
      expect(await helpCommands(argv), argv.join(" ")).toEqual(["get", "set", "update", "push", "remove", "watch", "help"]);
    }
    // Top-level help lists no subcommand of resource, and no text in it names binding.
    for (const argv of [["--help"], ["help"]]) {
      const topLevel = await run(argv, fakeResources());
      expect(topLevel.exitCode, argv.join(" ")).toBe(0);
      expect(topLevel.stdout, argv.join(" ")).not.toMatch(/\b(un)?bind\b/);
    }
  });
});

describe("binding", () => {
  it("with the flag on, bind and unbind pass the resource ID, the artifact ID and bind's level, print the product's lines, and appear in help with json create", async () => {
    const resources = fakeResources();
    expect(await run(["resource", "bind", RESOURCE_ID, ARTIFACT_ID, "--access", "read-write"], resources, flagOn)).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `Artifact ${ARTIFACT_ID} bound to resource ${RESOURCE_ID} with read-write access.\n`,
    });
    expect(await run(["resource", "unbind", RESOURCE_ID, ARTIFACT_ID], resources, flagOn)).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `Artifact ${ARTIFACT_ID} unbound from resource ${RESOURCE_ID}.\n`,
    });
    expect(resources.bind.mock.calls).toEqual([[{ resourceID: RESOURCE_ID, artifactID: ARTIFACT_ID, access: "read-write" }]]);
    expect(resources.unbind.mock.calls).toEqual([[{ resourceID: RESOURCE_ID, artifactID: ARTIFACT_ID }]]);
    expect(calledMethods(resources)).toEqual(["bind", "unbind"]);
    expect(await helpCommands(["resource", "--help"], flagOn)).toEqual(["list", "info", "describe", "destroy", "events", "bind", "unbind", "json", "help"]);
    expect(await helpCommands(["resource", "json", "--help"], flagOn)).toEqual(["create", "get", "set", "update", "push", "remove", "watch", "help"]);
  });

  it("with the flag on, bind writes the tokenless warning to stderr exactly when the result's authRequired is false", async () => {
    const resources = fakeResources();
    resources.bind.mockResolvedValueOnce({ authRequired: false });
    expect(await run(["resource", "bind", RESOURCE_ID, ARTIFACT_ID, "--access", "read"], resources, flagOn)).toMatchObject({
      exitCode: 0,
      stdout: `Artifact ${ARTIFACT_ID} bound to resource ${RESOURCE_ID} with read access.\n`,
      stderr: `${TOKENLESS_BIND_WARNING}\n`,
    });
    expect(await run(["resource", "bind", RESOURCE_ID, ARTIFACT_ID, "--access", "read"], resources, flagOn)).toMatchObject({ exitCode: 0, stderr: "" });
  });

  it("with the flag on, bind without --access is a directive error that makes no call", async () => {
    const resources = fakeResources();
    expectDirectiveError(await run(["resource", "bind", RESOURCE_ID, ARTIFACT_ID], resources, flagOn), resources, "bind", ["--access"]);
  });
});

/** The JSON verbs with the arguments each takes after its store options. */
const JSON_VERBS: Array<[string, string[]]> = [
  ["get", ["items"]],
  ["set", ["items", "1"]],
  ["update", ["items", '{"a":1}']],
  ["push", ["items", "1"]],
  ["remove", ["items"]],
  ["watch", ["items"]],
];

describe("the JSON store commands", () => {
  it("address a store with exactly one of --artifact and --resource, naming it so in their confirmation lines, and refuse neither, both, --name and --resource-id", async () => {
    const resources = fakeResources();
    resources.json.watch = untilAborted(() => undefined);
    for (const [verb, args] of JSON_VERBS) {
      for (const [option, id, store] of [["--artifact", ARTIFACT_ID, { artifactID: ARTIFACT_ID }], ["--resource", RESOURCE_ID, { resourceID: RESOURCE_ID }]] as const) {
        const argv = ["resource", "json", verb, option, id, ...args];
        if (verb === "watch") {
          const { handlers, done } = await runUntilSignals(argv, resources);
          handlers.get("SIGINT")!();
          expect((await done).exitCode, argv.join(" ")).toBe(0);
        } else {
          const result = await run(argv, resources);
          expect(result.exitCode, argv.join(" ")).toBe(0);
          if (verb === "set" || verb === "update" || verb === "remove") {
            expect(result.stdout, argv.join(" ")).toBe(option === "--artifact" ? `JSON store of artifact ${ARTIFACT_ID} updated.\n` : `JSON store ${RESOURCE_ID} updated.\n`);
          }
        }
        const calls = (resources.json as unknown as Record<string, Fake>)[verb]!.mock.calls;
        expect(calls.at(-1)![0].store, argv.join(" ")).toEqual(store);
      }
    }

    const refusedOptions: Array<[string[], string[]]> = [
      [[], ["--artifact", "--resource"]],
      [["--artifact", ARTIFACT_ID, "--resource", RESOURCE_ID], ["--artifact", "--resource"]],
      [["--name", "todos"], ["--name"]],
      [["--resource-id", RESOURCE_ID], ["--resource-id"]],
    ];
    for (const [verb, args] of JSON_VERBS) {
      for (const [options, mentions] of refusedOptions) {
        const refused = fakeResources();
        const argv = ["resource", "json", verb, ...options, ...args];
        expectDirectiveError(await run(argv, refused), refused, argv.join(" "), mentions);
      }
    }
  });

  it("take a value from its argument, from --file <path>, or from standard input with --file -, and refuse both", async () => {
    const valueFile = path.join(temporaryDirectory("television-resource-cli-value-"), "value.json");
    writeFileSync(valueFile, '{"from":"file"}');
    const resources = fakeResources();
    const store = { artifactID: ARTIFACT_ID };

    expect(await run(["resource", "json", "set", "--artifact", ARTIFACT_ID, "a", '{"from":"argument"}'], resources)).toMatchObject({ exitCode: 0 });
    expect(await run(["resource", "json", "set", "--artifact", ARTIFACT_ID, "a", "--file", valueFile], resources)).toMatchObject({ exitCode: 0 });
    standardInput('{"from":"stdin"}');
    expect(await run(["resource", "json", "set", "--artifact", ARTIFACT_ID, "a", "--file", "-"], resources)).toMatchObject({ exitCode: 0 });
    expect(resources.json.set.mock.calls).toEqual([
      [{ store, path: "a", value: { from: "argument" } }],
      [{ store, path: "a", value: { from: "file" } }],
      [{ store, path: "a", value: { from: "stdin" } }],
    ]);

    const both = [
      ["resource", "json", "set", "--artifact", ARTIFACT_ID, "a", "1", "--file", valueFile],
      ["resource", "json", "update", "--artifact", ARTIFACT_ID, "a", '{"b":1}', "--file", valueFile],
      ["resource", "json", "push", "--artifact", ARTIFACT_ID, "list", "1", "--file", valueFile],
    ];
    for (const argv of both) {
      const refused = fakeResources();
      expectDirectiveError(await run(argv, refused), refused, argv.join(" "), ["--file"]);
    }
  });

  it("refuse text that does not parse as JSON as a directive error and make no call", async () => {
    const badFile = path.join(temporaryDirectory("television-resource-cli-value-"), "bad.json");
    writeFileSync(badFile, "{not json");
    const cases = [
      ["resource", "json", "set", "--artifact", ARTIFACT_ID, "a", "{not json"],
      ["resource", "json", "set", "--resource", RESOURCE_ID, "--file", badFile],
      ["resource", "json", "update", "--artifact", ARTIFACT_ID, "{not json"],
      ["resource", "json", "push", "--resource", RESOURCE_ID, "list", "{not json"],
    ];
    for (const argv of cases) {
      const resources = fakeResources();
      expectDirectiveError(await run(argv, resources), resources, argv.join(" "), ["JSON"]);
    }
  });

  it("take set's and update's one argument after the store as the value for the whole value, and pass / and an omitted path as the root", async () => {
    const resources = fakeResources();
    const store = { resourceID: RESOURCE_ID };
    const address = ["--resource", RESOURCE_ID];
    for (const argv of [
      ["resource", "json", "set", ...address, "[1,2]"],
      ["resource", "json", "set", ...address, "/", "[1,2]"],
      ["resource", "json", "update", ...address, '{"a/b":1}'],
      ["resource", "json", "update", ...address, "/", '{"a/b":1}'],
      ["resource", "json", "update", ...address, "items", '{"a":null}'],
      ["resource", "json", "get", ...address],
      ["resource", "json", "get", ...address, "/"],
      ["resource", "json", "get", ...address, "items/a"],
      ["resource", "json", "remove", ...address, "items/a"],
    ]) {
      expect((await run(argv, resources)).exitCode, argv.join(" ")).toBe(0);
    }
    expect(resources.json.set.mock.calls).toEqual([
      [{ store, path: "", value: [1, 2] }],
      [{ store, path: "", value: [1, 2] }],
    ]);
    expect(resources.json.update.mock.calls).toEqual([
      [{ store, path: "", values: { "a/b": 1 } }],
      [{ store, path: "", values: { "a/b": 1 } }],
      [{ store, path: "items", values: { a: null } }],
    ]);
    expect(resources.json.get.mock.calls).toEqual([
      [{ store, path: "" }],
      [{ store, path: "" }],
      [{ store, path: "items/a" }],
    ]);
    expect(resources.json.remove.mock.calls).toEqual([[{ store, path: "items/a" }]]);
  });

  it("with the flag on, create passes its description, usage and value and prints the new store's resource ID, and without --description is a directive error that makes no call", async () => {
    const valueFile = path.join(temporaryDirectory("television-resource-cli-value-"), "value.json");
    writeFileSync(valueFile, '{"from":"file"}');
    const resources = fakeResources();
    const created = `${JSON.stringify({ resourceID: RESOURCE_ID })}\n`;
    expect(await run(["resource", "json", "create", "--description", "Tasks", "--file", valueFile], resources, flagOn)).toMatchObject({ exitCode: 0, stderr: "", stdout: created });
    expect(await run(["resource", "json", "create", "--description", "Empty"], resources, flagOn)).toMatchObject({ exitCode: 0, stdout: created });
    expect(
      await run(["resource", "json", "create", "{}", "--description", "Used", "--usage", "Content: {}.\nAdd keys with set."], resources, flagOn),
    ).toMatchObject({ exitCode: 0, stdout: created });
    standardInput('{"from":"stdin"}');
    expect(await run(["resource", "json", "create", "--description", "Piped", "--file", "-"], resources, flagOn)).toMatchObject({ exitCode: 0, stdout: created });
    expect(resources.json.create.mock.calls).toEqual([
      [{ description: "Tasks", value: { from: "file" } }],
      [{ description: "Empty" }],
      [{ description: "Used", usage: "Content: {}.\nAdd keys with set.", value: {} }],
      [{ description: "Piped", value: { from: "stdin" } }],
    ]);

    for (const [argv, mentions] of [
      [["resource", "json", "create"], ["--description"]],
      [["resource", "json", "create", '{"a":1}', "--usage", "Content."], ["--description"]],
      [["resource", "json", "create", "--description", "Tasks", "1", "--file", valueFile], ["--file"]],
      [["resource", "json", "create", "--description", "Tasks", "{not json"], ["JSON"]],
    ] as const) {
      const refused = fakeResources();
      expectDirectiveError(await run([...argv], refused, flagOn), refused, argv.join(" "), [...mentions]);
    }
  });

  it("push generates its key with the shared module, passes it to the client and prints it", async () => {
    const resources = fakeResources();
    const first = await run(["resource", "json", "push", "--artifact", ARTIFACT_ID, "list", '{"t":1}'], resources);
    const second = await run(["resource", "json", "push", "--artifact", ARTIFACT_ID, "list", '{"t":2}'], resources);
    const keys = [first, second].map((result) => (JSON.parse(result.stdout) as { key: string }).key);
    for (const [index, result] of [first, second].entries()) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${JSON.stringify({ key: keys[index] })}\n`);
    }
    // Push keys are 20 characters that sort in the order they were made.
    expect(keys[0]).toMatch(/^[-0-9A-Z_a-z]{20}$/);
    expect(keys[0]! < keys[1]!).toBe(true);
    const store = { artifactID: ARTIFACT_ID };
    expect(resources.json.push.mock.calls).toEqual([
      [{ store, path: "list", key: keys[0], value: { t: 1 } }],
      [{ store, path: "list", key: keys[1], value: { t: 2 } }],
    ]);
  });

  it("get and watch print the exists-or-not shape, and watch exits 0 on SIGINT and on SIGTERM", async () => {
    const resources = fakeResources();
    resources.json.get.mockResolvedValueOnce({ exists: true, value: null }).mockResolvedValueOnce({ exists: false });
    expect(await run(["resource", "json", "get", "--artifact", ARTIFACT_ID, "a"], resources)).toMatchObject({ exitCode: 0, stdout: '{"exists":true,"value":null}\n' });
    expect(await run(["resource", "json", "get", "--artifact", ARTIFACT_ID, "b"], resources)).toMatchObject({ exitCode: 0, stdout: '{"exists":false}\n' });

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const watching = fakeResources();
      watching.json.watch = untilAborted((input) => {
        input.onValue({ exists: true, value: { a: 1 } });
        input.onValue({ exists: false });
      });
      const { handlers, done } = await runUntilSignals(["resource", "json", "watch", "--artifact", ARTIFACT_ID, "/"], watching);
      handlers.get(signal)!();
      expect(await done, signal).toMatchObject({ exitCode: 0, stderr: "", stdout: '{"exists":true,"value":{"a":1}}\n{"exists":false}\n' });
      expect(watching.json.watch.mock.lastCall![0]).toMatchObject({ store: { artifactID: ARTIFACT_ID }, path: "" });
    }
  });

  it("watch fails like an unreachable server when its connection ends", async () => {
    const resources = fakeResources();
    resources.json.watch.mockImplementationOnce(async () => {
      throw new RequestError("The event stream ended.", { serverURL: SERVER_URL });
    });
    expect(await run(["resource", "json", "watch", "--resource", RESOURCE_ID], resources)).toMatchObject({
      exitCode: 1,
      stdout: "",
      stderr: `Could not reach Television server at ${SERVER_URL}: The event stream ended.\n`,
    });
  });
});
