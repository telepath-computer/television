import { VitestTestRunner } from "vitest/runners";
export interface VitestAttemptRecord {
  schemaVersion: 1;
  file: string;
  project?: string;
  titlePath: string[];
  line?: number;
  column?: number;
  attemptIndex: number;
  status: "passed" | "failed" | "skipped" | "unknown";
  startedAt: string;
  completedAt: string;
  durationMs: number;
}
export default class VitestAttemptReporter extends VitestTestRunner {}
