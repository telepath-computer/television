// A front that terminates TLS and forwards plain HTTP to a server, as
// `tailscale serve` does (proofs/product/resources/resources.md, Test hooks).
// It stands in for software outside Television: it forwards each connection's
// bytes unchanged, WebSocket upgrades included, and replaces no Television
// mechanism. Its certificate is generated for each front, so no key is kept in
// the repository; browsers are told to accept it.
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

export interface HttpsFront {
  port: number;
  close(): Promise<void>;
}

/** One DER element: its tag, its length and its content. */
function der(tag: number, content: Buffer): Buffer {
  if (content.length < 0x80) return Buffer.concat([Buffer.from([tag, content.length]), content]);
  const length: number[] = [];
  for (let rest = content.length; rest > 0; rest >>= 8) length.unshift(rest & 0xff);
  return Buffer.concat([Buffer.from([tag, 0x80 | length.length, ...length]), content]);
}

const sequence = (...items: Buffer[]): Buffer => der(0x30, Buffer.concat(items));

function objectIdentifier(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first! + second!];
  for (const value of rest) {
    const chunk = [value & 0x7f];
    for (let remaining = value >> 7; remaining > 0; remaining >>= 7) chunk.unshift(0x80 | (remaining & 0x7f));
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

const utcTime = (date: Date): Buffer => der(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));

const commonName = (host: string): Buffer => sequence(der(0x31, sequence(objectIdentifier("2.5.4.3"), der(0x0c, Buffer.from(host)))));

/** A self-signed X.509 certificate for `host`, valid from a day before now to a day after, with its private key. */
function selfSignedCertificate(host: string): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaWithSHA256 = sequence(objectIdentifier("1.2.840.10045.4.3.2"));
  const day = 24 * 60 * 60 * 1000;
  const serial = randomBytes(8);
  serial[0] = serial[0]! & 0x7f;
  const toBeSigned = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))), // version 3
    der(0x02, serial),
    ecdsaWithSHA256,
    commonName(host),
    sequence(utcTime(new Date(Date.now() - day)), utcTime(new Date(Date.now() + day))),
    commonName(host),
    publicKey.export({ type: "spki", format: "der" }),
    // The subject alternative name, a DNS name.
    der(0xa3, sequence(sequence(objectIdentifier("2.5.29.17"), der(0x04, sequence(der(0x82, Buffer.from(host))))))),
  );
  const signature = der(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", toBeSigned, privateKey)]));
  const certificate = sequence(toBeSigned, ecdsaWithSHA256, signature);
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}

/** Starts a front on loopback that serves `host` over TLS and forwards to the plain-HTTP `targetPort` on loopback. */
export async function startHttpsFront(host: string, targetPort: number): Promise<HttpsFront> {
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const server = tls.createServer(selfSignedCertificate(host), (client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    track(client);
    track(upstream);
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", end).on("close", end);
    upstream.on("error", end).on("close", end);
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
