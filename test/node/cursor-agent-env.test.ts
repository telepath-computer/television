import { describe, expect, test } from "vitest";
import {
  CURSOR_AGENT_ENV_VARS,
  isCursorAgentRuntime,
  stripCursorAgentEnv,
} from "../../scripts/test/cursor-agent-env.mjs";
import { getElectronE2EInvocation, prepareElectronE2EEnv } from "../../scripts/electron-e2e-env.mjs";

describe("isCursorAgentRuntime", () => {
  test("is true when CURSOR_AGENT=1", () => {
    expect(isCursorAgentRuntime({ CURSOR_AGENT: "1" })).toBe(true);
  });

  test("is false in normal terminal env", () => {
    expect(isCursorAgentRuntime({ PATH: "/bin", HOME: "/Users/me" })).toBe(false);
    expect(isCursorAgentRuntime({ CURSOR_AGENT: "0" })).toBe(false);
  });
});

describe("stripCursorAgentEnv", () => {
  test("is a no-op outside Cursor agent runtime", () => {
    const env = stripCursorAgentEnv({
      PATH: "/bin",
      ELECTRON_RUN_AS_NODE: "1",
      PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/ms-playwright");
  });

  test("removes Cursor agent overrides when CURSOR_AGENT=1", () => {
    const env = stripCursorAgentEnv({
      CURSOR_AGENT: "1",
      PATH: "/bin",
      ELECTRON_RUN_AS_NODE: "1",
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/cursor-sandbox-cache/playwright",
      HOME: "/Users/me",
    });

    expect(env.CURSOR_AGENT).toBe("1");
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/Users/me");
    for (const key of CURSOR_AGENT_ENV_VARS) {
      expect(env[key]).toBeUndefined();
    }
  });
});

describe("getElectronE2EInvocation", () => {
  test("resolves repository-local Playwright through npx with or without xvfb", () => {
    expect(getElectronE2EInvocation({ useXvfb: false }, ["smoke.test.ts", "--retries=2"])).toEqual({
      command: "npx",
      args: ["playwright", "test", "--config=packages/desktop/playwright.config.ts", "smoke.test.ts", "--retries=2"],
    });
    expect(getElectronE2EInvocation({ useXvfb: true }, ["--reporter=json"])).toEqual({
      command: "xvfb-run",
      args: ["-a", "npx", "playwright", "test", "--config=packages/desktop/playwright.config.ts", "--reporter=json"],
    });
  });
});

describe("prepareElectronE2EEnv", () => {
  test("sets ELECTRON_DISABLE_SANDBOX when the plan requests it", () => {
    const env = prepareElectronE2EEnv({ PATH: "/bin" }, { disableSandbox: true });

    expect(env.ELECTRON_DISABLE_SANDBOX).toBe("1");
  });

  test("preserves env on remote runners without CURSOR_AGENT", () => {
    const env = prepareElectronE2EEnv({
      PATH: "/bin",
      PLAYWRIGHT_BROWSERS_PATH: "/home/playwright/.cache/ms-playwright",
      ELECTRON_RUN_AS_NODE: "1",
    });

    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/home/playwright/.cache/ms-playwright");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  test("strips overrides when CURSOR_AGENT=1", () => {
    const env = prepareElectronE2EEnv({
      CURSOR_AGENT: "1",
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/cursor-sandbox-cache/playwright",
      ELECTRON_RUN_AS_NODE: "1",
    });

    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
