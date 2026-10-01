import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMAND, parseCliArgs, parseConfig } from "../src/config.ts";

describe("parseCliArgs", () => {
  it("parses a config path and --command", () => {
    expect(parseCliArgs(["eval.json", "--command", "claude -p"])).toEqual({
      configPath: "eval.json",
      command: "claude -p",
    });
  });

  it("accepts --command=<value>", () => {
    expect(parseCliArgs(["eval.json", "--command=claude -p"])).toEqual({
      configPath: "eval.json",
      command: "claude -p",
    });
  });

  it("errors when the config path is missing", () => {
    expect(() => parseCliArgs(["--command", "claude -p"])).toThrow(/config path/);
  });

  it("defaults the command when --command is absent", () => {
    expect(parseCliArgs(["eval.json"])).toEqual({
      configPath: "eval.json",
      command: DEFAULT_COMMAND,
    });
  });

  it("errors when --command has no value", () => {
    expect(() => parseCliArgs(["eval.json", "--command"])).toThrow(/--command/);
  });

  it("errors when invoked with no arguments", () => {
    expect(() => parseCliArgs([])).toThrow(/config path/);
  });

  it("errors on unknown flags", () => {
    expect(() => parseCliArgs(["eval.json", "--command", "x", "--only", "today"])).toThrow(/unknown flag/);
  });

  it("errors on extra positional arguments", () => {
    expect(() => parseCliArgs(["eval.json", "other.json", "--command", "x"])).toThrow(/unexpected argument/);
  });
});

describe("parseConfig", () => {
  const options = { configPath: "/tmp/evals/eval.json", invocationDir: "/tmp/invoked-from" };
  const wrap = (jobs: unknown): string => JSON.stringify({ jobs });

  it("parses a job with every field, resolving cwd relative to the config file", () => {
    const parsed = parseConfig(
      wrap([{ name: "today", prompt: "do it", cwd: "runs/today", before_command: "mkdir -p runs/today" }]),
      options,
    );
    expect(parsed.configDir).toBe(path.resolve("/tmp/evals"));
    expect(parsed.jobs).toEqual([
      {
        name: "today",
        prompt: "do it",
        cwd: path.resolve("/tmp/evals/runs/today"),
        beforeCommand: "mkdir -p runs/today",
      },
    ]);
  });

  it("defaults cwd to the invocation directory and before_command to null", () => {
    const parsed = parseConfig(wrap([{ name: "today", prompt: "do it" }]), options);
    expect(parsed.jobs).toEqual([
      { name: "today", prompt: "do it", cwd: path.resolve("/tmp/invoked-from"), beforeCommand: null },
    ]);
  });

  it("rejects an absolute cwd (configs are portable; the page resolves config-relative)", () => {
    expect(() => parseConfig(wrap([{ name: "today", prompt: "do it", cwd: "/elsewhere" }]), options)).toThrow(
      /must be relative/,
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseConfig("not json", options)).toThrow(/invalid JSON/);
  });

  it("rejects a non-object top level", () => {
    expect(() => parseConfig("[]", options)).toThrow(/object/);
  });

  it("rejects a config without a jobs array", () => {
    expect(() => parseConfig("{}", options)).toThrow(/"jobs"/);
    expect(() => parseConfig(JSON.stringify({ jobs: "nope" }), options)).toThrow(/"jobs"/);
  });

  it("rejects a job that is not an object", () => {
    expect(() => parseConfig(wrap(["nope"]), options)).toThrow(/jobs\[0\]/);
  });

  it("rejects a job without a name", () => {
    expect(() => parseConfig(wrap([{ prompt: "do it" }]), options)).toThrow(/name/);
    expect(() => parseConfig(wrap([{ name: "", prompt: "do it" }]), options)).toThrow(/name/);
  });

  it("rejects a job without a prompt", () => {
    expect(() => parseConfig(wrap([{ name: "today" }]), options)).toThrow(/prompt/);
    expect(() => parseConfig(wrap([{ name: "today", prompt: 5 }]), options)).toThrow(/prompt/);
  });

  it("rejects a non-string cwd", () => {
    expect(() => parseConfig(wrap([{ name: "today", prompt: "p", cwd: 5 }]), options)).toThrow(/cwd/);
  });

  it("rejects a non-string before_command", () => {
    expect(() => parseConfig(wrap([{ name: "today", prompt: "p", before_command: 5 }]), options)).toThrow(
      /before_command/,
    );
  });
});
