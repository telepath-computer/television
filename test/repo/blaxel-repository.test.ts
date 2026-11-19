import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  githubRepositoryHttpsUrl,
  resolveBlaxelRepositoryUrl,
} from "../../scripts/test/blaxel-repository.mjs";

const isolatedGitEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...isolatedGitEnv } });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commitFile(cwd: string, file: string, contents: string): string {
  writeFileSync(path.join(cwd, file), contents);
  git(cwd, "add", file);
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", file);
  return git(cwd, "rev-parse", "HEAD");
}

describe("Blaxel repository selection", () => {
  // proofs/arch/test-runner/blaxel-testshards.md#^blaxel-repo-url-conversion
  test("converts GitHub remote URLs to credential-free HTTPS repository URLs", () => {
    const expected = "https://github.com/example-org/example-repository.git";
    for (const remote of [
      "https://github.com/example-org/example-repository",
      "https://github.com/example-org/example-repository.git",
      "https://github.com/example-org/example-repository/",
      "https://x-access-token:ghp_secret@github.com/example-org/example-repository.git",
      "https://ghp_secret@GitHub.com/example-org/example-repository",
      "git@github.com:example-org/example-repository.git",
      "git@github.com:example-org/example-repository",
      "ssh://git@github.com/example-org/example-repository.git",
      "ssh://git@github.com:22/example-org/example-repository",
    ]) {
      const converted = githubRepositoryHttpsUrl(remote);
      expect(converted, remote).toBe(expected);
      expect(converted).not.toContain("ghp_secret");
    }
    expect(githubRepositoryHttpsUrl("https://github.com/telepath-computer/television")).toBe("https://github.com/telepath-computer/television.git");

    for (const remote of [
      "https://gitlab.com/telepath-computer/television.git",
      "https://github.com.example.com/telepath-computer/television.git",
      "git@bitbucket.org:telepath-computer/television.git",
      "/home/user/workspace/television",
      "file:///home/user/workspace/television.git",
      "https://github.com/telepath-computer",
      "https://github.com/telepath-computer/television/tree/main",
      "git@github.com:television.git",
      "",
    ]) {
      expect(() => githubRepositoryHttpsUrl(remote), remote).toThrow(/does not name a GitHub repository/);
    }
    for (const remote of [
      "https://ghp_secret@gitlab.com/telepath-computer/television.git",
      "https://user@example.com:ghp_secret@gitlab.com/telepath-computer/television",
      "user:ghp_secret@gitlab.com:telepath-computer/television.git",
      "https:/user:ghp_secret@gitlab.com/telepath-computer/television",
    ]) {
      let rejection: unknown;
      try {
        githubRepositoryHttpsUrl(remote);
      } catch (error) {
        rejection = error;
      }
      expect(String(rejection), remote).toContain("does not name a GitHub repository");
      expect(String(rejection), remote).not.toContain("ghp_secret");
    }
  });

  // proofs/arch/test-runner/blaxel-testshards.md#^blaxel-repo-origin-selection
  test("selects the repository from the checkout's origin unless --repo-url is given", () => {
    const checkout = temporaryRoot("tv-blaxel-repository-origin-");
    git(checkout, "init", "-q");
    expect(() => resolveBlaxelRepositoryUrl({ cwd: checkout })).toThrow();

    git(checkout, "remote", "add", "origin", "git@github.com:example-org/example-repository.git");
    expect(resolveBlaxelRepositoryUrl({ cwd: checkout })).toBe("https://github.com/example-org/example-repository.git");

    git(checkout, "remote", "set-url", "origin", "https://git.example.com/mirror/television.git");
    expect(() => resolveBlaxelRepositoryUrl({ cwd: checkout })).toThrow(/does not name a GitHub repository/);
    expect(resolveBlaxelRepositoryUrl({ cwd: checkout, repoUrl: "https://ghp_secret@github.com/telepath-computer/television" }))
      .toBe("https://github.com/telepath-computer/television.git");
  });

  // proofs/arch/test-runner/blaxel-testshards.md#^blaxel-repo-reject-before-dispatch
  test("stops the coordinator before dispatch when origin is not a GitHub repository", () => {
    const checkout = temporaryRoot("tv-blaxel-repository-reject-");
    git(checkout, "init", "-q");
    commitFile(checkout, "README.md", "fixture\n");
    git(checkout, "remote", "add", "origin", "https://git.example.com/mirror/television.git");
    const outputDir = path.join(checkout, "blaxel-output");

    const coordinator = path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs");
    const result = spawnSync(process.execPath, [coordinator, "--suite", "unit", "--pool", "unused", "--output-dir", outputDir], {
      cwd: checkout,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, ...isolatedGitEnv, BLAXEL_TV_GH_TOKEN: "placeholder-token" },
    });

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("does not name a GitHub repository");
    expect(existsSync(outputDir)).toBe(false);
  });

  // proofs/arch/test-runner/blaxel-testshards.md#^blaxel-repo-coordinator-wiring
  test("selects the coordinator repository and worker checkout through the shared repository module", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs"), "utf8");
    expect(source).toContain('resolveBlaxelRepositoryUrl({ repoUrl: options["repo-url"] })');
    expect(source).toContain("run_step checkout bash -lc ${shellQuote(blaxelCheckoutScript({ repoUrl, commit }))}");
    expect(source).toContain("run_step deps bash -c ${shellQuote(blaxelDependencyScript())}");
    expect(source).not.toMatch(/github\.com\/[\w.-]+\/[\w.-]+/);
    expect(source).not.toContain("git clone");
    expect(source).not.toContain("npm ci");
  });
});
