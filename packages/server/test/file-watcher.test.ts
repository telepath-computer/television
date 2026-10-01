import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultWatchContentFile } from "../src/file-watcher.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
  intervalMs = 20,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for watcher event");
    }
    await sleep(intervalMs);
  }
}

async function settledChangeCount(readCount: () => number): Promise<number> {
  let count = readCount();
  let unchangedSince = Date.now();
  // Native delivery can include setup or recovery events after watch attachment.
  // Separate those notifications from the operation whose callbacks we count.
  await waitFor(() => {
    const current = readCount();
    if (current !== count) {
      count = current;
      unchangedSince = Date.now();
    }
    return Date.now() - unchangedSince >= 250;
  });
  return count;
}

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-file-watch-"));
}

describe("defaultWatchContentFile", () => {
  const dirs: string[] = [];
  const watchers: Array<{ close(): void }> = [];

  afterEach(() => {
    for (const watcher of watchers.splice(0)) {
      watcher.close();
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fires for a single write to the watched file", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const watchedPath = path.join(dir, "theme.css");
    writeFileSync(watchedPath, ":root { --color-bg: rgb(0, 255, 0); }\n", "utf8");

    let changes = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {
      changes += 1;
    });
    watchers.push(watcher);

    await sleep(50);
    changes = 0;
    writeFileSync(watchedPath, ":root { --color-bg: rgb(255, 0, 255); }\n", "utf8");

    await waitFor(() => changes >= 1);
  });

  it("fires for sequential writes to the watched file", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const watchedPath = path.join(dir, "theme.css");
    writeFileSync(watchedPath, ":root { --color-bg: rgb(0, 255, 0); }\n", "utf8");

    let changes = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {
      changes += 1;
    });
    watchers.push(watcher);

    await sleep(50);
    changes = 0;
    for (const css of [
      ":root { --color-bg: rgb(255, 0, 255); }\n",
      ":root { --color-bg: rgb(0, 0, 255); }\n",
      ":root { --color-bg: rgb(255, 255, 0); }\n",
    ]) {
      const baseline = changes;
      writeFileSync(watchedPath, css, "utf8");
      await waitFor(() => changes > baseline);
      await sleep(100);
    }
  });

  it("ignores writes to sibling files in the same directory", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const watchedPath = path.join(dir, "theme.css");
    const siblingPath = path.join(dir, "lock.tmp");
    writeFileSync(watchedPath, ":root { --color-bg: rgb(0, 255, 0); }\n", "utf8");
    writeFileSync(siblingPath, "lock-1\n", "utf8");

    let changes = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {
      changes += 1;
    });
    watchers.push(watcher);

    const baseline = await settledChangeCount(() => changes);
    writeFileSync(siblingPath, "lock-2\n", "utf8");
    await sleep(250);

    expect(changes).toBe(baseline);
    writeFileSync(watchedPath, ":root { --color-bg: rgb(255, 0, 255); }\n", "utf8");
    await waitFor(() => changes > baseline);
  });

  it("stops firing after close", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const watchedPath = path.join(dir, "theme.css");
    writeFileSync(watchedPath, ":root { --color-bg: rgb(0, 255, 0); }\n", "utf8");

    let changes = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {
      changes += 1;
    });
    watchers.push(watcher);

    await sleep(50);
    changes = 0;
    watcher.close();
    writeFileSync(watchedPath, ":root { --color-bg: rgb(255, 0, 255); }\n", "utf8");
    await sleep(250);

    expect(changes).toBe(0);
  });

  it("supports attaching an error listener", () => {
    const dir = tempDir();
    dirs.push(dir);
    const watchedPath = path.join(dir, "theme.css");
    writeFileSync(watchedPath, ":root { --color-bg: rgb(0, 255, 0); }\n", "utf8");

    const watcher = defaultWatchContentFile(watchedPath, () => {});
    watchers.push(watcher);

    const error = new Error("synthetic watcher error");
    const onError = vi.fn();

    watcher.on("error", onError);
    (watcher as unknown as EventEmitter).emit("error", error);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("reports death when a watched directory artifact root is moved and rearms when it returns", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const bundle = path.join(dir, "bundle");
    const moved = path.join(dir, "moved-bundle");
    mkdirSync(bundle);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html>", "utf8");

    let changes = 0;
    let deaths = 0;
    let rearms = 0;
    const watcher = defaultWatchContentFile(`${bundle}${path.sep}`, () => {
      changes += 1;
    }, {
      recursive: true,
      rearmIntervalMs: 25,
      onWatcherDead: () => {
        deaths += 1;
      },
      onWatcherRearmed: () => {
        rearms += 1;
      },
    });
    watchers.push(watcher);

    await sleep(50);
    renameSync(bundle, moved);
    await waitFor(() => deaths >= 1);
    renameSync(moved, bundle);
    await waitFor(() => rearms >= 1);
    const baseline = await settledChangeCount(() => changes);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html><h1>Restored</h1>", "utf8");
    await waitFor(() => changes > baseline);
  });

  it("reattaches when the watched directory is deleted and recreated before the event handler runs", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const bundle = path.join(dir, "bundle");
    mkdirSync(bundle);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html>", "utf8");

    let changes = 0;
    const watcher = defaultWatchContentFile(bundle, () => {
      changes += 1;
    }, {
      recursive: true,
      rearmIntervalMs: 25,
      onWatcherRearmed: () => {
        changes += 1;
      },
    });
    watchers.push(watcher);

    const beforeReplacement = await settledChangeCount(() => changes);
    rmSync(bundle, { recursive: true, force: true });
    mkdirSync(bundle);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html><h1>recreated</h1>", "utf8");

    await waitFor(() => changes > beforeReplacement);
    const baseline = await settledChangeCount(() => changes);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html><h1>watched again</h1>", "utf8");
    await waitFor(() => changes > baseline);
  });

  it("reports death for two file watchers sharing a moved parent directory and rearms both when it returns", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const parent = path.join(dir, "parent");
    const moved = path.join(dir, "moved");
    mkdirSync(parent);
    const markdownPath = path.join(parent, "note.md");
    const htmlPath = path.join(parent, "page.html");
    writeFileSync(markdownPath, "# Note\n", "utf8");
    writeFileSync(htmlPath, "<!doctype html><h1>Page</h1>", "utf8");

    const markdown = { changes: 0, deaths: 0, rearms: 0 };
    const html = { changes: 0, deaths: 0, rearms: 0 };
    const markdownWatcher = defaultWatchContentFile(markdownPath, () => {
      markdown.changes += 1;
    }, {
      rearmIntervalMs: 25,
      onWatcherDead: () => {
        markdown.deaths += 1;
      },
      onWatcherRearmed: () => {
        markdown.rearms += 1;
      },
    });
    const htmlWatcher = defaultWatchContentFile(htmlPath, () => {
      html.changes += 1;
    }, {
      rearmIntervalMs: 25,
      onWatcherDead: () => {
        html.deaths += 1;
      },
      onWatcherRearmed: () => {
        html.rearms += 1;
      },
    });
    watchers.push(markdownWatcher, htmlWatcher);

    await sleep(50);
    renameSync(parent, moved);
    await waitFor(() => markdown.deaths >= 1 && html.deaths >= 1);

    renameSync(moved, parent);
    await waitFor(() => markdown.rearms >= 1 && html.rearms >= 1);
    await settledChangeCount(() => markdown.changes + html.changes);
    const markdownBaseline = markdown.changes;
    const htmlBaseline = html.changes;
    writeFileSync(markdownPath, "# Restored\n", "utf8");
    writeFileSync(htmlPath, "<!doctype html><h1>Restored</h1>", "utf8");
    await waitFor(() => markdown.changes > markdownBaseline && html.changes > htmlBaseline);
  });

  it("keeps the content watcher when an unreadable ancestor cannot be watched", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const watchable = path.join(dir, "watchable");
    const unreadable = path.join(watchable, "unreadable");
    const parent = path.join(unreadable, "parent");
    const moved = path.join(dir, "moved-watchable");
    mkdirSync(parent, { recursive: true });
    const watchedPath = path.join(parent, "note.md");
    writeFileSync(watchedPath, "# Note\n", "utf8");

    try {
      chmodSync(unreadable, 0o311);

      let changes = 0;
      let deaths = 0;
      const watcher = defaultWatchContentFile(watchedPath, () => {
        changes += 1;
      }, {
        rearmIntervalMs: 25,
        onWatcherDead: () => {
          deaths += 1;
        },
      });
      watchers.push(watcher);

      await sleep(50);
      writeFileSync(watchedPath, "# Changed\n", "utf8");
      await waitFor(() => changes >= 1);

      renameSync(watchable, moved);
      await waitFor(() => deaths >= 1);
    } finally {
      for (const candidate of [unreadable, path.join(moved, "unreadable")]) {
        if (existsSync(candidate)) chmodSync(candidate, 0o755);
      }
    }
  });

  it("reports death when an ancestor of the watched file parent directory is moved", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const outer = path.join(dir, "outer");
    const parent = path.join(outer, "parent");
    const moved = path.join(dir, "moved-outer");
    mkdirSync(parent, { recursive: true });
    const watchedPath = path.join(parent, "note.md");
    writeFileSync(watchedPath, "# Note\n", "utf8");

    let deaths = 0;
    let rearms = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {}, {
      rearmIntervalMs: 25,
      onWatcherDead: () => {
        deaths += 1;
      },
      onWatcherRearmed: () => {
        rearms += 1;
      },
    });
    watchers.push(watcher);

    await sleep(50);
    renameSync(outer, moved);
    await waitFor(() => deaths >= 1);

    renameSync(moved, outer);
    await waitFor(() => rearms >= 1);
  });

  it("reports death when a watched file parent directory is moved and rearms when it returns", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const parent = path.join(dir, "parent");
    const moved = path.join(dir, "moved");
    mkdirSync(parent);
    const watchedPath = path.join(parent, "note.md");
    writeFileSync(watchedPath, "# Note\n", "utf8");

    let changes = 0;
    let deaths = 0;
    let rearms = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {
      changes += 1;
    }, {
      rearmIntervalMs: 25,
      onWatcherDead: () => {
        deaths += 1;
      },
      onWatcherRearmed: () => {
        rearms += 1;
      },
    });
    watchers.push(watcher);

    await sleep(50);
    renameSync(parent, moved);
    await waitFor(() => deaths >= 1);

    renameSync(moved, parent);
    await waitFor(() => rearms >= 1);
    const baseline = await settledChangeCount(() => changes);
    writeFileSync(watchedPath, "# Restored\n", "utf8");
    await waitFor(() => changes > baseline);
  });

  it("constructs dead when the watched file parent directory does not exist and rearms when it appears", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const parent = path.join(dir, "missing-parent");
    const watchedPath = path.join(parent, "theme.css");

    let changes = 0;
    let deaths = 0;
    let rearms = 0;
    const watcher = defaultWatchContentFile(watchedPath, () => {
      changes += 1;
    }, {
      rearmIntervalMs: 25,
      onWatcherDead: () => {
        deaths += 1;
      },
      onWatcherRearmed: () => {
        rearms += 1;
      },
    });
    watchers.push(watcher);

    expect(deaths).toBe(1);
    mkdirSync(parent);
    writeFileSync(watchedPath, ":root{}\n", "utf8");
    await waitFor(() => rearms >= 1);
    await waitFor(() => changes >= 1);
  });
});
