import type { JobSpec } from "./config.ts";

// Pure rendering for the run display. One line per job:
//
//   today     Read the skill at ../../dist/tv-tasks and follow its 'Tod…     0:14
//
// bold name (gray once settled) → gray truncated prompt → right-aligned
// status (live elapsed / green check / red cross), filling the terminal width.

export type JobState = "running" | "completed" | "failed";

export interface JobRun extends JobSpec {
  state: JobState;
  /** Epoch ms when the job started. */
  startedAt: number;
  /** Epoch ms when the job settled, or null while running. */
  settledAt: number | null;
  /** Why the job failed, or null when completed / not yet settled. */
  reason?: string | null;
}

const NAME_GAP = 3;
const STATUS_WIDTH = 8;
const ELLIPSIS = "…";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const ESC = "\u001b";
const BOLD = `${ESC}[1m`;
const GRAY = `${ESC}[90m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;

const STATE_RANK: Record<JobState, number> = { running: 0, completed: 1, failed: 2 };

interface LineParts {
  name: string;
  prompt: string;
  status: string;
}

interface LineLayout {
  nameWidth: number;
  width: number;
}

interface LineFields {
  nameField: string;
  promptField: string;
  /** Right-alignment padding before the status text. */
  statusPad: string;
  statusText: string;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function statusFor(job: JobRun, now: number): string {
  if (job.state === "running") return formatElapsed(now - job.startedAt);
  return job.state === "completed" ? "✓" : "✗";
}

export function orderJobs<T extends { state: JobState }>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
}

export function layoutLine(parts: LineParts, layout: LineLayout): string {
  const { nameField, promptField, statusPad, statusText } = layoutFields(parts, layout);
  return nameField + promptField + statusPad + statusText;
}

export function renderFrame(jobs: JobRun[], { width, now }: { width: number; now: number }): string[] {
  if (jobs.length === 0) return [];
  const nameWidth = Math.max(...jobs.map((job) => job.name.length));
  return orderJobs(jobs).map((job) => renderJobLine(job, { nameWidth, width, now }));
}

function renderJobLine(job: JobRun, { nameWidth, width, now }: { nameWidth: number; width: number; now: number }): string {
  const status = statusFor(job, now);
  const { nameField, promptField, statusPad, statusText } = layoutFields(
    { name: job.name, prompt: job.prompt, status },
    { nameWidth, width },
  );
  const nameColor = job.state === "running" ? BOLD : GRAY;
  const statusColor = job.state === "completed" ? GREEN : job.state === "failed" ? RED : YELLOW;
  return nameColor + nameField + RESET + GRAY + promptField + RESET + statusPad + statusColor + statusText + RESET;
}

// The one clamped field computation shared by layoutLine and renderJobLine:
// plain fields are clamped/padded here (before any coloring) so the visible
// length of every rendered line is exactly `width`.
function layoutFields({ name, prompt, status }: LineParts, { nameWidth, width }: LineLayout): LineFields {
  const safeWidth = Math.max(0, width);
  const statusText = status.length > safeWidth ? status.slice(status.length - safeWidth) : status;
  const statusPad = " ".repeat(Math.max(0, Math.min(STATUS_WIDTH, safeWidth) - statusText.length));
  const nameField = name.padEnd(nameWidth + NAME_GAP).slice(0, safeWidth - statusPad.length - statusText.length);
  const promptWidth = safeWidth - nameField.length - statusPad.length - statusText.length;
  if (promptWidth < 1) return { nameField, promptField: "", statusPad, statusText };
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const promptField =
    cleaned.length > promptWidth ? cleaned.slice(0, promptWidth - 1) + ELLIPSIS : cleaned.padEnd(promptWidth);
  return { nameField, promptField, statusPad, statusText };
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}
