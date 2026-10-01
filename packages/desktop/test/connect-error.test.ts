import { describe, expect, it } from "vitest";
import { connectErrorMessage } from "../src/connect-error.ts";

describe("connectErrorMessage", () => {
  it("unwraps Electron IPC invoke errors", () => {
    expect(
      connectErrorMessage(
        new Error("Error invoking remote method 'television:connect': Error: This server requires a token"),
      ),
    ).toBe("This server requires a token");
  });

  it("passes through plain Error messages", () => {
    expect(connectErrorMessage(new Error("Token rejected"))).toBe("Token rejected");
  });

  it("falls back for non-Error values", () => {
    expect(connectErrorMessage("nope")).toBe("Failed to connect");
  });
});
