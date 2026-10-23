import { spawnSync } from "node:child_process";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BundledTemplateStateOperations } from "../src/bundled-template-installer.ts";
import { ServerStore } from "../src/server-store.ts";

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

function servingBoot(home: string, bundledTemplatesPath = sourceRoot, bundledTemplateStateOperations?: BundledTemplateStateOperations): ServerStore {
  const store = new ServerStore({ storagePath: home, bundledTemplatesPath, bundledTemplateStateOperations, installOnboardingChannels: true });
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
  // proofs/arch/templates/bundled-installation.md#^templates-install-t-validate
  it("accepts exactly the bundled templates at or above their minimum versions", () => {
    expect(runValidator(sourceRoot).status).toBe(0);
    const expectRefused = (root: string, diagnostic: RegExp) => {
      const result = runValidator(root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(diagnostic);
    };
    const extra = sourceCopy();
    mkdirSync(path.join(extra, "extra"));
    expectRefused(extra, /unexpected.*extra/i);
    const extraFile = sourceCopy();
    writeFileSync(path.join(extraFile, "stray.txt"), "stray\n");
    expectRefused(extraFile, /unexpected.*stray\.txt/i);
    for (const id of ["checklist", "sticky-note"]) {
      const missing = sourceCopy();
      rmSync(path.join(missing, id), { recursive: true });
      expectRefused(missing, new RegExp(`missing.*${id}`, "i"));
      const invalid = sourceCopy();
      rmSync(path.join(invalid, id, "index.html"));
      expectRefused(invalid, new RegExp(`${id}.*index\\.html`, "i"));
      const old = sourceCopy();
      const manifestPath = path.join(old, id, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "0.9.9" }));
      expectRefused(old, new RegExp(`${id}.*below minimum`, "i"));
    }
  });

});

describe("bundled artifact template serving installation", () => {
  // proofs/arch/templates/bundled-installation.md#^templates-install-t-boot
  it("installs an unhandled Checklist, preserves a handled deletion, and does nothing at token-only construction", () => {
    const home = tempRoot();
    stores.push(new ServerStore({ storagePath: home, bundledTemplatesPath: sourceRoot }));
    expect(existsSync(path.join(home, "templates/checklist"))).toBe(false);
    servingBoot(home);
    expect(files(path.join(home, "templates/checklist"))).toEqual(files(path.join(sourceRoot, "checklist")));
    expect(JSON.parse(readFileSync(statePath(home), "utf8"))).toEqual({ version: 1, installedTemplateIDs: ["checklist", "sticky-note"] });
    rmSync(path.join(home, "templates/checklist"), { recursive: true });
    servingBoot(home);
    expect(existsSync(path.join(home, "templates/checklist"))).toBe(false);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-boot
  it("keeps a handled deletion after a successful replacement left a hidden prior copy", () => {
    const home = tempRoot();
    const templates = path.join(home, "templates");
    mkdirSync(path.join(templates, ".checklist.bundled-template.previous-1234"), { recursive: true });
    writeFileSync(path.join(templates, ".checklist.bundled-template.previous-1234/index.html"), "old page");
    mkdirSync(path.join(templates, ".checklist.bundled-template.previous-user-notes"));
    writeState(home, ["checklist"]);

    servingBoot(home);

    expect(existsSync(path.join(templates, "checklist"))).toBe(false);
    expect(existsSync(path.join(templates, ".checklist.bundled-template.previous-1234"))).toBe(true);
    expect(existsSync(path.join(templates, ".checklist.bundled-template.previous-user-notes"))).toBe(true);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("recovers a complete prior folder from an interrupted replacement pair", () => {
    const home = tempRoot();
    const templates = path.join(home, "templates");
    const prior = path.join(templates, ".checklist.bundled-template.previous-4321");
    const staged = path.join(templates, ".checklist.bundled-template.tmp-4321");
    mkdirSync(prior, { recursive: true });
    mkdirSync(staged);
    writeFileSync(path.join(prior, "index.html"), "prior page");
    writeFileSync(path.join(staged, "index.html"), "staged page");
    writeState(home, ["checklist"]);

    servingBoot(home);

    expect(existsSync(path.join(templates, "checklist"))).toBe(true);
    expect(existsSync(prior)).toBe(false);
    expect(existsSync(staged)).toBe(false);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-boot
  it("keeps an edited valid installed copy at the minimum and backs up an old copy before replacement", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    cpSync(path.join(sourceRoot, "checklist"), installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "edited page");
    const edited = snapshotRegularFiles(installed);
    servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(edited);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Checklist", description: "edited", version: "2.0.0" }));
    const newer = snapshotRegularFiles(installed);
    servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(newer);
    expect(JSON.parse(readFileSync(path.join(installed, "manifest.json"), "utf8")).version).toBe("2.0.0");
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Checklist", description: "old", version: "0.9.0" }));
    servingBoot(home);
    expect(readFileSync(path.join(installed, "index.html"), "utf8")).not.toBe("edited page");
    const backup = readdirSync(path.join(home, "templates")).find((name) => /^\.checklist\.backup\.\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(name));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(home, "templates", backup!, "index.html"), "utf8")).toBe("edited page");
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-state
  it.each([
    ["malformed JSON", "{"],
    ["wrong version", JSON.stringify({ version: 2, installedTemplateIDs: [] })],
    ["non-string ID", JSON.stringify({ version: 1, installedTemplateIDs: [7] })],
    ["duplicate ID", JSON.stringify({ version: 1, installedTemplateIDs: ["checklist", "checklist"] })],
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
    expect(existsSync(path.join(home, "templates/checklist"))).toBe(false);
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
    expect(existsSync(path.join(unreadableHome, "templates/checklist"))).toBe(false);
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
        calls.push(`rename:${from}:${to}`);
        return renameSync(from, to);
      },
    });
    expect(calls).toHaveLength(4);
    const temporary = calls[0]!.slice("write:".length);
    expect(path.dirname(temporary)).toBe(path.dirname(statePath(home)));
    expect(calls[1]).toBe(`rename:${temporary}:${statePath(home)}`);
    expect(calls.slice(2)).toEqual(calls.slice(0, 2));
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "older-bundle", "sticky-note"]);
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
    expect(files(path.join(home, "templates/checklist"))).toEqual(files(path.join(sourceRoot, "checklist")));
    const retryCalls: string[] = [];
    servingBoot(home, sourceRoot, {
      writeFileSync(filename, bytes) { retryCalls.push(`write:${filename}`); return writeFileSync(filename, bytes); },
      renameSync(from, to) { retryCalls.push(`rename:${from}:${to}`); return renameSync(from, to); },
    });
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);
    const temporary = retryCalls[0]?.slice("write:".length);
    expect(temporary).toBeDefined();
    expect(path.dirname(temporary!)).toBe(path.dirname(statePath(home)));
    expect(retryCalls[1]).toBe(`rename:${temporary}:${statePath(home)}`);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("keeps an invalid occupant when its socket prevents backup, then replaces it after the obstruction clears", async () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    const former = snapshotRegularFiles(installed);
    const socket = createServer();
    const socketPath = path.join(installed, "blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    servingBoot(home);
    expect(warning).toHaveBeenCalled();
    expect(readFileSync(path.join(installed, "index.html"), "utf8")).toBe("old page");
    expect(snapshotRegularFiles(installed)).toEqual(former);
    expect(existsSync(socketPath)).toBe(true);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["sticky-note"]);
    const stickyNote = path.join(home, "templates/sticky-note");
    const stickyBeforeRetry = snapshotRegularFiles(stickyNote);
    expect(readdirSync(path.join(home, "templates")).filter((name) => name.startsWith(".checklist.backup."))).toEqual([]);
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    rmSync(socketPath, { force: true });
    servingBoot(home);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);
    expect(readFileSync(path.join(installed, "index.html"), "utf8")).not.toBe("old page");
    expect(snapshotRegularFiles(stickyNote)).toEqual(stickyBeforeRetry);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("keeps the prior folder after backup when a socket in bundled source blocks replacement copy, then retries", async () => {
    const home = tempRoot();
    const source = sourceCopy();
    const installed = path.join(home, "templates/checklist");
    cpSync(path.join(sourceRoot, "checklist"), installed, { recursive: true });
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Checklist", description: "old", version: "0.9.0" }));
    const former = snapshotRegularFiles(installed);
    const previous = readFileSync(path.join(installed, "manifest.json"));
    const socket = createServer();
    const socketPath = path.join(source, "checklist/blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    servingBoot(home, source);
    expect(warning).toHaveBeenCalled();
    expect(readFileSync(path.join(installed, "manifest.json"))).toEqual(previous);
    expect(snapshotRegularFiles(installed)).toEqual(former);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["sticky-note"]);
    const stickyNote = path.join(home, "templates/sticky-note");
    const stickyBeforeRetry = snapshotRegularFiles(stickyNote);
    const backup = readdirSync(path.join(home, "templates"))
      .find((name) => /^\.checklist\.backup\.\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(name));
    expect(backup).toBeDefined();
    expect(snapshotRegularFiles(path.join(home, "templates", backup!))).toEqual(former);
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    rmSync(socketPath, { force: true });
    servingBoot(home, source);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);
    expect(readFileSync(path.join(installed, "manifest.json"))).not.toEqual(previous);
    expect(snapshotRegularFiles(stickyNote)).toEqual(stickyBeforeRetry);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-independent-ids
  it("handles both templates independently across prior state, preservation, replacement and a failed backup", async () => {
    const handledHome = tempRoot();
    writeState(handledHome, ["checklist"]);
    servingBoot(handledHome);
    expect(existsSync(path.join(handledHome, "templates/checklist"))).toBe(false);
    expect(snapshotRegularFiles(path.join(handledHome, "templates/sticky-note")))
      .toEqual(snapshotRegularFiles(path.join(sourceRoot, "sticky-note")));
    expect(JSON.parse(readFileSync(statePath(handledHome), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);

    const home = tempRoot();
    servingBoot(home);
    for (const id of ["checklist", "sticky-note"]) {
      expect(snapshotRegularFiles(path.join(home, "templates", id))).toEqual(snapshotRegularFiles(path.join(sourceRoot, id)));
    }
    const sticky = path.join(home, "templates/sticky-note");
    writeFileSync(path.join(sticky, "index.html"), "edited Sticky note page");
    const edited = snapshotRegularFiles(sticky);
    servingBoot(home);
    expect(snapshotRegularFiles(sticky)).toEqual(edited);
    const manifestPath = path.join(sticky, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "0.9.9" }));
    const old = snapshotRegularFiles(sticky);
    servingBoot(home);
    expect(snapshotRegularFiles(sticky)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "sticky-note")));
    const backup = readdirSync(path.join(home, "templates")).find((name) => /^\.sticky-note\.backup\.\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(name));
    expect(backup).toBeDefined();
    expect(snapshotRegularFiles(path.join(home, "templates", backup!))).toEqual(old);

    const failureHome = tempRoot();
    const checklist = path.join(failureHome, "templates/checklist");
    mkdirSync(checklist, { recursive: true });
    writeFileSync(path.join(checklist, "index.html"), "invalid Checklist");
    const socket = createServer();
    const socketPath = path.join(checklist, "blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      servingBoot(failureHome);
      expect(JSON.parse(readFileSync(statePath(failureHome), "utf8")).installedTemplateIDs).toEqual(["sticky-note"]);
      writeFileSync(path.join(failureHome, "templates/sticky-note/index.html"), "keep my note");
      const preserved = snapshotRegularFiles(path.join(failureHome, "templates/sticky-note"));
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
      servingBoot(failureHome);
      expect(JSON.parse(readFileSync(statePath(failureHome), "utf8")).installedTemplateIDs).toEqual(["checklist", "sticky-note"]);
      expect(snapshotRegularFiles(path.join(failureHome, "templates/sticky-note"))).toEqual(preserved);
      expect(snapshotRegularFiles(checklist)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
    } finally {
      if (socket.listening) await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  });
});
