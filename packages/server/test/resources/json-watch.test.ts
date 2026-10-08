import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { RequestError, TelevisionClient } from "@telepath-computer/television-shared";
import { type JSONValue, type JsonReadResult, type ResourceEvent, type StoreAddress } from "@telepath-computer/television-shared/resources";

/*
 * The shared client's `watch` over its real HTTP and WebSocket transports,
 * against a scripted server that plays the `/events` stream and the JSON
 * store's `get` route, records each `get` it answers, and holds each answer
 * until the test releases it. The script forfeits the real server's emission
 * and timing, which the CLI seam crosses. Proves
 * [[arch/resources/json-store.md#^js-arch-t-watch]].
 */

interface HeldGet {
  /** The store address the read carried, as its query parameters. */
  store: Record<string, string>;
  path: string;
  respond(status: number, body: unknown): void;
}

/** How long a test waits to see that something does not happen. */
const QUIET_MS = 150;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await sleep(5);
  }
}

class ScriptedServer {
  readonly gets: HeldGet[] = [];
  readonly streams: WebSocket[] = [];
  private answered = 0;
  private readonly http: http.Server;
  private readonly sockets = new WebSocketServer({ noServer: true });

  private constructor() {
    this.http = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://scripted");
      if (request.method !== "GET" || url.pathname !== "/api/resources/v1/json/value") {
        response.writeHead(404).end();
        return;
      }
      const store = Object.fromEntries([...url.searchParams].filter(([key]) => key !== "path"));
      this.gets.push({
        store,
        path: url.searchParams.get("path") ?? "",
        respond: (status, body) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body)),
      });
    });
    this.http.on("upgrade", (request, socket, head) => {
      if (new URL(request.url ?? "/", "http://scripted").pathname !== "/events") {
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (ws) => this.streams.push(ws));
    });
  }

  static async start(): Promise<ScriptedServer> {
    const server = new ScriptedServer();
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    return server;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`;
  }

  /** Waits for the client's stream, then sends it the stream's first message. */
  async open(): Promise<WebSocket> {
    await until(() => this.streams.length > 0);
    const stream = this.streams.at(-1)!;
    stream.send(JSON.stringify({ type: "server-status", version: "0.0.0" }));
    return stream;
  }

  send(message: unknown): void {
    for (const stream of this.streams) stream.send(JSON.stringify(message));
  }

  event(event: ResourceEvent): void {
    this.send({ type: "resource-event", event });
  }

  changed(store: { resourceID: string; artifactID?: string }, paths: string[]): void {
    this.event({ event: "changed", ...store, paths });
  }

  /** Answers the oldest held `get` with a value or its absence. */
  answer(result: JsonReadResult): void {
    this.respond(200, result);
  }

  respond(status: number, body: unknown): void {
    const held = this.gets[this.answered];
    if (held === undefined) throw new Error("no get is held");
    this.answered++;
    held.respond(status, body);
  }

  get held(): number {
    return this.gets.length - this.answered;
  }

  async close(): Promise<void> {
    for (const stream of this.streams) stream.terminate();
    this.sockets.close();
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }
}

const servers: ScriptedServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function scripted(): Promise<ScriptedServer> {
  const server = await ScriptedServer.start();
  servers.push(server);
  return server;
}

const TODOS = "01JTODOSTODOSTODOSTODOSTOD";
const OTHER = "01JOTHERSTOREOTHERSTOREOTH";
const ARTIFACT = "01JARTIFACTARTIFACTARTIFAC";

function startWatch(server: ScriptedServer, path: string, store: StoreAddress = { resourceID: TODOS }) {
  const values: JsonReadResult[] = [];
  const controller = new AbortController();
  const client = new TelevisionClient(server.url, { token: "token" });
  const watching = client.resources.json.watch({ store, path, onValue: (result) => values.push(result), signal: controller.signal });
  const outcome = watching.then(() => null, (error: unknown) => error);
  return { values, stop: () => controller.abort(), watching, outcome, client };
}

const value = (json: JSONValue): JsonReadResult => ({ exists: true, value: json });

// spec: proofs/arch/resources/json-store.md#^js-arch-t-watch
describe("watch over the event stream", () => {
  it("reads only after the stream's first message, then once for each change that can affect its path, one read at a time", async () => {
    const server = await scripted();
    const watch = startWatch(server, "items/a");
    await until(() => server.streams.length > 0);
    await sleep(QUIET_MS);
    expect(server.gets).toEqual([]);

    await server.open();
    await until(() => server.gets.length === 1);
    expect(server.gets.map(({ store, path }) => ({ store, path }))).toEqual([{ store: { resourceID: TODOS }, path: "items/a" }]);
    server.answer(value({ done: false }));
    await until(() => watch.values.length === 1);
    expect(watch.values).toEqual([value({ done: false })]);

    // Another store, or paths that neither equal, contain nor lie within the watched path.
    server.changed({ resourceID: OTHER }, ["items/a"]);
    server.changed({ resourceID: TODOS }, ["items/b", "items/ab", "item", "x/items/a"]);
    await sleep(QUIET_MS);
    expect(server.gets).toHaveLength(1);

    for (const paths of [["items/a"], ["items"], [""], ["items/a/done"], ["x", "items/a/done/deep"]]) {
      const before = server.gets.length;
      server.changed({ resourceID: TODOS }, paths);
      await until(() => server.gets.length === before + 1);
      server.answer(value({ done: false }));
      await sleep(QUIET_MS);
      expect(server.gets, JSON.stringify(paths)).toHaveLength(before + 1);
    }
    // Every read found the value equal to the last one passed.
    expect(watch.values).toEqual([value({ done: false })]);

    watch.stop();
    expect(await watch.outcome).toBeNull();
  });

  it("reads once more after a held read, however many changes arrived during it, and passes only results that differ", async () => {
    const server = await scripted();
    const watch = startWatch(server, "");
    await server.open();
    await until(() => server.gets.length === 1);
    server.answer(value({ b: 1, a: [1, { c: 2 }] }));
    await until(() => watch.values.length === 1);

    server.changed({ resourceID: TODOS }, ["a"]);
    await until(() => server.gets.length === 2);
    server.changed({ resourceID: TODOS }, ["b"]);
    server.changed({ resourceID: TODOS }, ["c"]);
    server.changed({ resourceID: TODOS }, [""]);
    await sleep(QUIET_MS);
    expect(server.gets).toHaveLength(2);
    // The same value with its keys in another order passes nothing.
    server.answer(value({ a: [1, { c: 2 }], b: 1 }));
    await until(() => server.gets.length === 3);
    await sleep(QUIET_MS);
    expect(server.gets).toHaveLength(3);
    expect(watch.values).toEqual([value({ b: 1, a: [1, { c: 2 }] })]);

    server.answer({ exists: false });
    await until(() => watch.values.length === 2);
    await sleep(QUIET_MS);
    expect(server.gets).toHaveLength(3);
    expect(watch.values).toEqual([value({ b: 1, a: [1, { c: 2 }] }), { exists: false }]);

    // The stream's other messages and other stores' events change nothing.
    server.send({ type: "channel-created", channel: { id: "c", name: "C" } });
    server.send({ type: "server-status", version: "0.0.0" });
    server.event({ event: "destroyed", resourceID: OTHER });
    server.event({ event: "updated", resource: { resourceID: TODOS, type: "json", description: "Todos", usage: "", status: "available", createdAt: "2026-03-01T10:00:00.000Z" } });
    server.event({ event: "unbound", resourceID: TODOS, artifactID: "a" });
    await sleep(QUIET_MS);
    expect(server.held).toBe(0);
    expect(server.gets).toHaveLength(3);

    watch.stop();
    expect(await watch.outcome).toBeNull();
  });

  it("recognizes its store by the address it was given, following an artifact's store across a write whose resource ID it never knew", async () => {
    const server = await scripted();
    const byArtifact = startWatch(server, "a", { artifactID: ARTIFACT });
    const byResource = startWatch(server, "a", { resourceID: TODOS });
    await until(() => server.streams.length === 2);
    for (const stream of server.streams) stream.send(JSON.stringify({ type: "server-status", version: "0.0.0" }));
    await until(() => server.gets.length === 2);
    expect(server.gets.map((get) => get.store).sort((left, right) => (Object.keys(left)[0]! < Object.keys(right)[0]! ? -1 : 1))).toEqual([
      { artifact: ARTIFACT },
      { resourceID: TODOS },
    ]);
    server.answer({ exists: false });
    server.answer({ exists: false });
    await until(() => byArtifact.values.length === 1 && byResource.values.length === 1);

    const reads = () => server.gets.map((get) => get.store);
    // The artifact's first write: an event naming the artifact and a resource ID the watch never knew.
    server.changed({ resourceID: OTHER, artifactID: ARTIFACT }, ["a"]);
    await until(() => server.gets.length === 3);
    expect(reads()[2]).toEqual({ artifact: ARTIFACT });
    server.answer(value(1));
    await until(() => byArtifact.values.length === 2);
    expect(byArtifact.values).toEqual([{ exists: false }, value(1)]);

    // The resource ID alone, without the artifact, is another store to the artifact's watch.
    server.changed({ resourceID: TODOS }, ["a"]);
    await until(() => server.gets.length === 4);
    expect(reads()[3]).toEqual({ resourceID: TODOS });
    server.answer(value(2));
    server.changed({ resourceID: OTHER }, ["a"]);
    server.changed({ resourceID: "01JNOBODYNOBODYNOBODYNOBOD", artifactID: "01JANOTHERARTIFACTANOTHERA" }, ["a"]);
    await sleep(QUIET_MS);
    expect(server.gets).toHaveLength(4);
    expect(byResource.values).toEqual([{ exists: false }, value(2)]);
    byArtifact.stop();
    byResource.stop();
  });

  it("ends a watch by resource ID with not-found when its store is destroyed", async () => {
    const server = await scripted();
    const watch = startWatch(server, "");
    await server.open();
    await until(() => server.gets.length === 1);
    server.answer(value({}));
    await until(() => watch.values.length === 1);
    server.event({ event: "destroyed", resourceID: TODOS, artifactID: ARTIFACT });
    expect(await watch.outcome).toMatchObject({ code: "not-found", message: `Resource not found: ${TODOS}` });
  });

  it("reads a watch by artifact again when the artifact's store is destroyed, passing that it has no value", async () => {
    const server = await scripted();
    const watch = startWatch(server, "", { artifactID: ARTIFACT });
    await server.open();
    await until(() => server.gets.length === 1);
    server.answer(value({ a: 1 }));
    await until(() => watch.values.length === 1);
    server.event({ event: "destroyed", resourceID: OTHER });
    await sleep(QUIET_MS);
    expect(server.gets).toHaveLength(1);
    server.event({ event: "destroyed", resourceID: TODOS, artifactID: ARTIFACT });
    await until(() => server.gets.length === 2);
    server.answer({ exists: false });
    await until(() => watch.values.length === 2);
    expect(watch.values).toEqual([value({ a: 1 }), { exists: false }]);
    watch.stop();
    expect(await watch.outcome).toBeNull();
  });

  it("ends with a read's refusal", async () => {
    const server = await scripted();
    const watch = startWatch(server, "");
    await server.open();
    await until(() => server.gets.length === 1);
    server.respond(404, { error: `Resource not found: ${TODOS}`, code: "not-found" });
    const error = await watch.outcome;
    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ status: 404, message: `Resource not found: ${TODOS}`, serverURL: server.url });
    expect(watch.values).toEqual([]);
  });

  it("ends with the error of an HTTP 401 when the stream closes with 4401", async () => {
    const server = await scripted();
    const watch = startWatch(server, "");
    await until(() => server.streams.length > 0);
    server.streams[0]!.close(4401, "Authentication failed");
    const error = await watch.outcome;

    const read = watch.client.resources.json.get({ store: { resourceID: TODOS }, path: "" });
    await until(() => server.gets.length === 1);
    server.respond(401, { error: "Unauthorized" });
    const unauthorized = await read.then(() => null, (failure: unknown) => failure);
    expect(unauthorized).toBeInstanceOf(RequestError);
    expect(error).toBeInstanceOf(RequestError);
    expect({ ...(error as RequestError), message: (error as Error).message }).toEqual({ ...(unauthorized as RequestError), message: (unauthorized as Error).message });
    expect(error).toMatchObject({ status: 401, serverURL: server.url });
  });
});
