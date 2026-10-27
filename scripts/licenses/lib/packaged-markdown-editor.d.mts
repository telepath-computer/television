import type { VendoredAsset } from "./config.mjs";
import type { SurfaceInventoryPackage } from "./inventory.mjs";

export interface PackagedMarkdownEditorLicensingRecord {
  packages: SurfaceInventoryPackage[];
  assets: string[];
}

export function packagedMarkdownEditorFolderPath(options?: { root?: string }): string;

export function packagedMarkdownEditorLicensingRecordPath(options?: { root?: string }): string;

export function readPackagedMarkdownEditorRecord(options?: {
  root?: string;
  recordPath?: string;
  assets?: VendoredAsset[];
}): PackagedMarkdownEditorLicensingRecord;
