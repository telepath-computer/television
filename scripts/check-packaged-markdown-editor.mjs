import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInventoryRoot } from "./licenses/lib/inventory.mjs";
import {
  packagedMarkdownEditorFolderPath,
  packagedMarkdownEditorLicensingRecordPath,
} from "./licenses/lib/packaged-markdown-editor.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const refreshCommand = "npm run refresh:packaged-markdown-editor";

/** Build the packaged Markdown editor into caller-owned temporary output. */
export function buildPackagedMarkdownEditor({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  outputFolder,
  recordPath,
}) {
  const build = spawnSync(process.execPath, [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "build",
    "--config",
    path.join(root, "packages/view-markdown/vite.packaged-markdown-editor.config.ts"),
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: "production",
      TV_PACKAGED_MARKDOWN_EDITOR_OUTPUT_DIR: path.resolve(outputFolder),
      TV_PACKAGED_MARKDOWN_EDITOR_RECORD_OUTPUT: path.resolve(recordPath),
      TV_PACKAGED_MARKDOWN_EDITOR_INVENTORY_ROOT: path.resolve(inventoryRoot),
    },
  });
  if (build.status !== 0 || build.error !== undefined) {
    const diagnostic = [build.stderr, build.stdout, build.error?.message]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n")
      .trim();
    throw new Error(`packaged Markdown editor build failed${diagnostic ? `:\n${diagnostic}` : ""}`);
  }
}

/** Build the packaged Markdown editor privately and compare its checked output with the committed copies. */
export async function checkPackagedMarkdownEditor({
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  templateFolder = packagedMarkdownEditorFolderPath({ root }),
  recordPath = packagedMarkdownEditorLicensingRecordPath({ root }),
  observeFreshOutput,
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "television-packaged-markdown-editor-"));
  const outputFolder = path.join(temporaryRoot, "editor");
  const freshRecordPath = path.join(temporaryRoot, "packaged-markdown-editor-licenses.json");
  try {
    buildPackagedMarkdownEditor({
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

    if (errors.length > 0) {
      errors.push(`Run \`${refreshCommand}\` to refresh the committed editor, licensing record, and notices.`);
    }
    return { ok: errors.length === 0, errors };
  } catch (error) {
    const failure = message(error);
    const errors = [failure];
    if (!failure.includes(refreshCommand)) {
      errors.push(`Run \`${refreshCommand}\` to rebuild the inventory and refresh the committed files.`);
    }
    return {
      ok: false,
      errors,
    };
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
  if (!fresh.equals(committed)) errors.push(`${label} differs from the fresh packaged Markdown editor build`);
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
    errors.push(`package record ${identity} differs from the fresh packaged Markdown editor build`);
  }
  const freshAssets = new Set(fresh.assets ?? []);
  const committedAssets = new Set(committed.assets ?? []);
  for (const assetID of symmetricDifference(freshAssets, committedAssets)) {
    errors.push(`asset ID ${String(assetID)} differs from the fresh packaged Markdown editor build`);
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
  const result = await checkPackagedMarkdownEditor();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  }
}
