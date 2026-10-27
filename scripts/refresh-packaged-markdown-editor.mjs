import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackagedMarkdownEditor } from "./check-packaged-markdown-editor.mjs";
import {
  generateDocumentTemplateNotices,
  generateSourceNotices,
} from "./licenses/generate-notices.mjs";
import { loadAssetManifest, loadLicenseConfig } from "./licenses/lib/config.mjs";
import { resolveInventoryRoot } from "./licenses/lib/inventory.mjs";
import {
  packagedMarkdownEditorFolderPath,
  packagedMarkdownEditorLicensingRecordPath,
  readPackagedMarkdownEditorRecord,
} from "./licenses/lib/packaged-markdown-editor.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/** Build the Markdown file view so its licensing inventory represents this tree. */
export function buildMarkdownFileView({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  outputFolder,
}) {
  const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "--workspace",
    "@telepath-computer/television-view-markdown",
    "run",
    "build",
    "--",
    "--outDir",
    path.resolve(outputFolder),
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: "production",
      TV_LICENSE_INVENTORY_ROOT: path.resolve(inventoryRoot),
    },
  });
  if (build.status !== 0 || build.error !== undefined) {
    const diagnostic = [build.stderr, build.stdout, build.error?.message]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `Markdown file view build failed${diagnostic ? `:\n${diagnostic}` : ""}. `
        + "Fix that build, then rerun `npm run refresh:packaged-markdown-editor`.",
    );
  }
}

/** Rebuild the packaged Markdown editor privately, then replace only its generated copies. */
export function refreshPackagedMarkdownEditor({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  templateFolder = packagedMarkdownEditorFolderPath({ root }),
  recordPath = packagedMarkdownEditorLicensingRecordPath({ root }),
  sourceNoticePath = path.join(root, "THIRD-PARTY-NOTICES.txt"),
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "television-packaged-markdown-editor-refresh-"));
  const fileViewOutputFolder = path.join(temporaryRoot, "file-view");
  const outputFolder = path.join(temporaryRoot, "editor");
  const freshRecordPath = path.join(temporaryRoot, "packaged-markdown-editor-licenses.json");
  try {
    buildMarkdownFileView({ root, inventoryRoot, outputFolder: fileViewOutputFolder });
    buildPackagedMarkdownEditor({
      root,
      inventoryRoot,
      outputFolder,
      recordPath: freshRecordPath,
    });
    const config = loadLicenseConfig({ root });
    const assets = loadAssetManifest({ root, config });
    const record = readPackagedMarkdownEditorRecord({
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
      packagedMarkdownEditorRecord: record,
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    refreshPackagedMarkdownEditor();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
