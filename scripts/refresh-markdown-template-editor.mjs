import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkdownTemplateEditor } from "./check-markdown-template-editor.mjs";
import {
  generateDocumentTemplateNotices,
  generateSourceNotices,
} from "./licenses/generate-notices.mjs";
import { loadAssetManifest, loadLicenseConfig } from "./licenses/lib/config.mjs";
import { resolveInventoryRoot } from "./licenses/lib/inventory.mjs";
import {
  documentTemplateEditorFolderPath,
  markdownTemplateEditorRecordPath,
  readMarkdownTemplateEditorRecord,
} from "./licenses/lib/markdown-template-editor.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/** Rebuild the packaged editor privately, then replace only its generated copies. */
export function refreshMarkdownTemplateEditor({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  templateFolder = documentTemplateEditorFolderPath({ root }),
  recordPath = markdownTemplateEditorRecordPath({ root }),
  sourceNoticePath = path.join(root, "THIRD-PARTY-NOTICES.txt"),
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "television-markdown-template-editor-refresh-"));
  const outputFolder = path.join(temporaryRoot, "editor");
  const freshRecordPath = path.join(temporaryRoot, "template-editor-licenses.json");
  try {
    buildMarkdownTemplateEditor({
      root,
      inventoryRoot,
      outputFolder,
      recordPath: freshRecordPath,
    });
    const config = loadLicenseConfig({ root });
    const assets = loadAssetManifest({ root, config });
    const record = readMarkdownTemplateEditorRecord({
      root,
      recordPath: freshRecordPath,
      assets,
    });

    fs.mkdirSync(templateFolder, { recursive: true });
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.copyFileSync(path.join(outputFolder, "editor.js"), path.join(templateFolder, "editor.js"));
    fs.copyFileSync(path.join(outputFolder, "editor.css"), path.join(templateFolder, "editor.css"));
    fs.copyFileSync(freshRecordPath, recordPath);

    generateDocumentTemplateNotices({
      root,
      outputPath: path.join(templateFolder, "THIRD-PARTY-NOTICES.txt"),
      config,
      assets,
      record,
    });
    generateSourceNotices({
      root,
      outputPath: sourceNoticePath,
      config,
      assets,
      templateEditorRecord: record,
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    refreshMarkdownTemplateEditor();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
