import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

function tempDir(): string { return mkdtempSync(path.join(os.tmpdir(), "television-display-")); }
function displayStatePath(storagePath: string): string { return path.join(storagePath, "state", "display.json"); }
function readDisplayState(storagePath: string): any { return JSON.parse(readFileSync(displayStatePath(storagePath), "utf8")); }
function seedChannel(storagePath: string, channel: { id: string; name: string }): void {
  const channelsDir = path.join(storagePath, "state", "channels");
  mkdirSync(channelsDir, { recursive: true });
  writeFileSync(
    path.join(channelsDir, `${channel.id}.json`),
    JSON.stringify({ ...channel, layoutVersion: 2, layout: [] }, null, 2),
  );
}
function seedDisplayState(storagePath: string, state: {
  focusedChannelId: string | null;
  pinnedChannelIds: string[];
  activeThemeName: string | null;
  appearanceMode?: "system" | "light" | "dark";
  themeJavaScriptConsentIds?: string[];
}): void {
  mkdirSync(path.join(storagePath, "state"), { recursive: true });
  writeFileSync(displayStatePath(storagePath), JSON.stringify(state, null, 2));
}
describe("display focus", () => {
  it("focuses path artifacts attached to a channel", () => {
    const storagePath = tempDir();
    const store = createServingStore(storagePath);
    const target = path.join(storagePath, "artifact.html");
    writeFileSync(target, "<!doctype html>");
    try {
      const other = store.createChannel({ name: "Other" });
      const artifact = store.createArtifact({ kind: "path", title: "A", path: target, channelID: other.id });
      expect(store.focus({ artifactID: artifact.id })).toEqual({ channelID: other.id, artifactID: artifact.id });
      expect(store.getFocusedChannelId()).toBe(other.id);
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});


describe("display HTTP API", () => {
  async function harness(auth = true, acpEnabled = true) {
    const storagePath = tempDir();
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth, acpProfile: acpEnabled ? { agent: "hermes", command: "hermes", args: ["acp"], envPrefix: "HERMES_", sessionIdStrategy: "mapped" } : undefined });
    await server.start();
    return { storagePath, store, server, authHeader: { Authorization: `Bearer ${store.authToken}` } };
  }

  it("GET /display returns focused channel, active theme, and ACP flag", async () => {
    const h = await harness(true, true);
    try {
      const channels = h.store.listChannels();
      expect(channels).toHaveLength(1);
      expect(existsSync(displayStatePath(h.storagePath))).toBe(true);
      expect(readDisplayState(h.storagePath)).toEqual({
        focusedChannelId: channels[0]!.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });

      await request(h.server.httpServer)
        .get("/display")
        .set(h.authHeader)
        .expect(200)
        .expect(({ body }) => {
          expect(body.focusedChannelId).toBe(h.store.getFocusedChannelId());
          expect(body.pinnedChannelIds).toEqual([]);
          expect(body.activeThemeName).toBeNull();
          expect(body.acpEnabled).toBe(true);
        });
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("GET /display keeps activeScreenID output-only for focused and empty state", async () => {
    const h = await harness(true, true);
    try {
      const assertDisplayResponse = async (focusedChannelId: string | null) => {
        const response = await request(h.server.httpServer)
          .get("/display")
          .set({ Authorization: `Bearer ${h.store.authToken}` })
          .expect(200);

        expect(response.body).toMatchObject({
          focusedChannelId,
          pinnedChannelIds: [],
          activeThemeName: null,
          appearanceMode: "system",
          themeJavaScriptConsentIds: [],
          acpEnabled: true,
        });
        expect(response.body).not.toHaveProperty("activeChannelID");
        expect(Object.hasOwn(response.body, "activeScreenID")).toBe(true);
        expect(response.body.activeScreenID === null || typeof response.body.activeScreenID === "string").toBe(true);
        expect(Object.hasOwn(readDisplayState(h.storagePath), "activeScreenID")).toBe(false);
      };

      const focusedChannelId = h.store.getFocusedChannelId()!;
      await assertDisplayResponse(focusedChannelId);
      await request(h.server.httpServer)
        .delete(`/channels/${focusedChannelId}`)
        .set(h.authHeader)
        .expect(200);
      await assertDisplayResponse(null);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("GET /display returns only persisted display state even when /events sockets are open", async () => {
    const h = await harness(true, true);
    const initial = readDisplayState(h.storagePath);
    const socket = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=${h.store.authToken}`);
    try {
      await new Promise<void>((resolve) => socket.once("open", () => resolve()));
      await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
        expect(body).toMatchObject({
          focusedChannelId: initial.focusedChannelId,
          pinnedChannelIds: initial.pinnedChannelIds,
          activeThemeName: initial.activeThemeName,
          acpEnabled: true,
        });
      });
    } finally {
      socket.close();
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
  });

  it("GET /display returns acpEnabled false when no ACP profile is configured", async () => {
    const h = await harness(true, false);
    try {
      await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
        expect(body.acpEnabled).toBe(false);
      });
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  // proofs/arch/themes/index.md#^themes-t-active-color-scheme-state
  it("derives active color scheme across display HTTP, theme events, refresh fallback, and restart", async () => {
    const storagePath = tempDir();
    seedChannel(storagePath, { id: "screen-1", name: "One" });
    seedThemePackage(storagePath, "fixed-dark", ":root{}", {
      colorScheme: "dark",
    });
    const adaptiveDir = seedThemePackage(storagePath, "adaptive", ":root{}", {
      colorScheme: "light dark",
    });
    seedDisplayState(storagePath, {
      focusedChannelId: "screen-1",
      pinnedChannelIds: [],
      activeThemeName: "fixed-dark",
      appearanceMode: "light",
    });
    const noWatch = () => ({ close() {}, on() {} });
    const firstStore = createServingStore(storagePath, { watchContentFile: noWatch });
    expect(firstStore.getDisplayState().activeThemeColorScheme).toBe("dark");
    expect(readDisplayState(storagePath)).not.toHaveProperty("activeThemeColorScheme");
    firstStore.dispose();

    const store = createServingStore(storagePath, { watchContentFile: noWatch });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    await server.start();
    const auth = { Authorization: `Bearer ${store.authToken}` };
    const ws = new WebSocket(
      `${server.getBaseURL().replace(/^http/, "ws")}/events?token=${store.authToken}`,
    );
    const themeEvents: any[] = [];
    const persistedAtDelivery: any[] = [];
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type !== "theme-changed") return;
      themeEvents.push(message);
      persistedAtDelivery.push(readDisplayState(storagePath));
    });
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));

    try {
      await request(server.httpServer).get("/display").set(auth).expect(200).expect(({ body }) => {
        expect(body).toMatchObject({
          activeThemeName: "fixed-dark",
          activeThemeColorScheme: "dark",
          appearanceMode: "light",
        });
      });

      const stableBytes = readFileSync(displayStatePath(storagePath), "utf8");
      await request(server.httpServer).patch("/display").set(auth).send({
        activeThemeColorScheme: "light",
      }).expect(400);
      expect(readFileSync(displayStatePath(storagePath), "utf8")).toBe(stableBytes);
      expect(store.getDisplayState()).toMatchObject({
        activeThemeName: "fixed-dark",
        activeThemeColorScheme: "dark",
      });

      await request(server.httpServer).patch("/display").set(auth).send({
        activeThemeName: "adaptive",
      }).expect(204);
      await expect.poll(() => themeEvents.length).toBe(1);

      await request(server.httpServer).patch("/display").set(auth).send({
        themeJavaScriptConsentIds: ["adaptive"],
      }).expect(204);
      await expect.poll(() => themeEvents.length).toBe(2);

      writeFileSync(
        path.join(adaptiveDir, "manifest.json"),
        `${JSON.stringify({
          name: "adaptive",
          version: "1.0.0",
          colorScheme: " LIGHT ",
        }, null, 2)}\n`,
      );
      await request(server.httpServer).post("/themes/refresh").set(auth).expect(200);
      await expect.poll(() => themeEvents.length).toBe(3);

      writeFileSync(
        path.join(adaptiveDir, "manifest.json"),
        `${JSON.stringify({
          name: "adaptive",
          version: "invalid",
          colorScheme: "light",
        }, null, 2)}\n`,
      );
      await request(server.httpServer).post("/themes/refresh").set(auth).expect(200);
      await expect.poll(() => themeEvents.length).toBe(4);

      expect(themeEvents).toEqual([
        {
          type: "theme-changed",
          themeName: "adaptive",
          activeThemeColorScheme: "light dark",
          themeJavaScriptConsentIds: [],
        },
        {
          type: "theme-changed",
          themeName: "adaptive",
          activeThemeColorScheme: "light dark",
          themeJavaScriptConsentIds: ["adaptive"],
        },
        {
          type: "theme-changed",
          themeName: "adaptive",
          activeThemeColorScheme: "light",
          themeJavaScriptConsentIds: ["adaptive"],
        },
        {
          type: "theme-changed",
          themeName: null,
          activeThemeColorScheme: null,
          themeJavaScriptConsentIds: ["adaptive"],
        },
      ]);
      expect(persistedAtDelivery.map((state) => ({
        activeThemeName: state.activeThemeName,
        hasDerivedScheme: Object.hasOwn(state, "activeThemeColorScheme"),
      }))).toEqual([
        { activeThemeName: "adaptive", hasDerivedScheme: false },
        { activeThemeName: "adaptive", hasDerivedScheme: false },
        { activeThemeName: "adaptive", hasDerivedScheme: false },
        { activeThemeName: null, hasDerivedScheme: false },
      ]);
      await request(server.httpServer).get("/display").set(auth).expect(200).expect(({ body }) => {
        expect(body.activeThemeName).toBeNull();
        expect(body.activeThemeColorScheme).toBeNull();
      });
    } finally {
      ws.close();
      await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-consent-state
  it("reads absent persisted theme JavaScript consent as an empty wire set without a boot rewrite", async () => {
    const storagePath = tempDir();
    seedChannel(storagePath, { id: "screen-1", name: "One" });
    seedDisplayState(storagePath, {
      focusedChannelId: "screen-1",
      pinnedChannelIds: [],
      activeThemeName: null,
      appearanceMode: "system",
    });
    const original = readFileSync(displayStatePath(storagePath), "utf8");
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    await server.start();
    try {
      expect(store.getDisplayState().themeJavaScriptConsentIds).toEqual([]);
      expect(readFileSync(displayStatePath(storagePath), "utf8")).toBe(original);
      await request(server.httpServer)
        .get("/display")
        .set({ Authorization: `Bearer ${store.authToken}` })
        .expect(200)
        .expect(({ body }) => expect(body.themeJavaScriptConsentIds).toEqual([]));
    } finally {
      await server.dispose();
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-consent-state
  it("validates, persists, and broadcasts complete exact theme JavaScript consent sets", async () => {
    const h = await harness();
    const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=${h.store.authToken}`);
    const websocketEvents: any[] = [];
    const persistedAtDelivery: any[] = [];
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "theme-changed") {
        websocketEvents.push(message);
        persistedAtDelivery.push(readDisplayState(h.storagePath));
      }
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    const storeEvents: any[] = [];
    h.store.addEventListener("theme-changed", (event) => storeEvents.push(event));
    try {
      seedThemePackage(h.storagePath, "paperlike", ":root{}", {
        enableMainJS: true,
        mainJS: "globalThis.paperlike = true;",
      });
      h.store.refreshThemeRegistry();

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        activeThemeName: "paperlike",
        themeJavaScriptConsentIds: ["Theme.ID", "theme.id"],
      }).expect(204);
      expect(h.store.getDisplayState()).toMatchObject({
        activeThemeName: "paperlike",
        themeJavaScriptConsentIds: ["Theme.ID", "theme.id"],
      });
      expect(readDisplayState(h.storagePath).themeJavaScriptConsentIds)
        .toEqual(["Theme.ID", "theme.id"]);

      const firstEventIds = storeEvents[0].themeJavaScriptConsentIds;
      firstEventIds.push("listener-mutation");
      expect(h.store.getDisplayState().themeJavaScriptConsentIds)
        .toEqual(["Theme.ID", "theme.id"]);

      const stableBytes = readFileSync(displayStatePath(h.storagePath), "utf8");
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        themeJavaScriptConsentIds: ["theme.id", "Theme.ID"],
      }).expect(204);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(stableBytes);

      for (const invalid of [
        [""],
        ["Theme.ID", "Theme.ID"],
        ["Theme.ID", 42],
      ]) {
        await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
          themeJavaScriptConsentIds: invalid,
        }).expect(400);
        expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(stableBytes);
      }

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        themeJavaScriptConsentIds: ["theme.id"],
      }).expect(204);
      h.store.refreshThemeRegistry();
      expect(h.store.getDisplayState().themeJavaScriptConsentIds).toEqual(["theme.id"]);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(storeEvents.map((event) => ({
        themeName: event.themeName,
        consent: event.themeJavaScriptConsentIds,
      }))).toEqual([
        { themeName: "paperlike", consent: ["Theme.ID", "theme.id", "listener-mutation"] },
        { themeName: "paperlike", consent: ["theme.id"] },
      ]);
      expect(websocketEvents).toEqual([
        {
          type: "theme-changed",
          themeName: "paperlike",
          activeThemeColorScheme: "light dark",
          themeJavaScriptConsentIds: ["Theme.ID", "theme.id"],
        },
        {
          type: "theme-changed",
          themeName: "paperlike",
          activeThemeColorScheme: "light dark",
          themeJavaScriptConsentIds: ["theme.id"],
        },
      ]);
      expect(persistedAtDelivery.map((state) => state.themeJavaScriptConsentIds)).toEqual([
        ["Theme.ID", "theme.id"],
        ["theme.id"],
      ]);

      await h.server.dispose();
      const restartedStore = createServingStore(h.storagePath);
      try {
        expect(restartedStore.getDisplayState().themeJavaScriptConsentIds).toEqual(["theme.id"]);
      } finally {
        restartedStore.dispose();
      }
    } finally {
      ws.close();
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
  });

  it("fresh startup with pre-existing channels picks one as active and does not create extras", async () => {
    const storagePath = tempDir();
    seedChannel(storagePath, { id: "screen-1", name: "One" });
    seedChannel(storagePath, { id: "screen-2", name: "Two" });
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, acpProfile: { agent: "hermes", command: "hermes", args: ["acp"], envPrefix: "HERMES_", sessionIdStrategy: "mapped" } });
    await server.start();
    try {
      expect(store.listChannels().map((channel) => channel.id).sort()).toEqual(["screen-1", "screen-2"]);
      await request(server.httpServer).get("/display").set({ Authorization: `Bearer ${store.authToken}` }).expect(200).expect(({ body }) => {
        expect(["screen-1", "screen-2"]).toContain(body.focusedChannelId);
        expect(body.pinnedChannelIds).toEqual([]);
        expect(body.activeThemeName).toBeNull();
        expect(body.acpEnabled).toBe(true);
      });
      const persisted = readDisplayState(storagePath);
      expect(["screen-1", "screen-2"]).toContain(persisted.focusedChannelId);
      expect(persisted.pinnedChannelIds).toEqual([]);
      expect(persisted.activeThemeName).toBeNull();
    } finally { await server.dispose(); store.dispose(); rmSync(storagePath, { recursive: true, force: true }); }
  });

  it("fresh startup keeps a stale persisted focusedChannelId drift-tolerantly null", async () => {
    const storagePath = tempDir();
    seedChannel(storagePath, { id: "screen-1", name: "One" });
    seedDisplayState(storagePath, {
      focusedChannelId: "deleted-screen",
      pinnedChannelIds: [],
      activeThemeName: null,
      appearanceMode: "system",
    });
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, acpProfile: { agent: "hermes", command: "hermes", args: ["acp"], envPrefix: "HERMES_", sessionIdStrategy: "mapped" } });
    await server.start();
    try {
      expect(store.getFocusedChannelId()).toBeNull();
      expect(store.listChannels().map((channel) => channel.id)).toEqual(["screen-1"]);
      await request(server.httpServer).get("/display").set({ Authorization: `Bearer ${store.authToken}` }).expect(200).expect(({ body }) => {
        expect(body).toMatchObject({ focusedChannelId: null, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: true });
      });
    } finally { await server.dispose(); store.dispose(); rmSync(storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display persists focusedChannelId and pinnedChannelIds independently while preserving theme and ACP", async () => {
    const h = await harness();
    try {
      const initialFocusedChannelId = h.store.getFocusedChannelId()!;
      const other = h.store.createChannel({ name: "Other" });
      const pinned = h.store.createChannel({ name: "Pinned" });
      seedThemePackage(h.storagePath, "paperlike", ":root{}");
      h.store.refreshThemeRegistry();
      const channelEvents: any[] = [];
      const pinnedEvents: any[] = [];
      const themeEvents: any[] = [];
      h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
      h.store.addEventListener("pinned-channels-changed", (event) => pinnedEvents.push(event));
      h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: other.id,
        pinnedChannelIds: [pinned.id, initialFocusedChannelId],
        activeThemeName: "paperlike",
        appearanceMode: "system",
      }).expect(204);
      expect(channelEvents.map((event) => event.channelID)).toEqual([other.id]);
      expect(pinnedEvents.map((event) => event.pinnedChannelIds)).toEqual([[pinned.id, initialFocusedChannelId]]);
      expect(themeEvents.map((event) => event.themeName)).toEqual(["paperlike"]);

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        pinnedChannelIds: [initialFocusedChannelId, pinned.id],
      }).expect(204);
      await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
        expect(body).toMatchObject({
          focusedChannelId: other.id,
          pinnedChannelIds: [initialFocusedChannelId, pinned.id],
          activeThemeName: "paperlike",
          appearanceMode: "system",
          acpEnabled: true,
        });
      });

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: initialFocusedChannelId,
      }).expect(204);
      await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
        expect(body).toMatchObject({
          focusedChannelId: initialFocusedChannelId,
          pinnedChannelIds: [initialFocusedChannelId, pinned.id],
          activeThemeName: "paperlike",
          appearanceMode: "system",
          acpEnabled: true,
        });
      });
      expect(pinnedEvents.map((event) => event.pinnedChannelIds)).toEqual([
        [pinned.id, initialFocusedChannelId],
        [initialFocusedChannelId, pinned.id],
      ]);

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: null }).expect(204);
      expect(readDisplayState(h.storagePath)).toEqual({
        focusedChannelId: initialFocusedChannelId,
        pinnedChannelIds: [initialFocusedChannelId, pinned.id],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  // proofs/arch/themes/index.md#^themes-t-appearance-server
  it("supports appearance defaults, validation, persistence, idempotence, and events", async () => {
    const h = await harness();
    const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=${h.store.authToken}`);
    const websocketEvents: any[] = [];
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "appearance-changed") websocketEvents.push(message);
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    try {
      const initialFocusedChannelId = h.store.getFocusedChannelId()!;
      const other = h.store.createChannel({ name: "Other" });
      seedThemePackage(h.storagePath, "paperlike", ":root{}");
      h.store.refreshThemeRegistry();
      expect(readDisplayState(h.storagePath)).toEqual({
        focusedChannelId: initialFocusedChannelId,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
      await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
        expect(body.appearanceMode).toBe("system");
      });

      const storeEvents: string[] = [];
      h.store.addEventListener("appearance-changed", (event) => storeEvents.push(event.appearanceMode));
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: other.id,
        pinnedChannelIds: [initialFocusedChannelId],
        activeThemeName: "paperlike",
        appearanceMode: "light",
      }).expect(204);
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        appearanceMode: "dark",
      }).expect(204);
      expect(readDisplayState(h.storagePath)).toEqual({
        focusedChannelId: other.id,
        pinnedChannelIds: [initialFocusedChannelId],
        activeThemeName: "paperlike",
        appearanceMode: "dark",
        themeJavaScriptConsentIds: [],
      });

      const darkBytes = readFileSync(displayStatePath(h.storagePath), "utf8");
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        appearanceMode: "dark",
      }).expect(204);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(darkBytes);
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        appearanceMode: "sepia",
      }).expect(400);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(darkBytes);

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        appearanceMode: "system",
      }).expect(204);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(storeEvents).toEqual(["light", "dark", "system"]);
      expect(websocketEvents).toEqual([
        { type: "appearance-changed", appearanceMode: "light" },
        { type: "appearance-changed", appearanceMode: "dark" },
        { type: "appearance-changed", appearanceMode: "system" },
      ]);

      await h.server.dispose();
      const restartedStore = createServingStore(h.storagePath);
      try {
        expect(restartedStore.getDisplayState()).toMatchObject({
          focusedChannelId: other.id,
          pinnedChannelIds: [initialFocusedChannelId],
          activeThemeName: "paperlike",
          appearanceMode: "system",
          themeJavaScriptConsentIds: [],
        });
      } finally {
        restartedStore.dispose();
      }
    } finally {
      ws.close();
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
  });

  it("PATCH /display rejects focusedChannelId: null while channels exist without changing state", async () => {
    const h = await harness();
    const initial = readFileSync(displayStatePath(h.storagePath), "utf8");
    const initialState = h.store.getDisplayState();
    const channelEvents: any[] = [];
    h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
    try {
      const response = await request(h.server.httpServer)
        .patch("/display")
        .set(h.authHeader)
        .send({ focusedChannelId: null })
        .expect(400);
      expect(response.body.error).toMatch(/cannot be null while channels exist/);
      expect(channelEvents).toEqual([]);
      expect(h.store.getDisplayState()).toEqual(initialState);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(initial);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display with an empty body is a no-op", async () => {
    const h = await harness();
    const initial = readDisplayState(h.storagePath);
    const channelEvents: any[] = [];
    const pinnedEvents: any[] = [];
    const themeEvents: any[] = [];
    h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
    h.store.addEventListener("pinned-channels-changed", (event) => pinnedEvents.push(event));
    h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));
    try {
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({}).expect(204);
      expect(channelEvents).toHaveLength(0);
      expect(pinnedEvents).toHaveLength(0);
      expect(themeEvents).toHaveLength(0);
      expect(readDisplayState(h.storagePath)).toEqual(initial);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display is idempotent when values match current state", async () => {
    const h = await harness();
    try {
      const channel = h.store.createChannel({ name: "S1" });
      seedThemePackage(h.storagePath, "paperlike", ":root{}");
      h.store.refreshThemeRegistry();
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: channel.id,
        pinnedChannelIds: [channel.id],
        activeThemeName: "paperlike",
        appearanceMode: "system",
      }).expect(204);
      const channelEvents: any[] = [];
      const pinnedEvents: any[] = [];
      const themeEvents: any[] = [];
      h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
      h.store.addEventListener("pinned-channels-changed", (event) => pinnedEvents.push(event));
      h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: channel.id,
        pinnedChannelIds: [channel.id],
        activeThemeName: "paperlike",
        appearanceMode: "system",
      }).expect(204);
      expect(channelEvents).toHaveLength(0);
      expect(pinnedEvents).toHaveLength(0);
      expect(themeEvents).toHaveLength(0);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display passes unrestricted theme ID syntax to exact registry lookup", async () => {
    const h = await harness();
    const initial = readDisplayState(h.storagePath);
    const channelEvents: any[] = [];
    const themeEvents: any[] = [];
    h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
    h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));
    try {
      const res = await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "Bad Name" }).expect(404);
      expect(res.body).toEqual({ error: "Theme not found: Bad Name" });
      expect(channelEvents).toHaveLength(0);
      expect(themeEvents).toHaveLength(0);
      expect(readDisplayState(h.storagePath)).toEqual(initial);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display treats traversal-shaped strings as unknown exact theme IDs", async () => {
    const h = await harness();
    const initial = readDisplayState(h.storagePath);
    const channelEvents: any[] = [];
    const themeEvents: any[] = [];
    h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
    h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));
    try {
      const res = await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "../etc/passwd" }).expect(404);
      expect(res.body).toEqual({ error: "Theme not found: ../etc/passwd" });
      expect(channelEvents).toHaveLength(0);
      expect(themeEvents).toHaveLength(0);
      expect(readDisplayState(h.storagePath)).toEqual(initial);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects unknown themes with 404 and leaves state unchanged", async () => {
    const h = await harness();
    const initial = readDisplayState(h.storagePath);
    const channelEvents: any[] = [];
    const themeEvents: any[] = [];
    h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
    h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));
    try {
      const res = await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "paperlike" }).expect(404);
      expect(res.body).toEqual({ error: "Theme not found: paperlike" });
      expect(channelEvents).toHaveLength(0);
      expect(themeEvents).toHaveLength(0);
      expect(readDisplayState(h.storagePath)).toEqual(initial);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects unknown channels with 404 and leaves state unchanged", async () => {
    const h = await harness();
    const initial = readDisplayState(h.storagePath);
    const initialState = h.store.getDisplayState();
    const channelEvents: any[] = [];
    const themeEvents: any[] = [];
    h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
    h.store.addEventListener("theme-changed", (event) => themeEvents.push(event));
    try {
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ focusedChannelId: "no-such-screen" }).expect(404);
      expect(channelEvents).toHaveLength(0);
      expect(themeEvents).toHaveLength(0);
      expect(h.store.getDisplayState()).toEqual(initialState);
      expect(readDisplayState(h.storagePath)).toEqual(initial);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects unknown pinned channel ids without changing exposed or persisted state", async () => {
    const h = await harness();
    try {
      const initialFocusedChannelId = h.store.getFocusedChannelId()!;
      const other = h.store.createChannel({ name: "Other" });
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: other.id,
        pinnedChannelIds: [initialFocusedChannelId],
      }).expect(204);
      const initialBytes = readFileSync(displayStatePath(h.storagePath), "utf8");
      const initialState = h.store.getDisplayState();
      const pinnedEvents: any[] = [];
      h.store.addEventListener("pinned-channels-changed", (event) => pinnedEvents.push(event));

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: initialFocusedChannelId,
        pinnedChannelIds: ["missing", other.id],
      }).expect(404);

      expect(h.store.getDisplayState()).toEqual(initialState);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(initialBytes);
      expect(pinnedEvents).toEqual([]);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects duplicate pinned channel ids without changing exposed or persisted state", async () => {
    const h = await harness();
    try {
      const focusedChannelId = h.store.getFocusedChannelId()!;
      const initialBytes = readFileSync(displayStatePath(h.storagePath), "utf8");
      const initialState = h.store.getDisplayState();
      const pinnedEvents: any[] = [];
      h.store.addEventListener("pinned-channels-changed", (event) => pinnedEvents.push(event));

      const response = await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        pinnedChannelIds: [focusedChannelId, focusedChannelId],
      }).expect(400);

      expect(response.body.error).toMatch(/must not contain duplicate channel ids/);
      expect(h.store.getDisplayState()).toEqual(initialState);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(initialBytes);
      expect(pinnedEvents).toEqual([]);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display is idempotent and rejects unknown channels, theme IDs, and fields", async () => {
    const h = await harness();
    try {
      const active = h.store.getFocusedChannelId();
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ focusedChannelId: active }).expect(204);
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ focusedChannelId: "missing" }).expect(404);
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "missing" }).expect(404);
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "../bad" }).expect(404);
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ unsupported: true }).expect(400);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("POST /display/focus resolves the owning channel and reports schema/error cases", async () => {
    const h = await harness();
    const target = path.join(h.storagePath, "focus.html");
    writeFileSync(target, "<!doctype html>");
    try {
      const channel = h.store.listChannels()[0]!;
      const artifact = h.store.createArtifact({ kind: "path", title: "A", path: target, channelID: channel.id });

      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: artifact.id }).expect(200).expect(({ body }) => expect(body).toEqual({ channelID: channel.id, artifactID: artifact.id }));
      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: "missing" }).expect(404);
      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: artifact.id, channelID: channel.id }).expect(400);
      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: artifact.id, extra: true }).expect(400);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("DELETE /channels selects the first pinned channel or newest unpinned channel when focus is removed", async () => {
    for (const successorKind of ["pinned", "unpinned"] as const) {
      const h = await harness();
      try {
        const focusedChannelId = h.store.getFocusedChannelId()!;
        const older = (await request(h.server.httpServer)
          .post("/channels")
          .set(h.authHeader)
          .send({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "Older" })
          .expect(201)).body.channel;
        const newer = (await request(h.server.httpServer)
          .post("/channels")
          .set(h.authHeader)
          .send({ id: "01BX5ZZKBKACTAV9WEVGEMMVRZ", name: "Newer" })
          .expect(201)).body.channel;
        const pinnedChannelIds = successorKind === "pinned" ? [older.id, newer.id] : [];
        const expectedFocusedChannelId = successorKind === "pinned" ? older.id : newer.id;
        await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
          focusedChannelId,
          pinnedChannelIds,
        }).expect(204);

        await request(h.server.httpServer).delete(`/channels/${focusedChannelId}`).set(h.authHeader).expect(200);

        const expected = {
          focusedChannelId: expectedFocusedChannelId,
          pinnedChannelIds,
          activeThemeName: null,
          appearanceMode: "system",
          themeJavaScriptConsentIds: [],
        };
        expect(h.store.getDisplayState()).toEqual({
          ...expected,
          activeThemeColorScheme: null,
        });
        expect(readDisplayState(h.storagePath)).toEqual(expected);
        await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
          expect(body).toMatchObject({
            ...expected,
            activeThemeColorScheme: null,
            acpEnabled: true,
          });
        });
      } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
    }
  });

  it("POST /channels focuses the new channel after deleting the sole channel", async () => {
    const h = await harness();
    try {
      const soleChannelId = h.store.getFocusedChannelId()!;
      await request(h.server.httpServer).delete(`/channels/${soleChannelId}`).set(h.authHeader).expect(200);
      const created = await request(h.server.httpServer)
        .post("/channels")
        .set(h.authHeader)
        .send({ name: "First again" })
        .expect(201);

      const expected = {
        focusedChannelId: created.body.channel.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      };
      expect(h.store.getDisplayState()).toEqual({
        ...expected,
        activeThemeColorScheme: null,
      });
      expect(readDisplayState(h.storagePath)).toEqual(expected);
      await request(h.server.httpServer).get("/display").set(h.authHeader).expect(200).expect(({ body }) => {
        expect(body).toMatchObject({
          ...expected,
          activeThemeColorScheme: null,
          acpEnabled: true,
        });
      });
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });



  it("PATCH /display persists ordered pins and non-default focus byte-stably across restart", async () => {
    const h = await harness();
    try {
      const firstPinned = h.store.createChannel({ name: "First pinned" });
      const focused = h.store.createChannel({ name: "Focused" });
      const secondPinned = h.store.createChannel({ name: "Second pinned" });
      seedThemePackage(h.storagePath, "paperlike", ":root{}");
      h.store.refreshThemeRegistry();
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: focused.id,
        pinnedChannelIds: [secondPinned.id, firstPinned.id],
        activeThemeName: "paperlike",
        appearanceMode: "system",
      }).expect(204);
      const persistedBytes = readFileSync(displayStatePath(h.storagePath), "utf8");
      expect(JSON.parse(persistedBytes)).toEqual({
        focusedChannelId: focused.id,
        pinnedChannelIds: [secondPinned.id, firstPinned.id],
        activeThemeName: "paperlike",
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
      await h.server.dispose();
      const restartedStore = createServingStore(h.storagePath);
      const restarted = new Server({ store: restartedStore, host: "127.0.0.1", port: 0, auth: true });
      await restarted.start();
      try {
        await request(restarted.httpServer).get("/display").set({ Authorization: `Bearer ${restartedStore.authToken}` }).expect(200).expect(({ body }) => {
          expect(body).toMatchObject({
            focusedChannelId: focused.id,
            pinnedChannelIds: [secondPinned.id, firstPinned.id],
            activeThemeName: "paperlike",
            appearanceMode: "system",
            acpEnabled: false,
          });
        });
        expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(persistedBytes);
      } finally {
        await restarted.dispose();
      }
    } finally { rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects an unknown channel", async () => {
    const h = await harness();
    try {
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ focusedChannelId: "missing" }).expect(404);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects an unknown theme", async () => {
    const h = await harness();
    try {
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "missing" }).expect(404);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects a traversal-shaped string as an unknown exact theme ID", async () => {
    const h = await harness();
    try {
      const response = await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ activeThemeName: "../bad" }).expect(404);
      expect(response.body).toEqual({ error: "Theme not found: ../bad" });
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("PATCH /display rejects unknown fields", async () => {
    const h = await harness();
    try {
      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({ unsupported: true }).expect(400);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("DELETE /channels allows removing the last remaining channel and leaves display focusedChannelId null", async () => {
    const h = await harness();
    try {
      const focusedChannelId = h.store.getFocusedChannelId()!;
      const channelEvents: any[] = [];
      h.store.addEventListener("channel-changed", (event) => channelEvents.push(event));
      await request(h.server.httpServer).delete(`/channels/${focusedChannelId}`).set(h.authHeader).expect(200);
      expect(channelEvents).toHaveLength(1);
      expect(channelEvents[0].channelID).toBeNull();
      expect(h.store.listChannels()).toHaveLength(0);
      expect(h.store.getDisplayState()).toEqual({
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: null,
        activeThemeColorScheme: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
      expect(readDisplayState(h.storagePath)).toEqual({
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      });
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("POST /display/focus rejects body without artifactID", async () => {
    const h = await harness();
    try {
      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({}).expect(400);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("POST /display/focus for an artifact on the active channel broadcasts only artifact-focus", async () => {
    const h = await harness();
    const target = path.join(h.storagePath, "active-focus.html");
    writeFileSync(target, "<!doctype html>");
    try {
      const focusedChannelId = h.store.getFocusedChannelId()!;
      const artifact = h.store.createArtifact({ kind: "path", title: "A", path: target, channelID: focusedChannelId });
      const persistedDisplayBefore = readFileSync(displayStatePath(h.storagePath), "utf8");
      const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=${h.store.authToken}`);
      const events: any[] = [];
      ws.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type !== "server-status") events.push(message);
      });
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));

      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: artifact.id }).expect(200).expect(({ body }) => {
        expect(body).toEqual({ channelID: focusedChannelId, artifactID: artifact.id });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();
      expect(events).toEqual([{ type: "artifact-focus", channelID: focusedChannelId, artifactID: artifact.id }]);
      expect(readFileSync(displayStatePath(h.storagePath), "utf8")).toBe(persistedDisplayBefore);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("POST /display/focus persists cross-channel focus before broadcasting artifact focus", async () => {
    const h = await harness(true);
    const target = path.join(h.storagePath, "ordered.html");
    writeFileSync(target, "<!doctype html>");
    try {
      const other = h.store.createChannel({ name: "Other" });
      const artifact = h.store.createArtifact({ kind: "path", title: "A", path: target, channelID: other.id });
      const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=${h.store.authToken}`);
      const events: any[] = [];
      const persistedDisplayAtDelivery: any[] = [];
      // Skip the connect-time server-status advertisement (owned by
      // version-advertisement.test.ts); these assert the domain stream.
      ws.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type !== "server-status") {
          events.push(message);
          persistedDisplayAtDelivery.push(readDisplayState(h.storagePath));
        }
      });
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: artifact.id }).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();
      expect(events.map((event) => event.type)).toEqual(["channel-changed", "artifact-focus"]);
      const expectedDisplay = {
        focusedChannelId: other.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        themeJavaScriptConsentIds: [],
      };
      expect(persistedDisplayAtDelivery).toEqual([expectedDisplay, expectedDisplay]);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("requires auth for display endpoints", async () => {
    const h = await harness(true);
    try {
      await request(h.server.httpServer).get("/display").expect(401);
      await request(h.server.httpServer).patch("/display").send({ focusedChannelId: null }).expect(401);
      await request(h.server.httpServer).post("/display/focus").send({ artifactID: "a" }).expect(401);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });

  it("broadcasts focus, ordered pins, theme, and artifact-focus events over /events", async () => {
    const h = await harness(true);
    const target = path.join(h.storagePath, "event.html");
    writeFileSync(target, "<!doctype html>");
    try {
      const other = h.store.createChannel({ name: "Other" });
      seedThemePackage(h.storagePath, "paperlike", ":root{}");
      h.store.refreshThemeRegistry();
      const artifact = h.store.createArtifact({ kind: "path", title: "A", path: target, channelID: other.id });
      const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=${h.store.authToken}`);
      const events: any[] = [];
      // Skip the connect-time server-status advertisement (owned by
      // version-advertisement.test.ts); these assert the domain stream.
      ws.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type !== "server-status") events.push(message);
      });
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));

      await request(h.server.httpServer).patch("/display").set(h.authHeader).send({
        focusedChannelId: other.id,
        pinnedChannelIds: [other.id],
        activeThemeName: "paperlike",
        appearanceMode: "system",
      }).expect(204);
      await request(h.server.httpServer).post("/display/focus").set(h.authHeader).send({ artifactID: artifact.id }).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws.close();

      expect(events).toEqual([
        { type: "channel-changed", channelID: other.id },
        { type: "pinned-channels-changed", pinnedChannelIds: [other.id] },
        {
          type: "theme-changed",
          themeName: "paperlike",
          activeThemeColorScheme: "light dark",
          themeJavaScriptConsentIds: [],
        },
        { type: "artifact-focus", channelID: other.id, artifactID: artifact.id },
      ]);
    } finally { await h.server.dispose(); rmSync(h.storagePath, { recursive: true, force: true }); }
  });
});
