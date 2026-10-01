import type { ApplicationPageSnapshot } from "../services/application-service.ts";

/** One held tab gesture's provisional page order, consumed by both sibling views. */
export interface TabReorderSnapshot {
  readonly channelId: string;
  readonly pages: readonly ApplicationPageSnapshot[];
  readonly carriedArtifactId: string;
}

export type TabReorderChange = (reorder: TabReorderSnapshot | null) => void;
