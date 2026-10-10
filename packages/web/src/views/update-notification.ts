import { copyButtonTemplate } from "./copy-button.ts";
import { View, view } from "@telepath-computer/utils/lit-view";
import {
  isNewerVersion,
  isReleaseVersion,
  type ClientSignalEventName,
  type UpdateState,
  type UpdateToast,
} from "@telepath-computer/television-shared";
import { html, nothing, type TemplateResult } from "lit-html";
import { ref, type RefOrCallback } from "lit-html/directives/ref.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { renderMarkdown } from "../markdown.ts";
import type { UpdatePresentationState } from "../services/update-presentation.ts";
import {
  DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY,
  DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN,
  RECOMMENDED_DESKTOP_VERSION,
  decideDesktopUpgradeRecommendation,
  type DesktopUpgradeRecommendationContext,
} from "../services/desktop-upgrade-recommendation.ts";
import {
  DESKTOP_SELF_UPDATE_DISMISSED_VERSION_KEY,
  desktopSelfUpdateNoticeMarkdown,
  type DesktopUpdateState,
} from "../services/desktop-update.ts";
import "../elements/icon.ts";
import "../elements/popover.ts";
import "./update-notification.css";

/** localStorage key of the dismissed channel version (^dismissal). */
export const DISMISSED_VERSION_KEY = "tv-update-dismissed";

/** Fixed interface copy authored by specs/ui/app/update-notification/content.yml. */
export const UPDATE_NOTIFICATION_COPY = {
  update_available: "Update available",
  copy_prompt: "Copy upgrade prompt",
  later: "Later",
  restart_to_update: "Restart to update",
  restarting: "Restarting…",
} as const;

const POPOVER_ID = "update-popover";

export interface UpdateNotificationTemplateOptions {
  /** Already-rendered notice body; the update markdown pipeline owns its production. */
  body: unknown;
  prompt?: string;
  copied?: boolean;
  /** The desktop self-update notice's restart button; absent, none renders. */
  restart?: "ready" | "restarting";
  /** Current presentation state supplied by the composing controller. */
  presented?: boolean;
  /** Direct-view commit hook used to synchronize the panel. */
  panelRef?: RefOrCallback<Element>;
  /** Direct-view commit hook for the bell, the panel's invoker (^po-invoker). */
  bellRef?: RefOrCallback<Element>;
  onPresent?: () => void;
  onDismiss?: () => void;
  onCopy?: () => void;
  onRestart?: () => void;
}

function isNoticeControl(event: KeyboardEvent, panel: HTMLElement): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest("button, a[href], input, select, textarea, [tabindex]");
  return control !== null && panel.contains(control);
}

/** Render the paired bell and manual popover update surface. */
export class UpdateNotification extends View<[UpdateNotificationTemplateOptions]> {
  #panel: Element | undefined;
  #observer: MutationObserver | undefined;
  #open = false;
  #onPresent: () => void = () => {};
  #onDismiss: () => void = () => {};

  disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#panel = undefined;
  }

  readonly #observePanel = (panel: Element | undefined): void => {
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#panel = panel;
    this.#open = panel?.hasAttribute("open") ?? false;
    if (!panel) return;
    this.#observer = new MutationObserver(() => {
      const open = panel.hasAttribute("open");
      if (open === this.#open) return;
      this.#open = open;
      if (open) this.#onPresent();
      else this.#onDismiss();
    });
    this.#observer.observe(panel, { attributes: true, attributeFilter: ["open"] });
  };

  template({
    body,
    prompt,
    copied = false,
    restart,
    panelRef,
    bellRef,
    onPresent = () => {},
    onDismiss = () => {},
    onCopy = () => {},
    onRestart = () => {},
  }: UpdateNotificationTemplateOptions): TemplateResult {
    this.#onPresent = onPresent;
    this.#onDismiss = onDismiss;
    const onLaterClick = (): void => { this.#panel?.removeAttribute("open"); };
    const onPanelKeydown = (event: KeyboardEvent): void => {
      const panel = event.currentTarget as HTMLElement;
      if (event.key !== "Escape" || !isNoticeControl(event, panel)) return;
      event.preventDefault();
      event.stopPropagation();
      panel.removeAttribute("open");
    };

    return html`
    <button
      class="update-bell"
      id="update-bell"
      icon
      intent="alert"
      aria-label=${UPDATE_NOTIFICATION_COPY.update_available}
      title=${UPDATE_NOTIFICATION_COPY.update_available}
      ${bellRef === undefined ? nothing : ref(bellRef)}
    >
      <tv-icon name="notification" size="sm"></tv-icon>
    </button>

    <tv-popover
      id=${POPOVER_ID}
      manual
      trigger="update-bell"
      role="status"
      class="update-popover"
      ${ref(this.#observePanel)}
      ${panelRef === undefined ? nothing : ref(panelRef)}
      @keydown=${onPanelKeydown}
    >
      ${body}
      <div class="update-actions">
        <button size="sm" class="update-later" @click=${onLaterClick}
          >${UPDATE_NOTIFICATION_COPY.later}</button
        >
        ${prompt === undefined
          ? nothing
          : copyButtonTemplate({
              label: UPDATE_NOTIFICATION_COPY.copy_prompt,
              prompt,
              intent: "primary",
              copied,
              onActivate: onCopy,
            })}
        ${restart === undefined
          ? nothing
          : html`<button
              size="sm"
              intent="primary"
              class="update-restart"
              ?disabled=${restart === "restarting"}
              @click=${onRestart}
            >${restart === "restarting"
              ? UPDATE_NOTIFICATION_COPY.restarting
              : UPDATE_NOTIFICATION_COPY.restart_to_update}</button>`}
      </div>
    </tv-popover>
    `;
  }
}

export const UpdateNotificationView = view(UpdateNotification);

/** The dismissal store; `null` disables persistence. */
export interface DismissalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The retained update-state slice read from the bundle-serving connection. */
export interface UpdateNotificationConnection {
  status: string;
  readonly serverVersion: string | null;
  readonly updateState: UpdateState | null;
  sendTelemetrySignal(event: ClientSignalEventName, properties: Record<string, string>): void;
}

// Variance escape hatch, as in update-reload.ts: the typed EventTarget's
// listener signatures are contravariant in the event union.
type AnyEventListener = (event: any) => void;

export interface UpdateNotificationConnectionOwner {
  readonly connection: UpdateNotificationConnection;
  addEventListener(type: "server-status" | "change", listener: AnyEventListener): void;
  removeEventListener(type: "server-status" | "change", listener: AnyEventListener): void;
}

/**
 * The dismissal comparison (^dismissal): auto-present iff nothing is
 * dismissed or the advertised version is strictly newer than the dismissed
 * one. A single last-dismissed value suffices because the channel moves
 * forward.
 */
export function shouldAutoPresent(toastVersion: string, dismissedVersion: string | null): boolean {
  if (dismissedVersion === null) return true;
  return isNewerVersion(toastVersion, dismissedVersion);
}

// `update_toast_shown` fires once per channel version per page load, however
// many times the view mounts or re-presents.
const signaledToastVersions = new Set<string>();

/** Test-only: clear the per-page-load `update_toast_shown` dedup ledger. */
export function resetUpdateToastSignalDedup(): void {
  signaledToastVersions.clear();
}

interface PendingSignal {
  event: ClientSignalEventName;
  properties: Record<string, string>;
}

export interface UpdateNotificationControllerOptions {
  connectionOwner?: UpdateNotificationConnectionOwner | null;
  presentation?: UpdatePresentationState | null;
  dismissalStorage?: DismissalStorage | null;
  desktopRecommendation?: DesktopUpgradeRecommendationContext | null;
  /** The page's desktop update state; its bridge reports downloaded updates. */
  desktopUpdate?: DesktopUpdateState | null;
}

type ActiveNotice =
  | { kind: "server"; version: string; markdown: string; prompt?: string; toast: UpdateToast }
  | { kind: "desktop-self-update"; version: string; markdown: string }
  | { kind: "recommendation"; version: string; markdown: string };

/**
 * Retained update policy for the directly composed top-bar view. Application
 * state remains on the owned connection; this controller holds only the
 * notice's transient presentation and its persistence/telemetry handoffs.
 */
export class UpdateNotificationController {
  #connectionOwner: UpdateNotificationConnectionOwner | null = null;
  #presentation: UpdatePresentationState | null = null;
  #desktopRecommendation: DesktopUpgradeRecommendationContext | null = null;
  #desktopUpdate: DesktopUpdateState | null = null;
  #dismissalStorage: DismissalStorage | null | undefined;
  #connected = false;
  #subscribed = false;
  #presentationSubscribed = false;
  #desktopUpdateSubscribed = false;
  #decidedNoticeKey: string | null = null;
  #presented = false;
  #clearCopiedOnRender = false;
  #panel: HTMLElement | null = null;
  #bell: HTMLElement | null = null;
  #panelSyncQueued = false;
  #pendingSignals: PendingSignal[] = [];
  readonly #onChange: () => void;

  constructor(onChange: () => void = () => {}) {
    this.#onChange = onChange;
  }

  get presented(): boolean {
    return this.#presented;
  }

  configure({
    connectionOwner = null,
    presentation = null,
    dismissalStorage,
    desktopRecommendation = null,
    desktopUpdate = null,
  }: UpdateNotificationControllerOptions): void {
    if (connectionOwner !== this.#connectionOwner) {
      this.#unsubscribe();
      this.#connectionOwner = connectionOwner;
      this.#subscribe();
    }
    if (presentation !== this.#presentation) {
      this.#unsubscribePresentation();
      this.#presentation = presentation;
      this.#subscribePresentation();
    }
    if (desktopUpdate !== this.#desktopUpdate) {
      this.#unsubscribeDesktopUpdate();
      this.#desktopUpdate = desktopUpdate;
      this.#subscribeDesktopUpdate();
    }
    this.#dismissalStorage = dismissalStorage;
    this.#desktopRecommendation = desktopRecommendation;
  }

  connect(): void {
    if (this.#connected) return;
    this.#connected = true;
    this.#subscribe();
    this.#subscribePresentation();
    this.#subscribeDesktopUpdate();
  }

  disconnect(): void {
    if (!this.#connected) return;
    this.#unsubscribe();
    this.#unsubscribePresentation();
    this.#unsubscribeDesktopUpdate();
    this.#connected = false;
    this.#panel = null;
    this.#bell = null;
  }

  template(): unknown {
    const suppressed = this.#presentation?.toastsSuppressed ?? false;
    const notice = this.#activeNotice(suppressed);
    const noticeKey = notice === null ? null : `${notice.kind}:${notice.version}`;

    if (notice === null) {
      this.#decidedNoticeKey = null;
      this.#presented = false;
      this.#clearCopiedOnRender = true;
    } else if (noticeKey !== this.#decidedNoticeKey) {
      this.#decidedNoticeKey = noticeKey;
      this.#presented = this.#shouldAutoPresent(notice);
      this.#clearCopiedOnRender = true;
      if (this.#presented && notice.kind === "server" && !suppressed) {
        this.#queueToastShown(notice.toast);
      }
    }

    if (notice === null || suppressed) {
      this.#presented = false;
      this.#clearCopiedOnRender = true;
      this.#requestPanelSync();
      return nothing;
    }

    const existingCopy = this.#panel?.querySelector<HTMLButtonElement>(".copy-button");
    const copied = this.#presented && !this.#clearCopiedOnRender &&
      existingCopy?.hasAttribute("copied") === true;
    const template = UpdateNotificationView({
      body: unsafeHTML(renderMarkdown(notice.markdown)),
      prompt: notice.kind === "server" ? notice.prompt : undefined,
      copied,
      restart: notice.kind !== "desktop-self-update"
        ? undefined
        : this.#desktopUpdate?.restarting ? "restarting" : "ready",
      presented: this.#presented,
      panelRef: this.#panelCommitted,
      bellRef: this.#bellCommitted,
      onPresent: this.#present,
      onDismiss: this.#dismiss,
      onCopy: this.#onCopy,
      onRestart: this.#onRestart,
    });
    this.#clearCopiedOnRender = false;
    this.#requestPanelSync();
    return template;
  }

  #dismissalStore(): DismissalStorage | null {
    if (this.#dismissalStorage !== undefined) return this.#dismissalStorage;
    return typeof localStorage === "undefined" ? null : localStorage;
  }

  #subscribe(): void {
    if (!this.#connected || this.#subscribed || this.#connectionOwner === null) return;
    this.#connectionOwner.addEventListener("server-status", this.#onOwnerNotification);
    this.#connectionOwner.addEventListener("change", this.#onOwnerNotification);
    this.#subscribed = true;
  }

  #unsubscribe(): void {
    if (!this.#subscribed || this.#connectionOwner === null) return;
    this.#connectionOwner.removeEventListener("server-status", this.#onOwnerNotification);
    this.#connectionOwner.removeEventListener("change", this.#onOwnerNotification);
    this.#subscribed = false;
  }

  #subscribePresentation(): void {
    if (!this.#connected || this.#presentationSubscribed || this.#presentation === null) return;
    this.#presentation.addEventListener("change", this.#onPresentationChange);
    this.#presentationSubscribed = true;
  }

  #unsubscribePresentation(): void {
    if (!this.#presentationSubscribed || this.#presentation === null) return;
    this.#presentation.removeEventListener("change", this.#onPresentationChange);
    this.#presentationSubscribed = false;
  }

  // The surface subscribes to the bridge's report when it mounts, which is
  // after the gate has allowed normal boot (^desktop-self-update-notice-evaluation).
  #subscribeDesktopUpdate(): void {
    if (!this.#connected || this.#desktopUpdateSubscribed || this.#desktopUpdate === null) return;
    this.#desktopUpdate.addEventListener("change", this.#onPresentationChange);
    this.#desktopUpdate.subscribe();
    this.#desktopUpdateSubscribed = true;
  }

  #unsubscribeDesktopUpdate(): void {
    if (!this.#desktopUpdateSubscribed || this.#desktopUpdate === null) return;
    this.#desktopUpdate.removeEventListener("change", this.#onPresentationChange);
    this.#desktopUpdateSubscribed = false;
  }

  #onPresentationChange = (): void => {
    this.#onChange();
  };

  #onOwnerNotification = (): void => {
    this.#flushPendingSignals();
    this.#onChange();
  };

  #connection(): UpdateNotificationConnection | null {
    return this.#connectionOwner?.connection ?? null;
  }

  #activeNotice(suppressed: boolean): ActiveNotice | null {
    const updateState = this.#connection()?.updateState ?? null;
    const toast = updateState?.toast ?? null;
    if (toast !== null) {
      return {
        kind: "server",
        version: toast.version,
        markdown: toast.markdown,
        ...(toast.prompt === undefined ? {} : { prompt: toast.prompt }),
        toast,
      };
    }

    // After the server notice, before the recommendation
    // (^desktop-self-update-notice-precedence). The two desktop notices never apply to
    // the same app.
    const downloadedVersion = suppressed ? null : this.#desktopUpdate?.version ?? null;
    if (downloadedVersion !== null) {
      return {
        kind: "desktop-self-update",
        version: downloadedVersion,
        markdown: desktopSelfUpdateNoticeMarkdown(downloadedVersion),
      };
    }

    const recommendation = this.#desktopRecommendation;
    if (
      recommendation !== null &&
      decideDesktopUpgradeRecommendation({
        ...recommendation,
        noticesSuppressed: suppressed,
        updateState,
      })
    ) {
      return {
        kind: "recommendation",
        version: RECOMMENDED_DESKTOP_VERSION,
        markdown: DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN,
      };
    }
    return null;
  }

  #dismissalKey(notice: ActiveNotice): string {
    switch (notice.kind) {
      case "server":
        return DISMISSED_VERSION_KEY;
      case "desktop-self-update":
        return DESKTOP_SELF_UPDATE_DISMISSED_VERSION_KEY;
      case "recommendation":
        return DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY;
    }
  }

  // The server notice and the recommendation present again only for a newer
  // release version. A downloaded update is compared for equality: its
  // version need not be a release version, and a different download may be
  // a lower release (^desktop-self-update-notice-dismissal).
  #shouldAutoPresent(notice: ActiveNotice): boolean {
    const stored = this.#dismissalStore()?.getItem(this.#dismissalKey(notice)) ?? null;
    if (notice.kind === "desktop-self-update") return stored !== notice.version;
    return shouldAutoPresent(notice.version, stored !== null && isReleaseVersion(stored) ? stored : null);
  }

  #queueToastShown(toast: UpdateToast): void {
    if (signaledToastVersions.has(toast.version)) return;
    signaledToastVersions.add(toast.version);
    this.#queueSignal("update_toast_shown", toast);
  }

  #queueSignal(event: ClientSignalEventName, toast: UpdateToast): void {
    this.#pendingSignals.push({
      event,
      properties: {
        server_version: this.#connection()?.serverVersion ?? "",
        channel_version: toast.version,
      },
    });
    this.#flushPendingSignals();
  }

  #flushPendingSignals(): void {
    if (this.#pendingSignals.length === 0) return;
    const connection = this.#connection();
    if (!connection || connection.status !== "connected") return;
    const signals = this.#pendingSignals;
    this.#pendingSignals = [];
    for (const signal of signals) {
      connection.sendTelemetrySignal(signal.event, signal.properties);
    }
  }

  #present = (): void => {
    const notice = this.#activeNotice(this.#presentation?.toastsSuppressed ?? false);
    if (notice === null || this.#presented) return;
    this.#presented = true;
    if (notice.kind === "server") this.#queueToastShown(notice.toast);
    this.#onChange();
  };

  #dismiss = (): void => {
    if (!this.#presented) return;
    const notice = this.#activeNotice(this.#presentation?.toastsSuppressed ?? false);
    if (notice !== null) {
      this.#dismissalStore()?.setItem(this.#dismissalKey(notice), notice.version);
    }
    this.#presented = false;
    this.#clearCopiedOnRender = true;
    this.#onChange();
  };

  #onRestart = (): void => {
    this.#desktopUpdate?.restart();
  };

  #onCopy = (): void => {
    const notice = this.#activeNotice(this.#presentation?.toastsSuppressed ?? false);
    if (notice?.kind !== "server" || notice.prompt === undefined) return;
    this.#queueSignal("update_prompt_copy_clicked", notice.toast);
  };

  #panelCommitted = (element: Element | undefined): void => {
    this.#panel = element instanceof HTMLElement ? element : null;
    this.#requestPanelSync();
  };

  #bellCommitted = (element: Element | undefined): void => {
    this.#bell = element instanceof HTMLElement ? element : null;
    this.#requestPanelSync();
  };

  #requestPanelSync(): void {
    if (this.#panelSyncQueued) return;
    this.#panelSyncQueued = true;
    queueMicrotask(() => {
      this.#panelSyncQueued = false;
      this.#syncPanel();
    });
  }

  #syncPanel(): void {
    const panel = this.#panel;
    if (panel === null) return;
    if (this.#presented && this.#bell === null) return;
    panel.toggleAttribute("open", this.#presented);
  }
}
