import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop } from "./helpers.ts";

// proofs/arch/desktop/index.md#^desktop-t-user-data-order
test("application name determines the default user-data directory", async () => {
  const hostRoot = mkdtempSync(path.join(os.tmpdir(), "television-user-data-identity-"));
  const xdgConfig = path.join(hostRoot, "xdg-config");
  const appData = path.join(hostRoot, "app-data");
  const localAppData = path.join(hostRoot, "local-app-data");
  mkdirSync(xdgConfig, { recursive: true });
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });

  let launched: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    launched = await launchDesktop({
      fixture: "/packages/desktop/test/e2e/fixtures/smoke.html",
      env: {
        HOME: hostRoot,
        USERPROFILE: hostRoot,
        XDG_CONFIG_HOME: xdgConfig,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
      },
    });
    const identity = await launched.app.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      argv: process.argv,
    }));

    expect(identity.argv.some((arg) => arg.startsWith("--user-data-dir"))).toBe(false);
    expect(path.basename(identity.userData)).toBe("Television");
    if (process.platform !== "darwin") {
      // macOS Electron resolves home natively and ignores the env redirect,
      // so there the run uses the real default location and isolation cannot hold.
      expect(path.relative(hostRoot, identity.userData)).not.toMatch(/^\.\.(?:[/\\]|$)/);
    }
  } finally {
    await launched?.app.close().catch(() => undefined);
    rmSync(hostRoot, { recursive: true, force: true });
  }
});
