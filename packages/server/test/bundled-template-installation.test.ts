import { spawnSync } from "node:child_process";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_ARTIFACT_TEMPLATES, runBundledTemplateInstallation, type BundledTemplateOperations } from "../src/bundled-template-installer.ts";
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
    for (const id of ["checklist", "calendar", "sticky-note", "map"]) {
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
  }, 90_000);

});

describe("bundled artifact template serving installation", () => {
  // proofs/arch/templates/bundled-installation.md#^templates-install-t-boot
  it("installs unhandled templates, preserves handled deletions, and does nothing at token-only construction", () => {
    const home = tempRoot();
    stores.push(new ServerStore({ storagePath: home, bundledTemplatesPath: sourceRoot }));
    for (const id of ["checklist", "calendar", "sticky-note", "map"]) {
      expect(existsSync(path.join(home, "templates", id))).toBe(false);
    }
    servingBoot(home);
    for (const id of ["checklist", "calendar", "sticky-note", "map"]) {
      expect(snapshotRegularFiles(path.join(home, "templates", id))).toEqual(snapshotRegularFiles(path.join(sourceRoot, id)));
      rmSync(path.join(home, "templates", id), { recursive: true });
    }
    expect(JSON.parse(readFileSync(statePath(home), "utf8"))).toEqual({ version: 1, installedTemplateIDs: ["checklist", "calendar", "sticky-note", "map"].sort() });
    servingBoot(home);
    for (const id of ["checklist", "calendar", "sticky-note", "map"]) {
      expect(existsSync(path.join(home, "templates", id))).toBe(false);
    }
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("finishes backup, durably unhandles the ID, removes the destination, replaces it, then records success", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    // Calendar is a handled deletion, so only the Checklist is replaced.
    writeState(home, ["checklist", "calendar", "other"].sort());
    const former = snapshotRegularFiles(installed);
    const calls: string[] = [];
    servingBoot(home, sourceRoot, {
      cpSync(from, to, options) {
        cpSync(from, to, options);
        if (from === installed) {
          expect(snapshotRegularFiles(String(to))).toEqual(former);
          calls.push("backup complete");
        } else if (from === path.join(sourceRoot, "checklist")) {
          expect(existsSync(installed)).toBe(false);
          expect(snapshotRegularFiles(String(to))).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
          calls.push("copy complete");
        }
      },
      renameSync(from, to) {
        renameSync(from, to);
        if (to === installed) {
          expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
          calls.push("replacement complete");
          return;
        }
        if (to !== statePath(home)) return;
        const ids = JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs;
        if (ids.includes("map")) {
          expect(ids).toEqual(["checklist", "calendar", "map", "other", "sticky-note"].sort());
          calls.push("Map handled");
        } else if (ids.includes("sticky-note")) {
          expect(ids).toEqual(["checklist", "calendar", "other", "sticky-note"].sort());
          calls.push("Sticky note handled");
        } else if (ids.includes("checklist")) {
          expect(ids).toEqual(["checklist", "calendar", "other"].sort());
          calls.push("handled");
        } else {
          expect(ids).toEqual(["calendar", "other"]);
          expect(snapshotRegularFiles(installed)).toEqual(former);
          calls.push("unhandled");
        }
      },
      rmSync(filename, options) {
        rmSync(filename, options);
        if (filename === installed) calls.push("destination removed");
      },
    });
    expect(calls).toEqual(["backup complete", "unhandled", "destination removed", "copy complete", "replacement complete", "handled", "Sticky note handled", "Map handled"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("restores an absent destination on the next serving boot after interruption following removal", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["checklist", "calendar"].sort());
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const interrupted = servingBoot(home, sourceRoot, {
      rmSync(filename, options) {
        rmSync(filename, options);
        if (filename === installed) throw new Error("stop after destination removal");
      },
    });
    expect(warning).toHaveBeenCalled();
    expect(existsSync(installed)).toBe(false);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["calendar", "sticky-note", "map"].sort());
    const backup = readdirSync(path.dirname(installed)).find((name) => name.startsWith(".checklist.backup."));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(path.dirname(installed), backup!, "index.html"), "utf8")).toBe("old page");
    interrupted.dispose();

    const recovered = servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
    expect(recovered.templateCache!.getSnapshot().templates.map(({ id }) => id)).toEqual(["checklist", "sticky-note", "map"].sort());
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("leaves the destination and handled state intact when removing its ID cannot be written", () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["checklist", "calendar"].sort());
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
    const backup = readdirSync(path.dirname(installed)).find((name) => name.startsWith(".checklist.backup."));
    expect(backup).toBeDefined();
    expect(snapshotRegularFiles(path.join(path.dirname(installed), backup!))).toEqual(former);
    failed.dispose();
    servingBoot(home);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
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
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
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
    writeState(home, ["calendar", "older-bundle"]);
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
    expect(calls).toHaveLength(6);
    const temporary = calls[0]!.slice("write:".length);
    expect(path.dirname(temporary)).toBe(path.dirname(statePath(home)));
    expect(calls[1]).toBe(`rename:${temporary}:${statePath(home)}`);
    expect(calls.slice(2, 4)).toEqual(calls.slice(0, 2));
    expect(calls.slice(4)).toEqual(calls.slice(0, 2));
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "map", "older-bundle", "sticky-note"].sort());
    expect(JSON.parse(readFileSync(oldLink, "utf8")).installedTemplateIDs).toEqual(["calendar", "older-bundle"]);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-state-retry
  it("keeps the installed folder and old state bytes when a real temporary-file obstruction rejects state write, then records it on retry", () => {
    const home = tempRoot();
    writeState(home, ["calendar"]);
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
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
    const temporary = retryCalls[0]?.slice("write:".length);
    expect(temporary).toBeDefined();
    expect(path.dirname(temporary!)).toBe(path.dirname(statePath(home)));
    expect(retryCalls[1]).toBe(`rename:${temporary}:${statePath(home)}`);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("keeps an invalid occupant and handled state when a socket prevents backup, then retries", async () => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["checklist", "calendar"].sort());
    const former = snapshotRegularFiles(installed);
    const socket = createServer();
    const socketPath = path.join(installed, "blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = servingBoot(home);
      expect(warning).toHaveBeenCalled();
      expect(snapshotRegularFiles(installed)).toEqual(former);
      expect(existsSync(socketPath)).toBe(true);
      expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
      expect(readdirSync(path.dirname(installed)).filter((name) => name.startsWith(".checklist.backup."))).toEqual([]);
      failed.dispose();
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
    }
    const stickyNote = path.join(home, "templates/sticky-note");
    const stickyBeforeRetry = snapshotRegularFiles(stickyNote);
    const map = path.join(home, "templates/map");
    const mapBeforeRetry = snapshotRegularFiles(map);
    servingBoot(home);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
    expect(snapshotRegularFiles(stickyNote)).toEqual(stickyBeforeRetry);
    expect(snapshotRegularFiles(map)).toEqual(mapBeforeRetry);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it("retries a failed supporting-file copy on serving boot without accepting partial content", async () => {
    const home = tempRoot();
    const source = sourceCopy();
    const installed = path.join(home, "templates/checklist");
    cpSync(path.join(sourceRoot, "checklist"), installed, { recursive: true });
    writeFileSync(path.join(installed, "manifest.json"), JSON.stringify({ name: "Checklist", description: "old", version: "0.9.0" }));
    writeState(home, ["checklist", "calendar"].sort());
    const former = snapshotRegularFiles(installed);
    const socket = createServer();
    const socketPath = path.join(source, "checklist/runtime.js");
    writeFileSync(path.join(source, "checklist/index.html"), '<!doctype html><script src="runtime.js"></script>');
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = servingBoot(home, source);
      expect(warning).toHaveBeenCalled();
      expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["calendar", "sticky-note", "map"].sort());
      expect(existsSync(installed)).toBe(false);
      const backup = readdirSync(path.dirname(installed))
        .find((name) => /^\.checklist\.backup\.\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/.test(name));
      expect(backup).toBeDefined();
      expect(snapshotRegularFiles(path.join(path.dirname(installed), backup!))).toEqual(former);
      failed.dispose();
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
    }
    writeFileSync(socketPath, "document.body.textContent = 'Restored support script';");
    const stickyNote = path.join(home, "templates/sticky-note");
    const stickyBeforeRetry = snapshotRegularFiles(stickyNote);
    const map = path.join(home, "templates/map");
    const mapBeforeRetry = snapshotRegularFiles(map);
    servingBoot(home, source);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(source, "checklist")));
    expect(snapshotRegularFiles(stickyNote)).toEqual(stickyBeforeRetry);
    expect(snapshotRegularFiles(map)).toEqual(mapBeforeRetry);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-retry
  it.each([false, true])("removes an interrupted hidden copy on boot; valid customized destination present: %s", (present) => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    const temporary = path.join(home, "templates/.checklist.bundled-template.tmp");
    mkdirSync(temporary, { recursive: true });
    writeFileSync(path.join(temporary, "stale.txt"), "incomplete copy");
    writeState(home, present ? ["checklist", "calendar"].sort() : ["calendar"]);
    if (present) {
      cpSync(path.join(sourceRoot, "checklist"), installed, { recursive: true });
      writeFileSync(path.join(installed, "index.html"), "customized page");
    }
    const expected = snapshotRegularFiles(present ? installed : path.join(sourceRoot, "checklist"));

    servingBoot(home);

    expect(snapshotRegularFiles(installed)).toEqual(expected);
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
    expect(existsSync(temporary)).toBe(false);
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-containment
  it("continues after one bundled ID fails and leaves a removed bundle available to the scanner", async () => {
    const home = tempRoot();
    const source = sourceCopy();
    cpSync(path.join(source, "checklist"), path.join(source, "second"), { recursive: true });
    const installed = path.join(home, "templates/checklist");
    mkdirSync(installed, { recursive: true });
    writeFileSync(path.join(installed, "index.html"), "old page");
    writeState(home, ["checklist", "calendar"].sort());
    const inventory = [...BUNDLED_ARTIFACT_TEMPLATES, { id: "second", minimumVersion: "1.0.0" }];
    const socket = createServer();
    const socketPath = path.join(installed, "blocked.sock");
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      runBundledTemplateInstallation(home, source, {}, inventory);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('"checklist"'), expect.any(Error));
      expect(readFileSync(path.join(installed, "index.html"), "utf8")).toBe("old page");
      expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "map", "second", "sticky-note"].sort());
      expect(snapshotRegularFiles(path.join(home, "templates/second"))).toEqual(snapshotRegularFiles(path.join(source, "second")));
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
    }
    runBundledTemplateInstallation(home, source, {}, inventory);
    const retained = snapshotRegularFiles(installed);
    runBundledTemplateInstallation(home, source, {}, inventory.filter(({ id }) => id !== "checklist"));
    expect(snapshotRegularFiles(installed)).toEqual(retained);
    expect(scanTemplatesDirectory(path.join(home, "templates")).templates.map(({ id }) => id).sort()).toEqual(["checklist", "map", "second", "sticky-note"].sort());
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-copied-artifacts
  it.each(["invalid", "below minimum"])("preserves copied pages, records and stores through %s replacement and handled deletion", async (condition) => {
    const home = tempRoot();
    const installed = path.join(home, "templates/checklist");
    const firstBoot = servingBoot(home);
    const template = firstBoot.templateCache!.getSnapshot().templates.find(({ id }) => id === "checklist")!;
    const channelID = firstBoot.listChannels()[0]!.id;
    const first = await firstBoot.createTemplateArtifact({ template, templateID: "checklist", channelID, source: "cli", data: { title: "First", items: {} } });
    const second = await firstBoot.createTemplateArtifact({ template, templateID: "checklist", channelID, source: "ui" });
    firstBoot.resources.json.write({ artifactID: second.artifactID }, { kind: "set", path: "", value: { title: "Second", items: {} } });
    expect(first.path).not.toBe(installed);
    expect(second.path).not.toBe(installed);
    expect(first.path).not.toBe(second.path);
    const pages = snapshotRegularFiles(path.join(home, "artifacts"));
    const records = snapshotRegularFiles(path.join(home, "state/artifacts"));
    const stores = snapshotRegularFiles(path.join(home, "resources"));
    firstBoot.dispose();
    const expectDependents = (store: ServerStore) => {
      expect(snapshotRegularFiles(path.join(home, "state/artifacts"))).toEqual(records);
      expect(snapshotRegularFiles(path.join(home, "resources"))).toEqual(stores);
      expect(snapshotRegularFiles(path.join(home, "artifacts"))).toEqual(pages);
      for (const [created, message] of [[first, "First"], [second, "Second"]] as const) {
        expect(store.getArtifact(created.artifactID)).toMatchObject({ id: created.artifactID, kind: "path", path: `${created.path}${path.sep}` });
        expect(store.resources.json.get({ artifactID: created.artifactID }, "")).toEqual({ exists: true, value: { title: message, items: {} } });
      }
    };

    writeFileSync(path.join(installed, "index.html"), "edited page at the minimum");
    const edited = snapshotRegularFiles(installed);
    const source = sourceCopy();
    const manifest = JSON.parse(readFileSync(path.join(source, "checklist/manifest.json"), "utf8"));
    writeFileSync(path.join(source, "checklist/manifest.json"), JSON.stringify({ ...manifest, version: "2.0.0" }));
    const kept = servingBoot(home, source);
    expect(snapshotRegularFiles(installed)).toEqual(edited);
    expectDependents(kept);
    kept.dispose();

    writeFileSync(path.join(installed, "manifest.json"), condition === "invalid" ? "{" : JSON.stringify({ ...manifest, version: "0.9.0" }));
    const former = snapshotRegularFiles(installed);
    const replaced = servingBoot(home, source);
    expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(source, "checklist")));
    expectDependents(replaced);
    expect(replaced.templateCache!.getSnapshot().templates.find(({ id }) => id === "checklist")).toMatchObject({ id: "checklist", path: installed, version: "2.0.0" });
    const backup = readdirSync(path.dirname(installed)).find((name) => name.startsWith(".checklist.backup."));
    expect(backup).toBeDefined();
    expect(snapshotRegularFiles(path.join(path.dirname(installed), backup!))).toEqual(former);
    replaced.dispose();

    rmSync(installed, { recursive: true });
    const deleted = servingBoot(home, source);
    expect(existsSync(installed)).toBe(false);
    expectDependents(deleted);
    expect(deleted.templateCache!.getSnapshot().templates.map(({ id }) => id)).toEqual(["calendar", "sticky-note", "map"].sort());
    expect(JSON.parse(readFileSync(statePath(home), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
  });

  // proofs/arch/templates/bundled-installation.md#^templates-install-t-independent-ids
  it("handles all four templates independently across prior state, preservation, replacement and a failed backup", async () => {
    const handledHome = tempRoot();
    writeState(handledHome, ["checklist"]);
    servingBoot(handledHome);
    expect(existsSync(path.join(handledHome, "templates/checklist"))).toBe(false);
    for (const id of ["calendar", "sticky-note", "map"]) {
      expect(snapshotRegularFiles(path.join(handledHome, "templates", id)))
        .toEqual(snapshotRegularFiles(path.join(sourceRoot, id)));
    }
    expect(JSON.parse(readFileSync(statePath(handledHome), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());

    const home = tempRoot();
    servingBoot(home);
    for (const id of ["checklist", "calendar", "sticky-note", "map"]) {
      expect(snapshotRegularFiles(path.join(home, "templates", id))).toEqual(snapshotRegularFiles(path.join(sourceRoot, id)));
    }
    for (const id of ["calendar", "sticky-note", "map"]) {
      const installed = path.join(home, "templates", id);
      writeFileSync(path.join(installed, "index.html"), `edited ${id} page`);
      const edited = snapshotRegularFiles(installed);
      servingBoot(home);
      expect(snapshotRegularFiles(installed)).toEqual(edited);
      const manifestPath = path.join(installed, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "0.9.9" }));
      const old = snapshotRegularFiles(installed);
      servingBoot(home);
      expect(snapshotRegularFiles(installed)).toEqual(snapshotRegularFiles(path.join(sourceRoot, id)));
      const backupPattern = new RegExp(`^\\.${id}\\.backup\\.\\d{4}-\\d\\d-\\d\\d-\\d\\d-\\d\\d-\\d\\d$`);
      const backup = readdirSync(path.join(home, "templates")).find((name) => backupPattern.test(name));
      expect(backup).toBeDefined();
      expect(snapshotRegularFiles(path.join(home, "templates", backup!))).toEqual(old);
    }

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
      expect(JSON.parse(readFileSync(statePath(failureHome), "utf8")).installedTemplateIDs).toEqual(["calendar", "sticky-note", "map"].sort());
      expect(snapshotRegularFiles(path.join(failureHome, "templates/calendar"))).toEqual(snapshotRegularFiles(path.join(sourceRoot, "calendar")));
      writeFileSync(path.join(failureHome, "templates/sticky-note/index.html"), "keep my note");
      const preserved = snapshotRegularFiles(path.join(failureHome, "templates/sticky-note"));
      writeFileSync(path.join(failureHome, "templates/map/index.html"), "keep my map");
      const preservedMap = snapshotRegularFiles(path.join(failureHome, "templates/map"));
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      rmSync(socketPath, { force: true });
      servingBoot(failureHome);
      expect(JSON.parse(readFileSync(statePath(failureHome), "utf8")).installedTemplateIDs).toEqual(["checklist", "calendar", "sticky-note", "map"].sort());
      expect(snapshotRegularFiles(path.join(failureHome, "templates/sticky-note"))).toEqual(preserved);
      expect(snapshotRegularFiles(path.join(failureHome, "templates/map"))).toEqual(preservedMap);
      expect(snapshotRegularFiles(checklist)).toEqual(snapshotRegularFiles(path.join(sourceRoot, "checklist")));
    } finally {
      if (socket.listening) await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  }, 90_000);
});
