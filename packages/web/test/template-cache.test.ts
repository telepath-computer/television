import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactTemplateScan, TemplateClient } from "@telepath-computer/television-shared";
import { TemplateCache } from "../src/services/template-cache.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function scan(ids = ["one"], watching = true): ArtifactTemplateScan {
  return { templates: ids.map((id) => ({ id, name: id, description: "Page", version: "1.0.0", path: `/templates/${id}`, hasIcon: true })), errors: [], watching };
}
function icon(text: string) { return { bytes: new TextEncoder().encode(text), contentType: "image/svg+xml" as const }; }
const caches: TemplateCache[] = [];
function fixture() {
  const client = { list: vi.fn(async (_options?: { fresh?: boolean }) => scan()), icon: vi.fn<TemplateClient["icon"]>(async (_id) => icon("first")) };
  const cache = new TemplateCache(() => client as unknown as TemplateClient);
  caches.push(cache);
  return { cache, client };
}
afterEach(() => caches.splice(0).forEach((cache) => cache.dispose()));
async function flush() { await Promise.resolve(); await Promise.resolve(); }
async function bytes(cache: TemplateCache, id: string) { return (await fetch(cache.icons.get(id)!)).text(); }

describe("connection template cache (^templates-t-app-cache)", () => {
  it.each(["push", "full fetch", "reconnect"])("keeps the old image until replacement after %s, then revokes it", async (source) => {
    const { cache, client } = fixture();
    await cache.load(); await flush();
    const old = cache.icons.get("one")!;
    const replacement = deferred<Awaited<ReturnType<TemplateClient["icon"]>>>();
    client.icon.mockReturnValueOnce(replacement.promise);
    if (source === "push") cache.apply({ scan: scan(), invalidatedIDs: ["one"] });
    else {
      if (source === "reconnect") {
        cache.reset();
        expect(cache.icons.get("one")).toBe(old);
      }
      await cache.load();
    }
    expect(cache.icons.get("one")).toBe(old);
    expect(await bytes(cache, "one")).toBe("first");
    replacement.resolve(icon("replacement")); await flush();
    expect(await bytes(cache, "one")).toBe("replacement");
    expect(cache.icons.get("one")).not.toBe(old);
    await expect(fetch(old)).rejects.toThrow();
    const current = cache.icons.get("one")!;
    cache.dispose();
    expect(cache.icons.size).toBe(0);
    await expect(fetch(current)).rejects.toThrow();
  });

  it("removes old icons on replacement failure, missing icons or removed templates", async () => {
    const { cache, client } = fixture();
    client.list.mockResolvedValue(scan(["one", "two", "three"]));
    await cache.load(); await flush();
    const old = [...cache.icons.values()];
    const changed = vi.fn();
    cache.addEventListener("change", changed);
    client.icon.mockRejectedValueOnce(new Error("missing image"));
    const next = scan(["one", "two"]);
    next.templates[1]!.hasIcon = false;
    cache.apply({ scan: next, invalidatedIDs: ["one"] });
    expect([...cache.icons.keys()]).toEqual(["one"]);
    changed.mockClear();
    await flush();
    expect(cache.icons.size).toBe(0);
    expect(changed).toHaveBeenCalledOnce();
    for (const url of old) await expect(fetch(url)).rejects.toThrow();
  });

  it("preloads icons, retains them while closed, and applies only named push invalidations", async () => {
    const { cache, client } = fixture();
    client.list.mockResolvedValue(scan(["one", "two"]));
    await cache.load(); await flush();
    expect(await bytes(cache, "one")).toBe("first");
    const kept = cache.icons.get("two");
    cache.setOpen(true); cache.setOpen(false); cache.setOpen(true);
    expect(client.list).toHaveBeenCalledTimes(1);
    expect(client.icon).toHaveBeenCalledTimes(2);
    client.icon.mockResolvedValue(icon("updated"));
    cache.apply({ scan: scan(["one", "two", "three"]), invalidatedIDs: ["one", "three"] });
    await flush();
    expect(cache.icons.get("two")).toBe(kept);
    expect(await bytes(cache, "one")).toBe("updated");
    expect(await bytes(cache, "three")).toBe("updated");
    cache.apply({ scan: scan(["two"]), invalidatedIDs: ["one", "three"] });
    expect([...cache.icons.keys()]).toEqual(["two"]);
    client.list.mockResolvedValue(scan(["two"]));
    await cache.load(); await flush();
    expect(cache.icons.get("two")).not.toBe(kept);
    expect(await bytes(cache, "two")).toBe("updated");
  });

  it("rejects delayed lists and icons superseded by a push or a connection attempt", async () => {
    const { cache, client } = fixture();
    const list = deferred<ArtifactTemplateScan>();
    const image = deferred<Awaited<ReturnType<TemplateClient["icon"]>>>();
    client.list.mockReturnValueOnce(list.promise);
    const loading = cache.load();
    cache.apply({ scan: scan(["new"]), invalidatedIDs: ["new"] });
    list.resolve(scan(["old"]));
    await loading; await flush();
    expect(cache.scan?.templates[0]?.id).toBe("new");
    client.icon.mockReturnValueOnce(image.promise);
    cache.apply({ scan: scan(["new"]), invalidatedIDs: ["new"] });
    client.icon.mockResolvedValue(icon("latest"));
    cache.apply({ scan: scan(["new"]), invalidatedIDs: ["new"] });
    await flush();
    const latest = cache.icons.get("new");
    image.resolve(icon("stale")); await flush();
    expect(cache.icons.get("new")).toBe(latest);
    expect(await bytes(cache, "new")).toBe("latest");
    const reconnect = deferred<ArtifactTemplateScan>();
    client.list.mockReturnValueOnce(reconnect.promise);
    const oldAttempt = cache.load();
    cache.reset();
    reconnect.resolve(scan(["wrong-attempt"])); await oldAttempt;
    expect(cache.scan?.templates[0]?.id).toBe("new");
  });

  it("reloads every icon after reconnect when a partial push supersedes the list response", async () => {
    const { cache, client } = fixture();
    client.list.mockResolvedValue(scan(["one", "two"]));
    client.icon.mockImplementation(async (id) => icon(`${id}-old`));
    await cache.load(); await flush();
    expect(await bytes(cache, "one")).toBe("one-old");
    expect(await bytes(cache, "two")).toBe("two-old");

    cache.reset();
    expect(await bytes(cache, "one")).toBe("one-old");
    expect(await bytes(cache, "two")).toBe("two-old");
    const reconnect = deferred<ArtifactTemplateScan>();
    client.list.mockReturnValueOnce(reconnect.promise);
    client.icon.mockImplementation(async (id) => icon(`${id}-new`));
    const loading = cache.load();
    cache.apply({ scan: scan(["one", "two"]), invalidatedIDs: ["one"] });
    reconnect.resolve(scan(["one", "two"]));
    await loading; await flush();

    cache.setOpen(true);
    expect(await bytes(cache, "one")).toBe("one-new");
    expect(await bytes(cache, "two")).toBe("two-new");
    expect(client.list).toHaveBeenCalledTimes(2);
    expect(client.icon).toHaveBeenCalledTimes(4);
  });

  it("retries failed loads on opening, keeps previous rows, and refreshes once per watcher-failure transition", async () => {
    const { cache, client } = fixture();
    client.list.mockRejectedValueOnce(new Error("offline"));
    await cache.load();
    expect(cache.scan).toBeNull();
    cache.setOpen(true); await flush();
    expect(client.list).toHaveBeenCalledTimes(2);
    expect(client.list).toHaveBeenLastCalledWith(undefined);
    expect(cache.scan?.templates[0]?.id).toBe("one");
    const pending = deferred<ArtifactTemplateScan>();
    client.list.mockReturnValueOnce(pending.promise);
    cache.apply({ scan: scan(["one"], false), invalidatedIDs: [] });
    expect(client.list).toHaveBeenLastCalledWith({ fresh: true });
    expect(cache.scan?.templates[0]?.id).toBe("one");
    pending.resolve(scan(["two"], false)); await flush();
    cache.apply({ scan: scan(["two"], false), invalidatedIDs: [] });
    expect(client.list).toHaveBeenCalledTimes(3);
    cache.setOpen(false); cache.setOpen(true); await flush();
    expect(client.list).toHaveBeenCalledTimes(4);
    expect(client.list).toHaveBeenLastCalledWith({ fresh: true });
    cache.apply({ scan: scan(["restored"]), invalidatedIDs: ["restored"] });
    cache.setOpen(false); cache.setOpen(true);
    expect(client.list).toHaveBeenCalledTimes(4);
    client.list.mockRejectedValueOnce(new Error("reconnect list failed"));
    await cache.load();
    expect(cache.scan?.templates[0]?.id).toBe("restored");
    cache.setOpen(false); cache.setOpen(true); await flush();
    expect(client.list).toHaveBeenCalledTimes(6);
    expect(client.list).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps connections separate and discards completions after disposal", async () => {
    const { cache, client } = fixture();
    const other = fixture().cache;
    const pending = deferred<ArtifactTemplateScan>();
    client.list.mockReturnValue(pending.promise);
    const loading = cache.load();
    cache.dispose(); pending.resolve(scan()); await loading;
    expect(cache.scan).toBeNull();
    expect(other.scan).toBeNull();
    expect(client.icon).not.toHaveBeenCalled();
  });
});
