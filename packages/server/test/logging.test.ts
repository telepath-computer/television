import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-logging-"));
}

function readLogRecords(storagePath: string): Array<Record<string, unknown>> {
  const logPath = path.join(storagePath, "logs", "tv.log");
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function listen(server: http.Server, host: string, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("server did not report an address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function findUnassignedCgnatAddress(): string {
  const assignedAddresses = new Set(
    Object.values(os.networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .map((entry) => entry.address),
  );

  for (let secondOctet = 64; secondOctet <= 127; secondOctet += 1) {
    for (let thirdOctet = 0; thirdOctet <= 255; thirdOctet += 1) {
      const candidate = `100.${secondOctet}.${thirdOctet}.1`;
      if (!assignedAddresses.has(candidate)) return candidate;
    }
  }

  // Exhaustion would require the host to own the sampled .1 address in every CGNAT /24.
  throw new Error("test host has no unassigned CGNAT address");
}

const UNASSIGNED_CGNAT_ADDRESS = findUnassignedCgnatAddress();

describe("server logging", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records lifecycle start and stop snapshots", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0, auth: true });

    await server.start();
    await server.dispose("SIGTERM");

    const records = readLogRecords(storagePath);
    expect(records.some((record) => record.msg === "server started")).toBe(true);
    expect(records.some((record) => record.msg === "server stopped" && record.signal === "SIGTERM")).toBe(true);
    const start = records.find((record) => record.msg === "server started") as { snapshot?: { authMode?: string } } | undefined;
    expect(start?.snapshot?.authMode).toBe("auth");
  });

  // ^t-record-before-exit
  it("writes the fatal bind record before startup rejection is observable", async () => {
    const blocker = http.createServer((_req, res) => res.end("blocked"));
    const blockedPort = await listen(blocker, "127.0.0.1");
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: blockedPort });
    let recordsAtRejection: Array<Record<string, unknown>> | undefined;

    try {
      const start = server.start().catch((error: unknown) => {
        recordsAtRejection = readLogRecords(storagePath);
        throw error;
      });
      await expect(start).rejects.toMatchObject({ exitStatus: 69 });
    } finally {
      await Promise.all([server.dispose("SIGTERM"), close(blocker)]);
    }

    expect(readLogRecords(storagePath)).toContainEqual(expect.objectContaining({
      msg: "server stopped",
      signal: "SIGTERM",
    }));

    const fatalRecords = recordsAtRejection?.filter((record) => record.msg === "server startup failed");
    expect(fatalRecords).toEqual([
      expect.objectContaining({
        reason: "required-listener-bind-failed",
        exitStatus: 69,
        outcomes: [
          expect.objectContaining({
            address: "127.0.0.1",
            port: blockedPort,
            outcome: "failed",
            code: "EADDRINUSE",
            syscall: "listen",
          }),
        ],
      }),
    ]);
  });

  // ^t-attempt-all ^t-record-schema
  it("records every bind outcome in one fatal startup record", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, listen: ["192.0.2.1", "198.51.100.1"], port: 0 });
    let records: Array<Record<string, unknown>> = [];

    try {
      await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });
      records = readLogRecords(storagePath);
    } finally {
      await server.dispose();
    }

    const fatalRecords = records.filter((record) => record.msg === "server startup failed");
    expect(fatalRecords).toHaveLength(1);
    const fatalRecord = fatalRecords[0];
    expect(fatalRecord).toEqual(expect.objectContaining({
      ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      reason: "required-listener-bind-failed",
      exitStatus: 69,
    }));

    const outcomes = fatalRecord?.outcomes as Array<Record<string, unknown>> | undefined;
    const boundPort = outcomes?.[0]?.port;
    expect(boundPort).toEqual(expect.any(Number));
    expect(outcomes).toEqual([
      { address: "127.0.0.1", port: boundPort, outcome: "bound" },
      expect.objectContaining({
        address: "192.0.2.1",
        port: boundPort,
        outcome: "failed",
        code: "EADDRNOTAVAIL",
        syscall: "listen",
        cause: expect.any(String),
        hint: expect.any(String),
      }),
      expect.objectContaining({
        address: "198.51.100.1",
        port: boundPort,
        outcome: "failed",
        code: "EADDRNOTAVAIL",
        syscall: "listen",
        cause: expect.any(String),
        hint: expect.any(String),
      }),
    ]);
    expect(records.some((record) => record.msg === "server started")).toBe(false);
    expect(records.some((record) => typeof record.msg === "string" && record.msg.startsWith("bind failed on "))).toBe(false);
  });

  // proofs/arch/cli/startup-bind-failure.md#^t-hint
  it("writes Tailscale recovery guidance for an unassigned CGNAT address under launch mode daemon", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, listen: [UNASSIGNED_CGNAT_ADDRESS], port: 0, telemetry: { launchMode: "daemon" } });

    try {
      await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });
    } finally {
      await server.dispose();
    }

    const fatalRecord = readLogRecords(storagePath).find((record) => record.msg === "server startup failed");
    const outcomes = fatalRecord?.outcomes as Array<Record<string, unknown>> | undefined;
    const failure = outcomes?.find((outcome) => outcome.address === UNASSIGNED_CGNAT_ADDRESS);
    const hint = String(failure?.hint);
    expect(failure).toEqual(expect.objectContaining({ code: "EADDRNOTAVAIL" }));
    expect(hint).toContain("not assigned to any interface");
    expect(hint).toContain("Tailscale IP");
    expect(hint).toContain("tailscaled may not be up yet");
    expect(hint).toContain("transient at boot");
    expect(hint).toContain("tailnet IP may have changed");
    expect(hint).toContain("service manager will retry");
    expect(hint).toContain("config file's `listen` setting is corrected");
    expect(hint).not.toContain("tv serve --persist");
  });

  // proofs/arch/cli/startup-bind-failure.md#^t-hint-foreground
  it("records a plain cause without Tailscale wording for an unassigned CGNAT address under launch mode cli", async () => {
    const outcomesByMode: Partial<Record<"daemon" | "cli", Record<string, unknown>>> = {};
    for (const launchMode of ["daemon", "cli"] as const) {
      const storagePath = tempDir();
      dirs.push(storagePath);
      const store = createServingStore(storagePath);
      const server = new Server({ store, listen: [UNASSIGNED_CGNAT_ADDRESS], port: 0, telemetry: { launchMode } });

      try {
        await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });
      } finally {
        await server.dispose();
      }

      const fatalRecord = readLogRecords(storagePath).find((record) => record.msg === "server startup failed");
      const outcomes = fatalRecord?.outcomes as Array<Record<string, unknown>> | undefined;
      outcomesByMode[launchMode] = outcomes?.find((outcome) => outcome.address === UNASSIGNED_CGNAT_ADDRESS);
    }

    const foreground = outcomesByMode.cli;
    expect(foreground).toEqual(expect.objectContaining({ code: "EADDRNOTAVAIL", outcome: "failed" }));
    expect(`${String(foreground?.cause)} ${String(foreground?.hint)}`).not.toMatch(/tailscale|tailscaled|tailnet/i);
    expect(String(foreground?.cause)).not.toContain("\n");
    expect(Object.keys(foreground ?? {}).sort()).toEqual(Object.keys(outcomesByMode.daemon ?? {}).sort());
  });

  it("keeps generic address failures free of Tailscale wording", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, listen: ["192.0.2.1"], port: 0 });

    try {
      await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });
    } finally {
      await server.dispose();
    }

    const fatalRecord = readLogRecords(storagePath).find((record) => record.msg === "server startup failed");
    const outcomes = fatalRecord?.outcomes as Array<Record<string, unknown>> | undefined;
    const failure = outcomes?.find((outcome) => outcome.address === "192.0.2.1");
    const diagnosis = `${String(failure?.cause)} ${String(failure?.hint)}`;
    expect(failure).toEqual(expect.objectContaining({ code: "EADDRNOTAVAIL" }));
    expect(diagnosis).not.toMatch(/tailscale|tailscaled|tailnet/i);
  });
});
