import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { telemetryVersion, type BuiltTelemetryEvent, type TelemetryCaptureSink, type TelemetryEnv } from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const TEST_TELEMETRY_ENV: TelemetryEnv = {
  TV_TELEMETRY_TEST: "1",
};
const TEST_VERSION = telemetryVersion("0.1.170");
const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const HTTP_CREATED = 201;
const CLIENT_META_HEADER = "X-Television-Client-Meta";
const CLIENT_ID = "client-http-actions";
const SAFARI_MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

class RecordingTelemetrySink implements TelemetryCaptureSink {
  readonly events: BuiltTelemetryEvent[] = [];
  enqueue(event: BuiltTelemetryEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}

interface Harness {
  storagePath: string;
  targetPath: string;
  server: Server;
  store: ServerStore;
  sink: RecordingTelemetrySink;
}

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function clientMetaHeader(clientId = CLIENT_ID): Record<string, string> {
  return {
    [CLIENT_META_HEADER]: JSON.stringify({
      clientId,
      userAgent: SAFARI_MAC_UA,
      clientApp: "browser",
    }),
  };
}

describe("server telemetry session attachment", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0).reverse()) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
      rmSync(harness.targetPath, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<Harness> {
    const storagePath = tempDir("television-telemetry-session-attachment-");
    const targetPath = tempDir("television-telemetry-session-target-");
    const store = createServingStore(storagePath);
    const sink = new RecordingTelemetrySink();
    const server = new Server({
      store,
      host: LOOPBACK_HOST,
      port: EPHEMERAL_PORT,
      auth: false,
      telemetry: { env: TEST_TELEMETRY_ENV, sink, version: TEST_VERSION, launchMode: "cli" },
    });
    await server.start();
    sink.clear();
    const harness = { storagePath, targetPath, server, store, sink };
    harnesses.push(harness);
    return harness;
  }

  function createMarkdownPath(harness: Harness, name: string): string {
    const filePath = path.join(harness.targetPath, name);
    writeFileSync(filePath, "# private content\n", "utf8");
    return filePath;
  }

  it("stamps client-attributed HTTP mutation events with the client's current session id", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;

    await request(h.server.httpServer)
      .post("/artifacts")
      .set(clientMetaHeader())
      .send({ kind: "path", title: "Private One", channelID: channel.id, path: createMarkdownPath(h, "one.md") })
      .expect(HTTP_CREATED);
    await request(h.server.httpServer)
      .post("/artifacts")
      .set(clientMetaHeader())
      .send({ kind: "path", title: "Private Two", channelID: channel.id, path: createMarkdownPath(h, "two.md") })
      .expect(HTTP_CREATED);

    const [first, second] = h.sink.events.filter((event) => event.name === "artifact_created");
    expect(first?.properties.$session_id).toEqual(expect.any(String));
    expect(second?.properties.$session_id).toBe(first?.properties.$session_id);
  });

  it("leaves CLI/session-less HTTP mutation events without $session_id", async () => {
    const h = await setup();
    const channel = h.store.listChannels()[0]!;

    await request(h.server.httpServer)
      .post("/artifacts")
      .send({ kind: "path", title: "Private", channelID: channel.id, path: createMarkdownPath(h, "sessionless.md") })
      .expect(HTTP_CREATED);

    expect(h.sink.events[0]?.name).toBe("artifact_created");
    expect(h.sink.events[0]?.properties).not.toHaveProperty("$session_id");
  });
});
