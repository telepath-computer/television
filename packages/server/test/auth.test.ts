import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createToken, isAuthorizedBearer, isAuthorizedQueryToken } from "../src/auth.ts";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-auth-"));
}

describe("auth helpers", () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.dispose();
    }
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createToken returns 64-char hex", () => {
    const token = createToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("isAuthorizedBearer validates bearer token", () => {
    expect(isAuthorizedBearer("Bearer secret", "secret")).toBe(true);
    expect(isAuthorizedBearer("Bearer wrong", "secret")).toBe(false);
    expect(isAuthorizedBearer("Basic secret", "secret")).toBe(false);
    expect(isAuthorizedBearer(undefined, "secret")).toBe(false);
  });

  it("isAuthorizedQueryToken validates ?token=", () => {
    expect(isAuthorizedQueryToken("/ws?token=secret", "secret")).toBe(true);
    expect(isAuthorizedQueryToken("/ws", "secret")).toBe(false);
    expect(isAuthorizedQueryToken("/ws?token=wrong", "secret")).toBe(false);
    expect(isAuthorizedQueryToken(undefined, "secret")).toBe(false);
  });

  it("artifact registry routes require authentication", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const artifactPath = path.join(storagePath, "auth.html");
    writeFileSync(artifactPath, "<!doctype html>");
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    const [channel] = store.listChannels();
    const artifact = store.createArtifact({ kind: "path", title: "A", path: artifactPath, channelID: channel.id });

    await request(server.httpServer).post("/artifacts").send({ kind: "path", title: "External", path: artifactPath }).expect(401);
    await request(server.httpServer).patch(`/artifacts/${artifact.id}`).send({ title: "B" }).expect(401);
    await request(server.httpServer).delete(`/artifacts/${artifact.id}`).expect(401);
    await request(server.httpServer).delete(`/channels/${channel.id}`).expect(401);
  });
});
