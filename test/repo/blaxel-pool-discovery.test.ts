import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);
const discoveryUrl = pathToFileURL(path.resolve("scripts/test/blaxel-pool.mjs")).href;

function sandbox(name: string, labels = {}, status = "DEPLOYED") {
  return {
    metadata: { name, labels: { project: "television", purpose: "testshards", pool: "fixture", arch: "x64", ...labels } },
    spec: {},
    status,
  };
}

// Contract: ^blaxel-pool-pagination. Only the service is mocked; the SDK runs.
async function withApi(run: (discover: (deployedOnly: boolean) => Promise<string[]>, requests: string[]) => Promise<void>, failLaterPage = false) {
  const home = mkdtempSync(path.join(os.tmpdir(), "tv-blaxel-discovery-"));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/sandboxes") {
      response.end(JSON.stringify({ data: [
        sandbox("other-project", { project: "other" }),
        sandbox("other-purpose", { purpose: "other" }),
        sandbox("other-pool", { pool: "other" }),
        sandbox("other-arch", { arch: "arm64" }),
      ], meta: { hasMore: true, nextCursor: "second" } }));
    } else if (request.url === "/sandboxes?cursor=second") {
      response.statusCode = failLaterPage ? 403 : 200;
      response.end(JSON.stringify(failLaterPage ? { message: "page unavailable" } : {
        data: [sandbox("b-worker"), sandbox("c-failed", {}, "FAILED")],
        meta: { hasMore: true, nextCursor: "third" },
      }));
    } else if (request.url === "/sandboxes?cursor=third") {
      response.end(JSON.stringify({ data: [sandbox("a-worker")], meta: { hasMore: false } }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "unexpected request" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const discover = async (deployedOnly: boolean) => {
      const source = `import { listBlaxelPoolSandboxes } from ${JSON.stringify(discoveryUrl)};
        const workers = await listBlaxelPoolSandboxes({ pool: "fixture", arch: "x64", deployedOnly: ${deployedOnly} });
        console.log(JSON.stringify(workers.map(worker => worker.metadata.name)));`;
      const { stdout } = await execute(process.execPath, ["--input-type=module", "-e", source], {
        cwd: home,
        env: {
          HOME: home,
          PATH: process.env.PATH,
          TV_TEST_SURFACE_OWNER: process.env.TV_TEST_SURFACE_OWNER,
          BL_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          BL_API_KEY: "fixture-key",
          BL_WORKSPACE: "fixture-workspace",
          BL_DISABLE_H2: "true",
          DO_NOT_TRACK: "1",
        },
        timeout: 10_000,
      });
      return JSON.parse(stdout) as string[];
    };
    await run(discover, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(home, { recursive: true, force: true });
  }
}

test.each([false, true])("discovers every pool page with deployedOnly=%s", async (deployedOnly) => {
  await withApi(async (discover, requests) => {
    expect(await discover(deployedOnly)).toEqual(deployedOnly ? ["a-worker", "b-worker"] : ["a-worker", "b-worker", "c-failed"]);
    expect(requests).toEqual(["/sandboxes", "/sandboxes?cursor=second", "/sandboxes?cursor=third"]);
  });
});

test("rejects discovery when a later page fails", async () => {
  await withApi(async (discover, requests) => {
    await expect(discover(true)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("page unavailable") });
    expect(requests).toEqual(["/sandboxes", "/sandboxes?cursor=second"]);
  }, true);
});
