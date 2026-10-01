import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// The e2e:node surface's preCommand builds the desktop bundle before these
// tests run; the build script's upload-only hook then generates the upload
// directory from that build and stops before `todesktop build`.
const repoRoot = path.resolve(import.meta.dirname, "../..");
const desktopRoot = path.join(repoRoot, "packages/desktop");
const buildScript = path.join(desktopRoot, "scripts/todesktop-build.mjs");
const uploadEntries = ["LICENSE", "assets", "dist", "package-lock.json", "package.json", "todesktop.json"];

type Manifest = {
  name?: string;
  version?: string;
  main?: string;
  homepage?: string;
  author?: string | { name?: string; email?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Lockfile = { packages?: Record<string, Manifest> };

type ToDesktopConfig = {
  id?: string;
  appId?: string;
  productName?: string;
  icon?: string;
  buildVersion?: string;
  nodeVersion?: string;
  appBuilderLibVersion?: string;
  fuses?: { runAsNode?: boolean };
};

const tempRoots: string[] = [];
let uploadDir = "";

beforeAll(() => {
  uploadDir = path.join(makeTempRoot("tv-desktop-upload-"), "upload");
  const result = runBuildScript(["--upload-only", uploadDir]);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});

afterAll(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop upload directory", () => {
  // proofs/arch/desktop/distribution.md#^desktop-dist-t-upload
  test("holds the built app, the license, a generated manifest and lockfile, and the configuration", () => {
    expect(readdirSync(uploadDir).sort()).toEqual(uploadEntries);
    const { "electron.cjs": mainBundle, ...otherBundleFiles } = treeBytes(path.join(desktopRoot, "dist"));
    expect(mainBundle).toBeDefined();
    expect(treeBytes(path.join(uploadDir, "dist"))).toEqual({ ...otherBundleFiles, "electron.js": mainBundle });
    expect(treeBytes(path.join(uploadDir, "assets"))).toEqual(treeBytes(path.join(desktopRoot, "assets")));

    const workspace = readJSON<Manifest>(path.join(desktopRoot, "package.json"));
    const manifest = readJSON<Manifest>(path.join(uploadDir, "package.json"));
    expect(manifest.version).toBe(workspace.version);
    expect(manifest.main).toBe("dist/electron.js");
    expect(manifest).not.toHaveProperty("type");
    expect(manifest.homepage).toMatch(/\S/);
    expect(manifest.author).toEqual(workspace.author);
    expect(manifest.dependencies).toEqual(workspace.dependencies);
    expect(manifest.devDependencies).toEqual({ electron: runtimeVersion() });

    const lockRoot = readJSON<Lockfile>(path.join(uploadDir, "package-lock.json")).packages?.[""];
    expect(lockRoot?.dependencies).toEqual(manifest.dependencies);
    expect(lockRoot?.devDependencies).toEqual(manifest.devDependencies);
  });

  // proofs/arch/desktop/distribution.md#^desktop-dist-t-upload
  test("names an author with an email address, as ToDesktop requires", () => {
    const manifest = readJSON<Manifest>(path.join(uploadDir, "package.json"));
    expect(authorEmail(manifest.author)).toMatch(/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/);
  });

  // proofs/arch/desktop/distribution.md#^desktop-dist-t-config
  test("carries the ToDesktop configuration values that other specs rely on", () => {
    const config = readJSON<ToDesktopConfig>(path.join(uploadDir, "todesktop.json"));
    const manifest = readJSON<Manifest>(path.join(uploadDir, "package.json"));

    expect(config.id).toMatch(/\S/);
    expect(config.appId).toBe("computer.telepath.television");
    expect(config.productName).toBe("Television");
    expect(config.icon).toBe("assets/icon.icns");
    expect(statSync(path.join(uploadDir, config.icon!)).isFile()).toBe(true);
    expect(config.buildVersion).toBe(manifest.version);
    expect(config.nodeVersion).toBe(readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim());
    expect(config.appBuilderLibVersion).toBe("26.16.1");
    expect(config.fuses?.runAsNode).toBe(false);
  });

  // proofs/arch/desktop/distribution.md#^desktop-dist-t-bundle-imports
  test("loads nothing from outside dist/ but Node built-ins, Electron and declared dependencies", () => {
    const manifest = readJSON<Manifest>(path.join(uploadDir, "package.json"));
    const available = new Set(["electron", ...Object.keys(manifest.dependencies ?? {})]);
    const distDir = path.join(uploadDir, "dist");
    const loaded = new Set<string>();
    const unavailable: string[] = [];

    for (const file of listFiles(distDir).filter((entry) => /\.[cm]?js$/.test(entry))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) {
          const target = path.resolve(path.dirname(file), specifier);
          if (!target.startsWith(`${distDir}${path.sep}`)) unavailable.push(`${path.relative(distDir, file)}: ${specifier}`);
          continue;
        }
        loaded.add(specifier);
        if (isBuiltin(specifier) || available.has(packageName(specifier))) continue;
        unavailable.push(`${path.relative(distDir, file)}: ${specifier}`);
      }
    }

    expect(unavailable).toEqual([]);
    expect(loaded).toContain("electron");
    expect(loaded).toContain("@todesktop/runtime");
  });
});

describe("desktop build script", () => {
  // proofs/arch/desktop/distribution.md#^desktop-dist-t-build-exit
  test("runs todesktop build from the upload directory following the build log, and fails when it fails", () => {
    const root = makeTempRoot("tv-desktop-build-exit-");
    const standIn = writeStandIn(root);

    for (const status of [0, 3]) {
      const record = path.join(root, `record-${status}.json`);
      const result = runBuildScript([], {
        TV_TODESKTOP_COMMAND: standIn,
        STAND_IN_RECORD: record,
        STAND_IN_STATUS: String(status),
      });
      const recorded = readJSON<{ args: string[]; cwd: string; entries: string[] }>(record);

      expect(recorded.args).toEqual(["build", "--follow-logs"]);
      expect(recorded.entries).toEqual(uploadEntries);
      expect(path.resolve(recorded.cwd)).not.toBe(desktopRoot);
      if (status === 0) expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      else expect(result.status).not.toBe(0);
    }
  });

  // proofs/arch/desktop/distribution.md#^desktop-dist-t-unsigned
  test("passes --code-sign=false to todesktop build for an unsigned test build", () => {
    const root = makeTempRoot("tv-desktop-build-unsigned-");
    const record = path.join(root, "record.json");
    const result = runBuildScript(["--code-sign=false"], {
      TV_TODESKTOP_COMMAND: writeStandIn(root),
      STAND_IN_RECORD: record,
      STAND_IN_STATUS: "0",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readJSON<{ args: string[] }>(record).args).toEqual(["build", "--follow-logs", "--code-sign=false"]);
  });

  // proofs/arch/desktop/distribution.md#^desktop-dist-t-dry-run
  test("passes the ToDesktop CLI's own checks in a dry run", () => {
    const result = runBuildScript(["--dry-run"], toDesktopSignedOutEnv(makeTempRoot("tv-desktop-dry-run-")));

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("ToDesktop build dry run");
  });
});

describe("release identity", () => {
  // proofs/product/versioning.md#^versioning-ac-release-identity
  test("the CLI package and a desktop build of the same commit carry one release version", () => {
    const rootVersion = readJSON<Manifest>(path.join(repoRoot, "package.json")).version;
    const packDir = makeTempRoot("tv-release-pack-");
    const packed = JSON.parse(execFileSync(
      "npm",
      ["pack", "--workspace", "@telepath-computer/television", "--ignore-scripts", "--json", "--pack-destination", packDir],
      { cwd: repoRoot, encoding: "utf8" },
    )) as Array<{ filename: string }>;
    const packedManifest = JSON.parse(execFileSync(
      "tar",
      ["-xOf", path.join(packDir, packed[0]!.filename), "package/package.json"],
      { encoding: "utf8" },
    )) as Manifest;

    expect(packedManifest.name).toBe("@telepath-computer/television");
    expect(packedManifest.version).toBe(rootVersion);
    expect(readJSON<Manifest>(path.join(uploadDir, "package.json")).version).toBe(rootVersion);
    expect(readJSON<ToDesktopConfig>(path.join(uploadDir, "todesktop.json")).buildVersion).toBe(rootVersion);
  });
});

function runBuildScript(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [buildScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 50 * 1024 * 1024,
  });
}

// A stand-in for the ToDesktop CLI that records its arguments, working
// directory and the directory's entries, then exits with STAND_IN_STATUS.
function writeStandIn(root: string): string {
  const standIn = path.join(root, "todesktop-stand-in.mjs");
  writeFileSync(standIn, [
    "#!/usr/bin/env node",
    "import { readdirSync, writeFileSync } from \"node:fs\";",
    "writeFileSync(process.env.STAND_IN_RECORD, JSON.stringify({",
    "  args: process.argv.slice(2),",
    "  cwd: process.cwd(),",
    "  entries: readdirSync(process.cwd()).sort(),",
    "}));",
    "process.exit(Number(process.env.STAND_IN_STATUS));",
    "",
  ].join("\n"));
  chmodSync(standIn, 0o755);
  return standIn;
}

// An environment in which the ToDesktop CLI has no credentials: no credential
// variables, and its configuration and logs in a temporary directory. The
// command hook is unset, so the build script runs the workspace's CLI.
// NODE_ENV is unset as it is for a developer or the build workflow: Vitest sets
// it to "test", which makes the CLI load a settings file it does not ship.
function toDesktopSignedOutEnv(root: string): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: undefined,
    TODESKTOP_EMAIL: undefined,
    TODESKTOP_ACCESS_TOKEN: undefined,
    TV_TODESKTOP_COMMAND: undefined,
    TODESKTOP_CONFIG_DIR: path.join(root, "todesktop-config"),
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
  };
}

function runtimeVersion(): string | undefined {
  return readJSON<Manifest>(path.join(repoRoot, "package.json")).devDependencies?.electron;
}

function authorEmail(author: Manifest["author"]): string | undefined {
  if (typeof author === "string") return /<([^>]+)>/.exec(author)?.[1];
  return author?.email;
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function treeBytes(root: string): Record<string, string> {
  return Object.fromEntries(listFiles(root).map((file) => [
    path.relative(root, file).split(path.sep).join("/"),
    readFileSync(file).toString("base64"),
  ]));
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }).sort();
}

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function readJSON<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
