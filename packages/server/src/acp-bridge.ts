import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { withDisposable } from "@telepath-computer/utils/disposable";
import type { ACPBridgeClientMessage, ACPBridgeServerMessage, ACPBridgeServerStatus } from "@telepath-computer/television-shared";
import type { ACPAgentProfile } from "./config.ts";

type SendMessage = (message: ACPBridgeServerMessage) => void;

export type ACPChildProcess = EventEmitter & {
  readonly pid?: number;
  stdin: Pick<Writable, "write">;
  stdout: Pick<Readable, "on">;
  stderr: Pick<Readable, "on">;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export type ACPProcessLauncher = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: ["pipe", "pipe", "pipe"]; detached: boolean },
) => ACPChildProcess;

const launchACPProcess: ACPProcessLauncher = (command, args, options) => {
  const child = spawn(command, args, options);
  // detached: true (set in ensureStarted) makes the child a process group
  // leader. Override kill() to signal the whole group via negative PID so
  // descendants (e.g. Hermes shelling to sudo) get torn down with the agent.
  // ESRCH means the group is already gone — treat as a successful no-op.
  const directKill = child.kill.bind(child);
  child.kill = ((signal?: NodeJS.Signals | number): boolean => {
    const pid = child.pid;
    const sig = signal ?? "SIGTERM";
    if (pid != null) {
      try {
        process.kill(-pid, sig);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          return true;
        }
      }
    }
    return directKill(sig as NodeJS.Signals);
  }) as typeof child.kill;
  return child as ACPChildProcess;
};
const ACP_STOP_TIMEOUT_MS = 5_000;
const ACP_DISPOSE_TIMEOUT_MS = 10_000;
const trackedChildren = new Set<ACPChildProcess>();
let exitSafetyNetInstalled = false;

function installExitSafetyNet(): void {
  if (exitSafetyNetInstalled) return;
  exitSafetyNetInstalled = true;
  process.on("exit", () => {
    for (const child of trackedChildren) {
      child.kill("SIGKILL");
    }
  });
}

function trackChild(child: ACPChildProcess): void {
  installExitSafetyNet();
  trackedChildren.add(child);
  const untrack = (): void => {
    trackedChildren.delete(child);
  };
  child.once("exit", untrack);
  child.once("error", untrack);
}

export const ACP_STUB_CWD = path.join(homedir(), ".television", "acp");

/**
 * The `tv` arguments that reach this server from a launched agent: the served
 * home, and the acquired port when the configured port is 0
 * (specs/arch/cli/index.md#^cli-acp-home-context).
 */
export function buildACPAgentTVArgs(input: { home: string; configuredPort: number; acquiredPort: number }): string[] {
  const args = ["--home", path.resolve(input.home)];
  if (input.configuredPort === 0) args.push("--port", String(input.acquiredPort));
  return args;
}

export interface ACPBridgeOptions {
  send: SendMessage;
  profile: ACPAgentProfile;
  tvArgs: readonly string[];
  launchProcess?: ACPProcessLauncher;
}

export class ACPBridge extends withDisposable(class {}) {
  private child: ACPChildProcess | null = null;
  private status: ACPBridgeServerStatus = "exited";
  private error: string | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly send: SendMessage;
  private readonly profile: ACPAgentProfile;
  private readonly tvArgs: readonly string[];
  private readonly launchProcess: ACPProcessLauncher;
  private readonly sessionCwd: string;

  constructor(options: ACPBridgeOptions) {
    super();
    this.send = options.send;
    this.profile = options.profile;
    this.tvArgs = options.tvArgs;
    this.launchProcess = options.launchProcess ?? launchACPProcess;
    this.sessionCwd = path.resolve(process.cwd());
  }

  handleClientMessage(message: ACPBridgeClientMessage): void {
    switch (message.type) {
      case "acp-bridge-connect":
        void this.ensureStarted();
        this.sendStatus();
        return;
      case "acp-bridge-message":
        if (!this.child || this.status !== "ready") {
          this.sendStatus();
          return;
        }

        this.child.stdin.write(`${JSON.stringify(message.message)}\n`);
        return;
    }
  }

  detachSocket(): void {
    void this.dispose();
  }

  async dispose(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;
    this.status = "exited";

    const stopPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, ACP_STOP_TIMEOUT_MS);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill();
    });

    let disposeTimeout: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      disposeTimeout = setTimeout(() => {
        console.warn("ACPBridge: timed out waiting for ACP child process to exit after SIGKILL; continuing shutdown.");
        resolve();
      }, ACP_DISPOSE_TIMEOUT_MS);
    });

    await Promise.race([stopPromise, timeoutPromise]);
    if (disposeTimeout) clearTimeout(disposeTimeout);
  }

  private async ensureStarted(): Promise<void> {
    if (this.child || this.status === "launching") {
      return;
    }

    this.status = "launching";
    this.error = null;
    this.sendStatus();

    await mkdir(ACP_STUB_CWD, { recursive: true });

    // detached: true makes the child a session leader (setsid) with no
    // controlling terminal. Without this, agents inheriting our tmux tty can
    // block on /dev/tty reads (e.g. Hermes' 45s sudo password prompt).
    const child = this.launchProcess(this.profile.command, this.profile.args, {
      cwd: ACP_STUB_CWD,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    this.child = child;
    trackChild(child);

    child.once("spawn", () => {
      if (this.child !== child) {
        return;
      }
      this.status = "ready";
      this.error = null;
      this.sendStatus();
    });

    child.once("error", (error) => {
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.status = "error";
      this.error = error.message;
      this.sendStatus();
    });

    child.once("exit", () => {
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.status = "exited";
      this.error = this.stderrBuffer.trim() || this.error;
      this.sendStatus();
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      this.stdoutBuffer += chunk.toString();
      this.flushStdoutBuffer();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrBuffer += chunk.toString();
      this.error = this.stderrBuffer.trim() || this.error;
    });
  }

  private flushStdoutBuffer(): void {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (error) {
        // Non-JSON lines on stdout violate the ACP contract (stdout is reserved
        // for JSON-RPC frames), but a misbehaving agent must not be allowed to
        // brick the bridge. Drop the line and keep the stream healthy.
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`ACPBridge: dropping non-JSON stdout line (${reason}): ${line}`);
        continue;
      }
      this.send({ type: "acp-bridge-message", message });
    }
  }

  private sendStatus(): void {
    if (this.status === "ready") {
      this.send({
        type: "acp-bridge-status",
        status: "ready",
        agent: this.profile.agent,
        sessionIdStrategy: this.profile.sessionIdStrategy,
        sessionCwd: this.sessionCwd,
        tvArgs: [...this.tvArgs],
      });
      return;
    }

    const message: ACPBridgeServerMessage = {
      type: "acp-bridge-status",
      status: this.status,
      ...(this.error ? { error: this.error } : {}),
    };
    this.send(message);
  }

  getChildPID(): number | null {
    return this.child?.pid ?? null;
  }
}
