import { describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { getOnboardingArtifactSentinelPath, getOnboardingStatePath } from "../src/artifact-paths.ts";
import {
  getOnboardingStateTempPath,
  readLegacyOnboardingFile,
  readOnboardingStateFile,
  writeOnboardingStateFile,
  type OnboardingStateV2,
  type OnboardingStateV3,
} from "../src/onboarding-state.ts";

function tempStorage(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-onboarding-state-"));
}

function withStorage(run: (storagePath: string) => void): void {
  const storagePath = tempStorage();
  try {
    run(storagePath);
  } finally {
    const stateDir = path.join(storagePath, "state");
    if (existsSync(stateDir)) {
      chmodSync(stateDir, 0o755);
    }
    rmSync(storagePath, { recursive: true, force: true });
  }
}

function seedStateDir(storagePath: string): void {
  mkdirSync(path.join(storagePath, "state"), { recursive: true });
}

const state: OnboardingStateV3 = {
  version: 3,
  channels: { "tv-guide": { installedAt: "2026-01-01T00:00:00.000Z" } },
};

const legacyV2State: OnboardingStateV2 = {
  version: 2,
  screens: state.channels,
};

describe("Onboarding state file", () => {
  describe("State-file writer", () => {
    // proofs/arch/onboarding/installer.md#^t-state-writer
    it("writes complete parseable v3 JSON at state/onboarding.json", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeOnboardingStateFile(storagePath, state);
        const onDisk = JSON.parse(readFileSync(getOnboardingStatePath(storagePath), "utf8"));
        expect(onDisk).toEqual(state);
      });
    });

    it("leaves the legacy file byte-identical across rewrites", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        // Deliberately odd formatting: byte-identity, not JSON equality.
        const legacyBytes = `{ "version": 1,\n  "artifactID": "television-onboarding",\n  "installedAt": "2025-05-05T05:05:05.000Z" }\n`;
        writeFileSync(getOnboardingArtifactSentinelPath(storagePath), legacyBytes);
        writeOnboardingStateFile(storagePath, state);
        writeOnboardingStateFile(storagePath, {
          version: 3,
          channels: { ...state.channels, extra: { installedAt: "2026-02-02T00:00:00.000Z" } },
        });
        expect(readFileSync(getOnboardingArtifactSentinelPath(storagePath), "utf8")).toBe(legacyBytes);
      });
    });

    it("leaves no temporary file behind after a successful write", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeOnboardingStateFile(storagePath, state);
        const entries = readdirSync(path.join(storagePath, "state"));
        expect(entries).toEqual(["onboarding.json"]);
      });
    });

    // specs/arch/onboarding/installer.md#^state-file-atomic — a recoverable
    // failure induced through real filesystem state, never by replacing the
    // writer: the writer's temp path is occupied by a non-empty directory, so
    // the temp write fails (EISDIR) even when the test runs as root (a
    // write-protected directory would not block a privileged user).
    it("a recoverable write failure surfaces and leaves the previous state intact", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeOnboardingStateFile(storagePath, state);
        const tempPath = getOnboardingStateTempPath(storagePath);
        mkdirSync(tempPath);
        writeFileSync(path.join(tempPath, "occupied"), "blocks rename cleanup too");
        expect(() =>
          writeOnboardingStateFile(storagePath, { version: 3, channels: {} }),
        ).toThrow();
        const onDisk = JSON.parse(readFileSync(getOnboardingStatePath(storagePath), "utf8"));
        expect(onDisk).toEqual(state);
      });
    });
  });

  describe("parsing the authoritative state file", () => {
    it("round-trips what the writer wrote", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeOnboardingStateFile(storagePath, state);
        expect(readOnboardingStateFile(storagePath)).toEqual({ status: "ok", state });
      });
    });

    it("reports absent when the file does not exist", () => {
      withStorage((storagePath) => {
        expect(readOnboardingStateFile(storagePath)).toEqual({ status: "absent" });
      });
    });

    // proofs/arch/onboarding/installer.md#^t-invalid-state (parse half) — the
    // truncated shape is what a torn write would leave.
    it("reports invalid on a truncated file", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeFileSync(getOnboardingStatePath(storagePath), '{"version":3,"channels":{"tv-gu');
        const result = readOnboardingStateFile(storagePath);
        expect(result.status).toBe("invalid");
      });
    });

    it("reports v2 state as a migration input", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeFileSync(getOnboardingStatePath(storagePath), JSON.stringify(legacyV2State));
        expect(readOnboardingStateFile(storagePath)).toEqual({ status: "v2", state: legacyV2State });
      });
    });

    it("reports invalid on schema-invalid payloads", () => {
      const invalidPayloads = [
        { version: 3, screens: {}, channels: {} },
        { version: 2, screens: {}, channels: {} },
        { version: 3, channels: [] },
        { version: 3, channels: { "tv-guide": {} } },
        { version: 3, channels: { "tv-guide": { installedAt: 42 } } },
        // Keys must be onboarding slugs and timestamps syntactically usable
        // (specs/arch/onboarding/installer.md#^invalid-state-conservative).
        { version: 3, channels: { "tv-guide": { installedAt: "not-a-date" } } },
        { version: 3, channels: { "Bad_Slug": { installedAt: "2026-01-01T00:00:00.000Z" } } },
        { version: 3, channels: { "double--hyphen": { installedAt: "2026-01-01T00:00:00.000Z" } } },
        { version: 3 },
        [],
        "v3",
      ];
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        for (const payload of invalidPayloads) {
          writeFileSync(getOnboardingStatePath(storagePath), JSON.stringify(payload));
          expect(readOnboardingStateFile(storagePath).status, JSON.stringify(payload)).toBe("invalid");
        }
      });
    });
  });

  describe("parsing the legacy sentinel", () => {
    it("reads a v1 payload with its usable installedAt", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeFileSync(
          getOnboardingArtifactSentinelPath(storagePath),
          JSON.stringify({ version: 1, artifactID: "television-onboarding", installedAt: "2025-05-05T05:05:05.000Z" }),
        );
        expect(readLegacyOnboardingFile(storagePath)).toEqual({
          status: "v1",
          installedAt: "2025-05-05T05:05:05.000Z",
        });
      });
    });

    it("reads a v1 payload with an unusable installedAt as undefined", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        for (const installedAt of ["not-a-date", 42, undefined]) {
          writeFileSync(
            getOnboardingArtifactSentinelPath(storagePath),
            JSON.stringify({ version: 1, artifactID: "television-onboarding", installedAt }),
          );
          expect(readLegacyOnboardingFile(storagePath)).toEqual({ status: "v1", installedAt: undefined });
        }
      });
    });

    // specs/arch/onboarding/installer.md#^migrate-legacy-v2
    it("reads a valid v2 payload held at the legacy path", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        writeFileSync(getOnboardingArtifactSentinelPath(storagePath), JSON.stringify(legacyV2State));
        expect(readLegacyOnboardingFile(storagePath)).toEqual({ status: "v2", state: legacyV2State });
      });
    });

    it("reports invalid on garbage and absent when missing", () => {
      withStorage((storagePath) => {
        expect(readLegacyOnboardingFile(storagePath)).toEqual({ status: "absent" });
        seedStateDir(storagePath);
        writeFileSync(getOnboardingArtifactSentinelPath(storagePath), "not json");
        expect(readLegacyOnboardingFile(storagePath).status).toBe("invalid");
        writeFileSync(getOnboardingArtifactSentinelPath(storagePath), JSON.stringify({ version: 7 }));
        expect(readLegacyOnboardingFile(storagePath).status).toBe("invalid");
      });
    });

    // A `version: 1` object is only the spec'd v1 payload when it records the
    // legacy artifact ID; anything else is not install evidence
    // (specs/arch/onboarding/installer.md#^invalid-state-conservative).
    it("reports invalid on a v1 payload without the legacy artifact ID", () => {
      withStorage((storagePath) => {
        seedStateDir(storagePath);
        for (const payload of [
          { version: 1, installedAt: "2025-05-05T05:05:05.000Z" },
          { version: 1, artifactID: "something-else", installedAt: "2025-05-05T05:05:05.000Z" },
          { version: 1, artifactID: 42, installedAt: "2025-05-05T05:05:05.000Z" },
        ]) {
          writeFileSync(getOnboardingArtifactSentinelPath(storagePath), JSON.stringify(payload));
          expect(readLegacyOnboardingFile(storagePath).status, JSON.stringify(payload)).toBe("invalid");
        }
      });
    });
  });
});
