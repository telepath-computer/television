import type { MarkdownTemplateEditorLicensingRecord } from "./licenses/lib/markdown-template-editor.mjs";

export interface MarkdownTemplateEditorCheckObservation {
  editorJavaScript: Buffer;
  editorStylesheet: Buffer;
  record: MarkdownTemplateEditorLicensingRecord;
}

export interface MarkdownTemplateEditorCheckResult {
  ok: boolean;
  errors: string[];
}

export function checkMarkdownTemplateEditor(options?: {
  root?: string;
  inventoryRoot?: string;
  templateFolder?: string;
  recordPath?: string;
  observeFreshOutput?: (observation: MarkdownTemplateEditorCheckObservation) => void;
}): Promise<MarkdownTemplateEditorCheckResult>;
