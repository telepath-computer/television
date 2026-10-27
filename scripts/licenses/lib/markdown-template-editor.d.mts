import type { VendoredAsset } from "./config.mjs";
import type { SurfaceInventoryPackage } from "./inventory.mjs";

export interface MarkdownTemplateEditorLicensingRecord {
  packages: SurfaceInventoryPackage[];
  assets: string[];
}

export function documentTemplateEditorFolderPath(options?: { root?: string }): string;

export function markdownTemplateEditorRecordPath(options?: { root?: string }): string;

export function readMarkdownTemplateEditorRecord(options?: {
  root?: string;
  recordPath?: string;
  assets?: VendoredAsset[];
}): MarkdownTemplateEditorLicensingRecord;
