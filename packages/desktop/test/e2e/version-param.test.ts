import { expect, test } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startConnectTestServer, type ConnectTestServer } from "./connect-server.ts";
import { expectPermanentApplicationShell, getBrowserWindowURL, launchDesktop } from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_PACKAGE_JSON = path.resolve(HERE, "..", "..", "package.json");

let testServer: ConnectTestServer;


test.describe(() => {
test.beforeEach(async () => {
  testServer = await startConnectTestServer();
});

test.afterEach(async () => {
  await testServer.dispose();
});

// Seam test (specs/arch/updates/desktop-upgrade-gate.md ^t-shell-version-param):
// shell version → renderer input, crossed in the real Electron app with
// TV_TEST_DESKTOP_APP_VERSION unset — the real `app.getVersion()` value flows
// through `buildRemoteURL()` into the `?desktopAppVersion=` parameter the
// renderer reads. This is the unhooked coverage the ^hook-shell-version mock
// forfeits.
test.describe("desktop version propagation", () => {

test("the real app.getVersion() reaches the renderer as ?desktopAppVersion= (hook unset)", async () => {
  const packageVersion = (JSON.parse(readFileSync(DESKTOP_PACKAGE_JSON, "utf8")) as { version: string }).version;
  const { app, page, userDataDir } = await launchDesktop({
    connectTo: { serverURL: testServer.serverURL, token: testServer.token },
    env: { TV_TEST_DESKTOP_APP_VERSION: undefined },
  });
  try {
    await expectPermanentApplicationShell(page);
    const url = new URL(await getBrowserWindowURL(app));
    expect(url.searchParams.get("desktopAppVersion")).toBe(packageVersion);
    expect(url.searchParams.get("mode")).toBe("electron");
  } finally {
    await app.close();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
});

// Harness smoke for the env-passing + connect-to-real-server capability, and
// the shell hook end to end: TV_TEST_DESKTOP_APP_VERSION under the harness's
// TV_TEST_MODE=true replaces the reported version
// (^hook-shell-version — a DECLARED MOCK of app.getVersion(); the real path is
// covered by the unhooked test above).
test("launchDesktop({connectTo, env}) reaches the served interface with the hooked version", async () => {
  const { app, page, userDataDir } = await launchDesktop({
    connectTo: { serverURL: testServer.serverURL, token: testServer.token },
    env: { TV_TEST_DESKTOP_APP_VERSION: "9.9.9" },
  });
  try {
    await expectPermanentApplicationShell(page);
    const url = new URL(await getBrowserWindowURL(app));
    expect(url.origin).toBe(testServer.serverURL);
    expect(url.searchParams.get("desktopAppVersion")).toBe("9.9.9");
  } finally {
    await app.close();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
});
})
});
