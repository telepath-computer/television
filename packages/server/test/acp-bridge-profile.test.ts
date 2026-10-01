import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { resolveACPAgentProfile } from "../src/config.ts";
import { ACPBridge, ACP_STUB_CWD, buildACPAgentTVArgs, type ACPChildProcess, type ACPProcessLauncher } from "../src/acp-bridge.ts";

// The bridge puts its agent working directory under the operating-system home,
// which it reads when its module loads. vi.hoisted runs this before the imports
// above, so the bridge sees a temporary HOME and these tests never write the
// running user's default Television home (specs/product/cli.md, Testing).
const operatingSystemHome = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const original = process.env.HOME;
  const temporary = mkdtempSync(join(tmpdir(), "television-acp-os-home-"));
  process.env.HOME = temporary;
  return { original, temporary };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (operatingSystemHome.original === undefined) delete process.env.HOME;
  else process.env.HOME = operatingSystemHome.original;
  rmSync(operatingSystemHome.temporary, { recursive: true, force: true });
});

type FakeChild = ACPChildProcess & { stdout: PassThrough; stderr: PassThrough };

const TV_ARGS = ["--home", path.resolve("/srv/television-home")];

function fakeLauncher(): {
  launcher: ACPProcessLauncher;
  calls: Array<{ command: string; args: string[]; options: { cwd?: string; env?: NodeJS.ProcessEnv } }>;
  children: FakeChild[];
} {
  const calls: Array<{ command: string; args: string[]; options: { cwd?: string; env?: NodeJS.ProcessEnv } }> = [];
  const children: FakeChild[] = [];
  const launcher: ACPProcessLauncher = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter() as ReturnType<ACPProcessLauncher>;
    Object.assign(child, {
      pid: 12345,
      stdin: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit("exit", 0, null));
        return true;
      }),
    });
    children.push(child as FakeChild);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  return { launcher, calls, children };
}

describe("ACP agent profile resolution", () => {
  it("returns null when TELEVISION_ACP_AGENT is unset", () => {
    expect(resolveACPAgentProfile({})).toBeNull();
  });

  it("selects OpenClaw explicitly", () => {
    expect(resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" })).toMatchObject({
      agent: "openclaw",
      command: "openclaw",
      args: ["acp"],
      sessionIdStrategy: "deterministic",
    });
  });

  it("selects Hermes explicitly", () => {
    expect(resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "hermes" })).toMatchObject({
      agent: "hermes",
      command: "hermes",
      args: ["acp"],
      sessionIdStrategy: "mapped",
    });
  });

  it("rejects unknown ACP agent values with a clear error", () => {
    expect(() => resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "not-a-real-agent" })).toThrow(
      'Unsupported TELEVISION_ACP_AGENT "not-a-real-agent". Supported values: openclaw, hermes.',
    );
  });
});

describe("ACPBridge profile spawning", () => {
  it("spawns OpenClaw when given the OpenClaw profile", async () => {
    const { launcher, calls } = fakeLauncher();
    const bridge = new ACPBridge({
      send: vi.fn(),
      launchProcess: launcher,
      tvArgs: TV_ARGS,
      profile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" }),
    });

    bridge.handleClientMessage({ type: "acp-bridge-connect" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toMatchObject({ command: "openclaw", args: ["acp"] });
    expect(calls[0]?.options.env).toBeUndefined();
    await bridge.dispose();
  });

  it("spawns Hermes when given the Hermes profile", async () => {
    const { launcher, calls } = fakeLauncher();
    const bridge = new ACPBridge({
      send: vi.fn(),
      launchProcess: launcher,
      tvArgs: TV_ARGS,
      profile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "hermes" }),
    });

    bridge.handleClientMessage({ type: "acp-bridge-connect" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toMatchObject({ command: "hermes", args: ["acp"] });
    await bridge.dispose();
  });

  it("emits OpenClaw ready metadata", async () => {
    const send = vi.fn();
    const { launcher } = fakeLauncher();
    const bridge = new ACPBridge({
      send,
      launchProcess: launcher,
      tvArgs: TV_ARGS,
      profile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" }),
    });

    bridge.handleClientMessage({ type: "acp-bridge-connect" });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    });

    const readyMessage = send.mock.calls.map(([message]) => message).find((message) => message.status === "ready");
    expect(readyMessage).toMatchObject({
      type: "acp-bridge-status",
      status: "ready",
      agent: "openclaw",
      sessionIdStrategy: "deterministic",
      tvArgs: TV_ARGS,
    });
    expect(path.isAbsolute(readyMessage?.sessionCwd as string)).toBe(true);
    expect(path.resolve(readyMessage?.sessionCwd as string)).not.toBe(path.resolve(ACP_STUB_CWD));
    await bridge.dispose();
  });

  it("drops non-JSON stdout lines without erroring the bridge and keeps forwarding subsequent JSON frames", async () => {
    const send = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { launcher, children } = fakeLauncher();
    const bridge = new ACPBridge({
      send,
      launchProcess: launcher,
      tvArgs: TV_ARGS,
      profile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" }),
    });

    bridge.handleClientMessage({ type: "acp-bridge-connect" });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    });

    const child = children[0];
    expect(child).toBeDefined();

    const before: unknown = { jsonrpc: "2.0", id: 1, method: "before", params: {} };
    const after: unknown = { jsonrpc: "2.0", id: 2, method: "after", params: {} };
    const garbage = "\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510";

    child!.stdout.write(`${JSON.stringify(before)}\n`);
    child!.stdout.write(`${garbage}\n`);
    child!.stdout.write(`${JSON.stringify(after)}\n`);

    await vi.waitFor(() => {
      const forwarded = send.mock.calls
        .map(([m]) => m)
        .filter((m) => m && m.type === "acp-bridge-message")
        .map((m) => m.message);
      expect(forwarded).toContainEqual(after);
    });

    const messages = send.mock.calls.map(([m]) => m);
    const forwarded = messages.filter((m) => m.type === "acp-bridge-message").map((m) => m.message);
    expect(forwarded).toEqual([before, after]);

    const statuses = messages.filter((m) => m.type === "acp-bridge-status");
    expect(statuses.every((m) => m.status !== "error")).toBe(true);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(garbage));

    errorSpy.mockRestore();
    await bridge.dispose();
  });

  it("dispose resolves after the final timeout when the ACP child never exits", async () => {
    const send = vi.fn();
    const calls: Array<{ command: string; args: string[] }> = [];
    const child = new EventEmitter() as ACPChildProcess;
    Object.assign(child, {
      pid: 12345,
      stdin: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    const launcher: ACPProcessLauncher = (command, args) => {
      calls.push({ command, args: [...args] });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = new ACPBridge({
      send,
      launchProcess: launcher,
      tvArgs: TV_ARGS,
      profile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" }),
    });

    bridge.handleClientMessage({ type: "acp-bridge-connect" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    vi.useFakeTimers();

    const disposed = bridge.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(disposed).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("timed out waiting for ACP child process"));
  });

  it("emits Hermes ready metadata", async () => {
    const send = vi.fn();
    const { launcher } = fakeLauncher();
    const bridge = new ACPBridge({
      send,
      launchProcess: launcher,
      tvArgs: TV_ARGS,
      profile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "hermes" }),
    });

    bridge.handleClientMessage({ type: "acp-bridge-connect" });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    });

    const readyMessage = send.mock.calls.map(([message]) => message).find((message) => message.status === "ready");
    expect(readyMessage).toMatchObject({
      type: "acp-bridge-status",
      status: "ready",
      agent: "hermes",
      sessionIdStrategy: "mapped",
      tvArgs: TV_ARGS,
    });
    expect(path.isAbsolute(readyMessage?.sessionCwd as string)).toBe(true);
    expect(path.resolve(readyMessage?.sessionCwd as string)).not.toBe(path.resolve(ACP_STUB_CWD));
    await bridge.dispose();
  });
});

describe("ACP agent home context", () => {
  // proofs/arch/cli/index.md#^cli-acp-home-context-port-rule
  it("gives the agent --home, and --port with the acquired port only under configured port 0", () => {
    const home = path.resolve("/srv/television-home");
    expect(buildACPAgentTVArgs({ home, configuredPort: 0, acquiredPort: 41234 })).toEqual(["--home", home, "--port", "41234"]);
    expect(buildACPAgentTVArgs({ home, configuredPort: 32848, acquiredPort: 32848 })).toEqual(["--home", home]);
  });
});
