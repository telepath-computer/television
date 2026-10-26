export interface StickyNoteData {
  text: string;
  [field: string]: unknown;
}

export interface StickyNoteView {
  mode: "loading" | "note" | "unreadable";
  text: string;
  editable: boolean;
  status: string;
}

export interface StickyNoteModel {
  readonly view: StickyNoteView;
  input(text: string): void;
  blur(): void;
  receive(value: unknown): void;
  unavailable(): void;
  accessChanged(access: "read" | "read-write" | null): void;
  connectionChanged(status: "idle" | "connecting" | "connected" | "disconnected"): void;
  dispose(): void;
}

/** Validates the complete root without changing it. */
export function isStickyNoteData(value: unknown): value is StickyNoteData;

/** Keeps local typing until confirmed while the SDK owns stored and optimistic values. */
export function createStickyNoteModel(dependencies: {
  readAccess(): Promise<"read" | "read-write">;
  readRoot(): Promise<unknown>;
  writeText(text: string): Promise<void>;
  changed(view: StickyNoteView): void;
}): StickyNoteModel;
