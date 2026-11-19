export function githubRepositoryHttpsUrl(url: string): string;

export function resolveBlaxelRepositoryUrl(options?: {
  repoUrl?: string | null;
  cwd?: string;
}): string;

export function blaxelCheckoutScript(options: {
  repoUrl: string;
  commit: string;
}): string;

export function blaxelDependencyScript(): string;
