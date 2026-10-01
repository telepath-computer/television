export const BLAXEL_GITHUB_TOKEN_FILE: ".blaxel-gh-token";
export const BLAXEL_GITHUB_TOKEN_ENV: "BLAXEL_TV_GH_TOKEN";

export function readBlaxelGithubToken(options?: {
  cwd?: string;
  env?: Record<string, string | undefined>;
}): string | null;
