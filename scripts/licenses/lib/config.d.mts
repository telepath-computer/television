import type { LicenseSurface } from "./surfaces.mjs";
export type { LicenseSurface } from "./surfaces.mjs";

export interface LicenseElection {
  package: string;
  offered: string;
  elected: string;
}

export interface NoticeText {
  package: string;
  text: string;
  source: string;
}

export interface IgnoredPackage {
  pattern: string;
}

export interface LicenseConfig {
  allow: string[];
  elections: LicenseElection[];
  notices: NoticeText[];
  ignored: IgnoredPackage[];
}

export interface VendoredComponent {
  package?: string;
  version?: string;
  name?: string;
  license: string;
  noticeText: string;
}

export interface VendoredAsset {
  id: string;
  paths: string[];
  components: VendoredComponent[];
  surfaces: LicenseSurface[];
  noticesFolder?: string;
}

export interface LoadLicenseConfigOptions {
  root?: string;
  configPath?: string;
}

export interface LoadAssetManifestOptions {
  root?: string;
  assetsPath?: string;
  config?: LicenseConfig;
}

export function loadLicenseConfig(options?: LoadLicenseConfigOptions): LicenseConfig;
export function isIgnoredPackage(packageName: string, config: LicenseConfig): boolean;
export function loadAssetManifest(options?: LoadAssetManifestOptions): VendoredAsset[];
