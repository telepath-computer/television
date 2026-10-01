import { isIPv4 } from "node:net";

const LOCALHOST_IPV4 = "127.0.0.1";
const ANY_IPV4 = "0.0.0.0";

export function resolveBindAddresses(listenValues: readonly string[] | undefined = []): string[] {
  const addresses = [LOCALHOST_IPV4];

  for (const address of splitListenValues(listenValues)) {
    if (!isIPv4(address)) {
      throw new Error(`Invalid listen address \`${address}\`. Use an IPv4 address.`);
    }
    addresses.push(address);
  }

  const deduped = [...new Set(addresses)];
  return deduped.includes(ANY_IPV4) ? [ANY_IPV4] : deduped;
}

function splitListenValues(values: readonly string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
