import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import type { Duplex } from "node:stream";

export interface StableFrontProxy {
  readonly url: string;
  readonly targetURL: string;
  setTarget(url: string): void;
  dispose(): Promise<void>;
}

/** Keep one kernel-selected browser origin while independently bound backends restart. */
export async function startStableFrontProxy(initialTargetURL: string): Promise<StableFrontProxy> {
  let target = parseTarget(initialTargetURL);
  const sockets = new Set<Socket>();
  const peers = new Map<Duplex, Duplex>();
  const unlinkPeer = (stream: Duplex): Duplex | undefined => {
    const peer = peers.get(stream);
    peers.delete(stream);
    if (peer) peers.delete(peer);
    return peer;
  };
  const closeLinked = (stream: Duplex): void => {
    const peer = unlinkPeer(stream);
    destroyQuietly(stream);
    if (peer) destroyQuietly(peer);
  };
  const endLinked = (stream: Duplex): void => {
    const peer = unlinkPeer(stream);
    if (peer && !peer.destroyed && !peer.writableEnded) peer.end();
  };
  const linkPeers = (left: Duplex, right: Duplex): void => {
    peers.set(left, right);
    peers.set(right, left);
  };

  const server = createServer((req, res) => proxyRequest(req, res, target));
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => closeLinked(socket));
    socket.on("end", () => endLinked(socket));
    socket.once("close", () => {
      sockets.delete(socket);
      if (peers.has(socket)) closeLinked(socket);
    });
  });
  server.on("upgrade", (req, socket, head) => {
    req.on("error", () => closeLinked(socket));
    proxyUpgrade(req, socket, head, target, { link: linkPeers, close: closeLinked, end: endLinked });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Stable front proxy did not bind TCP");
  const url = `http://127.0.0.1:${address.port}`;
  let disposePromise: Promise<void> | undefined;

  return {
    url,
    get targetURL(): string {
      return target.toString();
    },
    setTarget(nextURL: string): void {
      target = parseTarget(nextURL);
    },
    dispose(): Promise<void> {
      disposePromise ??= (async () => {
        for (const socket of [...sockets]) closeLinked(socket);
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      })();
      return disposePromise;
    },
  };
}

function parseTarget(input: string): URL {
  const target = new URL(input);
  if (target.protocol !== "http:") throw new Error(`Stable front target must use http:, received ${target.protocol}`);
  return target;
}

function targetPort(target: URL): number {
  return target.port ? Number.parseInt(target.port, 10) : 80;
}

interface ProxyPeerBridge {
  link(left: Duplex, right: Duplex): void;
  close(stream: Duplex): void;
  end(stream: Duplex): void;
}

function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: URL, bridge: ProxyPeerBridge): void {
  const upstream = net.connect(targetPort(target), target.hostname, () => {
    upstream.write(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.toLowerCase() === "host" || value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) upstream.write(`${name}: ${item}\r\n`);
    }
    upstream.write(`host: ${target.host}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  bridge.link(socket, upstream);
  upstream.on("error", () => bridge.close(upstream));
  upstream.on("end", () => bridge.end(upstream));
  upstream.once("close", () => bridge.close(upstream));
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, target: URL): void {
  const targetURL = new URL(req.url ?? "/", target);
  let proxiedResponse: IncomingMessage | undefined;
  const proxied = request(targetURL, {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }, (response) => {
    proxiedResponse = response;
    response.on("error", closeBridge);
    res.writeHead(response.statusCode ?? 500, response.headers);
    response.pipe(res);
  });
  const closeBridge = (): void => {
    req.unpipe(proxied);
    proxiedResponse?.unpipe(res);
    destroyQuietly(req);
    destroyQuietly(proxied);
    if (proxiedResponse) destroyQuietly(proxiedResponse);
    destroyQuietly(res);
  };
  req.on("error", closeBridge);
  req.on("aborted", closeBridge);
  res.on("error", closeBridge);
  res.on("close", () => {
    if (!res.writableFinished) closeBridge();
  });
  proxied.on("error", (error) => {
    req.unpipe(proxied);
    if (proxiedResponse) destroyQuietly(proxiedResponse);
    if (!res.headersSent && !res.destroyed) {
      res.statusCode = 502;
      res.end(error.message);
    } else {
      destroyQuietly(res);
    }
    destroyQuietly(req);
  });
  req.pipe(proxied);
}

function destroyQuietly(stream: { destroyed?: boolean; destroy(): unknown }): void {
  if (stream.destroyed) return;
  if (stream instanceof net.Socket) {
    stream.resetAndDestroy();
    return;
  }
  stream.destroy();
}
