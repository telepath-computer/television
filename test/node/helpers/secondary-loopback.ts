import http from "node:http";

export const SECONDARY_LOOPBACK_ADDRESS = "127.0.0.2";
export const TERTIARY_LOOPBACK_ADDRESS = "127.0.0.3";
export const SECONDARY_LOOPBACK_SKIP_REASON =
  "requires 127.0.0.2 on lo0; on macOS: sudo ifconfig lo0 alias 127.0.0.2 up";
export const TERTIARY_LOOPBACK_SKIP_REASON =
  `${SECONDARY_LOOPBACK_SKIP_REASON}; also requires 127.0.0.3 on lo0: sudo ifconfig lo0 alias 127.0.0.3 up`;

const bindabilityByAddress = new Map<string, Promise<boolean>>();

export function canBindLoopbackAddress(address: string): Promise<boolean> {
  let bindability = bindabilityByAddress.get(address);
  if (bindability === undefined) {
    bindability = new Promise((resolve) => {
      const server = http.createServer();
      server.once("error", () => resolve(false));
      server.listen(0, address, () => {
        server.close(() => resolve(true));
      });
    });
    bindabilityByAddress.set(address, bindability);
  }

  return bindability;
}

export function canBindSecondaryLoopback(): Promise<boolean> {
  return canBindLoopbackAddress(SECONDARY_LOOPBACK_ADDRESS);
}

export function secondaryLoopbackTestName(name: string, available: boolean): string {
  return available ? name : `${name} (${SECONDARY_LOOPBACK_SKIP_REASON})`;
}

export function tertiaryLoopbackTestName(name: string, available: boolean): string {
  return available ? name : `${name} (${TERTIARY_LOOPBACK_SKIP_REASON})`;
}
