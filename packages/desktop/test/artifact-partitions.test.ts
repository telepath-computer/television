import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactPartitionReaper,
  partitionForWebview,
  readPartitionRecord,
  recordArtifactPartition,
  rewriteArtifactProxyHeaders,
  type PartitionRecordFS,
} from "../src/artifact-partitions.ts";

const SERVER_PAGE = "http://127.0.0.1:4500/?mode=electron";
const ORIGIN = "http://127.0.0.1:4500";
const OTHER_ORIGIN = "https://tv.example.ts.net";

function expectedKey(origin: string, id: string): string {
  return createHash("sha256").update(`${origin}\n${id}`, "utf8").digest("hex").slice(0, 32);
}

describe("partition names", () => {
  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-names
  it("names each partition from the requested partition and the page's origin", () => {
    const ids = ["01JABCDEFGHJKMNPQRSTVWXYZ0", "with space", "a/b:c", "UPPER", "upper", "naïve-日本"];
    for (const id of ids) {
      expect(partitionForWebview(`tv-artifact:${id}`, SERVER_PAGE)).toEqual({
        kind: "artifact",
        partition: `persist:artifact-${expectedKey(ORIGIN, id)}`,
        origin: ORIGIN,
        artifactID: id,
      });
    }
    const name = (requested: string, page: string) => partitionForWebview(requested, page)?.partition;
    expect(name("tv-artifact:same", SERVER_PAGE)).not.toBe(name("tv-artifact:same", `${OTHER_ORIGIN}/`));
    expect(name("tv-artifact:UPPER", SERVER_PAGE)).not.toBe(name("tv-artifact:upper", SERVER_PAGE));
    for (const page of [SERVER_PAGE, `${OTHER_ORIGIN}/`, "file:///app/connect.html"]) {
      expect(partitionForWebview("tv-url-artifact", page)).toEqual({ kind: "url", partition: "persist:url-artifacts" });
      expect(partitionForWebview("", page)).toEqual({ kind: "fallback", partition: "persist:webview-fallback" });
      expect(partitionForWebview(undefined, page)).toEqual({ kind: "fallback", partition: "persist:webview-fallback" });
    }
    for (const refused of ["tv-artifact:", "tv-artifact", "tv-url-artifacts", "persist:url-artifacts", "persist:arbitrary", "anything"]) {
      expect({ refused, assigned: partitionForWebview(refused, SERVER_PAGE) }).toEqual({ refused, assigned: null });
    }
    // An artifact partition is keyed by the page's origin, so it needs an HTTP(S) page.
    expect(partitionForWebview("tv-artifact:01JABCDEFGHJKMNPQRSTVWXYZ0", "file:///app/connect.html")).toBeNull();
    expect(partitionForWebview("tv-artifact:01JABCDEFGHJKMNPQRSTVWXYZ0", "")).toBeNull();
  });
});

describe("artifact proxy header rewriting", () => {
  const SANDBOX = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";
  const proxied = (headers: Record<string, string[]>, url = `${ORIGIN}/artifact/01JABC/index.html`) =>
    rewriteArtifactProxyHeaders(url, headers);

  // spec: proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-header
  it("rewrites only the artifact proxy's sandbox header and referrer policy", () => {
    const base = { "X-TV-Version": ["1.4.27"], "Content-Type": ["text/html"], "Referrer-Policy": ["no-referrer"] };
    for (const sandbox of [SANDBOX, "sandbox", "sandbox allow-scripts", "  SANDBOX   allow-scripts  ", "Sandbox allow-forms;"]) {
      expect({ sandbox, headers: proxied({ ...base, "Content-Security-Policy": [sandbox] }) }).toEqual({
        sandbox,
        headers: { "X-TV-Version": ["1.4.27"], "Content-Type": ["text/html"], "Referrer-Policy": ["strict-origin-when-cross-origin"] },
      });
    }
    // Policies with other directives stay, alone or beside a sandbox-only one.
    for (const kept of ["default-src 'self'; sandbox allow-scripts", "sandbox allow-scripts; img-src *", "script-src 'none'"]) {
      expect(proxied({ ...base, "Content-Security-Policy": [kept] })).toEqual({
        "X-TV-Version": ["1.4.27"], "Content-Type": ["text/html"], "Content-Security-Policy": [kept],
        "Referrer-Policy": ["strict-origin-when-cross-origin"],
      });
    }
    expect(proxied({ ...base, "content-security-policy": [SANDBOX, "img-src *"] })).toEqual({
      "X-TV-Version": ["1.4.27"], "Content-Type": ["text/html"], "content-security-policy": ["img-src *"],
      "Referrer-Policy": ["strict-origin-when-cross-origin"],
    });
    // Header names are matched without regard to case; the referrer policy is set whatever was there.
    expect(proxied({ "x-tv-version": ["1"], "CONTENT-SECURITY-POLICY": [SANDBOX], "referrer-policy": ["same-origin"], ETag: ["\"a\""] })).toEqual({
      "x-tv-version": ["1"], ETag: ["\"a\""], "Referrer-Policy": ["strict-origin-when-cross-origin"],
    });
    expect(proxied({ "X-TV-Version": ["1"] })).toEqual({ "X-TV-Version": ["1"], "Referrer-Policy": ["strict-origin-when-cross-origin"] });
    // Share IDs, other hosts, the bare mount and nested pages are the proxy's too.
    for (const url of [`${OTHER_ORIGIN}/artifact/share-id/page.html`, `${ORIGIN}/artifact/01JABC`, `${ORIGIN}/artifact/01JABC/a/b/c.png?x=1`]) {
      expect({ url, headers: proxied({ "X-TV-Version": ["1"], "Content-Security-Policy": [SANDBOX] }, url) })
        .toEqual({ url, headers: { "X-TV-Version": ["1"], "Referrer-Policy": ["strict-origin-when-cross-origin"] } });
    }
  });

  // spec: proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-header
  it("leaves responses that are not the artifact proxy's unchanged", () => {
    const sandboxed = { "X-TV-Version": ["1"], "Content-Security-Policy": [SANDBOX], "Referrer-Policy": ["no-referrer"] };
    for (const url of [`${ORIGIN}/artifactx/01JABC/`, `${ORIGIN}/theme/page.html`, `${ORIGIN}/views/markdown/`, `${ORIGIN}/`,
      `${ORIGIN}/site/artifact/01JABC/`, `${ORIGIN}/artifact/`, "not a url"]) {
      expect({ url, rewritten: rewriteArtifactProxyHeaders(url, sandboxed) }).toEqual({ url, rewritten: undefined });
    }
    // Without Television's version header, a site's own sandbox is its own.
    expect(proxied({ "Content-Security-Policy": [SANDBOX], "Referrer-Policy": ["no-referrer"] })).toBeUndefined();
  });
});

describe("the partition record", () => {
  let userData: string;

  beforeEach(() => {
    userData = mkdtempSync(path.join(os.tmpdir(), "television-partition-record-"));
  });

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  const recordFile = () => path.join(userData, "artifact-partitions.json");

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-record
  it("records each server's artifact partitions atomically and reads a malformed record as empty", () => {
    const operations: string[] = [];
    const recording: PartitionRecordFS = {
      readFileSync: (file, encoding) => readFileSync(file, encoding),
      writeFileSync: (file, content) => {
        operations.push(`write:${path.basename(file)}:${JSON.parse(String(content)).servers[ORIGIN]["artifact-a"]}`);
        writeFileSync(file, content);
      },
      renameSync: (from, to) => {
        operations.push(`rename:${path.basename(from)}:${path.basename(to)}`);
        writeFileSync(to, readFileSync(from));
        rmSync(from);
      },
    };
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-a", "A", recording);
    expect(operations).toEqual(["write:artifact-partitions.json.tmp:A", "rename:artifact-partitions.json.tmp:artifact-partitions.json"]);

    rmSync(recordFile());
    expect(readPartitionRecord(userData)).toEqual({ version: 1, servers: {} });
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-a", "A");
    expect(JSON.parse(readFileSync(recordFile(), "utf8"))).toEqual({ version: 1, servers: { [ORIGIN]: { "artifact-a": "A" } } });
    expect(existsSync(`${recordFile()}.tmp`)).toBe(false);

    recordArtifactPartition(userData, ORIGIN, "persist:artifact-b", "B");
    recordArtifactPartition(userData, OTHER_ORIGIN, "persist:artifact-c", "C");
    expect(readPartitionRecord(userData)).toEqual({
      version: 1,
      servers: { [ORIGIN]: { "artifact-a": "A", "artifact-b": "B" }, [OTHER_ORIGIN]: { "artifact-c": "C" } },
    });

    const bytes = readFileSync(recordFile(), "utf8");
    const modified = statSync(recordFile()).mtimeMs;
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-a", "A");
    expect(readFileSync(recordFile(), "utf8")).toBe(bytes);
    expect(statSync(recordFile()).mtimeMs).toBe(modified);

    const malformed = [
      "not json",
      JSON.stringify({ version: 2, servers: {} }),
      JSON.stringify({ version: 1, servers: [] }),
      JSON.stringify({ version: 1, servers: { [ORIGIN]: ["artifact-a"] } }),
      JSON.stringify({ version: 1, servers: { [ORIGIN]: { "artifact-a": 7 } } }),
      JSON.stringify(null),
    ];
    for (const content of malformed) {
      writeFileSync(recordFile(), content);
      expect({ content, record: readPartitionRecord(userData) }).toEqual({ content, record: { version: 1, servers: {} } });
      recordArtifactPartition(userData, ORIGIN, "persist:artifact-d", "D");
      expect({ content, record: readPartitionRecord(userData) })
        .toEqual({ content, record: { version: 1, servers: { [ORIGIN]: { "artifact-d": "D" } } } });
    }

    // A record that cannot be read at all is read as empty.
    rmSync(recordFile());
    mkdirSync(recordFile());
    expect(readPartitionRecord(userData)).toEqual({ version: 1, servers: {} });
  });
});

describe("the reaper", () => {
  let userData: string;
  const opened = new Set<string>();
  const fetchMock = vi.fn<typeof fetch>();

  const partitionDir = (name: string) => path.join(userData, "Partitions", name);
  const makePartition = (name: string) => {
    mkdirSync(partitionDir(name), { recursive: true });
    writeFileSync(path.join(partitionDir(name), "Preferences"), "{}");
  };
  const listed = (...ids: string[]) =>
    new Response(JSON.stringify({ artifacts: ids.map((id) => ({ id, kind: "path", title: id })) }), { status: 200 });
  const reaper = (options: { removeDirectory?: (dir: string) => void } = {}) => new ArtifactPartitionReaper({
    userData,
    isOpened: (name) => opened.has(name),
    fetch: fetchMock,
    ...options,
  });

  beforeEach(() => {
    userData = mkdtempSync(path.join(os.tmpdir(), "television-partition-reaper-"));
    opened.clear();
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(userData, { recursive: true, force: true });
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-schedule
  it("reaps when the server's page loads and hourly while it stays loaded, one reaping at a time", async () => {
    fetchMock.mockImplementation(async () => listed());
    const subject = reaper();
    await subject.pageLoaded({ serverURL: ORIGIN, token: "secret" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/artifacts`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");

    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Each load measures the hour afresh.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await subject.pageLoaded({ serverURL: ORIGIN, token: "secret" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    subject.stop();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // A tokenless connection sends no Authorization header.
    await subject.pageLoaded({ serverURL: `${ORIGIN}/`, token: "" });
    const tokenless = fetchMock.mock.calls.at(-1)!;
    expect(tokenless[0]).toBe(`${ORIGIN}/artifacts`);
    expect(new Headers(tokenless[1]?.headers).has("authorization")).toBe(false);
    subject.stop();

    // A load or an hour during a reaping's request starts no second one.
    fetchMock.mockReset();
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const first = subject.pageLoaded({ serverURL: ORIGIN, token: "secret" });
    void subject.pageLoaded({ serverURL: ORIGIN, token: "secret" });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer(listed());
    await first;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    subject.stop();
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-schedule
  it("stopping aborts a reaping in flight, which then changes nothing", async () => {
    makePartition("artifact-gone");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-gone", "GONE");
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, init) => new Promise<Response>((resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      void resolve;
    }));
    const subject = reaper();
    const reaping = subject.pageLoaded({ serverURL: ORIGIN, token: "" });
    subject.stop();
    expect(signal?.aborted).toBe(true);
    await reaping;
    expect(existsSync(partitionDir("artifact-gone"))).toBe(true);
    expect(readPartitionRecord(userData).servers[ORIGIN]).toEqual({ "artifact-gone": "GONE" });
    // A load straight after the stop reaps at once.
    fetchMock.mockImplementation(async () => listed());
    await subject.pageLoaded({ serverURL: ORIGIN, token: "" });
    expect(existsSync(partitionDir("artifact-gone"))).toBe(false);
    subject.stop();
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-deletes
  it("deletes only the partitions of artifacts the server no longer lists, and only those not opened since the start", async () => {
    for (const name of ["artifact-kept", "artifact-gone", "artifact-open", "artifact-other", "url-artifacts", "webview-fallback"]) {
      makePartition(name);
    }
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-kept", "KEPT");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-gone", "GONE");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-missing-dir", "MISSING");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-open", "OPEN");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-late-open", "LATE");
    makePartition("artifact-late-open");
    recordArtifactPartition(userData, OTHER_ORIGIN, "persist:artifact-other", "GONE");
    opened.add("persist:artifact-open");

    // While the request is in flight, a new partition is recorded and an
    // earlier one is opened; the answer lists neither.
    fetchMock.mockImplementation(async () => {
      recordArtifactPartition(userData, ORIGIN, "persist:artifact-new", "NEW");
      makePartition("artifact-new");
      opened.add("persist:artifact-late-open");
      return listed("KEPT");
    });
    await reaper().pageLoaded({ serverURL: ORIGIN, token: "t" });

    expect(existsSync(partitionDir("artifact-gone"))).toBe(false);
    for (const name of ["artifact-kept", "artifact-open", "artifact-late-open", "artifact-new", "artifact-other", "url-artifacts", "webview-fallback"]) {
      expect({ name, exists: existsSync(partitionDir(name)) }).toEqual({ name, exists: true });
    }
    expect(readPartitionRecord(userData)).toEqual({
      version: 1,
      servers: {
        [ORIGIN]: { "artifact-kept": "KEPT", "artifact-open": "OPEN", "artifact-late-open": "LATE", "artifact-new": "NEW" },
        [OTHER_ORIGIN]: { "artifact-other": "GONE" },
      },
    });
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-deletes
  it("keeps the entry of a partition whose directory cannot be removed", async () => {
    makePartition("artifact-stuck");
    makePartition("artifact-gone");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-stuck", "STUCK");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-gone", "GONE");
    fetchMock.mockImplementation(async () => listed());
    await reaper({
      removeDirectory: (dir) => {
        if (dir.endsWith("artifact-stuck")) throw new Error("EBUSY");
        rmSync(dir, { recursive: true, force: true });
      },
    }).pageLoaded({ serverURL: ORIGIN, token: "" });
    expect(readPartitionRecord(userData).servers[ORIGIN]).toEqual({ "artifact-stuck": "STUCK" });
    expect(existsSync(partitionDir("artifact-gone"))).toBe(false);
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-deletes
  it("changes nothing unless the server lists its artifacts", async () => {
    const answers: Array<[string, () => Promise<Response>]> = [
      ["401", async () => new Response(JSON.stringify({ artifacts: [] }), { status: 401 })],
      ["304-like 204", async () => new Response(null, { status: 204 })],
      ["not JSON", async () => new Response("<html>", { status: 200 })],
      ["no artifacts", async () => new Response(JSON.stringify({ items: [] }), { status: 200 })],
      ["artifacts not an array", async () => new Response(JSON.stringify({ artifacts: { id: "x" } }), { status: 200 })],
      ["an element without a string id", async () => new Response(JSON.stringify({ artifacts: [{ id: "KEPT" }, { id: 7 }] }), { status: 200 })],
      ["a null element", async () => new Response(JSON.stringify({ artifacts: [null] }), { status: 200 })],
      ["a failed request", async () => { throw new TypeError("fetch failed"); }],
    ];
    makePartition("artifact-gone");
    recordArtifactPartition(userData, ORIGIN, "persist:artifact-gone", "GONE");
    const before = readFileSync(path.join(userData, "artifact-partitions.json"), "utf8");
    for (const [label, answer] of answers) {
      fetchMock.mockImplementation(answer);
      await reaper().pageLoaded({ serverURL: ORIGIN, token: "" });
      expect({ label, exists: existsSync(partitionDir("artifact-gone")) }).toEqual({ label, exists: true });
      expect({ label, record: readFileSync(path.join(userData, "artifact-partitions.json"), "utf8") }).toEqual({ label, record: before });
    }
  });
});
