import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApp = vi.hoisted(() => ({
  getPath: vi.fn(() => "/tmp/television-connection-test"),
}));

vi.mock("electron", () => ({ app: mockApp }));

const fsState = vi.hoisted(() => {
  const files = new Map<string, string>();
  return { files };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) => fsState.files.has(path),
    readFileSync: (path: string) => {
      const content = fsState.files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFileSync: (path: string, content: string) => {
      fsState.files.set(path, content);
    },
    renameSync: (oldPath: string, newPath: string) => {
      const content = fsState.files.get(oldPath);
      if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
      fsState.files.set(newPath, content);
      fsState.files.delete(oldPath);
    },
  };
});

describe("connection-store", () => {
  beforeEach(() => {
    fsState.files.clear();
    vi.resetModules();
  });

  afterEach(() => {
    fsState.files.clear();
  });

  it("loadConnection returns null when file missing", async () => {
    const { loadConnection } = await import("../src/connection-store.ts");
    expect(loadConnection()).toBeNull();
  });

  it("saveConnection and loadConnection round-trip", async () => {
    const { loadConnection, saveConnection } = await import("../src/connection-store.ts");
    saveConnection({ serverURL: "http://localhost:32848", token: "abc" });
    expect(loadConnection()).toEqual({ serverURL: "http://localhost:32848", token: "abc" });
  });

  it("persists empty token for no-auth servers", async () => {
    const { loadConnection, saveConnection } = await import("../src/connection-store.ts");
    saveConnection({ serverURL: "http://localhost:32848", token: "" });
    expect(loadConnection()).toEqual({ serverURL: "http://localhost:32848", token: "" });
  });

  it("writes connection.json atomically via a temp file", async () => {
    const { saveConnection } = await import("../src/connection-store.ts");
    saveConnection({ serverURL: "http://localhost:32848", token: "abc" });
    expect(fsState.files.has("/tmp/television-connection-test/connection.json.tmp")).toBe(false);
    expect(JSON.parse(fsState.files.get("/tmp/television-connection-test/connection.json")!)).toEqual({
      serverURL: "http://localhost:32848",
      token: "abc",
    });
  });

  it("survives a simulated restart via loadConnection", async () => {
    const first = await import("../src/connection-store.ts");
    first.saveConnection({ serverURL: "http://localhost:99", token: "persist-me" });

    vi.resetModules();
    const second = await import("../src/connection-store.ts");
    expect(second.loadConnection()).toEqual({ serverURL: "http://localhost:99", token: "persist-me" });
  });

  it("loadConnection returns null for corrupt JSON", async () => {
    fsState.files.set("/tmp/television-connection-test/connection.json", "{not json");
    const { loadConnection } = await import("../src/connection-store.ts");
    expect(loadConnection()).toBeNull();
  });
});
