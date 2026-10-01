import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    stat: vi.fn(actual.stat),
    statSync: vi.fn(actual.statSync),
  };
});

import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createArtifact } from "@telepath-computer/television-artifact";
import {
  ArtifactContentChangedEvent,
  ThemeChangedEvent,
} from "@telepath-computer/television-shared";
import { artifactWatchTarget, ServerStore } from "../src/server-store.ts";
import type {
  ContentWatcher,
  WatchContentFile,
  WatchContentFileOptions,
} from "../src/file-watcher.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

const WAIT_FOR_WATCHER_READY_MS = 50;
const WAIT_FOR_DEBOUNCE_MS = 250;

class FakeWatcher extends EventEmitter implements ContentWatcher {
  closed = false;
  closeCalls = 0;

  close(): void {
    this.closed = true;
    this.closeCalls += 1;
  }
}

interface ControlledWatchCall {
  readonly watchPath: string;
  readonly onChange: () => void;
  readonly options: WatchContentFileOptions;
  readonly watcher: FakeWatcher;
}

function controlledWatchContentFile(calls: ControlledWatchCall[]): WatchContentFile {
  return (watchPath, onChange, options) => {
    const watcher = new FakeWatcher();
    calls.push({ watchPath, onChange, options: options ?? {}, watcher });
    return watcher;
  };
}

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-store-watch-"));
}

function writeMarkdown(dir: string, name = "note.md"): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, "# note\n", "utf8");
  return filePath;
}

function writeHtml(dir: string, name = "index.html"): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, "<!doctype html><h1>hello</h1>", "utf8");
  return filePath;
}

function writeBundle(dir: string): string {
  const bundleDir = path.join(dir, "bundle");
  mkdirSync(bundleDir);
  writeHtml(bundleDir, "index.html");
  writeHtml(bundleDir, "index.htm");
  writeFileSync(path.join(bundleDir, "style.css"), "body {}\n", "utf8");
  return `${bundleDir}${path.sep}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChange(changes: string[]): Promise<void> {
  const started = Date.now();
  while (changes.length === 0) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for artifact-content-changed");
    await wait(20);
  }
}

async function observeThemeOperation(
  changes: Array<string | null>,
  operation: () => void,
): Promise<Array<string | null>> {
  changes.length = 0;
  operation();
  const started = Date.now();
  while (changes.length === 0 && Date.now() - started <= 1_000) {
    await wait(20);
  }
  await wait(WAIT_FOR_DEBOUNCE_MS);
  return [...changes];
}

async function expectOneArtifactChange(
  changes: string[],
  artifactID: string,
  operation: () => void,
): Promise<void> {
  changes.length = 0;
  operation();
  await waitForChange(changes);
  await wait(WAIT_FOR_DEBOUNCE_MS);
  expect(changes).toEqual([artifactID]);
}

function collectContentChanges(store: ServerStore): string[] {
  const changes: string[] = [];
  store.addEventListener("artifact-content-changed", (event) => {
    changes.push((event as ArtifactContentChangedEvent).artifactID);
  });
  return changes;
}

function collectThemeChanges(store: ServerStore): Array<string | null> {
  const changes: Array<string | null> = [];
  store.addEventListener("theme-changed", (event) => {
    changes.push((event as ThemeChangedEvent).themeName);
  });
  return changes;
}

describe("ServerStore file-change watcher target selection", () => {
  const dirs: string[] = [];
  const stores: ServerStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    vi.useRealTimers();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("selects single-file, recursive-folder, and URL watcher modes without filesystem probes (^rn-ac-watch-target)", () => {
    vi.mocked(fs.stat).mockClear();
    vi.mocked(fs.statSync).mockClear();

    expect(artifactWatchTarget(createArtifact({ id: "md", kind: "path", title: "MD", path: "/tmp/note.md" }))).toEqual({
      watchPath: "/tmp/note.md",
      recursive: false,
    });
    expect(artifactWatchTarget(createArtifact({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.HTML" }))).toEqual({
      watchPath: "/tmp/index.HTML",
      recursive: false,
    });
    expect(artifactWatchTarget(createArtifact({ id: "dir", kind: "path", title: "Dir", path: "/tmp/site/" }))).toEqual({
      watchPath: "/tmp/site/",
      recursive: true,
    });
    expect(artifactWatchTarget(createArtifact({ id: "url", kind: "url", title: "URL", url: "https://example.com" }))).toBeNull();

    expect(fs.stat).not.toHaveBeenCalled();
    expect(fs.statSync).not.toHaveBeenCalled();
  });

  // proofs/arch/themes/index.md#^themes-t-shared-watcher-targets
  it("sends file artifacts and both recursive consumers through one watcher handoff at runtime and boot", () => {
    const dir = tempDir();
    dirs.push(dir);
    const storagePath = path.join(dir, "storage");
    const activeThemePath = seedThemePackage(storagePath, "paperlike", ":root {}");
    const mdPath = writeMarkdown(dir);
    const htmlPath = writeHtml(dir, "page.html");
    const bundlePath = writeBundle(dir);
    const calls: ControlledWatchCall[] = [];
    const watchContentFile = controlledWatchContentFile(calls);
    const store = createServingStore(storagePath, { watchContentFile });
    stores.push(store);

    store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });
    store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "HTML", path: htmlPath });
    store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "Dir", path: bundlePath });
    store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "url", title: "URL", url: "https://example.com" });
    store.patchDisplay({ activeThemeName: "paperlike" });

    const runtimeCalls = calls.map(({ watchPath, options }) => ({
      watchPath,
      recursive: options.recursive,
    }));

    store.dispose();
    calls.length = 0;
    const restarted = createServingStore(storagePath, { watchContentFile });
    stores.push(restarted);
    const bootCalls = calls.map(({ watchPath, options }) => ({
      watchPath,
      recursive: options.recursive,
    }));

    const expectedCalls = [
      { watchPath: mdPath, recursive: false },
      { watchPath: htmlPath, recursive: false },
      { watchPath: bundlePath, recursive: true },
      { watchPath: activeThemePath, recursive: true },
    ];
    expect({ runtimeCalls, bootCalls }).toEqual({
      runtimeCalls: expectedCalls,
      bootCalls: expect.arrayContaining(expectedCalls),
    });
    expect(bootCalls).toHaveLength(4);
  });

  it("emits artifact-content-changed for markdown and HTML file writes after debounce", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const mdPath = writeMarkdown(dir);
    const htmlPath = writeHtml(dir, "page.html");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const md = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });
    const html = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "HTML", path: htmlPath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    writeFileSync(mdPath, "# changed\n", "utf8");
    await waitForChange(changes);
    expect(changes).toContain(md.id);

    changes.length = 0;
    writeFileSync(htmlPath, "<!doctype html><h1>changed</h1>", "utf8");
    await waitForChange(changes);
    expect(changes).toContain(html.id);
  });

  it("debounces rapid content changes into one artifact-content-changed event", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const mdPath = writeMarkdown(dir);
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    writeFileSync(mdPath, "# 1\n", "utf8");
    writeFileSync(mdPath, "# 2\n", "utf8");
    writeFileSync(mdPath, "# 3\n", "utf8");
    await wait(800);

    expect(changes).toEqual([artifact.id]);
  });

  it("emits one artifact-content-changed event per spaced write", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const mdPath = writeMarkdown(dir);
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    for (const content of ["# 1\n", "# 2\n", "# 3\n"]) {
      writeFileSync(mdPath, content, "utf8");
      await waitForChange(changes);
      expect(changes.at(-1)).toBe(artifact.id);
      await wait(WAIT_FOR_DEBOUNCE_MS);
    }

    expect(changes).toEqual([artifact.id, artifact.id, artifact.id]);
  });

  it("emits one owning-artifact event for each recursive subdirectory operation (^rn-ac-recursive-watch)", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const bundlePath = writeBundle(dir);
    const nestedDir = path.join(bundlePath, "assets", "styles");
    mkdirSync(nestedDir, { recursive: true });
    const createdPath = path.join(nestedDir, "created.css");
    const renamedPath = path.join(nestedDir, "renamed.css");
    const atomicReplacementPath = path.join(dir, "atomic-replacement.css");
    writeFileSync(atomicReplacementPath, "body { color: purple; }\n", "utf8");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "Dir", path: bundlePath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    await expectOneArtifactChange(changes, artifact.id, () => {
      writeFileSync(createdPath, "body { color: red; }\n", "utf8");
    });
    await expectOneArtifactChange(changes, artifact.id, () => {
      writeFileSync(createdPath, "body { color: blue; }\n", "utf8");
    });
    await expectOneArtifactChange(changes, artifact.id, () => {
      renameSync(createdPath, renamedPath);
    });
    await expectOneArtifactChange(changes, artifact.id, () => {
      renameSync(atomicReplacementPath, renamedPath);
    });
    await expectOneArtifactChange(changes, artifact.id, () => {
      unlinkSync(renamedPath);
    });
    await expectOneArtifactChange(changes, artifact.id, () => {
      const createdAfterAttach = path.join(bundlePath, "generated", "deep", "late.css");
      mkdirSync(path.dirname(createdAfterAttach), { recursive: true });
      writeFileSync(createdAfterAttach, "body { color: green; }\n", "utf8");
    });
  });

  it("debounces rapid recursive subdirectory changes per artifact (^rn-ac-watch-debounce)", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const bundlePath = writeBundle(dir);
    const nestedDir = path.join(bundlePath, "assets", "data");
    mkdirSync(nestedDir, { recursive: true });
    const dataPath = path.join(nestedDir, "state.json");
    writeFileSync(dataPath, '{"version":0}\n', "utf8");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "Dir", path: bundlePath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    writeFileSync(dataPath, '{"version":1}\n', "utf8");
    writeFileSync(dataPath, '{"version":2}\n', "utf8");
    writeFileSync(dataPath, '{"version":3}\n', "utf8");
    await waitForChange(changes);
    await wait(WAIT_FOR_DEBOUNCE_MS);

    expect(changes).toEqual([artifact.id]);
  });

  // proofs/arch/themes/index.md#^themes-t-active-package-watch
  it("coalesces nested active-package changes and recovers the same theme root without crossing domain events", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const storagePath = path.join(dir, "storage");
    const themePath = seedThemePackage(
      storagePath,
      "paperlike",
      '@import "./nested/palette.css";\n',
    );
    const nestedDir = path.join(themePath, "nested");
    const nestedPath = path.join(nestedDir, "palette.css");
    const movedThemePath = path.join(dir, "moved-paperlike");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(nestedPath, ":root { --paper: white; }\n", "utf8");
    const entryBytes = readFileSync(path.join(themePath, "theme.css"), "utf8");
    const store = createServingStore(storagePath);
    stores.push(store);
    store.patchDisplay({
      activeThemeName: "paperlike",
      themeJavaScriptConsentIds: ["paperlike", "inactive-consent"],
    });
    const registry = store.getThemeRegistry();
    const themeChanges = collectThemeChanges(store);
    const completeThemeEvents: ThemeChangedEvent[] = [];
    store.addEventListener("theme-changed", (event) => completeThemeEvents.push(event));
    const artifactChanges = collectContentChanges(store);

    await wait(WAIT_FOR_WATCHER_READY_MS);
    const nestedChanges = await observeThemeOperation(themeChanges, () => {
      writeFileSync(nestedPath, ":root { --paper: ivory; }\n", "utf8");
      writeFileSync(nestedPath, ":root { --paper: snow; }\n", "utf8");
      writeFileSync(nestedPath, ":root { --paper: linen; }\n", "utf8");
    });
    const lossChanges = await observeThemeOperation(themeChanges, () => {
      renameSync(themePath, movedThemePath);
    });
    const recoveryChanges = await observeThemeOperation(themeChanges, () => {
      renameSync(movedThemePath, themePath);
    });
    const postRecoveryChanges = await observeThemeOperation(themeChanges, () => {
      writeFileSync(nestedPath, ":root { --paper: beige; }\n", "utf8");
    });

    expect({
      nestedChanges,
      lossChanges,
      recoveryChanges,
      postRecoveryChanges,
    }).toEqual({
      nestedChanges: ["paperlike"],
      lossChanges: ["paperlike"],
      recoveryChanges: ["paperlike"],
      postRecoveryChanges: ["paperlike"],
    });
    expect(artifactChanges).toEqual([]);
    expect(completeThemeEvents.map((event) => ({
      themeName: event.themeName,
      activeThemeColorScheme: event.activeThemeColorScheme,
      consent: event.themeJavaScriptConsentIds,
    }))).toEqual(Array.from({ length: 4 }, () => ({
      themeName: "paperlike",
      activeThemeColorScheme: "light dark",
      consent: ["paperlike", "inactive-consent"],
    })));
    expect(new Set(completeThemeEvents.map((event) => event.themeJavaScriptConsentIds)).size).toBe(4);
    completeThemeEvents[0]!.themeJavaScriptConsentIds.push("listener-mutation");
    expect(store.getDisplayState().themeJavaScriptConsentIds)
      .toEqual(["paperlike", "inactive-consent"]);
    expect(store.getActiveThemeName()).toBe("paperlike");
    expect(store.getThemeRegistry()).toEqual(registry);
    expect(readFileSync(path.join(themePath, "theme.css"), "utf8")).toBe(entryBytes);
  });

  // proofs/arch/themes/index.md#^themes-t-active-watcher-lifecycle
  it("closes active-theme owners before replacement and suppresses every superseded callback and timer", () => {
    vi.useFakeTimers();
    const dir = tempDir();
    dirs.push(dir);
    const storagePath = path.join(dir, "storage");
    seedThemePackage(storagePath, "one", ":root {}");
    seedThemePackage(storagePath, "two", ":root {}");
    const calls: ControlledWatchCall[] = [];
    const previousClosedAtConstruction: boolean[] = [];
    const baseWatchContentFile = controlledWatchContentFile(calls);
    const watchContentFile: WatchContentFile = (watchPath, onChange, options) => {
      if (calls.length > 0) {
        previousClosedAtConstruction.push(calls.at(-1)!.watcher.closed);
      }
      return baseWatchContentFile(watchPath, onChange, options);
    };
    const store = createServingStore(storagePath, { watchContentFile });
    stores.push(store);
    const changes = collectThemeChanges(store);

    store.patchDisplay({ activeThemeName: "one" });
    changes.length = 0;
    calls[0]!.onChange();
    store.patchDisplay({ activeThemeName: "two" });
    changes.length = 0;
    vi.advanceTimersByTime(200);
    const canceledOnReplacement = [...changes];

    calls[0]!.onChange();
    vi.advanceTimersByTime(200);
    const supersededWhileDifferent = [...changes];

    store.patchDisplay({ activeThemeName: "one" });
    changes.length = 0;
    calls[2]!.onChange();
    vi.advanceTimersByTime(50);
    calls[0]!.onChange();
    vi.advanceTimersByTime(50);
    const currentDeadlineDelivery = [...changes];
    vi.advanceTimersByTime(100);
    const afterSupersededDeadline = [...changes];

    changes.length = 0;
    calls[2]!.onChange();
    store.patchDisplay({ activeThemeName: null });
    changes.length = 0;
    calls[2]!.onChange();
    vi.advanceTimersByTime(200);
    const afterNullSelection = [...changes];

    store.patchDisplay({ activeThemeName: "one" });
    changes.length = 0;
    calls[3]!.onChange();
    store.dispose();
    calls[3]!.onChange();
    vi.advanceTimersByTime(200);
    const afterDispose = [...changes];

    expect({
      previousClosedAtConstruction,
      closedWatchers: calls.map(({ watcher }) => watcher.closed),
      canceledOnReplacement,
      supersededWhileDifferent,
      currentDeadlineDelivery,
      afterSupersededDeadline,
      afterNullSelection,
      afterDispose,
    }).toEqual({
      previousClosedAtConstruction: [true, true, true],
      closedWatchers: [true, true, true, true],
      canceledOnReplacement: [],
      supersededWhileDifferent: [],
      currentDeadlineDelivery: ["one"],
      afterSupersededDeadline: ["one"],
      afterNullSelection: [],
      afterDispose: [],
    });
  });

  // proofs/arch/themes/index.md#^themes-t-active-watcher-error
  it("reports an active-theme watcher error and closes only its event owner without changing domain state", () => {
    vi.useFakeTimers();
    const dir = tempDir();
    dirs.push(dir);
    const storagePath = path.join(dir, "storage");
    seedThemePackage(storagePath, "paperlike", ":root {}");
    const calls: ControlledWatchCall[] = [];
    const store = createServingStore(storagePath, {
      watchContentFile: controlledWatchContentFile(calls),
    });
    stores.push(store);
    store.patchDisplay({ activeThemeName: "paperlike" });
    const changes = collectThemeChanges(store);
    const registry = store.getThemeRegistry();
    const error = new Error("synthetic theme watcher error");
    const warnSpy = vi.spyOn(console, "warn");

    calls[0]!.onChange();
    calls[0]!.watcher.emit("error", error);
    calls[0]!.onChange();
    vi.advanceTimersByTime(200);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Watcher error for active theme paperlike"),
      error,
    );
    expect(calls[0]!.watcher.closed).toBe(true);
    expect(changes).toEqual([]);
    expect(store.getThemeRegistry()).toEqual(registry);
    expect(store.getActiveThemeName()).toBe("paperlike");
  });

  it("[Symbol.dispose]() is equivalent to dispose()", () => {
    const dir = tempDir();
    dirs.push(dir);
    const mdPath = writeMarkdown(dir);
    const watchers: FakeWatcher[] = [];
    const watchContentFile: WatchContentFile = () => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      return watcher;
    };
    const store = createServingStore(path.join(dir, "storage"), { watchContentFile });
    stores.push(store);
    store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });

    store[Symbol.dispose]();

    expect(watchers[0]?.closed).toBe(true);
  });

  it("emits artifact-content-changed when path patches retarget content", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const beforePath = writeMarkdown(dir, "before.md");
    const afterPath = writeMarkdown(dir, "after.md");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: beforePath });

    store.updateArtifact({ artifactID: artifact.id, fields: { path: afterPath } });

    await waitForChange(changes);
    expect(changes).toEqual([artifact.id]);
  });

  // proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-artifact-watcher-lifecycle
  it("isolates artifact watcher errors and suppresses stale callbacks after retarget, delete, and dispose", () => {
    vi.useFakeTimers();
    const dir = tempDir();
    dirs.push(dir);
    const beforePath = writeMarkdown(dir, "before.md");
    const afterPath = writeMarkdown(dir, "after.md");
    const siblingPath = writeMarkdown(dir, "sibling.md");
    const disposablePath = writeMarkdown(dir, "disposable.md");
    const calls: ControlledWatchCall[] = [];
    const store = createServingStore(path.join(dir, "storage"), {
      watchContentFile: controlledWatchContentFile(calls),
    });
    stores.push(store);
    const channelID = store.listChannels()[0]!.id;
    const retargeted = store.createArtifact({ channelID, kind: "path", title: "Retargeted", path: beforePath });
    const sibling = store.createArtifact({ channelID, kind: "path", title: "Sibling", path: siblingPath });
    const changes = collectContentChanges(store);
    const warnSpy = vi.spyOn(console, "warn");

    store.updateArtifact({ artifactID: retargeted.id, fields: { title: "Retitled" } });
    const titleOnlyPatch = {
      watcherCalls: calls.length,
      watcherClosed: calls[0]!.watcher.closed,
    };

    store.updateArtifact({ artifactID: retargeted.id, fields: { path: afterPath } });
    vi.advanceTimersByTime(50);
    calls[0]!.onChange();
    vi.advanceTimersByTime(50);
    const retargetDeliveryAtCurrentDeadline = [...changes];
    vi.advanceTimersByTime(100);
    const afterSupersededRetargetDeadline = [...changes];

    changes.length = 0;
    calls[0]!.onChange();
    vi.advanceTimersByTime(200);
    const staleAfterRetarget = [...changes];

    changes.length = 0;
    calls[2]!.onChange();
    store.deleteArtifact(retargeted.id);
    calls[2]!.onChange();
    vi.advanceTimersByTime(200);
    const staleAfterDelete = [...changes];

    const disposable = store.createArtifact({
      channelID,
      kind: "path",
      title: "Disposable",
      path: disposablePath,
    });
    const error = new Error("synthetic artifact watcher error");
    changes.length = 0;
    calls[1]!.onChange();
    calls[1]!.watcher.emit("error", error);
    calls[1]!.onChange();
    vi.advanceTimersByTime(200);
    const afterError = [...changes];
    const closedAfterError = calls.map(({ watcher }) => watcher.closed);

    changes.length = 0;
    calls[3]!.onChange();
    store.dispose();
    calls[3]!.onChange();
    vi.advanceTimersByTime(200);
    const staleAfterDispose = [...changes];

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Watcher error for artifact ${sibling.id}`),
      error,
    );
    expect({
      watchPaths: calls.map(({ watchPath }) => watchPath),
      titleOnlyPatch,
      retargetDeliveryAtCurrentDeadline,
      afterSupersededRetargetDeadline,
      staleAfterRetarget,
      staleAfterDelete,
      afterError,
      closedAfterError,
      staleAfterDispose,
      closedWatchers: calls.map(({ watcher }) => watcher.closed),
      disposableKind: disposable.kind,
    }).toEqual({
      watchPaths: [beforePath, siblingPath, afterPath, disposablePath],
      titleOnlyPatch: {
        watcherCalls: 2,
        watcherClosed: false,
      },
      retargetDeliveryAtCurrentDeadline: [retargeted.id],
      afterSupersededRetargetDeadline: [retargeted.id],
      staleAfterRetarget: [],
      staleAfterDelete: [],
      afterError: [],
      closedAfterError: [true, true, true, false],
      staleAfterDispose: [],
      closedWatchers: [true, true, true, true],
      disposableKind: "path",
    });
  });

  it("loads a missing path artifact without watcher warning and recovers when the path appears", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const parent = path.join(dir, "parent");
    const moved = path.join(dir, "moved-parent");
    mkdirSync(parent);
    const mdPath = writeMarkdown(parent, "note.md");
    const storagePath = path.join(dir, "storage");
    const first = createServingStore(storagePath);
    const artifact = first.createArtifact({ channelID: first.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });
    first.dispose();

    renameSync(parent, moved);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const restarted = createServingStore(storagePath);
    stores.push(restarted);
    const changes = collectContentChanges(restarted);

    await wait(WAIT_FOR_DEBOUNCE_MS);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Failed to watch artifact content path"), expect.anything());

    changes.length = 0;
    renameSync(moved, parent);
    await waitForChange(changes);
    expect(changes).toContain(artifact.id);
  });

  it("emits artifact-content-changed for two file artifacts when an ancestor directory moves and again after rearm", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const outer = path.join(dir, "outer");
    const parent = path.join(outer, "parent");
    const moved = path.join(dir, "moved-outer");
    mkdirSync(parent, { recursive: true });
    const mdPath = writeMarkdown(parent, "note.md");
    const htmlPath = writeHtml(parent, "page.html");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const md = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });
    const html = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "HTML", path: htmlPath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    renameSync(outer, moved);
    await waitForChange(changes);
    await wait(WAIT_FOR_DEBOUNCE_MS);
    expect(changes).toEqual(expect.arrayContaining([md.id, html.id]));

    changes.length = 0;
    renameSync(moved, outer);
    await waitForChange(changes);
    await wait(WAIT_FOR_DEBOUNCE_MS);
    expect(changes).toEqual(expect.arrayContaining([md.id, html.id]));
  });

  it("emits artifact-content-changed for two file artifacts sharing a moved parent directory and again after rearm", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const parent = path.join(dir, "parent");
    const moved = path.join(dir, "moved");
    mkdirSync(parent);
    const mdPath = writeMarkdown(parent, "note.md");
    const htmlPath = writeHtml(parent, "page.html");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const md = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "MD", path: mdPath });
    const html = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "HTML", path: htmlPath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    renameSync(parent, moved);
    await waitForChange(changes);
    await wait(WAIT_FOR_DEBOUNCE_MS);
    expect(changes).toEqual(expect.arrayContaining([md.id, html.id]));

    changes.length = 0;
    renameSync(moved, parent);
    await waitForChange(changes);
    await wait(WAIT_FOR_DEBOUNCE_MS);
    expect(changes).toEqual(expect.arrayContaining([md.id, html.id]));
  });

  it("emits artifact-content-changed when a watched directory dies and again after rearm", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const bundlePath = writeBundle(dir);
    const movedPath = path.join(dir, "moved-bundle");
    const store = createServingStore(path.join(dir, "storage"));
    stores.push(store);
    const changes = collectContentChanges(store);
    const artifact = store.createArtifact({ channelID: store.listChannels()[0]!.id, kind: "path", title: "Dir", path: bundlePath });

    await wait(WAIT_FOR_WATCHER_READY_MS);
    renameSync(bundlePath, movedPath);
    await waitForChange(changes);
    expect(changes).toEqual([artifact.id]);

    changes.length = 0;
    renameSync(movedPath, bundlePath);
    await waitForChange(changes);
    expect(changes).toEqual([artifact.id]);
  });

});
