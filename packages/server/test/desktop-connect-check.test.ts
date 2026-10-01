import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-desktop-connect-check-"));
}

async function harness(auth: boolean) {
  const storagePath = tempDir();
  const store = createServingStore(storagePath);
  const server = new Server({
    store,
    host: "127.0.0.1",
    port: 0,
    auth,
    acpProfile: {
      agent: "hermes",
      command: "hermes",
      args: ["acp"],
      envPrefix: "HERMES_",
      sessionIdStrategy: "mapped",
    },
  });
  await server.start();
  return { storagePath, store, server };
}

async function dispose(h: Awaited<ReturnType<typeof harness>>): Promise<void> {
  await h.server.dispose();
  rmSync(h.storagePath, { recursive: true, force: true });
}

// Historical reader fixture copied verbatim from published desktop 0.1.206:
// git revision 244b0b833, packages/desktop/src/connect-preflight.ts lines 31-39.
function isDisplayResponse(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return (
    (typeof candidate.activeScreenID === "string" || candidate.activeScreenID === null) &&
    (typeof candidate.activeThemeName === "string" || candidate.activeThemeName === null) &&
    typeof candidate.acpEnabled === "boolean"
  );
}

// Spec: ^updates-t-preflight-server-contract
describe("GET /desktop/connect-check", () => {
  it("returns the product marker without auth and ignores absent, valid, or malformed version queries", async () => {
    const h = await harness(false);
    try {
      for (const url of [
        "/desktop/connect-check",
        "/desktop/connect-check?desktopAppVersion=0.1.207",
        "/desktop/connect-check?desktopAppVersion=not-a-version",
      ]) {
        const response = await request(h.server.httpServer).get(url).expect(200);
        expect(response.body).toMatchObject({ product: "television" });
      }
    } finally {
      await dispose(h);
    }
  });

  it("accepts a valid bearer token and rejects missing or invalid credentials", async () => {
    const h = await harness(true);
    try {
      await request(h.server.httpServer)
        .get("/desktop/connect-check?desktopAppVersion=%5Bmalformed%5D")
        .set({ Authorization: `Bearer ${h.store.authToken}` })
        .expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ product: "television" }));

      await request(h.server.httpServer).get("/desktop/connect-check").expect(401);
      await request(h.server.httpServer)
        .get("/desktop/connect-check?desktopAppVersion=0.1.207")
        .set({ Authorization: "Bearer invalid" })
        .expect(401);
    } finally {
      await dispose(h);
    }
  });
});

// Spec: ^updates-t-legacy-connect-check-contract
describe("published 0.1.206 /display identity predicate", () => {
  it("accepts focused and empty display states", async () => {
    const h = await harness(true);
    const authHeader = { Authorization: `Bearer ${h.store.authToken}` };
    try {
      const focusedChannelId = h.store.getFocusedChannelId()!;
      const focused = await request(h.server.httpServer).get("/display").set(authHeader).expect(200);
      expect(isDisplayResponse(focused.body)).toBe(true);

      await request(h.server.httpServer).delete(`/channels/${focusedChannelId}`).set(authHeader).expect(200);
      const empty = await request(h.server.httpServer).get("/display").set(authHeader).expect(200);
      expect(isDisplayResponse(empty.body)).toBe(true);
    } finally {
      await dispose(h);
    }
  });
});
