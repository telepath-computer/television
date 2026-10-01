import { describe, expect, it } from "vitest";
import type { JobRun, JobState } from "../src/render.ts";
import { formatElapsed, layoutLine, orderJobs, renderFrame, statusFor, stripAnsi } from "../src/render.ts";

const BOLD = "[1m";
const GRAY = "[90m";
const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";

function job(name: string, state: JobState, overrides: Partial<JobRun> = {}): JobRun {
  return {
    name,
    prompt: "Read the skill at ../../dist/tv-tasks and follow its SKILL.md.",
    cwd: "/",
    beforeCommand: null,
    state,
    startedAt: 0,
    settledAt: state === "running" ? null : 14_000,
    ...overrides,
  };
}

describe("formatElapsed", () => {
  it("renders (M)M:SS", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(14_400)).toBe("0:14");
    expect(formatElapsed(140_000)).toBe("2:20");
    expect(formatElapsed(754_000)).toBe("12:34");
  });
});

describe("statusFor", () => {
  it("shows live elapsed time while running", () => {
    expect(statusFor(job("a", "running", { startedAt: 1_000 }), 15_400)).toBe("0:14");
  });

  it("shows a check mark once completed and a cross once failed", () => {
    expect(statusFor(job("a", "completed"), 20_000)).toBe("✓");
    expect(statusFor(job("a", "failed"), 20_000)).toBe("✗");
  });
});

describe("orderJobs", () => {
  it("orders ongoing first, then completed, then failed", () => {
    const jobs = [job("done", "completed"), job("bad", "failed"), job("busy", "running")];
    expect(orderJobs(jobs).map((entry) => entry.name)).toEqual(["busy", "done", "bad"]);
  });

  it("keeps config order within each group", () => {
    const jobs = [
      job("a", "completed"),
      job("b", "running"),
      job("c", "completed"),
      job("d", "running"),
      job("e", "failed"),
      job("f", "failed"),
    ];
    expect(orderJobs(jobs).map((entry) => entry.name)).toEqual(["b", "d", "a", "c", "e", "f"]);
  });
});

describe("layoutLine", () => {
  it("composes name, prompt, and right-aligned status at exactly the given width", () => {
    const line = layoutLine({ name: "today", prompt: "abc", status: "✓" }, { nameWidth: 7, width: 24 });
    expect(line).toBe("today     abc          ✓");
    expect(line.length).toBe(24);
  });

  it("truncates a long prompt with an ellipsis so the line fills the width", () => {
    const prompt = "Read the skill at ../../dist/tv-tasks and follow its SKILL.md.";
    const line = layoutLine({ name: "today", prompt, status: "14s" }, { nameWidth: 7, width: 40 });
    expect(line.length).toBe(40);
    expect(line).toContain("…");
    expect(line.endsWith(" 14s")).toBe(true);
    expect(line.startsWith("today     Read the skill")).toBe(true);
  });

  it("keeps the ellipsis column stable across differing status widths", () => {
    const prompt = "Read the skill at ../../dist/tv-tasks and follow its SKILL.md.";
    const running = layoutLine({ name: "today", prompt, status: "14s" }, { nameWidth: 7, width: 40 });
    const settled = layoutLine({ name: "errands", prompt, status: "✓" }, { nameWidth: 7, width: 40 });
    expect(running.indexOf("…")).toBe(settled.indexOf("…"));
  });

  it("collapses internal whitespace and newlines in the prompt", () => {
    const line = layoutLine({ name: "a", prompt: "one\ntwo   three", status: "✓" }, { nameWidth: 1, width: 30 });
    expect(line).toContain("one two three");
  });

  it("degrades gracefully when the terminal is too narrow", () => {
    const line = layoutLine({ name: "verylongname", prompt: "abc", status: "14s" }, { nameWidth: 12, width: 10 });
    expect(line.length).toBe(10);
  });
});

describe("renderFrame", () => {
  const width = 60;
  const now = 15_000;

  it("renders one line per job, ordered ongoing/completed/failed, each filling the width", () => {
    const jobs = [job("done", "completed"), job("busy", "running"), job("bad", "failed")];
    const lines = renderFrame(jobs, { width, now });
    expect(lines).toHaveLength(3);
    expect(stripAnsi(lines[0]).startsWith("busy")).toBe(true);
    expect(stripAnsi(lines[1]).startsWith("done")).toBe(true);
    expect(stripAnsi(lines[2]).startsWith("bad")).toBe(true);
    for (const line of lines) expect(stripAnsi(line).length).toBe(width);
  });

  it("bolds the name while running and grays it once settled", () => {
    const [running] = renderFrame([job("busy", "running")], { width, now });
    expect(running).toContain(`${BOLD}busy`);
    const [settled] = renderFrame([job("done", "completed")], { width, now });
    expect(settled).toContain(`${GRAY}done`);
    expect(settled).not.toContain(BOLD);
  });

  it("renders the prompt in gray", () => {
    const [line] = renderFrame([job("busy", "running", { prompt: "hello" })], { width, now });
    expect(line).toContain(`${GRAY}hello`);
  });

  it("renders a green check on completion and a red cross on failure", () => {
    const [completed] = renderFrame([job("done", "completed")], { width, now });
    expect(completed).toContain(`${GREEN}✓`);
    const [failed] = renderFrame([job("bad", "failed")], { width, now });
    expect(failed).toContain(`${RED}✗`);
  });

  it("renders live elapsed time for running jobs", () => {
    const [line] = renderFrame([job("busy", "running", { startedAt: 1_000 })], { width, now: 15_400 });
    expect(stripAnsi(line).endsWith("0:14")).toBe(true);
    expect(line).toContain(YELLOW + "0:14");
  });

  it("renders nothing for an empty job list", () => {
    expect(renderFrame([], { width, now })).toEqual([]);
  });

  it("clamps every line to exactly the width on narrow terminals, even with long names", () => {
    const jobs = [
      job("a-very-long-job-name", "running"),
      job("ok", "completed"),
      job("bad", "failed"),
    ];
    for (const narrow of [10, 15]) {
      const lines = renderFrame(jobs, { width: narrow, now });
      expect(lines).toHaveLength(3);
      for (const line of lines) expect(stripAnsi(line).length).toBe(narrow);
    }
  });

  it("pads every line to exactly the width when content is shorter", () => {
    const jobs = [job("a", "running", { prompt: "hi" })];
    const lines = renderFrame(jobs, { width: 30, now });
    expect(stripAnsi(lines[0]).length).toBe(30);
  });
});
