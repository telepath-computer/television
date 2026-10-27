import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "./playwright.ts";
import { Server } from "@telepath-computer/television-server";
import { resolveACPAgentProfile } from "../../packages/server/src/config.ts";
import { createServingStore } from "./serving-store.ts";

/** Real HTTP, WebSockets and built app; ACP authentication is enabled without launching an agent. */
export async function launchIsolationServer() {
  const home = mkdtempSync(path.join(os.tmpdir(), "television-isolation-"));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const server = new Server({
    store: createServingStore(home), host: "127.0.0.1", port: 0, auth: true,
    staticDir: path.join(root, "packages/web/dist"),
    acpProfile: resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "hermes" }),
  });
  try { await server.start(); } catch (error) {
    await server.dispose();
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
  return {
    home, serverURL: server.getBaseURL(), token: server.getAuthToken(),
    async dispose() {
      await server.dispose();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Authored isolation input shared by the browser and production Electron preload walks. */
export function writeIsolationFixture(folder: string): string {
  cpSync(fileURLToPath(new URL("../fixtures/artifact-isolation", import.meta.url)), folder, { recursive: true });
  return `${folder}${path.sep}`;
}

export interface IsolationResults {
  activated: boolean;
  storage: Record<string, string>;
  parent?: Record<string, string>;
  topNavigation?: string;
  appFrame?: Record<string, string>;
  serviceWorker: string;
  http: Record<string, { fetch: string; xhr: string }>;
  sockets: Record<string, { messages: number; closeCode: number }>;
  post: { type: string; status: number };
  sentinel: { value?: string | null; error?: string };
  /** Desktop only: what the artifact's own storage, and the app page it frames, hold under the token and sentinel keys. */
  values?: { token: string | null; sentinel: string | null };
  appFrameValues?: { token: string | null; sentinel: string | null };
  desktop?: {
    globals: Record<string, string>;
    televisionGlobals: string[];
    bridgeKeys: string[];
    links: Record<string, boolean>;
    appWindow: boolean;
    selfWindow: boolean;
  };
}

export const INACCESSIBLE_WINDOW = { document: "SecurityError", storage: "SecurityError", address: "SecurityError" };
export const ACCESSIBLE_WINDOW = { document: "accessible", storage: "accessible", address: "accessible" };

const TOKEN_ROUTES = (artifactID: string) => ["/channels", "/artifacts", "/display", "/themes", `/markdown/${artifactID}`,
  "/telemetry", "/demo-mode", "/desktop/connect-check", "/api/resources/v1/resources"];

/**
 * The desktop app's walk, with the artifact unsandboxed in its partition: its
 * storage works but holds neither the token nor the sentinel, and the token
 * routes answer it readably, refusing it.
 */
export function expectDesktopIsolationEnforced(results: IsolationResults, artifactID: string, clicked: boolean, token: string): void {
  if (clicked) expect(results.activated).toBe(true);
  expect(results.storage).toEqual({
    localRead: "accessible", localWrite: "accessible",
    sessionRead: "accessible", sessionWrite: "accessible",
    cookieRead: "accessible", cookieWrite: "accessible", indexedDB: "accessible",
  });
  expect(results.sentinel).toEqual({ value: null });
  for (const values of [results.values, results.appFrameValues]) {
    expect(values?.sentinel).toBeNull();
    expect(values?.token ?? "").not.toContain(token);
  }
  expect(results.appFrame).toEqual(ACCESSIBLE_WINDOW);
  expect(results.serviceWorker).toBe("registered");
  expect(results.http).toEqual(Object.fromEntries(TOKEN_ROUTES(artifactID).flatMap((route) => ["absent", "guessed"].map((auth) =>
    [`${route} ${auth}`, { fetch: "readable:401", xhr: "readable:401" }]))));
  expect(results.sockets).toEqual(Object.fromEntries(["/events", "/acp"].flatMap((route) => ["absent", "guessed"].map((auth) =>
    [`${route} ${auth}`, { messages: 0, closeCode: 4401 }]))));
  expect(results.post).toEqual({ type: "basic", status: 401 });
}

/** Assert complete records: a skipped or crashed attempt must not look like a denial. */
export function expectIsolationEnforced(results: IsolationResults, artifactID: string, clicked: boolean): void {
  expect(results.sentinel).toEqual({ error: "SecurityError" });
  // Attempts made from the click hold user activation, so their refusals are
  // not for want of it. Activation on load is not checked: Firefox sometimes
  // reports it there before anything has been clicked.
  if (clicked) expect(results.activated).toBe(true);
  expect(results.storage).toEqual({
    localRead: "SecurityError", localWrite: "SecurityError",
    sessionRead: "SecurityError", sessionWrite: "SecurityError",
    cookieRead: "SecurityError", cookieWrite: "SecurityError", indexedDB: "SecurityError",
  });
  expect(results.serviceWorker).toMatch(/^(SecurityError|TypeError)$/);
  expect(results.http).toEqual(Object.fromEntries(TOKEN_ROUTES(artifactID).flatMap((route) => ["absent", "guessed"].map((auth) =>
    [`${route} ${auth}`, { fetch: "unreadable", xhr: "unreadable" }]))));
  expect(results.sockets).toEqual(Object.fromEntries(["/events", "/acp"].flatMap((route) => ["absent", "guessed"].map((auth) =>
    [`${route} ${auth}`, { messages: 0, closeCode: 4401 }]))));
  expect(results.post).toEqual({ type: "opaque", status: 0 });
}
