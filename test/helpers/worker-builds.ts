import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Owns reusable preparation for one runner worker. */
export class WorkerBuilds {
  private readonly builds = new Map<string, Promise<string>>();
  private readonly directories = new Set<string>();
  private disposal: Promise<void> | undefined;
  private readonly prefix: string;
  private readonly parent: string;

  constructor(prefix: string, parent = os.tmpdir()) {
    this.prefix = prefix;
    this.parent = parent;
  }

  get(key: string, prepare: (directory: string) => void | Promise<void>): Promise<string> {
    if (this.disposal) return Promise.reject(new Error("Worker build lifetime has ended"));
    let build = this.builds.get(key);
    if (!build) {
      const directory = mkdtempSync(path.join(this.parent, this.prefix));
      this.directories.add(directory);
      build = Promise.resolve().then(() => prepare(directory)).then(() => directory, (error: unknown) => {
        this.builds.delete(key);
        this.remove(directory);
        throw error;
      });
      this.builds.set(key, build);
    }
    return build;
  }

  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      await Promise.allSettled(this.builds.values());
      const failures: unknown[] = [];
      for (const directory of this.directories) {
        try { this.remove(directory); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Failed to remove worker builds");
    })();
    return this.disposal;
  }

  private remove(directory: string): void {
    rmSync(directory, { recursive: true, force: true });
    this.directories.delete(directory);
  }
}
