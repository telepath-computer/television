import fs from "node:fs";
import path from "node:path";

export const BLAXEL_GITHUB_TOKEN_FILE = ".blaxel-gh-token";
export const BLAXEL_GITHUB_TOKEN_ENV = "BLAXEL_TV_GH_TOKEN";

export function readBlaxelGithubToken({ cwd = process.cwd(), env = process.env } = {}) {
  const tokenPath = path.join(cwd, BLAXEL_GITHUB_TOKEN_FILE);
  try {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    if (token) return token;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const envToken = env[BLAXEL_GITHUB_TOKEN_ENV]?.trim();
  return envToken || null;
}
