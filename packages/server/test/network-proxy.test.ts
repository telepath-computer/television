// Real TCP peers send authored WebSocket bytes through the test proxy. These
// contracts prove its timing controls; SDK authorization and rollback remain
// covered by the real browser walks named in the Checklist proof.
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkProxy } from "./e2e/network-proxy.ts";

const REQUEST = "GET /resources HTTP/1.1\r\nHost: tv-sdk.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
const RESPONSE = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";

class Peer {
  readonly socket: net.Socket;
  bytes: Buffer = Buffer.alloc(0);

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => { this.bytes = Buffer.concat([this.bytes, chunk]); });
    socket.on("error", () => socket.destroy());
  }

  async received(bytes: Buffer): Promise<void> {
    await expect.poll(() => this.bytes.length).toBe(bytes.length);
    expect(this.bytes).toEqual(bytes);
  }
}

class Wire {
  readonly peers: Peer[] = [];
  readonly clients: Peer[] = [];
  readonly server = net.createServer((socket) => {
    const peer = new Peer(socket);
    this.peers.push(peer);
    const handshake = () => {
      if (!peer.bytes.includes("\r\n\r\n")) return;
      socket.off("data", handshake);
      socket.write(RESPONSE);
    };
    socket.on("data", handshake);
  });
  proxy!: NetworkProxy;

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.proxy = await NetworkProxy.start((this.server.address() as net.AddressInfo).port);
  }

  async connect(): Promise<{ browser: Peer; server: Peer; connection: number }> {
    const browser = new Peer(net.connect(this.proxy.port, "127.0.0.1"));
    this.clients.push(browser);
    browser.socket.write(REQUEST);
    await browser.received(Buffer.from(RESPONSE));
    const server = this.peers.at(-1)!;
    await server.received(Buffer.from(REQUEST));
    browser.bytes = Buffer.alloc(0);
    server.bytes = Buffer.alloc(0);
    const hello = frame(JSON.stringify({ type: "subscribe", id: this.clients.length }), { masked: true });
    browser.socket.write(hello);
    await this.proxy.waitFor(() => this.proxy.messages.length === this.clients.length);
    await server.received(hello);
    server.bytes = Buffer.alloc(0);
    return { browser, server, connection: this.proxy.messages.at(-1)!.connection };
  }

  async close(): Promise<void> {
    await this.proxy.close();
    for (const peer of [...this.peers, ...this.clients]) peer.socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** Authored protocol fixtures retain their own frame lengths and masking. */
function frame(text: string, { masked = false, opcode = 1, fin = true } = {}): Buffer {
  const payload = Buffer.from(text);
  const size = payload.length < 126 ? 0 : payload.length <= 0xffff ? 2 : 8;
  const header = Buffer.alloc(2 + size + (masked ? 4 : 0));
  header[0] = opcode | (fin ? 0x80 : 0);
  header[1] = (masked ? 0x80 : 0) | (size === 0 ? payload.length : size === 2 ? 126 : 127);
  if (size === 2) header.writeUInt16BE(payload.length, 2);
  if (size === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
  if (masked) {
    const mask = Buffer.from([0x1a, 0x2b, 0x3c, 0x4d]);
    mask.copy(header, header.length - 4);
    for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
  }
  return Buffer.concat([header, payload]);
}

describe("selective WebSocket server-message buffering", () => {
  let wire: Wire;
  afterEach(async () => { await wire?.close(); });

  async function start(): Promise<Wire> {
    wire = new Wire();
    await wire.start();
    return wire;
  }

  // spec: proofs/ui/templates/checklist/index.md#^checklist-ui-ac-save-failure
  it("holds matching messages only on the chosen connection and releases their original bytes after later refusals", async () => {
    const { proxy } = await start();
    const first = await wire.connect();
    const second = await wire.connect();
    const access = frame('{"type":"access","level":"read"}');
    const refusal = frame('{"type":"error","code":"permission-denied"}');
    const other = Buffer.concat([frame("plain text"), frame("binary", { opcode: 2 })]);
    proxy.holdServerMessages(first.connection, (message) => message.type === "access");
    first.server.socket.write(Buffer.concat([access, refusal, other]));
    second.server.socket.write(access);

    await proxy.waitFor(() => proxy.heldServerMessageCount(first.connection) === 1);
    await first.browser.received(Buffer.concat([refusal, other]));
    await second.browser.received(access);
    expect(proxy.heldServerMessageCount(second.connection)).toBe(0);

    proxy.releaseServerMessages(first.connection);
    await first.browser.received(Buffer.concat([refusal, other, access]));
    expect(proxy.heldServerMessageCount(first.connection)).toBe(0);
    first.server.socket.write(access);
    await first.browser.received(Buffer.concat([refusal, other, access, access]));
  });

  // spec: proofs/ui/templates/checklist/index.md#^checklist-ui-ac-save-failure
  it.each([12, 256, 66_000])("preserves unmasked fragmented messages with %i-byte payloads and interleaved control frames", async (length) => {
    const { proxy } = await start();
    const { browser, server, connection } = await wire.connect();
    proxy.holdServerMessages(connection, (message) => message.type === "access");
    const text = JSON.stringify({ type: "access", value: "x".repeat(length) });
    const first = frame(text.slice(0, -1), { fin: false });
    const last = frame(text.slice(-1), { opcode: 0 });
    const ping = frame("ping", { opcode: 9 });
    const refusal = frame('{"type":"error"}');

    // Split both the extended-length header and the payload across TCP writes.
    server.socket.write(first.subarray(0, 1));
    server.socket.write(first.subarray(1, 3));
    server.socket.write(first.subarray(3));
    server.socket.write(ping);
    await browser.received(ping);
    server.socket.write(Buffer.concat([last, refusal]));
    await proxy.waitFor(() => proxy.heldServerMessageCount(connection) === 1);
    await browser.received(Buffer.concat([ping, refusal]));
    proxy.releaseServerMessages(connection);
    await browser.received(Buffer.concat([ping, refusal, first, last]));
  });

  // spec: proofs/arch/resources/sdk.md#^sdk-t-reconnect
  // spec: proofs/ui/templates/checklist/index.md#^checklist-ui-ac-save-failure
  it("holds masked fragmented writes independently of server messages without losing messages or control frames", async () => {
    const { proxy } = await start();
    const { browser, server, connection } = await wire.connect();
    const write = JSON.stringify({ type: "write", value: "x".repeat(256) });
    const first = frame(write.slice(0, -1), { masked: true, fin: false });
    const last = frame(write.slice(-1), { masked: true, opcode: 0 });
    const ping = frame("ping", { masked: true, opcode: 9 });
    const get = frame('{"type":"get"}', { masked: true });
    proxy.holdWrites();
    browser.socket.write(Buffer.concat([first, ping]));
    await server.received(ping);

    const access = frame('{"type":"access"}');
    const refusal = frame('{"type":"error"}');
    proxy.holdServerMessages(connection, (message) => message.type === "access");
    server.socket.write(Buffer.concat([access, refusal]));
    await proxy.waitFor(() => proxy.heldServerMessageCount(connection) === 1);
    await browser.received(refusal);

    browser.socket.write(Buffer.concat([last, get]));
    await proxy.waitFor(() => proxy.heldWriteCount === 1);
    await server.received(Buffer.concat([ping, get]));
    proxy.releaseWrites();
    await server.received(Buffer.concat([ping, get, first, last]));
    expect(proxy.messages.slice(1).map(({ message }) => message.type)).toEqual(["get", "write"]);

    proxy.releaseServerMessages(connection);
    await browser.received(Buffer.concat([refusal, access]));
  });

  // spec: proofs/ui/templates/checklist/index.md#^checklist-ui-ac-save-failure
  // spec: proofs/arch/resources/sdk.md#^sdk-t-reconnect
  it("drops held server messages and partial frames on disconnect without carrying the hold into a new connection", async () => {
    const { proxy } = await start();
    const first = await wire.connect();
    const access = frame('{"type":"access"}');
    proxy.holdServerMessages(first.connection, (message) => message.type === "access");
    first.server.socket.write(Buffer.concat([access, frame('{"type":', { fin: false })]));
    await proxy.waitFor(() => proxy.heldServerMessageCount(first.connection) === 1);
    proxy.sever();
    await proxy.waitFor(() => proxy.openWebSockets === 0);
    await expect.poll(() => first.browser.socket.destroyed && first.server.socket.destroyed).toBe(true);
    expect(proxy.heldServerMessageCount(first.connection)).toBe(0);
    proxy.releaseServerMessages(first.connection);

    const second = await wire.connect();
    second.server.socket.write(access);
    await second.browser.received(access);
    expect(second.connection).not.toBe(first.connection);
  });
});
