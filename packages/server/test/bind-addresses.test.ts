import { describe, expect, it } from "vitest";
import { resolveBindAddresses } from "../src/bind-addresses.ts";

describe("bind address resolution", () => {
  it("always includes localhost and accepts repeated comma-separated IPv4 values", () => {
    expect(resolveBindAddresses(["192.168.1.10,10.0.0.2", "192.168.1.10"])).toEqual([
      "127.0.0.1",
      "192.168.1.10",
      "10.0.0.2",
    ]);
  });

  it("rejects non-IPv4 listen values", () => {
    expect(() => resolveBindAddresses(["tailscale"])).toThrow("Invalid listen address `tailscale`");
    expect(() => resolveBindAddresses(["::1"])).toThrow("Invalid listen address `::1`");
  });

  it("does not bind localhost separately when 0.0.0.0 is requested", () => {
    expect(resolveBindAddresses(["0.0.0.0"])).toEqual(["0.0.0.0"]);
  });
});
