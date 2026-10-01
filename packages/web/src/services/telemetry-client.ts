import {
  TELEMETRY_ACTIVITY_MESSAGE_TYPE,
  type ClientTelemetryMeta,
  type TelemetryActivitySignal,
} from "@telepath-computer/television-shared";
import { ulid } from "ulid";
import type { StorageLike } from "./acp-session-store.ts";

export const CLIENT_ID_KEY = "tv.telemetry.clientId";

const ACTIVITY_DEBOUNCE_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
export const ACTIVITY_DEBOUNCE_MS = ACTIVITY_DEBOUNCE_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

const ACTIVITY_EVENT_TYPES = ["pointerdown", "scroll", "keydown"] as const;
const WINDOW_ACTIVE_EVENT_TYPES = ["focus"] as const;
const DOCUMENT_ACTIVE_EVENT_TYPES = ["visibilitychange"] as const;
const BACKGROUNDED_VISIBILITY_STATE = "hidden";

export type ClientIdFactory = () => string;

export interface BuildClientTelemetryMetaOptions {
  storage: StorageLike;
  clientApp: ClientTelemetryMeta["clientApp"];
  userAgent?: string;
  desktopAppVersion?: string | null;
  idFactory?: ClientIdFactory;
}

export interface TelemetryActivityEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface TelemetryActivityDocumentTarget extends TelemetryActivityEventTarget {
  readonly visibilityState: string;
}

export interface TelemetryActivityAgentOptions {
  meta: ClientTelemetryMeta;
  documentTarget: TelemetryActivityDocumentTarget;
  windowTarget: TelemetryActivityEventTarget;
  send(signal: TelemetryActivitySignal): void;
  nowMs?: () => number;
}

export interface TelemetryActivityAgent {
  start(): void;
  stop(): void;
}

export function getOrCreateTelemetryClientId(storage: StorageLike, idFactory: ClientIdFactory = defaultClientIdFactory): string {
  const existing = storage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  const next = idFactory();
  storage.setItem(CLIENT_ID_KEY, next);
  return next;
}

export function buildClientTelemetryMeta(options: BuildClientTelemetryMetaOptions): ClientTelemetryMeta {
  const clientId = getOrCreateTelemetryClientId(options.storage, options.idFactory);
  return {
    clientId,
    userAgent: options.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent),
    clientApp: options.clientApp,
    ...(options.desktopAppVersion ? { desktopAppVersion: options.desktopAppVersion } : {}),
  };
}

export function encodeClientTelemetryMetaSearchParams(meta: ClientTelemetryMeta): URLSearchParams {
  const params = new URLSearchParams();
  params.set("clientId", meta.clientId);
  params.set("userAgent", meta.userAgent);
  params.set("clientApp", meta.clientApp);
  if (meta.desktopAppVersion) params.set("desktopAppVersion", meta.desktopAppVersion);
  return params;
}

export function createTelemetryActivityAgent(options: TelemetryActivityAgentOptions): TelemetryActivityAgent {
  return new BrowserTelemetryActivityAgent(options);
}

class BrowserTelemetryActivityAgent implements TelemetryActivityAgent {
  readonly #meta: ClientTelemetryMeta;
  readonly #documentTarget: TelemetryActivityDocumentTarget;
  readonly #windowTarget: TelemetryActivityEventTarget;
  readonly #send: (signal: TelemetryActivitySignal) => void;
  readonly #nowMs: () => number;
  readonly #handleActivity: () => void;
  #started = false;
  #lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(options: TelemetryActivityAgentOptions) {
    this.#meta = options.meta;
    this.#documentTarget = options.documentTarget;
    this.#windowTarget = options.windowTarget;
    this.#send = options.send;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#handleActivity = () => this.#recordActivity();
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    for (const type of ACTIVITY_EVENT_TYPES) {
      this.#windowTarget.addEventListener(type, this.#handleActivity);
      this.#documentTarget.addEventListener(type, this.#handleActivity);
    }
    for (const type of WINDOW_ACTIVE_EVENT_TYPES) this.#windowTarget.addEventListener(type, this.#handleActivity);
    for (const type of DOCUMENT_ACTIVE_EVENT_TYPES) this.#documentTarget.addEventListener(type, this.#handleActivity);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    for (const type of ACTIVITY_EVENT_TYPES) {
      this.#windowTarget.removeEventListener(type, this.#handleActivity);
      this.#documentTarget.removeEventListener(type, this.#handleActivity);
    }
    for (const type of WINDOW_ACTIVE_EVENT_TYPES) this.#windowTarget.removeEventListener(type, this.#handleActivity);
    for (const type of DOCUMENT_ACTIVE_EVENT_TYPES) this.#documentTarget.removeEventListener(type, this.#handleActivity);
  }

  #recordActivity(): void {
    if (this.#documentTarget.visibilityState === BACKGROUNDED_VISIBILITY_STATE) return;
    const now = this.#nowMs();
    if (now - this.#lastSentAt < ACTIVITY_DEBOUNCE_MS) return;
    this.#lastSentAt = now;
    this.#send({ type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: this.#meta.clientId });
  }
}

function defaultClientIdFactory(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : ulid().toLowerCase();
}
