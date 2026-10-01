import { describe, expect, it } from "vitest";
import type { JobRun } from "../src/render.ts";
import { stripAnsi } from "../src/render.ts";
import type { UiStream } from "../src/ui.ts";
import { createUi } from "../src/ui.ts";

class FakeStream implements UiStream {
  isTTY: boolean;
  columns: number;
  chunks: string[] = [];

  constructor({ isTTY, columns = 60 }: { isTTY: boolean; columns?: number }) {
    this.isTTY = isTTY;
    this.columns = columns;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  get output(): string {
    return this.chunks.join("");
  }
}

function job(name: string, overrides: Partial<JobRun> = {}): JobRun {
  return {
    name,
    prompt: "a prompt",
    cwd: "/",
    beforeCommand: null,
    state: "running",
    startedAt: 0,
    settledAt: null,
    ...overrides,
  };
}

describe("createUi on a non-TTY stream", () => {
  it("prints plain started lines with no ANSI escapes", () => {
    const stream = new FakeStream({ isTTY: false });
    const jobs = [job("today"), job("errands")];
    const ui = createUi(stream, jobs, { now: () => 0 });
    ui.start();
    ui.finish();
    expect(stream.output).toBe("today: started\nerrands: started\n");
  });

  it("prints one settle line per job with its outcome and elapsed time", () => {
    const stream = new FakeStream({ isTTY: false });
    const done = job("today", { state: "completed", startedAt: 0, settledAt: 14_000 });
    const failed = job("errands", { state: "failed", startedAt: 0, settledAt: 2_000 });
    const ui = createUi(stream, [done, failed], { now: () => 20_000 });
    ui.settle(done);
    ui.settle(failed);
    ui.finish();
    expect(stream.output).toBe("today: ✓ 0:14\nerrands: ✗ 0:02\n");
    expect(stream.output).toBe(stripAnsi(stream.output));
  });
});

describe("createUi on a TTY stream", () => {
  it("draws one full-width line per job on start", () => {
    const stream = new FakeStream({ isTTY: true, columns: 50 });
    const jobs = [job("today"), job("errands")];
    const ui = createUi(stream, jobs, { now: () => 0 });
    ui.start();
    ui.finish();
    const lines = stripAnsi(stream.output).split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0].startsWith("today")).toBe(true);
    expect(lines[0].length).toBe(50);
  });

  it("falls back to a default width when the terminal reports zero columns", () => {
    const stream = new FakeStream({ isTTY: true, columns: 0 });
    const ui = createUi(stream, [job("today")], { now: () => 0 });
    ui.start();
    ui.finish();
    const lines = stripAnsi(stream.output).split("\n").filter((line) => line.length > 0);
    expect(lines[0].length).toBe(80);
  });

  it("redraws in place by moving the cursor up over the previous frame", () => {
    const stream = new FakeStream({ isTTY: true, columns: 50 });
    const jobs = [job("today"), job("errands")];
    const ui = createUi(stream, jobs, { now: () => 0 });
    ui.start();
    jobs[0].state = "completed";
    jobs[0].settledAt = 1_000;
    ui.settle(jobs[0]);
    ui.finish();
    expect(stream.output).toContain("[2A");
  });

  it("installs SIGINT/SIGTERM/exit cursor-restore handlers on start and removes them on finish", () => {
    const events = ["SIGINT", "SIGTERM", "exit"] as const;
    const before = events.map((event) => process.listenerCount(event));
    const stream = new FakeStream({ isTTY: true, columns: 50 });
    const ui = createUi(stream, [job("today")], { now: () => 0 });
    ui.start();
    try {
      for (const [i, event] of events.entries()) {
        expect(process.listenerCount(event), `${event} while running`).toBe(before[i] + 1);
      }
    } finally {
      ui.finish();
    }
    for (const [i, event] of events.entries()) {
      expect(process.listenerCount(event), `${event} after finish`).toBe(before[i]);
    }
  });

  it("hides the cursor while running and restores it on finish", () => {
    const stream = new FakeStream({ isTTY: true, columns: 50 });
    const ui = createUi(stream, [job("today")], { now: () => 0 });
    ui.start();
    expect(stream.output).toContain("[?25l");
    expect(stream.output).not.toContain("[?25h");
    ui.finish();
    expect(stream.output).toContain("[?25h");
  });
});
