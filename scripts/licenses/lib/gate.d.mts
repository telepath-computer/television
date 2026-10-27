import type { LicenseConfig, VendoredAsset } from "./config.mjs";
import type { InventorySurface, SurfaceInventory } from "./inventory.mjs";
import type { PackagedMarkdownEditorLicensingRecord } from "./packaged-markdown-editor.mjs";

export interface LicenseGateResult {
  ok: boolean;
  surfaces: InventorySurface[];
  errors: string[];
}

export interface EvaluateLicenseGateOptions {
  root?: string;
  inventoryRoot?: string;
  inventories?: SurfaceInventory[];
  config?: LicenseConfig;
  assets?: VendoredAsset[];
  declaringManifestPaths?: string[];
  sourceNoticePath?: string;
  checkSourceNotice?: boolean;
  packagedMarkdownEditorLicensingRecordPath?: string;
  documentTemplateNoticePath?: string;
  checkPackagedMarkdownEditor?: boolean;
}

export function evaluateLicenseGate(options?: EvaluateLicenseGateOptions): LicenseGateResult;

export function sourceNoticeError(options?: {
  root?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
  sourceNoticePath?: string;
  packagedMarkdownEditorRecord?: PackagedMarkdownEditorLicensingRecord | null;
}): string | null;

export function documentTemplateNoticeError(options?: {
  root?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
  record?: PackagedMarkdownEditorLicensingRecord;
  noticePath?: string;
}): string | null;

export function folderNoticeErrors(options?: {
  root?: string;
  config?: LicenseConfig;
  assets?: VendoredAsset[];
}): string[];

export function formatLicenseGateErrors(errors: string[]): string;
