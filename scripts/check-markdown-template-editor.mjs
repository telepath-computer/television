import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateMarkdownTemplateNotices,
  generateSourceNotices,
} from "./licenses/generate-notices.mjs";
import { loadAssetManifest, loadLicenseConfig } from "./licenses/lib/config.mjs";
import { resolveInventoryRoot } from "./licenses/lib/inventory.mjs";
import {
  markdownTemplateEditorFolderPath,
  markdownTemplateEditorRecordPath,
} from "./licenses/lib/markdown-template-editor.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const refreshCommand = "npm run refresh:markdown-template-editor";

/** Build the packaged editor into caller-owned temporary output. */
export function buildMarkdownTemplateEditor({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  outputFolder,
  recordPath,
}) {
  const build = spawnSync(process.execPath, [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    path.join(root, "packages/view-markdown/vite.editor.config.ts"),
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: "production",
      TV_MARKDOWN_TEMPLATE_EDITOR_OUTPUT_DIR: path.resolve(outputFolder),
      TV_MARKDOWN_TEMPLATE_EDITOR_RECORD_OUTPUT: path.resolve(recordPath),
      TV_MARKDOWN_TEMPLATE_EDITOR_INVENTORY_ROOT: path.resolve(inventoryRoot),
    },
  });
  if (build.status !== 0 || build.error !== undefined) {
    const diagnostic = [build.stderr, build.stdout, build.error?.message]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n")
      .trim();
    throw new Error(`Markdown template editor build failed${diagnostic ? `:\n${diagnostic}` : ""}`);
  }
}

/** Build the packaged editor privately and compare every generated result with its committed copy. */
export async function checkMarkdownTemplateEditor({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  templateFolder = markdownTemplateEditorFolderPath({ root }),
  recordPath = markdownTemplateEditorRecordPath({ root }),
  observeFreshOutput,
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "television-markdown-template-editor-"));
  const outputFolder = path.join(temporaryRoot, "editor");
  const freshRecordPath = path.join(temporaryRoot, "template-editor-licenses.json");
  try {
    buildMarkdownTemplateEditor({
      root,
      inventoryRoot,
      outputFolder,
      recordPath: freshRecordPath,
    });

    const editorJavaScript = fs.readFileSync(path.join(outputFolder, "editor.js"));
    const editorStylesheet = fs.readFileSync(path.join(outputFolder, "editor.css"));
    const record = JSON.parse(fs.readFileSync(freshRecordPath, "utf8"));
    observeFreshOutput?.({ editorJavaScript, editorStylesheet, record });

    const errors = [];
    compareBytes(editorJavaScript, path.join(templateFolder, "editor.js"), "editor.js", errors);
    compareBytes(editorStylesheet, path.join(templateFolder, "editor.css"), "editor.css", errors);
    compareRecord(record, recordPath, errors);

    const config = loadLicenseConfig({ root });
    const assets = loadAssetManifest({ root, config });
    compareText(
      generateMarkdownTemplateNotices({ root, config, assets, record }),
      path.join(templateFolder, "THIRD-PARTY-NOTICES.txt"),
      "Markdown template THIRD-PARTY-NOTICES.txt",
      errors,
    );
    compareText(
      generateSourceNotices({ root, config, assets, markdownTemplateRecord: record }),
      path.join(root, "THIRD-PARTY-NOTICES.txt"),
      "repository THIRD-PARTY-NOTICES.txt",
      errors,
    );
    if (errors.length > 0) {
      errors.push(`Run \`${refreshCommand}\` to refresh the committed editor, licensing record, and notices.`);
    }
    return { ok: errors.length === 0, errors };
  } catch (error) {
    return { ok: false, errors: [message(error)] };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function compareBytes(fresh, committedPath, label, errors) {
  let committed;
  try {
    committed = fs.readFileSync(committedPath);
  } catch (error) {
    errors.push(`${label} differs: ${committedPath} could not be read (${message(error)})`);
    return;
  }
  if (!fresh.equals(committed)) errors.push(`${label} differs from the fresh Markdown template editor build`);
}

function compareText(fresh, committedPath, label, errors) {
  let committed;
  try {
    committed = fs.readFileSync(committedPath, "utf8");
  } catch (error) {
    errors.push(`${label} differs: ${committedPath} could not be read (${message(error)})`);
    return;
  }
  if (fresh !== committed) errors.push(`${label} differs from the fresh generated notice`);
}

function compareRecord(fresh, committedPath, errors) {
  let committed;
  try {
    committed = JSON.parse(fs.readFileSync(committedPath, "utf8"));
  } catch (error) {
    errors.push(`licensing record differs: ${committedPath} could not be read (${message(error)})`);
    return;
  }
  const freshPackages = new Set((fresh.packages ?? []).map(packageIdentity));
  const committedPackages = new Set((committed.packages ?? []).map(packageIdentity));
  for (const identity of symmetricDifference(freshPackages, committedPackages)) {
    errors.push(`package record ${identity} differs from the fresh Markdown template editor build`);
  }
  const freshAssets = new Set(fresh.assets ?? []);
  const committedAssets = new Set(committed.assets ?? []);
  for (const assetID of symmetricDifference(freshAssets, committedAssets)) {
    errors.push(`asset ID ${String(assetID)} differs from the fresh Markdown template editor build`);
  }
}

function packageIdentity(record) {
  return `${record?.name ?? "<missing>"}@${record?.version ?? "<missing>"}|${record?.declaredLicense ?? ""}|${record?.licenseFilePath ?? ""}`;
}

function symmetricDifference(left, right) {
  return [...new Set([
    ...[...left].filter((value) => !right.has(value)),
    ...[...right].filter((value) => !left.has(value)),
  ])].sort(compare);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function compare(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  const result = await checkMarkdownTemplateEditor();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  }
}
