export function buildMarkdownFileView(options: {
  root?: string;
  inventoryRoot?: string;
  outputFolder: string;
}): void;

export function refreshPackagedMarkdownEditor(options?: {
  root?: string;
  inventoryRoot?: string;
  templateFolder?: string;
  recordPath?: string;
  sourceNoticePath?: string;
}): void;
