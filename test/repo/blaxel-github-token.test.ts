import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readBlaxelGithubToken } from "../../scripts/test/blaxel-github-token.mjs";
import { runPreflights } from "../../scripts/test/preflight.mjs";

const originalCwd = process.cwd();
const originalBlaxelToken = process.env.BLAXEL_TV_GH_TOKEN;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalBlaxelToken === undefined) delete process.env.BLAXEL_TV_GH_TOKEN;
  else process.env.BLAXEL_TV_GH_TOKEN = originalBlaxelToken;
});

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tv-blaxel-token-"));
}

describe("Blaxel GitHub token file", () => {
  test("reads and trims .blaxel-gh-token from the repository root", () => {
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, ".blaxel-gh-token"), "  github_pat_test\n\t");

    expect(readBlaxelGithubToken({ cwd: dir, env: {} })).toBe("github_pat_test");
  });

  test("treats a missing or whitespace-only token file as absent", () => {
    const missingDir = tempRepo();
    const emptyDir = tempRepo();
    fs.writeFileSync(path.join(emptyDir, ".blaxel-gh-token"), " \n\t");

    expect(readBlaxelGithubToken({ cwd: missingDir, env: {} })).toBeNull();
    expect(readBlaxelGithubToken({ cwd: emptyDir, env: {} })).toBeNull();
  });

  test("falls back to a trimmed BLAXEL_TV_GH_TOKEN environment variable", () => {
    const dir = tempRepo();

    expect(readBlaxelGithubToken({ cwd: dir, env: { BLAXEL_TV_GH_TOKEN: "  github_pat_env\n" } })).toBe("github_pat_env");
  });

  test("prefers .blaxel-gh-token over BLAXEL_TV_GH_TOKEN", () => {
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, ".blaxel-gh-token"), "github_pat_file\n");

    expect(readBlaxelGithubToken({ cwd: dir, env: { BLAXEL_TV_GH_TOKEN: "github_pat_env" } })).toBe("github_pat_file");
  });

  test("Blaxel preflight accepts BLAXEL_TV_GH_TOKEN when the token file is missing", () => {
    const dir = tempRepo();
    process.env.BLAXEL_TV_GH_TOKEN = "github_pat_env";
    process.chdir(dir);

    expect(runPreflights(["blaxel-github-token"], { provider: "blaxel" })).toMatchObject([
      { name: "blaxel-github-token", status: "passed" },
    ]);
  });

  test("Blaxel preflight rejects when the token file and environment variable are missing", () => {
    const dir = tempRepo();
    delete process.env.BLAXEL_TV_GH_TOKEN;
    process.chdir(dir);

    expect(runPreflights(["blaxel-github-token"], { provider: "blaxel" })).toMatchObject([
      { name: "blaxel-github-token", status: "failed" },
    ]);
  });
});
