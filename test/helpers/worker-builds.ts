import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Owns reusable preparation for one runner worker. */
export class WorkerBuilds {
  private readonly builds = new Map<string, Promise<string>>();

  constructor(private readonly prefix: string, private readonly parent = os.tmpdir()) {}

  get(key: string, prepare: (directory: string) => void | Promise<void>): Promise<string> {
    let build = this.builds.get(key);
    if (!build) {
      const directory = mkdtempSync(path.join(this.parent, this.prefix));
      build = Promise.resolve().then(() => prepare(directory)).then(() => directory);
      this.builds.set(key, build);
    }
    return build;
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.builds.values());
  }
}
