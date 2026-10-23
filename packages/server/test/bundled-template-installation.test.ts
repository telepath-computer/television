import { spawnSync } from "node:child_process";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_ARTIFACT_TEMPLATE_IDS, BUNDLED_ARTIFACT_TEMPLATES, runBundledTemplateInstallation, type BundledTemplateOperations } from "../src/bundled-template-installer.ts";
import { ServerStore } from "../src/server-store.ts";
import { scanTemplatesDirectory } from "../src/templates.ts";

const packageRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(packageRoot, "assets/templates");
const validator = path.join(packageRoot, "scripts/validate-templates.mjs");
const roots: string[] = [];
const stores: ServerStore[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-bundled-template-"));
  roots.push(root);
  return root;
}

function sourceCopy(): string {
  const root = path.join(tempRoot(), "templates");
  cpSync(sourceRoot, root, { recursive: true });
  return root;
}

function runValidator(root: string) {
  return spawnSync(process.execPath, [validator, root], { encoding: "utf8" });
}

function servingBoot(home: string, bundledTemplatesPath = sourceRoot, bundledTemplateOperations?: Partial<BundledTemplateOperations>): ServerStore {
  const store = new ServerStore({ storagePath: home, bundledTemplatesPath, bundledTemplateOperations, installOnboardingChannels: true });
  stores.push(store);
  return store;
}

function statePath(home: string): string {
  return path.join(home, "state/bundled-templates.json");
}

function writeState(home: string, ids: string[]): void {
  mkdirSync(path.dirname(statePath(home)), { recursive: true });
  writeFileSync(statePath(home), `${JSON.stringify({ version: 1, installedTemplateIDs: ids }, null, 2)}\n`);
}

function files(root: string, prefix = ""): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(root, relative) : [relative];
  }).sort();
}

function snapshotRegularFiles(root: string): Record<string, Buffer> {
  return Object.fromEntries(files(root)
    .filter((relative) => lstatSync(path.join(root, relative)).isFile())
    .map((relative) => [relative, readFileSync(path.join(root, relative))]));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bundled artifact template package", () => {
  // proofs/arch/templates/bundled-templates.md#^templates-example-t-package
  // proofs/arch/templates/bundled-templates.md#^templates-example-t-no-display
  it("declares the sole Example with its minimum version, data schema, unwritten store, and adapting guidance", () => {
    expect(BUNDLED_ARTIFACT_TEMPLATE_IDS).toEqual(["example"]);
    expect(BUNDLED_ARTIFACT_TEMPLATES).toEqual([{ id: "example", minimumVersion: "1.0.0" }]);
    const folder = path.join(sourceRoot, "example");
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      name: "Example", description: "A live message that an agent can change.", version: "1.0.0",
      dataSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    });
    expect(manifest).not.toHaveProperty("display");
    expect(manifest).not.toHaveProperty("url");
    expect(existsSync(path.join(folder, "data.json"))).toBe(false);
    const guidance = readFileSync(path.join(folder, "README.md"), "utf8");
    expect(guidance).toMatch(/`message` string.*store/i);
    expect(guidance).toMatch(/each artifact.*store/i);
    expect(guidance).toContain("tv resource json");
    expect(guidance).toMatch(/copy or detach.*(?:page files|files).*one artifact/i);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-validate
  it("accepts only the valid Example at or above its minimum version", () => {
    expect(runValidator(sourceRoot).status).toBe(0);
    const expectRefused = (root: string, diagnostic: RegExp) => {
      const result = runValidator(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(diagnostic);
    };
    const missing = sourceCopy();
    rmSync(path.join(missing, "example"), { recursive: true });
    expectRefused(missing, /missing.*example/i);
    const extra = sourceCopy();
    mkdirSync(path.join(extra, "extra"));
    expectRefused(extra, /unexpected.*extra/i);
    const extraFile = sourceCopy();
    writeFileSync(path.join(extraFile, "stray.txt"), "stray\n");
    expectRefused(extraFile, /unexpected.*stray\.txt/i);
    const invalid = sourceCopy();
    rmSync(path.join(invalid, "example/index.html"));
    expectRefused(invalid, /example.*index\.html/i);
    const old = sourceCopy();
    writeFileSync(path.join(old, "example/manifest.json"), JSON.stringify({
      name: "Example", description: "A live message that an agent can change.", version: "0.9.9",
    }));
    expectRefused(old, /example.*below minimum/i);
  });

});

describe("bundled artifact template serving installation", () => {
  // proofs/arch/templates/bundled-installation.md#^templates-install-t-boot
  it("installs an unhandled Example, preserves a handled deletion, and does nothing at token-only construction", () => {
    const home = tempRoot();
    stores.push(new ServerStore({ storagePath: home, bundledTemplatesPath: sourceRoot }));
    expect(existsSync(path.join(home, "templates/example"))).toBe(false);
    servingBoot(home);
    expect(files(path.join(home, "templates/example"))).toEqual(files(path.join(sourceRoot, "example")));
    expect(JSON.parse(readFileSync(statePath(home), "utf8"))).toEqual({ version: 1, installedTemplateIDs: ["example"] });
    rmSync(path.join(home, "templates/example"), { recursive: true });
    servingBoot(home);
    expect(existsSync(path.join(home, "templates/example"))).toBe(false);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("finishes backup, durably unhandles the ID, removes the destination, replaces it, then records success", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["example", "other"]);
    const former = snapshotRegularFiles(installed);
    const calls: string[] = [];
    servingBoot(home, sourceRoot, {
      cpSync(from, to, options) {
        cpSync(from, to, options);
        if (from === installed) {
          expect(snapshotRegularFiles(String(to))).toEqual(former);
          calls.push("backup complete");
        } else if (from === path.join(sourceRoot, "example")) {
          expect(existsSync(installed)).toBe(false);
          expect(snapshotRegularFiles(String(to))).toEqual(snapshotRegularFiles(path.join(sourceRoot, "example")));
          calls.push("copy complete");
        }
      },
      renameSync(from, to) {
        renameSync(from, to);
        if (to === installed) {
          expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "example")));
          calls.push("replacement complete");
          return;
        }
        const ids = JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs;
        if (ids.includes("example")) {
          expect(ids).toEqual(["example", "other"]);
          calls.push("handled");
        } else {
          expect(ids).toEqual(["other"]);
          expect(snapshotRegularFiles(installed)).toEqual(former);
          calls.push("unhandled");
        }
      },
      rmSync(filename, options) {
        rmSync(filename, options);
        if (filename === installed) calls.push("destination removed");
      },
    });
    expect(calls).toEqual(["backup complete", "unhandled", "destination removed", "copy complete", "replacement complete", "handled"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("restores an absent destination on the next serving boot after interruption following removal", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["example"]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const interrupted = servingBoot(home, sourceRoot, {
      rmSync(filename, options) {
        rmSync(filename, options);
        if (filename === installed) throw new Error("stop after destination removal");
      },
    });
    expect(warning).toHaveBeenCalled();
    expect(existsSync(installed)).toBe(false);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual([]);
    const backup = readdirSync(path.dirname(installed)).find((name) => name.startsWith(".example.backup."));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(path.dirname(installed), backup!, "index.html"), "utf8")).toBe("old page");
    interrupted.dispose();

    const recovered = servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "example")));
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
    expect(recovered.templateCache!.getSnapshot().templates.map(({ id }) => id)).toEqual(["example"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("leaves the destination and handled state intact when removing its ID cannot be written", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["example"]);
    const former = snapshotRegularFiles(installed);
    const state = readFileSync(statePath(home));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = servingBoot(home, sourceRoot, {
      writeFileSync(filename, bytes) {
        mkdirSync(String(filename));
        return writeFileSync(filename, bytes);
      },
    });
    expect(warning).toHaveBeenCalled();
    expect(snapshotRegularFiles(installed)).toEqual(former);
    expect(readFileSync(statePath(home))).toEqual(state);
    const backup = readdirSync(path.dirname(installed)).find((name) => name.startsWith(".example.backup."));
    expect(backup).toBeDefined();
    expect(snapshotRegularFiles(path.join(path.dirname(installed), backup!))).toEqual(former);
    failed.dispose();
    servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "example")));
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-boot
  it("keeps an edited valid installed copy at the minimum and backs up an old copy before replacement", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    cpSync(path.join(sourceRoot, "example"), installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "edited page");
    const edited = snapshotRegularFiles(installed);
    servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(edited);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Example", description: "edited", version: "2.0.0" }));
    const newer = snapshotRegularFiles(installed);
    servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(newer);
    expect(JSON.parse(readFileSync(path.join(installed, "manifest.json"), "utf8")).version).toBe("2.0.0");
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Example", description: "old", version: "0.9.0" }));
    servingBoot(home);
    expect(readFileSync(path.join(installed, "index.html"), "utf8")).not.toBe("edited page");
    const backup = readdirSync(path.join(home, "templates")).find((name) => /^\.example\.backup\.\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(name));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(home, "templates", backup!, "index.html"), "utf8")).toBe("edited page");
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-state
  it.each([
    ["malformed JSON", "{"],
    ["wrong version", JSON.stringify({ version: 2, installedTemplateIDs: [] })],
    ["non-string ID", JSON.stringify({ version: 1, installedTemplateIDs: [7] })],
    ["duplicate ID", JSON.stringify({ version: 1, installedTemplateIDs: ["example", "example"] })],
    ["unsorted IDs", JSON.stringify({ version: 1, installedTemplateIDs: ["z", "a"] })],
    ["unknown field", JSON.stringify({ version: 1, installedTemplateIDs: [], extra: true })],
  ])("invalid %s state warns and prevents handling or state writes", (_case, bytes) => {
    const home = tempRoot();
    mkdirSync(path.dirname(statePath(home)), { recursive: true });
    writeFileSync(statePath(home), bytes);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    servingBoot(home, sourceRoot, {
      writeFileSync(filename, value) { calls.push("write"); return writeFileSync(filename, value); },
      renameSync(from, to) { calls.push("rename"); return renameSync(from, to); },
    });
    expect(warning).toHaveBeenCalled();
    expect(existsSync(path.join(home, "templates/example"))).toBe(false);
    expect(readFileSync(statePath(home), "utf8")).toBe(bytes);
    expect(calls).toEqual([]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-state
  it("unreadable state warns and prevents handling or state writes", () => {
    const unreadableHome = tempRoot();
    mkdirSync(statePath(unreadableHome), { recursive: true });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    servingBoot(unreadableHome, sourceRoot, {
      writeFileSync(filename, value) { calls.push("write"); return writeFileSync(filename, value); },
      renameSync(from, to) { calls.push("rename"); return renameSync(from, to); },
    });
    expect(warning).toHaveBeenCalled();
    expect(existsSync(path.join(unreadableHome, "templates/example"))).toBe(false);
    expect(existsSync(statePath(unreadableHome))).toBe(true);
    expect(calls).toEqual([]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-state
  it("writes state to a same-directory temporary file and renames it atomically", () => {
    const home = tempRoot();
    writeState(home, ["older-bundle"]);
    const oldLink = path.join(home, "former-state.json");
    linkSync(statePath(home), oldLink);
    const calls: string[] = [];
    servingBoot(home, sourceRoot, {
      writeFileSync(filename, bytes) {
        calls.push(`write:${filename}`);
        return writeFileSync(filename, bytes);
      },
      renameSync(from, to) {
        if (to === statePath(home)) calls.push(`rename:${from}:${to}`);
        return renameSync(from, to);
      },
    });
    expect(calls).toHaveLength(2);
    const temporary = calls[0]!.slice("write:".length);
    expect(path.dirname(temporary)).toBe(path.dirname(statePath(home)));
    expect(calls[1]).toBe(`rename:${temporary}:${statePath(home)}`);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example", "older-bundle"]);
    expect(JSON.parse(readFileSync(oldLink, "utf8")).installedTemplateIDs).toEqual(["older-bundle"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-state-retry
  it("keeps the installed folder and old state bytes when a real temporary-file obstruction rejects state write, then records it on retry", () => {
    const home = tempRoot();
    writeState(home, []);
    const former = readFileSync(statePath(home));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    servingBoot(home, sourceRoot, {
      writeFileSync(filename, bytes) {
        if (typeof filename !== "string") throw new Error("expected bundled state temporary path");
        mkdirSync(filename);
        return writeFileSync(filename, bytes);
      },
      renameSync,
    });
    expect(warning).toHaveBeenCalled();
    expect(readFileSync(statePath(home))).toEqual(former);
    expect(files(path.join(home, "templates/example"))).toEqual(files(path.join(sourceRoot, "example")));
    const retryCalls: string[] = [];
    servingBoot(home, sourceRoot, {
      writeFileSync(filename, bytes) { retryCalls.push(`write:${filename}`); return writeFileSync(filename, bytes); },
      renameSync(from, to) { retryCalls.push(`rename:${from}:${to}`); return renameSync(from, to); },
    });
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
    const temporary = retryCalls[0]?.slice("write:".length);
    expect(temporary).toBeDefined();
    expect(path.dirname(temporary!)).toBe(path.dirname(statePath(home)));
    expect(retryCalls[1]).toBe(`rename:${temporary}:${statePath(home)}`);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("keeps an invalid occupant and handled state when a socket prevents backup, then retries", async () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["example"]);
    const former = snapshotRegularFiles(installed);
    const state = readFileSync(statePath(home));
    const socket = createServer();
    const socketPath = path.join(installed, "blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = servingBoot(home);
      expect(warning).toHaveBeenCalled();
      expect(snapshotRegularFiles(installed)).toEqual(former);
      expect(existsSync(socketPath)).toBe(true);
      expect(readFileSync(statePath(home))).toEqual(state);
      expect(readdirSync(path.dirname(installed)).filter((name) => name.startsWith(".example.backup."))).toEqual([]);
      failed.dispose();
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
    }
    servingBoot(home);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "example")));
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("retries a failed supporting-file copy on serving boot without accepting partial content", async () => {
    const home = tempRoot();
    const source = sourceCopy();
    const installed = path.join(home, "templates/example");
    cpSync(path.join(sourceRoot, "example"), installed, { recursive: true });
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Example", description: "old", version: "0.9.0" }));
    writeState(home, ["example"]);
    const former = snapshotRegularFiles(installed);
    const socket = createServer();
    const socketPath = path.join(source, "example/runtime.js");
    writeFileSync(path.join(source, "example/index.html"), '<!doctype html><script src="runtime.js"></script>');
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = servingBoot(home, source);
      expect(warning).toHaveBeenCalled();
      expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual([]);
      expect(existsSync(installed)).toBe(false);
      const backup = readdirSync(path.dirname(installed))
        .find((name) => /^\.example\.backup\.\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(name));
      expect(backup).toBeDefined();
      expect(snapshotRegularFiles(path.join(path.dirname(installed), backup!))).toEqual(former);
      failed.dispose();
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
    }
    writeFileSync(socketPath, "document.body.textContent = 'Restored support script';");
    servingBoot(home, source);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(source, "example")));
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it.each([false, true])("removes an interrupted hidden copy on boot; valid customized destination present: %s", (present) => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    const temporary = path.join(home, "templates/.example.bundled-template.tmp");
    mkdirSync(temporary, { recursive: true });
    writeFileSync(path.join(temporary, "stale.txt"), "incomplete copy");
    writeState(home, present ? ["example"] : []);
    if (present) {
      cpSync(path.join(sourceRoot, "example"), installed, { recursive: true });
      writeFileSync(path.join(installed, "index.html"), "customized page");
    }
    const expected = snapshotRegularFiles(present ? installed : path.join(sourceRoot, "example"));

    servingBoot(home);

    expect(snapshotRegularFiles(installed)).toEqual(expected);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
    expect(existsSync(temporary)).toBe(false);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-containment
  it("continues after one bundled ID fails and leaves a removed bundle available to the scanner", async () => {
    const home = tempRoot();
    const source = sourceCopy();
    cpSync(path.join(source, "example"), path.join(source, "second"), { recursive: true });
    const installed = path.join(home, "templates/example");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["example"]);
    const inventory = [...BUNDLED_ARTIFACT_TEMPLATES, { id: "second", minimumVersion: "1.0.0" }];
    const socket = createServer();
    const socketPath = path.join(installed, "blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      runBundledTemplateInstallation(home, source, {}, inventory);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('"example"'), expect.any(Error));
      expect(readFileSync(path.join(installed, "index.html"), "utf8")).toBe("old page");
      expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example", "second"]);
      expect(snapshotRegularFiles(path.join(home, "templates/second"))).toEqual(snapshotRegularFiles(path.join(source, "second")));
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
    }
    runBundledTemplateInstallation(home, source, {}, inventory);
    const retained = snapshotRegularFiles(installed);
    runBundledTemplateInstallation(home, source, {}, inventory.filter(({ id }) => id !== "example"));
    expect(snapshotRegularFiles(installed)).toEqual(retained);
    expect(scanTemplatesDirectory(path.join(home, "templates")).templates.map(({ id }) => id).sort()).toEqual(["example", "second"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-linked-records
  it.each(["invalid", "below minimum"])("preserves linked records and stores through %s replacement and handled deletion", async (condition) => {
    const home = tempRoot();
    const installed = path.join(home, "templates/example");
    const firstBoot = servingBoot(home);
    const template = firstBoot.templateCache!.getSnapshot().templates[0]!;
    const channelID = firstBoot.listChannels()[0]!.id;
    const first = await firstBoot.createTemplateArtifact({ template, templateID: "example", channelID, source: "cli", data: { message: "First" } });
    const second = await firstBoot.createTemplateArtifact({ template, templateID: "example", channelID, source: "ui" });
    firstBoot.resources.json.write({ artifactID: second.artifactID }, { kind: "set", path: "", value: { message: "Second" } });
    expect(first.path).toBe(installed);
    expect(second.path).toBe(installed);
    const records = snapshotRegularFiles(path.join(home, "state/artifacts"));
    const stores = snapshotRegularFiles(path.join(home, "resources"));
    firstBoot.dispose();
    const expectDependents = (store: ServerStore) => {
      expect(snapshotRegularFiles(path.join(home, "state/artifacts"))).toEqual(records);
      expect(snapshotRegularFiles(path.join(home, "resources"))).toEqual(stores);
      for (const [artifactID, message] of [[first.artifactID, "First"], [second.artifactID, "Second"]]) {
        expect(store.getArtifact(artifactID!)).toMatchObject({ id: artifactID, kind: "path", path: `${installed}${path.sep}` });
        expect(store.resources.json.get({ artifactID: artifactID! }, "")).toEqual({ exists: true, value: { message } });
      }
    };

    writeFileSync(path.join(installed, "index.html"), "edited page at the minimum");
    const edited = snapshotRegularFiles(installed);
    const source = sourceCopy();
    const manifest = JSON.parse(readFileSync(path.join(source, "example/manifest.json"), "utf8"));
    writeFileSync(path.join(source, "example/manifest.json"), JSON.stringify({ ...manifest, version: "2.0.0" }));
    const kept = servingBoot(home, source);
    expect(snapshotRegularFiles(installed)).toEqual(edited);
    expectDependents(kept);
    kept.dispose();

    writeFileSync(path.join(installed, "manifest.json"), condition === "invalid" ? "{" : JSON.stringify({ ...manifest, version: "0.9.0" }));
    const former = snapshotRegularFiles(installed);
    const replaced = servingBoot(home, source);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(source, "example")));
    expectDependents(replaced);
    expect(replaced.templateCache!.getSnapshot().templates[0]).toMatchObject({ id: "example", path: installed, version: "2.0.0" });
    const backup = readdirSync(path.dirname(installed)).find((name) => name.startsWith(".example.backup."));
    expect(backup).toBeDefined();
    expect(snapshotRegularFiles(path.join(path.dirname(installed), backup!))).toEqual(former);
    replaced.dispose();

    rmSync(installed, { recursive: true });
    const deleted = servingBoot(home, source);
    expect(existsSync(installed)).toBe(false);
    expectDependents(deleted);
    expect(deleted.templateCache!.getSnapshot().templates).toEqual([]);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["example"]);
  });
});
