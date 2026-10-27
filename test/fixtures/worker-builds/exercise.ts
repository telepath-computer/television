import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { disposeAllProductServers, launchProductServer } from "../../helpers/product-server.ts";
import { buildVersionedWebBundle } from "../../helpers/versioned-web-bundle.ts";

export async function exerciseWorkerBuilds(caseNumber: number): Promise<void> {
  const temporaryRoot = os.tmpdir();
  const recordPath = process.env.TV_WORKER_BUILD_RECORD;
  assert.ok(recordPath, "the parent supplies a private observation file");

  if (caseNumber === 1) {
    await assert.rejects(launchProductServer({
      onboardingBundle: path.join(temporaryRoot, "absent-bundle"),
      env: { VITEST: "" },
    }), /ENOENT/);
  }

  const server = await launchProductServer({ env: { VITEST: "" } });
  let webBundle: string;
  try {
    const response = await fetch(server.serverURL);
    assert.equal(response.status, 200);
    const document = await response.text();
    const script = document.match(/src="([^"]+\.js)"/);
    assert.ok(script, "the source CLI serves the built application");
    const asset = await fetch(new URL(script[1]!, server.serverURL));
    assert.equal(asset.status, 200);
    assert.ok((await asset.text()).length > 0);

    webBundle = await buildVersionedWebBundle("worker-lifetime-fixture");
    const builtDocument = readFileSync(path.join(webBundle, "index.html"), "utf8");
    const builtScript = builtDocument.match(/src="([^"]+\.js)"/);
    assert.ok(builtScript, "the real versioned builder emits an application entry");
    assert.ok(readFileSync(path.join(webBundle, builtScript[1]!)).length > 0);
  } finally {
    await server.dispose();
    await disposeAllProductServers();
  }

  const sourceDirectories = readdirSync(temporaryRoot)
    .filter((entry) => entry.startsWith("television-source-cli-e2e-"))
    .map((entry) => path.join(temporaryRoot, entry));
  assert.equal(sourceDirectories.length, 1, "one source build is shared across cases");
  assert.ok(existsSync(path.join(sourceDirectories[0]!, "tv.cjs")));
  assert.ok(existsSync(path.join(webBundle!, "index.html")), "case cleanup preserves the shared bundle");
  assert.equal(existsSync(server.home), false, "case cleanup removes its private home");
  appendFileSync(recordPath, `${JSON.stringify({ caseNumber, pid: process.pid, source: sourceDirectories[0], webBundle })}\n`);
}
