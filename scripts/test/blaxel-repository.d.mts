export const BLAXEL_WORKER_CHECKOUT: "/workspace/television";
export const BLAXEL_DEPENDENCY_CACHE: "/cache/blaxel-testshards";

export function githubRepositoryHttpsUrl(url: string): string;

export function resolveBlaxelRepositoryUrl(options?: {
  repoUrl?: string | null;
  cwd?: string;
}): string;

export function blaxelCheckoutScript(options: {
  repoUrl: string;
  commit: string;
  root?: string;
}): string;

export function blaxelDependencyScript(options?: {
  cacheDir?: string;
}): string;
