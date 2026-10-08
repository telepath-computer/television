import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { adminRoutes } from "@telepath-computer/television-shared/resources";
import { ResourceTestContext } from "../resources/harness.ts";

const SERVER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = path.resolve(SERVER_ROOT, "../..");
const SDK_DIR = path.join(SERVER_ROOT, "dist", "sdk");
const SDK_OUTPUT = "packages/server/dist/sdk/v1/resources.js";
const METAFILE = path.join(SERVER_ROOT, "dist", "sdk-metafile.json");

/** Every file under `directory`, relative to it. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

interface Metafile {
  outputs: Record<string, { entryPoint?: string; exports: string[]; inputs: Record<string, unknown> }>;
}

// spec: proofs/arch/resources/sdk.md#^sdk-t-build
test.describe("the SDK build", () => {
  test("bundles one ES module from first-party resource source alone, with its third-party notices beside it", () => {
    const metafile = JSON.parse(readFileSync(METAFILE, "utf8")) as Metafile;
    expect(Object.keys(metafile.outputs)).toEqual([SDK_OUTPUT]);
    expect(filesUnder(SDK_DIR).sort()).toEqual(["v1/THIRD-PARTY-NOTICES.txt", "v1/resources.js"]);
    const output = metafile.outputs[SDK_OUTPUT]!;
    expect(output.entryPoint).toBe("packages/shared/src/resources/sdk.ts");
    // An ES module's exports: the layer's functions and the JSON store's, and no error class.
    expect([...output.exports].sort()).toEqual([
      "child",
      "deleteValue",
      "get",
      "getAccess",
      "getConnectionStatus",
      "getResourceInfo",
      "getStore",
      "increment",
      "listResources",
      "onAccessChanged",
      "onChildAdded",
      "onChildChanged",
      "onChildRemoved",
      "onConnectionStatusChanged",
      "onResourcesChanged",
      "onValue",
      "push",
      "ref",
      "remove",
      "runTransaction",
      "serverTimestamp",
      "set",
      "update",
    ]);
    const inputs = Object.keys(output.inputs);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toMatch(/^packages\/shared\/src\//);
      expect(input).not.toContain("node_modules");
      expect(input).not.toBe("packages/shared/src/client.ts");
    }
    expect(readFileSync(path.join(REPO_ROOT, SDK_OUTPUT), "utf8")).toMatch(/^export \{/m);
  });
});

// spec: proofs/arch/resources/sdk.md#^sdk-t-serving
test.describe("serving the SDK", () => {
  const context = new ResourceTestContext();
  test.afterEach(() => context.cleanup());

  test("answers GET and HEAD without a token, with the built bytes and revalidating headers", async () => {
    const server = await context.start({ auth: true, sdkDir: SDK_DIR });
    const built = readFileSync(path.join(SDK_DIR, "v1", "resources.js"));
    const url = `${server.baseURL}/sdk/v1/resources.js`;

    const first = await fetch(url, { headers: { Referer: `${server.baseURL}/artifact/one/` } });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(Buffer.from(await first.arrayBuffer()).equals(built)).toBe(true);

    const other = await fetch(url, { headers: { Referer: `${server.baseURL}/artifact/two/sub/page.html` } });
    expect(Buffer.from(await other.arrayBuffer()).equals(built)).toBe(true);

    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("cache-control")).toBe("no-cache");

    // As a browser revalidates. Without a Cache-Control header of its own, fetch
    // adds `no-cache` to a conditional request, which asks for the body regardless.
    const revalidated = await fetch(url, { headers: { "If-None-Match": etag!, "Cache-Control": "max-age=0" } });
    expect(revalidated.status).toBe(304);
  });

  test("answers GET and HEAD for the SDK's notices without a token, with the built bytes and revalidating headers", async () => {
    const server = await context.start({ auth: true, sdkDir: SDK_DIR });
    const built = readFileSync(path.join(SDK_DIR, "v1", "THIRD-PARTY-NOTICES.txt"));
    const url = `${server.baseURL}/sdk/v1/THIRD-PARTY-NOTICES.txt`;

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const etag = response.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(Buffer.from(await response.arrayBuffer()).equals(built)).toBe(true);

    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("cache-control")).toBe("no-cache");
  });

  test("answers 404 on a server constructed without sdkDir, whose resource routes keep working", async () => {
    const server = await context.start({ auth: true });
    expect((await fetch(`${server.baseURL}/sdk/v1/resources.js`)).status).toBe(404);
    expect((await fetch(`${server.baseURL}/sdk/v1/THIRD-PARTY-NOTICES.txt`)).status).toBe(404);
    const artifactID = server.createArtifact();
    expect((await server.jsonSet({ artifactID }, "", { a: 1 })).status).toBe(200);
    expect((await server.request("GET", adminRoutes.list)).body.resources).toHaveLength(1);
  });
});
