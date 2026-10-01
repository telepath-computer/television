import process from "node:process";

import type { JobRun } from "./render.ts";
import { formatElapsed, renderFrame } from "./render.ts";

// The display shell around the pure renderer. On a TTY it live-redraws the
// full frame (one line per job) on a timer; elsewhere it degrades to plain
// sequential started/settled lines so piped or CI output stays sane.

export interface Ui {
  start(): void;
  settle(job: JobRun): void;
  finish(): void;
}

export interface UiStream {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): boolean;
}

const REDRAW_INTERVAL_MS = 100;
const DEFAULT_WIDTH = 80;

const ESC = "\u001b";
const CLEAR_LINE = `${ESC}[2K`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

export function createUi(stream: UiStream, jobs: JobRun[], { now = Date.now }: { now?: () => number } = {}): Ui {
  return stream.isTTY ? createTtyUi(stream, jobs, now) : createPlainUi(stream, jobs, now);
}

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

function createTtyUi(stream: UiStream, jobs: JobRun[], now: () => number): Ui {
  let drawnLines = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let finished = false;

  function draw(): void {
    const width = stream.columns || DEFAULT_WIDTH;
    const lines = renderFrame(jobs, { width, now: now() });
    let out = drawnLines > 0 ? `${ESC}[${drawnLines}A` : "";
    for (const line of lines) out += CLEAR_LINE + line + "\n";
    stream.write(out);
    drawnLines = lines.length;
  }

  function restoreCursorOnExit(): void {
    stream.write(SHOW_CURSOR);
  }

  // The cursor is hidden while the display runs; Node's default signal death
  // would skip finish(), leaving the user's terminal cursor invisible. Restore
  // it, then re-raise the signal with default handling so the process still
  // dies by the signal and exit codes stay conventional.
  function onSignal(signal: NodeJS.Signals): void {
    releaseTerminal();
    process.kill(process.pid, signal);
  }

  function releaseTerminal(): void {
    if (timer !== null) clearInterval(timer);
    for (const signal of SIGNALS) process.removeListener(signal, onSignal);
    process.removeListener("exit", restoreCursorOnExit);
    stream.write(SHOW_CURSOR);
  }

  return {
    start() {
      for (const signal of SIGNALS) process.on(signal, onSignal);
      process.on("exit", restoreCursorOnExit);
      stream.write(HIDE_CURSOR);
      draw();
      timer = setInterval(draw, REDRAW_INTERVAL_MS);
      timer.unref?.();
    },
    settle() {
      draw();
    },
    finish() {
      if (finished) return;
      finished = true;
      if (timer !== null) clearInterval(timer);
      draw();
      releaseTerminal();
    },
  };
}

function createPlainUi(stream: UiStream, jobs: JobRun[], now: () => number): Ui {
  return {
    start() {
      for (const job of jobs) stream.write(`${job.name}: started\n`);
    },
    settle(job) {
      const mark = job.state === "completed" ? "✓" : "✗";
      const elapsed = formatElapsed((job.settledAt ?? now()) - job.startedAt);
      const reason = job.state === "failed" && job.reason ? ` — ${job.reason}` : "";
      stream.write(`${job.name}: ${mark} ${elapsed}${reason}\n`);
    },
    finish() {},
  };
}
