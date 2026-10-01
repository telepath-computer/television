import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPersistedACPEnvironment,
  isACPCommandResolvable,
  resolveACPAgentProfile,
} from "./config.ts";
import { telemetryEnvironmentSuppressionReason } from "./telemetry/identity.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeExecutable(name: string): Promise<string> {
  const dir = await makeTempDir("television-config-test-");
  const file = path.join(dir, name);
  await writeFile(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return dir;
}

describe("ACP agent profile resolution", () => {
  it("returns null when TELEVISION_ACP_AGENT is unset", () => {
    expect(resolveACPAgentProfile({})).toBeNull();
  });

  it("accepts OpenClaw and Hermes profiles", () => {
    expect(resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" }).agent).toBe("openclaw");
    expect(resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "hermes" }).agent).toBe("hermes");
  });
});

describe("buildPersistedACPEnvironment", () => {
  it("captures PATH and the install-time developer home when TELEVISION_ACP_AGENT is unset", async () => {
    const developerHome = await makeTempDir("television-developer-home-");

    expect(buildPersistedACPEnvironment({
      PATH: "/custom/bin:/usr/bin",
      OPENCLAW_API_KEY: "openclaw-key",
      HERMES_API_KEY: "hermes-key",
      HOME: "/Users/alice",
    }, { developerHome })).toEqual({
      PATH: "/custom/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
    });
  });

  it("captures telemetry-control env vars and preserves DO_NOT_TRACK suppression", async () => {
    const developerHome = await makeTempDir("television-developer-home-");
    const snapshot = buildPersistedACPEnvironment({
      PATH: "/custom/bin:/usr/bin",
      DO_NOT_TRACK: "1",
      CI: "true",
      TV_TELEMETRY_TEST: "1",
      TELEVISION_TELEMETRY_BUILD: "production",
      HOME: "/Users/alice",
    }, { developerHome });

    expect(snapshot).toEqual({
      PATH: "/custom/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
      DO_NOT_TRACK: "1",
      CI: "true",
      TV_TELEMETRY_TEST: "1",
    });
    expect(telemetryEnvironmentSuppressionReason(snapshot)).toBe("do-not-track");
  });

  it("captures the update-channel env overrides and omits empty values (^t-persist-channel-env)", async () => {
    const developerHome = await makeTempDir("television-developer-home-");

    expect(buildPersistedACPEnvironment({
      PATH: "/custom/bin:/usr/bin",
      TV_UPDATE_CHANNEL_URL: "http://127.0.0.1:8399/update-channel.json",
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: "2000",
    }, { developerHome })).toEqual({
      PATH: "/custom/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
      TV_UPDATE_CHANNEL_URL: "http://127.0.0.1:8399/update-channel.json",
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: "2000",
    });

    expect(buildPersistedACPEnvironment({
      PATH: "/custom/bin:/usr/bin",
      TV_UPDATE_CHANNEL_URL: "",
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: "",
    }, { developerHome })).toEqual({
      PATH: "/custom/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
    });
  });

  it("omits empty telemetry-control env vars", async () => {
    const developerHome = await makeTempDir("television-developer-home-");

    expect(buildPersistedACPEnvironment({
      PATH: "/custom/bin:/usr/bin",
      DO_NOT_TRACK: "",
      CI: "",
      TV_TELEMETRY_TEST: "",
      TELEVISION_TELEMETRY_BUILD: "",
    }, { developerHome })).toEqual({
      PATH: "/custom/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
    });
  });

  it("captures PATH, TELEVISION_ACP_AGENT, and only OPENCLAW_* variables for OpenClaw", async () => {
    const env = {
      PATH: "/custom/bin:/usr/bin",
      HOME: "/Users/alice",
      TELEVISION_ACP_AGENT: "openclaw",
      OPENCLAW_API_KEY: "openclaw-key",
      OPENCLAW_HOME: "/opt/openclaw",
      HERMES_API_KEY: "hermes-key",
      OTHER: "ignored",
      DO_NOT_TRACK: "1",
      CI: "true",
      TV_TELEMETRY_TEST: "1",
      TELEVISION_TELEMETRY_BUILD: "production",
    };

    const developerHome = await makeTempDir("television-developer-home-");

    expect(buildPersistedACPEnvironment(env, { developerHome })).toEqual({
      PATH: "/custom/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
      TELEVISION_ACP_AGENT: "openclaw",
      OPENCLAW_API_KEY: "openclaw-key",
      OPENCLAW_HOME: "/opt/openclaw",
      DO_NOT_TRACK: "1",
      CI: "true",
      TV_TELEMETRY_TEST: "1",
    });
  });

  it("captures PATH, TELEVISION_ACP_AGENT, and only HERMES_* variables for Hermes", async () => {
    const env = {
      PATH: "/custom/hermes/bin:/usr/bin",
      HOME: "/Users/alice",
      TELEVISION_ACP_AGENT: "hermes",
      OPENCLAW_API_KEY: "openclaw-key",
      HERMES_API_KEY: "hermes-key",
      HERMES_HOME: "/opt/hermes",
      OTHER: "ignored",
    };

    const developerHome = await makeTempDir("television-developer-home-");

    expect(buildPersistedACPEnvironment(env, { developerHome })).toEqual({
      PATH: "/custom/hermes/bin:/usr/bin",
      TELEVISION_DEVELOPER_HOME: developerHome,
      TELEVISION_ACP_AGENT: "hermes",
      HERMES_API_KEY: "hermes-key",
      HERMES_HOME: "/opt/hermes",
    });
  });

  it("canonicalizes TELEVISION_ACP_AGENT in the snapshot", async () => {
    const developerHome = await makeTempDir("television-developer-home-");
    const snapshot = buildPersistedACPEnvironment({ PATH: "/x", TELEVISION_ACP_AGENT: " OpenClaw " }, { developerHome });

    expect(snapshot.TELEVISION_ACP_AGENT).toBe("openclaw");
    expect(snapshot.TELEVISION_DEVELOPER_HOME).toBe(developerHome);
  });

  it("preserves PATH exactly and does not capture HOME", async () => {
    const developerHome = await makeTempDir("television-developer-home-");
    const pathValue = "/path with spaces/bin::/usr/local/bin:/usr/bin";
    const env = {
      PATH: pathValue,
      HOME: "/Users/alice",
      TELEVISION_ACP_AGENT: "openclaw",
    };

    const snapshot = buildPersistedACPEnvironment(env, { developerHome });

    expect(snapshot.PATH).toBe(pathValue);
    expect(snapshot.TELEVISION_DEVELOPER_HOME).toBe(developerHome);
    expect(snapshot).not.toHaveProperty("HOME");
  });

  it("throws when PATH is absent", () => {
    expect(() => buildPersistedACPEnvironment({ TELEVISION_ACP_AGENT: "openclaw" })).toThrow(
      "PATH is required to build the persisted ACP environment.",
    );
  });
});

describe("isACPCommandResolvable", () => {
  it("succeeds or fails based on the supplied env snapshot instead of ambient PATH", async () => {
    const dir = await makeExecutable("openclaw");
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), "television-empty-path-test-"));
    tempDirs.push(emptyDir);

    expect(isACPCommandResolvable("openclaw", { PATH: dir })).toBe(true);
    expect(isACPCommandResolvable("openclaw", { PATH: emptyDir })).toBe(false);
    expect(isACPCommandResolvable("openclaw", {})).toBe(false);
  });

  it("does not treat executable directories as resolved commands", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "television-directory-path-test-"));
    tempDirs.push(dir);
    await mkdir(path.join(dir, "openclaw"), { mode: 0o755 });

    expect(isACPCommandResolvable("openclaw", { PATH: dir })).toBe(false);
  });

  it("resolves executables in non-first PATH entries", async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), "television-empty-path-test-"));
    tempDirs.push(emptyDir);
    const executableDir = await makeExecutable("hermes");

    expect(isACPCommandResolvable("hermes", { PATH: [emptyDir, executableDir].join(path.delimiter) })).toBe(true);
  });

  it("supports explicit executable paths", async () => {
    const dir = await makeExecutable("openclaw");
    const commandPath = path.join(dir, "openclaw");

    expect(isACPCommandResolvable(commandPath, { PATH: "" })).toBe(true);
    expect(isACPCommandResolvable(path.join(dir, "missing-openclaw"), { PATH: dir })).toBe(false);
  });
});
