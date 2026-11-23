import net from "node:net";

/** Which way traffic flows through the proxy. */
export type Direction = "to-server" | "to-browser";

/** What the proxy saw, in order: a message the browser sent on a WebSocket, or a release of held traffic. */
export type ProxyLogEntry =
  | { kind: "message"; connection: number; message: Record<string, unknown> }
  | { kind: "released"; direction: Direction };

/** One WebSocket frame, with its original bytes and decoded payload. */
interface Frame {
  readonly bytes: Buffer;
  readonly opcode: number;
  readonly fin: boolean;
  readonly payload: Buffer;
}

/** One whole message: its frames as sent, and a JSON object when it carries one. */
interface Message {
  readonly bytes: Buffer;
  readonly message: Record<string, unknown> | null;
}

interface FrameStream {
  bytes: Buffer;
  readonly fragments: Frame[];
}

interface Pipe {
  readonly number: number;
  readonly browser: net.Socket;
  readonly server: net.Socket;
  /** What the connection carries, once its first request has been read. */
  kind: "unknown" | "plain" | "websocket";
  /** A WebSocket's HTTP head as read so far in each direction; null once it has ended and frames follow. */
  readonly head: Record<Direction, Buffer | null>;
  readonly held: Record<Direction, Buffer[]>;
  /** The browser's write messages, held while writes are held. */
  readonly heldWrites: Message[];
  /** Server messages selected for delayed delivery on this connection. */
  readonly heldServerMessages: Message[];
  serverMessageHold: ((message: Record<string, unknown>) => boolean) | null;
  /** Unparsed frame bytes and incomplete messages, independently in each direction. */
  readonly streams: Record<Direction, FrameStream>;
  closed: boolean;
}

const HEAD_END = "\r\n\r\n";
const OPCODE_TEXT = 1;
/** Close, ping and pong: control frames, which may come between a message's fragments. */
const OPCODE_FIRST_CONTROL = 8;
const FIN_BIT = 0x80;
const MASK_BIT = 0x80;
const MASK_BYTES = 4;
const LENGTH_16 = 126;
const LENGTH_64 = 127;

/**
 * A test-controlled TCP proxy standing in for the network between a browser
 * and the server (proofs/arch/resources/sdk.md, Test hooks). It forwards
 * traffic unchanged, and lets a test sever open connections, refuse new ones,
 * or hold WebSocket traffic in either direction, only the page's writes, or
 * selected server messages on one connection until released. It reads the
 * browser's WebSocket messages so a test can see what the page sent.
 */
export class NetworkProxy {
  readonly log: ProxyLogEntry[] = [];
  /** Every WebSocket connection the browser attempted, accepted or refused, with the request's path and Host. */
  readonly webSocketAttempts: Array<{ path: string; host: string; refused: boolean }> = [];
  private readonly server: net.Server;
  private readonly pipes = new Set<Pipe>();
  private target: number;
  private refusing = false;
  private readonly holding: Record<Direction, boolean> = { "to-server": false, "to-browser": false };
  private holdingWrites = false;
  private nextNumber = 1;
  private readonly waiters = new Set<() => void>();

  private constructor(target: number) {
    this.target = target;
    this.server = net.createServer((browser) => this.accept(browser));
  }

  static async start(targetPort: number): Promise<NetworkProxy> {
    const proxy = new NetworkProxy(targetPort);
    await new Promise<void>((resolve) => proxy.server.listen(0, "127.0.0.1", resolve));
    return proxy;
  }

  get port(): number {
    return (this.server.address() as net.AddressInfo).port;
  }

  /** Messages the browser sent on WebSocket connections, oldest first. */
  get messages(): Array<{ connection: number; message: Record<string, unknown> }> {
    return this.log.flatMap((entry) => (entry.kind === "message" ? [{ connection: entry.connection, message: entry.message }] : []));
  }

  /** Open WebSocket connections. */
  get openWebSockets(): number {
    return [...this.pipes].filter((pipe) => pipe.kind === "websocket" && !pipe.closed).length;
  }

  /** Sends later connections to another server port. */
  retarget(port: number): void {
    this.target = port;
  }

  /** Refuses new WebSocket connections, closing each once its request arrives, or accepts them again. */
  refuse(refusing: boolean): void {
    this.refusing = refusing;
  }

  /** Cuts every open connection, dropping traffic it holds. */
  sever(): void {
    for (const pipe of this.pipes) this.cut(pipe);
  }

  /** Cuts one open WebSocket connection, dropping only the traffic it holds. */
  severConnection(connection: number): void {
    const pipe = [...this.pipes].find((pipe) => pipe.number === connection && pipe.kind === "websocket" && !pipe.closed);
    if (!pipe) throw new Error(`no open proxy connection ${connection}`);
    this.cut(pipe);
  }

  /** Holds WebSocket traffic in one direction, on open and later connections, until released. */
  hold(direction: Direction): void {
    this.holding[direction] = true;
  }

  /** Forwards held traffic in one direction and stops holding it. */
  release(direction: Direction): void {
    this.holding[direction] = false;
    this.log.push({ kind: "released", direction });
    for (const pipe of this.pipes) {
      const held = pipe.held[direction].splice(0);
      for (const chunk of held) this.forwardFrames(pipe, direction, chunk);
    }
  }

  /**
   * Holds the browser's write messages, on open and later connections, while
   * its other messages pass; held writes are forwarded on release, after any
   * message that passed meanwhile, and dropped with a severed connection.
   */
  holdWrites(): void {
    this.holdingWrites = true;
  }

  /** Forwards held write messages and stops holding them. */
  releaseWrites(): void {
    this.holdingWrites = false;
    for (const pipe of this.pipes) {
      for (const frame of pipe.heldWrites.splice(0)) this.forwardMessage(pipe, "to-server", frame);
    }
  }

  /** Write messages held now, across open connections. */
  get heldWriteCount(): number {
    return [...this.pipes].reduce((count, pipe) => count + pipe.heldWrites.length, 0);
  }

  /** Holds matching server messages on one open connection; later messages and control frames still pass. */
  holdServerMessages(connection: number, predicate: (message: Record<string, unknown>) => boolean): void {
    const pipe = [...this.pipes].find((pipe) => pipe.number === connection);
    if (!pipe) throw new Error(`no open proxy connection ${connection}`);
    pipe.serverMessageHold = predicate;
  }

  /** Releases selected messages unchanged, after anything that passed meanwhile, and removes the predicate. */
  releaseServerMessages(connection: number): void {
    const pipe = [...this.pipes].find((pipe) => pipe.number === connection);
    if (!pipe) return;
    pipe.serverMessageHold = null;
    for (const message of pipe.heldServerMessages.splice(0)) this.forwardMessage(pipe, "to-browser", message);
    this.notify();
  }

  /** Server messages held now on the selected connection; a closed connection holds none. */
  heldServerMessageCount(connection: number): number {
    return [...this.pipes].find((pipe) => pipe.number === connection)?.heldServerMessages.length ?? 0;
  }

  /** Resolves once `check` holds, checking after everything the proxy sees; rejects after `timeoutMs`. */
  waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
    if (check()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = () => {
        if (!check()) return;
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`the proxy did not see the expected traffic within ${timeoutMs}ms; log ${JSON.stringify(this.log)}`));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    this.sever();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter();
  }

  private accept(browser: net.Socket): void {
    const server = net.connect(this.target, "127.0.0.1");
    const pipe: Pipe = {
      number: this.nextNumber++,
      browser,
      server,
      kind: "unknown",
      head: { "to-server": Buffer.alloc(0), "to-browser": Buffer.alloc(0) },
      held: { "to-server": [], "to-browser": [] },
      heldWrites: [],
      heldServerMessages: [],
      serverMessageHold: null,
      streams: {
        "to-server": { bytes: Buffer.alloc(0), fragments: [] },
        "to-browser": { bytes: Buffer.alloc(0), fragments: [] },
      },
      closed: false,
    };
    this.pipes.add(pipe);
    browser.on("data", (chunk) => this.receive(pipe, "to-server", chunk));
    server.on("data", (chunk) => this.receive(pipe, "to-browser", chunk));
    for (const socket of [browser, server]) {
      socket.on("close", () => this.cut(pipe));
      socket.on("error", () => this.cut(pipe));
    }
  }

  private cut(pipe: Pipe): void {
    if (pipe.closed) return;
    pipe.closed = true;
    pipe.browser.destroy();
    pipe.server.destroy();
    pipe.heldWrites.length = 0;
    pipe.heldServerMessages.length = 0;
    pipe.serverMessageHold = null;
    for (const direction of ["to-server", "to-browser"] as const) {
      pipe.held[direction].length = 0;
      pipe.streams[direction].bytes = Buffer.alloc(0);
      pipe.streams[direction].fragments.length = 0;
    }
    this.pipes.delete(pipe);
    this.notify();
  }

  private receive(pipe: Pipe, direction: Direction, chunk: Buffer): void {
    if (pipe.kind === "plain") {
      this.forwardRaw(pipe, direction, chunk);
      return;
    }
    const head = pipe.head[direction];
    if (head === null) {
      this.frameData(pipe, direction, chunk);
      return;
    }
    // A WebSocket's HTTP head, each way, is read whole; frames follow it.
    const joined = Buffer.concat([head, chunk]);
    const end = joined.indexOf(HEAD_END);
    if (end < 0) {
      pipe.head[direction] = joined;
      return;
    }
    const headBytes = joined.subarray(0, end + HEAD_END.length);
    const rest = joined.subarray(end + HEAD_END.length);
    pipe.head[direction] = null;
    if (direction === "to-server" && pipe.kind === "unknown") {
      const text = headBytes.toString("latin1");
      if (!/^upgrade:\s*websocket\s*$/im.test(text)) {
        // Plain HTTP passes through untouched, request after request.
        pipe.kind = "plain";
        this.forwardRaw(pipe, direction, joined);
        return;
      }
      pipe.kind = "websocket";
      const path = text.split(" ")[1] ?? "";
      const host = /^host:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? "";
      this.webSocketAttempts.push({ path, host, refused: this.refusing });
      this.notify();
      if (this.refusing) {
        this.cut(pipe);
        return;
      }
    }
    this.forwardRaw(pipe, direction, headBytes);
    if (rest.length > 0) this.frameData(pipe, direction, rest);
  }

  private frameData(pipe: Pipe, direction: Direction, chunk: Buffer): void {
    if (this.holding[direction]) {
      pipe.held[direction].push(chunk);
      return;
    }
    this.forwardFrames(pipe, direction, chunk);
  }

  private forwardRaw(pipe: Pipe, direction: Direction, chunk: Buffer): void {
    if (pipe.closed || chunk.length === 0) return;
    (direction === "to-server" ? pipe.server : pipe.browser).write(chunk);
  }

  private forwardFrames(pipe: Pipe, direction: Direction, chunk: Buffer): void {
    if (pipe.closed) return;
    // Forward whole messages so one can be held independently. Control frames
    // pass immediately, including those between a message's fragments.
    const stream = pipe.streams[direction];
    stream.bytes = Buffer.concat([stream.bytes, chunk]);
    for (let frame = takeFrame(stream); frame !== null; frame = takeFrame(stream)) {
      if (frame.opcode >= OPCODE_FIRST_CONTROL) {
        this.forwardRaw(pipe, direction, frame.bytes);
        continue;
      }
      stream.fragments.push(frame);
      if (!frame.fin) continue;
      const parts = stream.fragments.splice(0);
      const text = parts[0]!.opcode === OPCODE_TEXT ? Buffer.concat(parts.map((part) => part.payload)).toString("utf8") : null;
      const message: Message = {
        bytes: Buffer.concat(parts.map((part) => part.bytes)),
        message: text === null ? null : jsonObject(text),
      };
      if (direction === "to-server" && this.holdingWrites && message.message?.type === "write") {
        pipe.heldWrites.push(message);
        this.notify();
      } else if (direction === "to-browser" && message.message !== null && pipe.serverMessageHold?.(message.message)) {
        pipe.heldServerMessages.push(message);
        this.notify();
      } else {
        this.forwardMessage(pipe, direction, message);
      }
    }
  }

  /** Forwards one whole message and records JSON objects the browser sends. */
  private forwardMessage(pipe: Pipe, direction: Direction, message: Message): void {
    if (pipe.closed) return;
    this.forwardRaw(pipe, direction, message.bytes);
    if (direction !== "to-server" || message.message === null) return;
    this.log.push({ kind: "message", connection: pipe.number, message: message.message });
    this.notify();
  }
}

/** The length of the first whole frame in `bytes`, or null while it is incomplete. */
function frameLength(bytes: Buffer): { header: number; payload: number } | null {
  if (bytes.length < 2) return null;
  let payload = bytes[1]! & 0x7f;
  let header = 2;
  if (payload === LENGTH_16) {
    if (bytes.length < header + 2) return null;
    payload = bytes.readUInt16BE(header);
    header += 2;
  } else if (payload === LENGTH_64) {
    if (bytes.length < header + 8) return null;
    payload = Number(bytes.readBigUInt64BE(header));
    header += 8;
  }
  if ((bytes[1]! & MASK_BIT) !== 0) header += MASK_BYTES;
  return bytes.length < header + payload ? null : { header, payload };
}

/** Takes the first whole frame from unparsed bytes, unmasking only masked payloads. */
function takeFrame(stream: FrameStream): Frame | null {
  const length = frameLength(stream.bytes);
  if (length === null) return null;
  const bytes = stream.bytes.subarray(0, length.header + length.payload);
  stream.bytes = stream.bytes.subarray(bytes.length);
  const payload = Buffer.from(bytes.subarray(length.header));
  if ((bytes[1]! & MASK_BIT) !== 0) {
    const mask = bytes.subarray(length.header - MASK_BYTES, length.header);
    for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % MASK_BYTES]!;
  }
  return { bytes, opcode: bytes[0]! & 0x0f, fin: (bytes[0]! & FIN_BIT) !== 0, payload };
}

/** Non-JSON text and binary messages pass through without invoking JSON predicates. */
function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
