import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../dist/cli.js");

function runCli(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd });
}

function writeConfig(jobs: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runner-cli-"));
  const configPath = path.join(dir, "eval.json");
  writeFileSync(configPath, JSON.stringify({ jobs }));
  return configPath;
}

describe("runner CLI", () => {
  it("exits nonzero with a usage error when invoked with no arguments", () => {
    const result = runCli([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/config path/);
  });

  // A bare invocation defaults --command (config.test.ts covers the
  // default); no CLI-level test, since exercising it would spawn the real
  // default agent command.

  it("exits nonzero when the config file is unreadable", () => {
    const result = runCli(["/nonexistent/eval.json", "--command", "true"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/config/);
  });

  it("exits nonzero when the config is invalid JSON", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "runner-cli-"));
    const configPath = path.join(dir, "eval.json");
    writeFileSync(configPath, "not json");
    const result = runCli([configPath, "--command", "true"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid JSON/);
  });

  it("runs all jobs, reports each outcome, and exits 0 even when a job fails", () => {
    const configPath = writeConfig([
      { name: "ok-a", prompt: "prompt a" },
      { name: "ok-b", prompt: "prompt b" },
      { name: "bad", prompt: "prompt c", cwd: "does-not-exist" },
    ]);
    const result = runCli([configPath, "--command", "cat >/dev/null"], path.dirname(configPath));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok-a: started");
    expect(result.stdout).toContain("ok-a: ✓");
    expect(result.stdout).toContain("ok-b: ✓");
    expect(result.stdout).toContain("bad: ✗");
  });

  it("emits no ANSI escapes when stdout is not a TTY", () => {
    const configPath = writeConfig([{ name: "only", prompt: "p" }]);
    const result = runCli([configPath, "--command", "cat >/dev/null"], path.dirname(configPath));
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("\u001b[");
  });

  it("discards agent stdout and stderr", () => {
    const configPath = writeConfig([{ name: "noisy", prompt: "p" }]);
    const result = runCli([configPath, "--command", "echo junk; echo junk2 >&2"], path.dirname(configPath));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("noisy: ✓");
    expect(result.stdout).not.toContain("junk");
    expect(result.stderr).not.toContain("junk");
  });

  it("runs jobs in parallel", () => {
    // Each job's prompt is a script the shared command evals; each writes a
    // start marker, then waits for the other's marker. Both can only succeed
    // when the jobs overlap — under sequential execution the first job would
    // exhaust its wait and fail.
    const waitScript = (mine: string, other: string): string =>
      `touch ${mine}.start; for i in $(seq 100); do [ -f ${other}.start ] && exit 0; sleep 0.05; done; exit 1`;
    const configPath = writeConfig([
      { name: "a", prompt: waitScript("a", "b") },
      { name: "b", prompt: waitScript("b", "a") },
    ]);
    const result = runCli([configPath, "--command", 'eval "$(cat)"'], path.dirname(configPath));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("a: ✓");
    expect(result.stdout).toContain("b: ✓");
  });

  it("restores the cursor and dies by the signal when interrupted mid-run", async () => {
    const HIDE_CURSOR = "\u001b[?25l";
    const SHOW_CURSOR = "\u001b[?25h";
    const configPath = writeConfig([{ name: "sleepy", prompt: "p" }]);
    // The TTY UI only engages on a real terminal, so run the CLI under a
    // pseudo-terminal via script(1) and deliver Ctrl-C through the pty.
    // macOS script requires a pipe, rather than Node's socket-backed stdin.
    const child = spawn(
      process.platform === "darwin" ? "sh" : "script",
      process.platform === "darwin"
        ? ["-c", 'cat | script -q /dev/null "$@"', "sh", process.execPath, cli, "eval.json", "--command", "sleep 5"]
        : ["-qec", `${process.execPath} ${cli} eval.json --command "sleep 5"`, "/dev/null"],
      { cwd: path.dirname(configPath) },
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    // Wait for the live display to start (cursor hidden), then Ctrl-C.
    await waitFor(() => out.includes(HIDE_CURSOR));
    child.stdin.end("\u0003");
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(out).toContain(HIDE_CURSOR);
    // Terminal state is set by the last cursor-control sequence; script(1)
    // may relay harmless PTY output after it has relayed the restoration.
    expect(out.lastIndexOf(SHOW_CURSOR)).toBeGreaterThan(out.lastIndexOf(HIDE_CURSOR));
    // BSD script returns the signal number; util-linux returns 128 + signal.
    expect(code).toBe(process.platform === "darwin" ? 2 : 130);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
