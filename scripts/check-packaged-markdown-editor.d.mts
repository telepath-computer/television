import type { PackagedMarkdownEditorLicensingRecord } from "./licenses/lib/packaged-markdown-editor.mjs";

export interface PackagedMarkdownEditorCheckObservation {
  editorJavaScript: Buffer;
  editorStylesheet: Buffer;
  record: PackagedMarkdownEditorLicensingRecord;
}

export interface PackagedMarkdownEditorCheckResult {
  ok: boolean;
  errors: string[];
}

export function buildPackagedMarkdownEditor(options: {
  root?: string;
  inventoryRoot?: string;
  outputFolder: string;
  recordPath: string;
}): void;

export function checkPackagedMarkdownEditor(options?: {
  root?: string;
  inventoryRoot?: string;
  templateFolder?: string;
  recordPath?: string;
  observeFreshOutput?: (observation: PackagedMarkdownEditorCheckObservation) => void;
}): Promise<PackagedMarkdownEditorCheckResult>;
