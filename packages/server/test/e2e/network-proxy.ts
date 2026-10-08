import net from "node:net";

/** Which way traffic flows through the proxy. */
export type Direction = "to-server" | "to-browser";

/** What the proxy saw, in order: a message the browser sent on a WebSocket, or a release of held traffic. */
export type ProxyLogEntry =
  | { kind: "message"; connection: number; message: Record<string, unknown> }
  | { kind: "released"; direction: Direction };

/** One WebSocket frame of the browser's, as sent and unmasked. */
interface Frame {
  readonly bytes: Buffer;
  readonly opcode: number;
  readonly fin: boolean;
  readonly payload: Buffer;
}

/** One whole message of the browser's: its frames as sent, and the JSON it carries if it is text. */
interface BrowserMessage {
  readonly bytes: Buffer;
  readonly message: Record<string, unknown> | null;
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
  readonly heldWrites: BrowserMessage[];
  /** Unparsed bytes of the browser's WebSocket frames. */
  frames: Buffer;
  /** Frames of a message of the browser's whose last fragment has not arrived. */
  readonly fragments: Frame[];
  closed: boolean;
}

const HEAD_END = "\r\n\r\n";
const OPCODE_TEXT = 1;
/** Close, ping and pong: control frames, which may come between a message's fragments. */
const OPCODE_FIRST_CONTROL = 8;
const FIN_BIT = 0x80;
const MASK_BYTES = 4;
const LENGTH_16 = 126;
const LENGTH_64 = 127;

/**
 * A test-controlled TCP proxy standing in for the network between a browser
 * and the server (proofs/arch/resources/sdk.md, Test hooks). It forwards
 * traffic unchanged, and lets a test sever open connections, refuse new ones,
 * or hold WebSocket traffic in either direction, or only the page's write
 * messages, until released. It reads the browser's WebSocket messages so a
 * test can see what the page sent.
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
      for (const frame of pipe.heldWrites.splice(0)) this.forwardMessage(pipe, frame);
    }
  }

  /** Write messages held now, across open connections. */
  get heldWriteCount(): number {
    return [...this.pipes].reduce((count, pipe) => count + pipe.heldWrites.length, 0);
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
      frames: Buffer.alloc(0),
      fragments: [],
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
    if (direction === "to-browser") {
      this.forwardRaw(pipe, direction, chunk);
      return;
    }
    // The browser's messages are forwarded whole, each once its last fragment
    // has arrived, so a write message can be held on its own.
    pipe.frames = Buffer.concat([pipe.frames, chunk]);
    for (let frame = takeFrame(pipe); frame !== null; frame = takeFrame(pipe)) {
      if (frame.opcode >= OPCODE_FIRST_CONTROL) {
        this.forwardRaw(pipe, direction, frame.bytes);
        continue;
      }
      pipe.fragments.push(frame);
      if (!frame.fin) continue;
      const parts = pipe.fragments.splice(0);
      const text = parts[0]!.opcode === OPCODE_TEXT ? Buffer.concat(parts.map((part) => part.payload)).toString("utf8") : null;
      const message: BrowserMessage = {
        bytes: Buffer.concat(parts.map((part) => part.bytes)),
        message: text === null ? null : (JSON.parse(text) as Record<string, unknown>),
      };
      if (this.holdingWrites && message.message?.type === "write") {
        pipe.heldWrites.push(message);
        this.notify();
      } else {
        this.forwardMessage(pipe, message);
      }
    }
  }

  /** Forwards one whole message of the browser's and records it if it is text. */
  private forwardMessage(pipe: Pipe, message: BrowserMessage): void {
    if (pipe.closed) return;
    this.forwardRaw(pipe, "to-server", message.bytes);
    if (message.message === null) return;
    this.log.push({ kind: "message", connection: pipe.number, message: message.message });
    this.notify();
  }
}

/** The length of the browser's first whole frame in `bytes`, or null while it is incomplete. */
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
  header += MASK_BYTES;
  return bytes.length < header + payload ? null : { header, payload };
}

/** Takes the first whole frame from the browser's unparsed bytes, and unmasks its payload. */
function takeFrame(pipe: Pipe): Frame | null {
  const length = frameLength(pipe.frames);
  if (length === null) return null;
  const bytes = pipe.frames.subarray(0, length.header + length.payload);
  pipe.frames = pipe.frames.subarray(bytes.length);
  const mask = bytes.subarray(length.header - MASK_BYTES, length.header);
  const payload = Buffer.from(bytes.subarray(length.header));
  for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % MASK_BYTES]!;
  return { bytes, opcode: bytes[0]! & 0x0f, fin: (bytes[0]! & FIN_BIT) !== 0, payload };
}
