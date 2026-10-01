import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PAGE_SIZE,
  InvalidRequestError,
} from "@telepath-computer/television-shared";
import { artifactWatchTarget, ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-store-artifacts-"));
}

function withStore(fn: (store: ServerStore, storagePath: string, channelID: string) => void): void {
  const storagePath = tempDir();
  const store = createServingStore(storagePath);
  const channelID = store.listChannels()[0]!.id;
  try { fn(store, storagePath, channelID); } finally { store.dispose(); rmSync(storagePath, { recursive: true, force: true }); }
}

describe("ServerStore pointer artifacts", () => {
  it("creates path artifacts with trimmed targets and appends them to the owning channel", () => withStore((store, storagePath, channelID) => {
    const target = path.join(storagePath, "note.md");
    writeFileSync(target, "# note");
    const events: Array<{ channelID: string; artifactID: string; readable: boolean }> = [];
    store.addEventListener("artifact-created", (event) => {
      events.push({
        channelID: event.channelID,
        artifactID: event.artifact.id,
        readable: store.getArtifact(event.artifact.id) !== undefined && store.getChannel(event.channelID) !== undefined,
      });
    });

    const artifact = store.createArtifact({ kind: "path", title: "A", channelID, path: `  ${target}  ` });

    expect(artifact).toEqual({ id: expect.any(String), kind: "path", title: "A", path: target });
    expect(store.getChannel(channelID)!.channel.layout).toEqual([{
      artifactIds: [artifact.id],
      geometry: { kind: "single", full_screen: false },
      size: DEFAULT_PAGE_SIZE,
    }]);
    expect(events).toEqual([{ channelID, artifactID: artifact.id, readable: true }]);
  }));

  it("creates URL artifacts with trimmed http(s) URLs", () => withStore((store, _storagePath, channelID) => {
    const artifact = store.createArtifact({ kind: "url", title: "U", channelID, url: "  https://example.com/a  " });
    expect(artifact).toEqual({ id: expect.any(String), kind: "url", title: "U", url: "https://example.com/a" });
  }));

  it("updates title without touching the channel file", () => withStore((store, storagePath, channelID) => {
    const target = path.join(storagePath, "index.html");
    writeFileSync(target, "<!doctype html>");
    const artifact = store.createArtifact({ kind: "path", title: "Before", channelID, path: target });
    const channelPath = path.join(storagePath, "state", "channels", `${channelID}.json`);
    const beforeChannel = readFileSync(channelPath, "utf8");

    expect(store.updateArtifact({ artifactID: artifact.id, fields: { title: "After" } })).toEqual({ ...artifact, title: "After" });

    expect(readFileSync(channelPath, "utf8")).toBe(beforeChannel);
    expect(store.getArtifact(artifact.id)).toEqual({ ...artifact, title: "After" });
  }));

  it("updates path artifacts to a new path", () => withStore((store, storagePath, channelID) => {
    const before = path.join(storagePath, "before.md");
    const after = path.join(storagePath, "after.md");
    writeFileSync(before, "# before");
    writeFileSync(after, "# after");
    const artifact = store.createArtifact({ kind: "path", title: "Note", channelID, path: before });

    expect(store.updateArtifact({ artifactID: artifact.id, fields: { path: after } })).toEqual({ ...artifact, path: after });
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "artifacts", `${artifact.id}.json`), "utf8"))).toEqual({ ...artifact, path: after });
  }));

  it("normalizes directory paths to a trailing separator regardless of input form", () => withStore((store, storagePath, channelID) => {
    const dir = path.join(storagePath, "site");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "index.html"), "<!doctype html>");
    const canonical = `${dir}${path.sep}`;

    for (const supplied of [dir, `${dir}/`, `${dir}//`]) {
      const artifact = store.createArtifact({ kind: "path", title: "Site", channelID, path: supplied });
      expect(artifact.kind).toBe("path");
      expect(artifact.kind === "path" && artifact.path).toBe(canonical);
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "artifacts", `${artifact.id}.json`), "utf8")).path).toBe(canonical);
      expect(artifactWatchTarget(artifact)).toEqual({ watchPath: canonical, recursive: true });
      store.deleteArtifact(artifact.id);
    }
  }));

  it("strips a trailing separator supplied on a file path", () => withStore((store, storagePath, channelID) => {
    const target = path.join(storagePath, "report.html");
    writeFileSync(target, "<!doctype html>");

    const artifact = store.createArtifact({ kind: "path", title: "Report", channelID, path: `${target}/` });

    expect(artifact.kind === "path" && artifact.path).toBe(target);
    expect(artifactWatchTarget(artifact)).toEqual({ watchPath: target, recursive: false });
  }));

  it("normalizes directory paths on update", () => withStore((store, storagePath, channelID) => {
    const before = path.join(storagePath, "before.md");
    writeFileSync(before, "# before");
    const dir = path.join(storagePath, "dashboard");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "index.htm"), "<!doctype html>");
    const artifact = store.createArtifact({ kind: "path", title: "Doc", channelID, path: before });

    const updated = store.updateArtifact({ artifactID: artifact.id, fields: { path: dir } });

    expect(updated.kind === "path" && updated.path).toBe(`${dir}${path.sep}`);
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "artifacts", `${artifact.id}.json`), "utf8")).path).toBe(`${dir}${path.sep}`);
  }));

  it("rejects a directory without a root index in either input form", () => withStore((store, storagePath, channelID) => {
    const dir = path.join(storagePath, "no-index");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "page.html"), "<!doctype html>");

    expect(() => store.createArtifact({ kind: "path", title: "No index", channelID, path: dir })).toThrow(/index\.html or index\.htm/);
    expect(() => store.createArtifact({ kind: "path", title: "No index", channelID, path: `${dir}/` })).toThrow(/index\.html or index\.htm/);
  }));

  it("rejects unsupported file extensions whether or not a trailing separator was supplied", () => withStore((store, storagePath, channelID) => {
    const target = path.join(storagePath, "data.json");
    writeFileSync(target, "{}");

    expect(() => store.createArtifact({ kind: "path", title: "Data", channelID, path: target })).toThrow(/extension must be one of/);
    expect(() => store.createArtifact({ kind: "path", title: "Data", channelID, path: `${target}/` })).toThrow(/extension must be one of/);
  }));

  it("rejects invalid create inputs with InvalidRequestError", () => withStore((store, storagePath, channelID) => {
    const target = path.join(storagePath, "index.html");
    writeFileSync(target, "<!doctype html>");
    expect(() => store.createArtifact({ kind: "path", title: "Missing path", channelID } as never)).toThrow(InvalidRequestError);
    expect(() => store.createArtifact({ kind: "path", title: "Both", channelID, path: target, url: "https://example.com" } as never)).toThrow(InvalidRequestError);
    expect(() => store.createArtifact({ kind: "path", title: "Relative", channelID, path: "relative.html" })).toThrow(InvalidRequestError);
    expect(() => store.createArtifact({ kind: "url", title: "Missing URL", channelID } as never)).toThrow(InvalidRequestError);
    expect(() => store.createArtifact({ kind: "url", title: "Both", channelID, url: "https://example.com", path: target } as never)).toThrow(InvalidRequestError);
    expect(() => store.createArtifact({ kind: "url", title: "File URL", channelID, url: "file:///tmp/a.html" })).toThrow(InvalidRequestError);
  }));
});
