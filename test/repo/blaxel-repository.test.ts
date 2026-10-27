import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  blaxelCheckoutScript,
  blaxelDependencyScript,
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

// Two bare repositories that share a base commit, standing in for the public
// repository and a private development repository on GitHub.
function twoRepositories(root: string) {
  const source = path.join(root, "source");
  mkdirSync(source);
  git(source, "init", "-q");
  writeFileSync(path.join(source, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(source, "package.json"), '{ "name": "fixture", "private": true }\n');
  git(source, "add", ".gitignore", "package.json");
  const base = commitFile(source, "package-lock.json", '{ "lockfileVersion": 3 }\n');
  const branch = git(source, "branch", "--show-current");
  const repositoryA = path.join(root, "a.git");
  const repositoryB = path.join(root, "b.git");
  git(root, "clone", "-q", "--bare", source, repositoryA);
  git(root, "clone", "-q", "--bare", source, repositoryB);

  const commitOnly = (repository: string, parent: string, file: string, contents: string): string => {
    git(source, "reset", "-q", "--hard", parent);
    const commit = commitFile(source, file, contents);
    git(source, "push", "-q", "--force", repository, `HEAD:${branch}`);
    return commit;
  };
  return { repositoryA, repositoryB, base, commitOnly };
}

function runBash(script: string, options: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync("bash", ["-c", script], {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...isolatedGitEnv, ...options.env },
  });
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

  // proofs/arch/test-runner/blaxel-testshards.md#^blaxel-repo-checkout-switch
  test("moves one persistent checkout between repositories without re-cloning or deleting ignored dependencies", () => {
    const root = temporaryRoot("tv-blaxel-repository-switch-");
    const { repositoryA, repositoryB, base, commitOnly } = twoRepositories(root);
    const commitAOnly = commitOnly(repositoryA, base, "a.txt", "only in A\n");
    const commitBOnly = commitOnly(repositoryB, base, "b.txt", "only in B\n");

    const checkout = path.join(root, "worker", "television");
    const runCheckout = (repoUrl: string, commit: string) => {
      const result = runBash(blaxelCheckoutScript({ repoUrl, commit, root: checkout }));
      expect(result.status, result.stderr).toBe(0);
      expect(git(checkout, "rev-parse", "HEAD")).toBe(commit);
      expect(git(checkout, "remote", "get-url", "origin")).toBe(repoUrl);
      return `${result.stdout}${result.stderr}`;
    };

    expect(runCheckout(repositoryA, commitAOnly)).toContain("Cloning into");
    const cloneSentinel = path.join(checkout, ".git", "tv-clone-sentinel");
    const dependencySentinel = path.join(checkout, "node_modules", "tv-dependency-sentinel");
    writeFileSync(cloneSentinel, "first clone\n");
    mkdirSync(path.dirname(dependencySentinel));
    writeFileSync(dependencySentinel, "installed\n");

    expect(runCheckout(repositoryB, commitBOnly)).not.toContain("Cloning into");
    expect(existsSync(path.join(checkout, "b.txt"))).toBe(true);
    expect(existsSync(path.join(checkout, "a.txt"))).toBe(false);

    const laterCommitAOnly = commitOnly(repositoryA, commitAOnly, "a2.txt", "later only in A\n");
    expect(runCheckout(repositoryA, laterCommitAOnly)).not.toContain("Cloning into");
    expect(existsSync(path.join(checkout, "a2.txt"))).toBe(true);
    expect(existsSync(path.join(checkout, "b.txt"))).toBe(false);

    expect(readFileSync(cloneSentinel, "utf8")).toBe("first clone\n");
    expect(readFileSync(dependencySentinel, "utf8")).toBe("installed\n");
  });

  // proofs/arch/test-runner/blaxel-testshards.md#^blaxel-repo-deps-reuse
  test("reuses installed dependencies across repositories until their declarations change", () => {
    const root = temporaryRoot("tv-blaxel-repository-deps-");
    const { repositoryA, repositoryB, base, commitOnly } = twoRepositories(root);
    const commitAOnly = commitOnly(repositoryA, base, "a.txt", "only in A\n");
    const commitBOnly = commitOnly(repositoryB, base, "b.txt", "only in B\n");
    const commitALockChange = commitOnly(repositoryA, commitAOnly, "package-lock.json", '{ "lockfileVersion": 3, "packages": {} }\n');

    const fakeBin = path.join(root, "bin");
    mkdirSync(fakeBin);
    const npmCalls = path.join(root, "npm-calls.txt");
    writeFileSync(path.join(fakeBin, "npm"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$TV_FAKE_NPM_CALLS"\nmkdir -p node_modules\n');
    chmodSync(path.join(fakeBin, "npm"), 0o755);
    const cacheStatus = path.join(root, "deps-cache-status.txt");
    const env = { PATH: `${fakeBin}:${process.env.PATH}`, TV_FAKE_NPM_CALLS: npmCalls, TV_TEST_DEPS_CACHE_STATUS_FILE: cacheStatus };

    const checkout = path.join(root, "worker", "television");
    const cacheDir = path.join(root, "cache", "blaxel-testshards");
    const checkoutAt = (repoUrl: string, commit: string) => {
      const result = runBash(blaxelCheckoutScript({ repoUrl, commit, root: checkout }));
      expect(result.status, result.stderr).toBe(0);
    };
    const deps = () => {
      const result = runBash(blaxelDependencyScript({ cacheDir }), { cwd: checkout, env });
      expect(result.status, result.stderr).toBe(0);
      const calls = existsSync(npmCalls) ? readFileSync(npmCalls, "utf8").trim().split("\n").filter(Boolean) : [];
      return { status: readFileSync(cacheStatus, "utf8").trim(), npmCalls: calls.length };
    };

    checkoutAt(repositoryA, commitAOnly);
    expect(deps()).toEqual({ status: "miss", npmCalls: 1 });
    expect(readFileSync(npmCalls, "utf8")).toContain("ci --prefer-offline --no-audit --fund=false");
    expect(deps()).toEqual({ status: "hit", npmCalls: 1 });

    checkoutAt(repositoryB, commitBOnly);
    expect(deps()).toEqual({ status: "hit", npmCalls: 1 });

    checkoutAt(repositoryA, commitALockChange);
    expect(deps()).toEqual({ status: "miss", npmCalls: 2 });
    expect(deps()).toEqual({ status: "hit", npmCalls: 2 });
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
