import {
  dialogTemplate,
  type DialogPresentation,
  presentDialog,
} from "./dialog.ts";
import {
  MenuView,
  type MenuEntry,
} from "./menu.ts";
import { html, nothing } from "lit-html";
import { createRef, ref, type Ref } from "lit-html/directives/ref.js";
import { repeat } from "lit-html/directives/repeat.js";
import { styleMap } from "lit-html/directives/style-map.js";
import {
  calculateChannelSidebarPlacement,
  type ChannelSidebarDragSource,
  type ChannelSidebarMembership,
  type ChannelSidebarPlacement,
  type ChannelSidebarRect,
} from "../components/channel-sidebar-placement.ts";
import type {
  ApplicationChannelSnapshot,
  ApplicationSnapshot,
} from "../services/application-service.ts";
import { focusOption } from "../elements/option-navigation.js";
import "../elements/icon.ts";
import "./channel-sidebar.css";
import "./channel-sidebar.drag.css";
import {
  DRAG_AUTOSCROLL_SPEED_PX_S,
  DRAG_AUTOSCROLL_ZONE_PX,
  DRAG_DISPLACEMENT_DURATION_MS,
  DRAG_PRESS_THRESHOLD_PX,
} from "./drag-measurements.ts";
const ROW_DISPLACEMENT_EASING = "ease";
const SCROLL_EDGE_TOLERANCE_PX = 0.5;
const LAYOUT_TOLERANCE_PX = 0.5;
const NEW_CHANNEL_NAME = "New channel";
const LIVE_CHANNEL_ROW_SELECTOR =
  ".channel-group:not(.channel-group-withdrawal) .channel-row";
// Keeps a compact carried preview under a far-edge grab. This is a local
// geometry detail shared with the authored staging interaction, not a spec measure.
const COMPACT_PREVIEW_GRIP_MARGIN_PX = 24;

export interface ChannelSidebarApplication {
  focusChannel(channelId: string): Promise<void>;
  setPinnedChannelIds(channelIds: readonly string[]): Promise<void>;
  renameChannel(channelId: string, name: string): Promise<void>;
  createChannel(name: string): Promise<{ readonly id: string }>;
  deleteChannel(channelId: string): Promise<void>;
}

interface ChannelRow {
  readonly channel: ApplicationChannelSnapshot;
  readonly pinned: boolean;
  readonly selected: boolean;
}

interface CreateRequest {
  resultChannelId: string | null;
}

interface DeleteTarget {
  readonly channelId: string;
  readonly name: string;
}

interface DepartingChannel {
  readonly row: ChannelRow;
  readonly side: "pinned" | "unpinned";
  readonly index: number;
}

export interface ChannelSidebarGripInput {
  readonly wideRow: ChannelSidebarRect;
  readonly compactPreviewWidth: number;
  readonly pointer: { readonly x: number; readonly y: number };
}

export interface ChannelSidebarGrip {
  readonly wideOffsetX: number;
  readonly previewOffsetX: number;
  readonly correctionX: number;
  readonly offsetY: number;
}

interface PressedChannel {
  readonly channelId: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly source: ChannelSidebarDragSource;
  readonly captureTarget: HTMLElement;
}

interface DraggingChannel extends PressedChannel {
  placement: ChannelSidebarPlacement;
  currentX: number;
  currentY: number;
  readonly grip: ChannelSidebarGrip;
  readonly rowWidth: number;
  readonly rowHeight: number;
  readonly originPinnedContentBottom: number | null;
  readonly originUnpinnedGroupTop: number | null;
  readonly displacementAnimations: Set<Animation>;
  edgeScrollFrame: number;
  edgeScrollTimestamp: number | null;
  edgeScrollRemainder: number;
  completed: boolean;
  operation: readonly string[] | null;
  operationResolved: boolean;
  operationRejected: boolean;
  restorationQueued: boolean;
}

interface DragPosition {
  readonly left: number;
  readonly top: number;
}

interface DragGroupLayout extends DragPosition {
  readonly width: number;
  readonly height: number;
  readonly withdrawal: HTMLElement;
}

interface DragLayout {
  readonly rows: ReadonlyMap<string, DragPosition>;
  readonly groups: ReadonlyMap<"pinned" | "unpinned", DragGroupLayout>;
}

type DragGroupEntry =
  | { readonly kind: "row"; readonly row: ChannelRow }
  | { readonly kind: "placeholder"; readonly key: string };

export interface ChannelListOptions {
  /** Row menus expose the shared rename, pin/unpin, and delete actions. */
  readonly management: boolean;
  /** Both list hosts share drag arrangement. */
  readonly dragging?: boolean;
  /** Switcher rows stay in view when a menu action moves them between groups. */
  readonly revealMovedRow?: boolean;
  /** The host may suspend its panel while the shared delete dialog is shown. */
  readonly onDeleteStart?: (channelId: string) => void;
  readonly onDeleteEnd?: (channelId: string, deleted: boolean) => void;
  /** A host-specific selection path, used by the collapsed switcher. */
  readonly selectChannel?: (channelId: string) => void;
  /** Pointer movement carries the switcher's singular keyboard highlight. */
  readonly highlightOnPointerMove?: boolean;
  /** The shell transition owns all visible motion while this is true. */
  readonly motionSuppressed?: boolean;
}

/** Shared channel-list rendering and interaction state for each list host. */
export class ChannelListController {
  readonly #renderHost: () => void;
  #application: ChannelSidebarApplication | null = null;
  #snapshot: ApplicationSnapshot | null = null;
  #options: ChannelListOptions = { management: true };
  #motionSuppressed = false;
  #renamingChannelId: string | null = null;
  #renameValue = "";
  #renameSettling = false;
  #pressed: PressedChannel | null = null;
  #dragging: DraggingChannel | null = null;
  #suppressPointerClick = false;
  #createRequest: CreateRequest | null = null;
  #enteringChannelId: string | null = null;
  #deleteTarget: DeleteTarget | null = null;
  #deleteRequestId: string | null = null;
  #departingChannel: DepartingChannel | null = null;
  #createAnimation: Animation | null = null;
  #deleteAnimation: Animation | null = null;
  #dialogPresentation: DialogPresentation | null = null;
  #listRef: Ref<HTMLElement> = createRef();
  #renameRef: Ref<HTMLInputElement> = createRef();
  #deleteAlertRef: Ref<HTMLElement> = createRef();
  #pendingReveal: { channelId: string; pinned: boolean; focus: boolean } | null = null;

  constructor(renderHost: () => void) {
    this.#renderHost = renderHost;
  }

  get creating(): boolean {
    return this.#createRequest !== null;
  }

  get dragging(): boolean {
    return this.#dragging !== null;
  }

  connect(): void {
    window.addEventListener("pointermove", this.#handlePointerMove);
    window.addEventListener("pointerup", this.#handlePointerUp);
    window.addEventListener("pointercancel", this.#handlePointerCancel);
    window.addEventListener("lostpointercapture", this.#handleLostPointerCapture);
    window.addEventListener("keydown", this.#handleWindowKeyDown, true);
    window.addEventListener("click", this.#handleDragClick, true);
    window.addEventListener("pointerdown", this.#resetDragClick, true);
  }

  update(
    application: ChannelSidebarApplication,
    snapshot: ApplicationSnapshot,
    options: ChannelListOptions,
  ): void {
    const previousSnapshot = this.#snapshot;
    const wasMotionSuppressed = this.#motionSuppressed;
    this.#application = application;
    this.#snapshot = snapshot;
    this.#options = options;
    this.#motionSuppressed = options.motionSuppressed ?? false;
    if (!wasMotionSuppressed && this.#motionSuppressed) {
      this.#settleOwnedMotionForSuppression();
    }
    this.#invalidateChangedMembership(snapshot);
    this.#synchronizeCreateMotion(snapshot);
    this.#synchronizeDeleteMotion(previousSnapshot, snapshot);
    if (
      this.#renamingChannelId !== null &&
      !snapshot.channels.some(({ id }) => id === this.#renamingChannelId)
    ) {
      this.#renamingChannelId = null;
      this.#renameValue = "";
    }

    this.#synchronizeCompletedDrag(snapshot);
    const reveal = this.#pendingReveal;
    if (reveal !== null && snapshot.display.pinnedChannelIds.includes(reveal.channelId) === reveal.pinned) {
      this.#pendingReveal = null;
      queueMicrotask(() => {
        const option = this.#channelOption(reveal.channelId);
        option?.scrollIntoView({ block: "nearest" });
        if (reveal.focus) option?.focus({ preventScroll: true });
      });
    }
    if (wasMotionSuppressed && !this.#motionSuppressed) {
      this.#resumeDeferredRowMotion();
    }
  }

  template(): unknown {
    const snapshot = this.#snapshot;
    if (snapshot === null) return nothing;
    const rows = this.#includeDepartingChannel(channelRows(
      snapshot,
      this.#dragging?.source,
    ));
    return html`
      <div
        class="channel-list"
        role="listbox"
        aria-label="Channels"
        ${ref(this.#listRef)}
      >
        ${this.#groupTemplate("Pinned", rows.pinned)}
        ${this.#groupTemplate("Recent", rows.unpinned)}
      </div>
    `;
  }

  overlayTemplate(): unknown {
    return this.#options.management ? this.#deleteConfirmationTemplate() : nothing;
  }

  disconnect(): void {
    window.removeEventListener("pointermove", this.#handlePointerMove);
    window.removeEventListener("pointerup", this.#handlePointerUp);
    window.removeEventListener("pointercancel", this.#handlePointerCancel);
    window.removeEventListener("lostpointercapture", this.#handleLostPointerCapture);
    window.removeEventListener("keydown", this.#handleWindowKeyDown, true);
    window.removeEventListener("click", this.#handleDragClick, true);
    window.removeEventListener("pointerdown", this.#resetDragClick, true);
    this.#clearDragImmediately();
    this.#dialogPresentation?.withdraw();
    this.#dialogPresentation = null;
    this.#createAnimation?.cancel();
    this.#createAnimation = null;
    this.#deleteAnimation?.cancel();
    this.#deleteAnimation = null;
    this.#application = null;
    this.#snapshot = null;
    this.#renamingChannelId = null;
    this.#renameValue = "";
    this.#renameSettling = false;
    this.#pressed = null;
    this.#suppressPointerClick = false;
    this.#createRequest = null;
    this.#enteringChannelId = null;
    this.#deleteTarget = null;
    this.#deleteRequestId = null;
    this.#departingChannel = null;
    this.#pendingReveal = null;
  }

  #groupTemplate(label: "Pinned" | "Recent", rows: readonly ChannelRow[]) {
    const side = label === "Pinned" ? "pinned" : "unpinned";
    const dragging = this.#dragging;
    if (dragging === null && rows.length === 0) return null;

    const carried = dragging === null
      ? undefined
      : rows.find(({ channel }) => channel.id === dragging.channelId);
    const flowRows = dragging === null
      ? rows
      : rows.filter(({ channel }) => channel.id !== dragging.channelId);
    const placeholder = dragging?.placement.kind === "placement" &&
        dragging.placement.placeholder?.side === side
      ? dragging.placement.placeholder
      : null;
    const entries: DragGroupEntry[] = flowRows.map((row) => ({ kind: "row", row }));
    if (placeholder !== null) {
      entries.splice(placeholder.index, 0, {
        kind: "placeholder",
        key: `channel-placeholder-${side}`,
      });
    }
    if (carried !== undefined) entries.push({ kind: "row", row: carried });
    const collapsed = dragging !== null && flowRows.length === 0 && placeholder === null;

    return html`
      <div
        class="channel-group"
        role="group"
        aria-labelledby=${`channel-group-${side}`}
        data-channel-side=${side}
        ?drag-collapsed=${collapsed}
      >
        <div class="channel-group-label" id=${`channel-group-${side}`}>${label}</div>
        ${repeat(
          entries,
          (entry) => entry.kind === "row" ? entry.row.channel.id : entry.key,
          (entry) => entry.kind === "row"
            ? this.#rowTemplate(entry.row)
            : html`
                <span
                  class="channel-placeholder"
                  aria-hidden="true"
                  data-channel-side=${side}
                  data-channel-index=${placeholder?.index ?? 0}
                  style=${styleMap({ height: `${dragging?.rowHeight ?? 0}px` })}
                ></span>
              `,
        )}
      </div>
    `;
  }

  #rowTemplate(row: ChannelRow) {
    const { channel, pinned, selected } = row;
    const dragging = this.#dragging?.channelId === channel.id ? this.#dragging : null;
    const unpinning = dragging !== null && pinned &&
      dragging.placement.kind === "placement" &&
      dragging.placement.side === "unpinned";
    const renaming = channel.id === this.#renamingChannelId;
    return html`
      <div
        class=${`channel-row${dragging !== null ? " dragged" : ""}${unpinning ? " unpinning" : ""}`}
        data-channel-id=${channel.id}
        style=${styleMap(dragging === null
          ? {}
          : {
              left: `${dragging.currentX - dragging.grip.previewOffsetX}px`,
              top: `${dragging.currentY - dragging.grip.offsetY}px`,
              width: `${dragging.rowWidth}px`,
              height: `${dragging.rowHeight}px`,
            })}
      >
        ${unpinning
          ? html`
              <span class="channel-drag-action" aria-hidden="true">
                <tv-icon name="unpin"></tv-icon>
                Unpin
              </span>
            `
          : null}
        ${renaming
          ? html`
              <input
                class="channel-rename"
                aria-label="Channel name"
                .value=${this.#renameValue}
                @input=${this.#handleRenameInput}
                @keydown=${this.#handleRenameKeyDown}
                @blur=${this.#handleRenameBlur}
                ${ref(this.#renameRef)}
              />
              <button
                class="channel-rename-commit"
                variant="ghost"
                icon
                size="sm"
                type="button"
                tabindex="-1"
                aria-label="Rename"
                @pointerdown=${this.#handleRenameCommitPress}
              >
                <tv-icon name="check"></tv-icon>
              </button>
            `
          : html`
              <div
                class="channel"
                role="option"
                tabindex="-1"
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  (event.currentTarget as HTMLElement).click();
                }}
                @pointermove=${this.#handleOptionPointerMove}
                aria-selected=${selected ? "true" : nothing}
                @pointerdown=${(event: PointerEvent) =>
                  (this.#options.dragging ?? this.#options.management)
                    ? this.#handlePointerDown(channel.id, event)
                    : undefined}
                @click=${(event: MouseEvent) =>
                  this.#handleChannelClick(channel.id, event)}
              >
                ${channel.name}
              </div>
              ${this.#options.management
                ? MenuView(this.#menuEntries(row), {
                    trigger: (id) => html`
                      <button
                        class="channel-menu-trigger"
                        variant="ghost"
                        icon
                        size="sm"
                        type="button"
                        tabindex="-1"
                        id=${id}
                        aria-haspopup="menu"
                        title=${`${channel.name} menu`}
                      >
                        <tv-icon name="expand"></tv-icon>
                      </button>
                    `,
                  })
                : nothing}
            `}
      </div>
    `;
  }

  #menuEntries(row: ChannelRow): readonly MenuEntry[] {
    const { channel, pinned } = row;
    return [
      {
        label: "Rename",
        action: () => this.#beginRename(channel.id),
      },
      {
        label: pinned ? "Unpin" : "Pin",
        action: () => this.#setPinned(channel.id, !pinned),
      },
      { separator: true },
      {
        label: "Delete",
        destructive: true,
        action: () => this.#showDeleteConfirmation(channel.id, channel.name),
      },
    ];
  }

  readonly create = (): void => {
    const application = this.#application;
    const snapshot = this.#snapshot;
    if (application === null || snapshot === null || this.#createRequest !== null) return;

    const request: CreateRequest = { resultChannelId: null };
    this.#createRequest = request;
    this.#renderHost();
    void application.createChannel(NEW_CHANNEL_NAME).then(
      (channel) => {
        request.resultChannelId = channel.id;
        void application.focusChannel(channel.id).catch(() => {});
        if (this.#createRequest === request) this.#renderHost();
      },
      () => {
        if (this.#createRequest !== request || this.#enteringChannelId !== null) return;
        this.#createRequest = null;
        this.#renderHost();
      },
    );
  };

  #synchronizeCreateMotion(snapshot: ApplicationSnapshot): void {
    const request = this.#createRequest;
    if (request === null || this.#enteringChannelId !== null) return;

    if (request.resultChannelId === null) return;
    const acknowledged = snapshot.channels.find(
      ({ id }) => id === request.resultChannelId,
    );
    if (acknowledged === undefined) return;

    this.#enteringChannelId = acknowledged.id;
    queueMicrotask(() => this.#startRowMotion("create", acknowledged.id));
  }

  #showDeleteConfirmation(channelId: string, name: string): void {
    if (this.#deleteTarget !== null || this.#deleteRequestId !== null) return;
    this.#hideMenu(channelId);
    this.#deleteTarget = { channelId, name };
    this.#options.onDeleteStart?.(channelId);
    this.#renderHost();
    const dialog = this.#deleteAlertRef.value?.closest("dialog");
    if (!(dialog instanceof HTMLDialogElement)) return;
    this.#dialogPresentation = presentDialog(dialog, () => {
      this.#dismissDeleteConfirmation();
    });
    this.#deleteAlertRef.value
      ?.querySelector<HTMLButtonElement>(".dialog-actions button")
      ?.focus();
  }

  #dismissDeleteConfirmation(confirmed = false): void {
    const target = this.#deleteTarget;
    const presentation = this.#dialogPresentation;
    this.#dialogPresentation = null;
    this.#deleteTarget = null;
    presentation?.withdraw();
    this.#renderHost();
    if (!confirmed && target !== null) this.#options.onDeleteEnd?.(target.channelId, false);
  }

  #confirmDelete(): void {
    const application = this.#application;
    const target = this.#deleteTarget;
    if (application === null || target === null || this.#deleteRequestId !== null) return;
    this.#deleteRequestId = target.channelId;
    this.#dismissDeleteConfirmation(true);
    const onDeleteEnd = this.#options.onDeleteEnd;
    void application.deleteChannel(target.channelId).then(() => {
      onDeleteEnd?.(target.channelId, true);
    }).catch(() => {
      if (this.#deleteRequestId === target.channelId && this.#departingChannel === null) {
        this.#deleteRequestId = null;
        this.#renderHost();
      }
      onDeleteEnd?.(target.channelId, false);
    });
  }

  #deleteConfirmationTemplate(): unknown {
    const target = this.#deleteTarget;
    if (target === null) return null;
    return dialogTemplate(html`
      <div
        class="dialog-alert channel-delete-alert"
        role="alertdialog"
        aria-labelledby="channel-delete-title"
        aria-describedby="channel-delete-body"
        ${ref(this.#deleteAlertRef)}
      >
        <h2 id="channel-delete-title">Delete “${target.name}”?</h2>
        <p id="channel-delete-body">
          This will permanently delete this channel from Television.
        </p>
        <div class="dialog-actions">
          <button type="button" autofocus @click=${() => this.#dismissDeleteConfirmation()}>
            Cancel
          </button>
          <button type="button" intent="danger" @click=${() => this.#confirmDelete()}>
            Delete
          </button>
        </div>
      </div>
    `);
  }

  #synchronizeDeleteMotion(
    previousSnapshot: ApplicationSnapshot | null,
    snapshot: ApplicationSnapshot,
  ): void {
    if (
      this.#deleteTarget !== null &&
      !snapshot.channels.some(({ id }) => id === this.#deleteTarget?.channelId)
    ) {
      const target = this.#deleteTarget;
      this.#dialogPresentation?.withdraw();
      this.#dialogPresentation = null;
      this.#deleteTarget = null;
      queueMicrotask(() => this.#options.onDeleteEnd?.(target.channelId, true));
    }

    const departing = this.#departingChannel;
    if (
      departing !== null &&
      snapshot.channels.some(({ id }) => id === departing.row.channel.id)
    ) {
      this.#deleteAnimation?.cancel();
      this.#deleteAnimation = null;
      this.#departingChannel = null;
      this.#deleteRequestId = null;
      return;
    }

    const channelId = this.#deleteRequestId;
    if (channelId === null || departing !== null) return;
    if (snapshot.channels.some(({ id }) => id === channelId)) return;
    if (previousSnapshot === null) {
      this.#deleteRequestId = null;
      return;
    }

    const previous = channelRows(previousSnapshot);
    const pinnedIndex = previous.pinned.findIndex(({ channel }) => channel.id === channelId);
    const unpinnedIndex = previous.unpinned.findIndex(({ channel }) => channel.id === channelId);
    const row = pinnedIndex >= 0
      ? previous.pinned[pinnedIndex]
      : previous.unpinned[unpinnedIndex];
    if (row === undefined) {
      this.#deleteRequestId = null;
      return;
    }
    this.#departingChannel = {
      row: { ...row, selected: false },
      side: pinnedIndex >= 0 ? "pinned" : "unpinned",
      index: pinnedIndex >= 0 ? pinnedIndex : unpinnedIndex,
    };
    queueMicrotask(() => this.#startRowMotion("delete", channelId));
  }

  #includeDepartingChannel(rows: {
    pinned: readonly ChannelRow[];
    unpinned: readonly ChannelRow[];
  }): { pinned: readonly ChannelRow[]; unpinned: readonly ChannelRow[] } {
    const departing = this.#departingChannel;
    if (departing === null) return rows;
    const side = [...rows[departing.side]];
    if (!side.some(({ channel }) => channel.id === departing.row.channel.id)) {
      side.splice(departing.index, 0, departing.row);
    }
    return { ...rows, [departing.side]: side };
  }

  #startRowMotion(kind: "create" | "delete", channelId: string): void {
    if (
      (kind === "create" && this.#enteringChannelId !== channelId) ||
      (kind === "delete" && this.#departingChannel?.row.channel.id !== channelId)
    ) return;
    if (this.#motionSuppressed) return;
    const row = [...(this.#listRef.value?.querySelectorAll<HTMLElement>(
      LIVE_CHANNEL_ROW_SELECTOR,
    ) ?? [])]
      .find((candidate) => candidate.dataset.channelId === channelId);
    if (row === undefined) {
      // A closed host may unmount the departing row before motion starts.
      if (kind === "delete") this.#finishRowMotion(kind, channelId);
      return;
    }

    if (
      typeof row.animate !== "function" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.#finishRowMotion(kind, channelId);
      return;
    }

    const height = row.getBoundingClientRect().height;
    const keyframes = kind === "create"
      ? [
          { maxHeight: "0px", opacity: 0 },
          { maxHeight: `${height}px`, opacity: 1 },
        ]
      : [
          { maxHeight: `${height}px`, opacity: 1 },
          { maxHeight: "0px", opacity: 0 },
        ];
    const animation = row.animate(keyframes, {
      duration: DRAG_DISPLACEMENT_DURATION_MS,
      easing: ROW_DISPLACEMENT_EASING,
    });
    if (kind === "create") {
      this.#createAnimation = animation;
    } else {
      this.#deleteAnimation = animation;
    }
    void animation.finished.then(
      () => {
        if (
          (kind === "create" && this.#createAnimation !== animation) ||
          (kind === "delete" && this.#deleteAnimation !== animation)
        ) return;
        if (kind === "create") {
          this.#createAnimation = null;
        } else {
          this.#deleteAnimation = null;
        }
        this.#finishRowMotion(kind, channelId);
      },
      () => undefined,
    );
  }

  #finishRowMotion(kind: "create" | "delete", channelId: string): void {
    if (kind === "create") {
      if (this.#enteringChannelId !== channelId) return;
      this.#enteringChannelId = null;
      this.#createRequest = null;
      this.#beginRename(channelId);
      return;
    }
    if (this.#departingChannel?.row.channel.id !== channelId) return;
    this.#departingChannel = null;
    this.#deleteRequestId = null;
    this.#renderHost();
  }

  #settleOwnedMotionForSuppression(): void {
    this.#pressed = null;
    this.#clearDragImmediately();
    const enteringChannelId = this.#enteringChannelId;
    if (this.#createAnimation !== null) {
      this.#createAnimation.cancel();
      this.#createAnimation = null;
      if (enteringChannelId !== null) {
        queueMicrotask(() => this.#finishRowMotion("create", enteringChannelId));
      }
    }
    const departingChannelId = this.#departingChannel?.row.channel.id ?? null;
    if (this.#deleteAnimation !== null) {
      this.#deleteAnimation.cancel();
      this.#deleteAnimation = null;
      if (departingChannelId !== null) {
        queueMicrotask(() => this.#finishRowMotion("delete", departingChannelId));
      }
    }
  }

  #resumeDeferredRowMotion(): void {
    const enteringChannelId = this.#enteringChannelId;
    const departingChannelId = this.#departingChannel?.row.channel.id ?? null;
    if (enteringChannelId !== null && this.#createAnimation === null) {
      queueMicrotask(() => this.#startRowMotion("create", enteringChannelId));
    }
    if (departingChannelId !== null && this.#deleteAnimation === null) {
      queueMicrotask(() => this.#startRowMotion("delete", departingChannelId));
    }
  }

  #beginRename(channelId: string): void {
    const channel = this.#snapshot?.channels.find(({ id }) => id === channelId);
    if (channel === undefined) return;
    this.#renamingChannelId = channelId;
    this.#renameValue = channel.name;
    this.#pressed = null;
    this.#renderHost();
    queueMicrotask(() => {
      if (this.#renamingChannelId !== channelId) return;
      this.#renameRef.value?.focus();
      this.#renameRef.value?.select();
    });
  }

  #finishRename(commit: boolean): void {
    if (
      this.#renamingChannelId === null ||
      this.#renameSettling ||
      this.#application === null
    ) return;

    this.#renameSettling = true;
    const channelId = this.#renamingChannelId;
    const name = this.#renameValue.trim();
    this.#renamingChannelId = null;
    this.#renameValue = "";
    this.#renderHost();
    this.#renameSettling = false;

    if (commit && name.length > 0) {
      void this.#application.renameChannel(channelId, name).catch(() => {});
    }
  }

  #handleRenameInput = (event: Event): void => {
    this.#renameValue = (event.currentTarget as HTMLInputElement).value;
  };

  #handleRenameKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      this.#finishRename(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.#finishRename(false);
    }
  };

  #handleRenameBlur = (): void => {
    this.#finishRename(true);
  };

  #handleRenameCommitPress = (event: PointerEvent): void => {
    event.preventDefault();
    this.#finishRename(true);
  };

  #setPinned(channelId: string, pin: boolean): void {
    if (this.#application === null || this.#snapshot === null) return;
    this.#hideMenu(channelId);
    if (this.#options.revealMovedRow) {
      const option = this.#channelOption(channelId);
      this.#pendingReveal = {
        channelId,
        pinned: pin,
        focus: option?.parentElement?.contains(document.activeElement) ?? false,
      };
    }
    const current = this.#snapshot.display.pinnedChannelIds;
    const next = pin
      ? [...current.filter((id) => id !== channelId), channelId]
      : current.filter((id) => id !== channelId);
    void this.#application.setPinnedChannelIds(next).catch(() => {
      this.#pendingReveal = null;
    });
  }

  #channelOption(channelId: string): HTMLElement | undefined {
    return [...(this.#listRef.value?.querySelectorAll<HTMLElement>(LIVE_CHANNEL_ROW_SELECTOR) ?? [])]
      .find((row) => row.dataset.channelId === channelId)
      ?.querySelector<HTMLElement>(".channel") ?? undefined;
  }

  #hideMenu(channelId: string): void {
    const row = [...(this.#listRef.value
      ?.querySelectorAll<HTMLElement>(LIVE_CHANNEL_ROW_SELECTOR) ?? [])]
      .find((candidate) => candidate.dataset.channelId === channelId);
    const trigger = row?.querySelector<HTMLButtonElement>(".channel-menu-trigger");
    if (!trigger) return;
    this.#listRef.value?.ownerDocument.querySelector<HTMLElement>(`tv-menu[trigger="${trigger.id}"]`)?.removeAttribute("open");
  }

  #handlePointerDown(channelId: string, event: PointerEvent): void {
    if (
      event.button !== 0 ||
      this.#pressed !== null ||
      this.#dragging !== null ||
      this.#snapshot === null
    ) return;
    this.#suppressPointerClick = false;
    const target = event.currentTarget as HTMLElement;
    const captureTarget = target.closest<HTMLElement>(".sidebar, .channel-switcher-pop");
    if (captureTarget === null) return;
    const membership = channelMembership(this.#snapshot);
    if (
      !membership.pinnedChannelIds.includes(channelId) &&
      !membership.unpinnedChannelIds.includes(channelId)
    ) return;
    this.#pressed = {
      channelId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      source: { channelId, ...membership },
      captureTarget,
    };
  }

  #resetDragClick = (): void => { this.#suppressPointerClick = false; };

  #handleDragClick = (event: MouseEvent): void => {
    if (!this.#suppressPointerClick || event.detail === 0) return;
    this.#suppressPointerClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  #handleChannelClick(channelId: string, event: MouseEvent): void {
    if (event.detail !== 0 && this.#suppressPointerClick) {
      this.#suppressPointerClick = false;
      return;
    }
    this.#suppressPointerClick = false;
    if (this.#dragging !== null) return;
    if (this.#options.selectChannel) {
      this.#options.selectChannel(channelId);
    } else {
      void this.#application?.focusChannel(channelId).catch(() => {});
    }
  }

  #handleOptionPointerMove = (event: PointerEvent): void => {
    if (
      !this.#options.highlightOnPointerMove ||
      this.#dragging !== null ||
      this.#renamingChannelId !== null ||
      this.#listRef.value?.querySelector("tv-menu[open]")
    ) return;
    focusOption(event.currentTarget as HTMLElement);
  };

  #handlePointerMove = (event: PointerEvent): void => {
    if (this.#motionSuppressed) {
      this.#pressed = null;
      return;
    }
    const dragging = this.#dragging;
    if (dragging !== null) {
      if (dragging.pointerId !== event.pointerId) return;
      event.preventDefault();
      this.#updateDragPlacement(dragging, event);
      return;
    }

    const pressed = this.#pressed;
    if (pressed === null || pressed.pointerId !== event.pointerId) return;
    if (event.buttons === 0) {
      this.#pressed = null;
      return;
    }
    if (
      Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) <=
        DRAG_PRESS_THRESHOLD_PX
    ) return;
    this.#beginDrag(pressed, event);
  };

  #beginDrag(pressed: PressedChannel, event: PointerEvent): void {
    if (this.#motionSuppressed) {
      this.#pressed = null;
      return;
    }
    const row = [...pressed.captureTarget.querySelectorAll<HTMLElement>(
      LIVE_CHANNEL_ROW_SELECTOR,
    )]
      .find((candidate) => candidate.dataset.channelId === pressed.channelId);
    if (row === undefined) {
      this.#pressed = null;
      return;
    }
    const wideRow = row.getBoundingClientRect();
    const compactPreviewWidth = this.#measureCompactPreviewWidth(row);
    const grip = calculateChannelSidebarGrip({
      wideRow,
      compactPreviewWidth,
      pointer: { x: pressed.x, y: pressed.y },
    });
    const pinnedGroup = pressed.captureTarget.querySelector<HTMLElement>(
      '[data-channel-side="pinned"]',
    );
    const unpinnedGroup = pressed.captureTarget.querySelector<HTMLElement>(
      '[data-channel-side="unpinned"]',
    );
    try {
      pressed.captureTarget.setPointerCapture(pressed.pointerId);
    } catch {
      this.#pressed = null;
      return;
    }

    pressed.captureTarget.style.setProperty(
      "--channel-sidebar-drag-grip-x",
      `${grip.previewOffsetX}px`,
    );
    pressed.captureTarget.style.setProperty(
      "--channel-sidebar-drag-grip-y",
      `${grip.offsetY}px`,
    );
    pressed.captureTarget.style.setProperty(
      "--channel-sidebar-drag-grip-correction-x",
      `${grip.correctionX}px`,
    );
    this.#suppressPointerClick = true;
    const dragging: DraggingChannel = {
      ...pressed,
      placement: { kind: "invalidated" },
      currentX: event.clientX,
      currentY: event.clientY,
      grip,
      rowWidth: compactPreviewWidth,
      rowHeight: wideRow.height,
      originPinnedContentBottom: pinnedGroup?.getBoundingClientRect().bottom ?? null,
      originUnpinnedGroupTop: unpinnedGroup?.getBoundingClientRect().top ?? null,
      displacementAnimations: new Set(),
      edgeScrollFrame: 0,
      edgeScrollTimestamp: null,
      edgeScrollRemainder: 0,
      completed: false,
      operation: null,
      operationResolved: false,
      operationRejected: false,
      restorationQueued: false,
    };
    this.#pressed = null;
    this.#dragging = dragging;
    this.#updateDragPlacement(dragging, event);
  }

  #measureCompactPreviewWidth(row: HTMLElement): number {
    const preview = row.cloneNode(true) as HTMLElement;
    for (const element of [
      preview,
      ...preview.querySelectorAll<HTMLElement>("[id], [trigger]"),
    ]) {
      element.removeAttribute("id");
      element.removeAttribute("trigger");
    }
    preview.classList.add("dragged");
    preview.style.position = "fixed";
    preview.style.left = "-10000px";
    preview.style.top = "-10000px";
    preview.style.visibility = "hidden";
    preview.style.pointerEvents = "none";
    document.body.append(preview);
    const width = preview.getBoundingClientRect().width;
    preview.remove();
    return width;
  }

  #updateDragPlacement(
    dragging: DraggingChannel,
    event: Pick<PointerEvent, "clientX" | "clientY">,
    renderUnchangedPosition = true,
  ): void {
    if (dragging.completed) return;
    const snapshot = this.#snapshot;
    if (snapshot === null) {
      dragging.placement = { kind: "invalidated" };
      return;
    }
    dragging.currentX = event.clientX;
    dragging.currentY = event.clientY;
    const current = channelMembership(snapshot);
    const rows = new Map(
      [...dragging.captureTarget.querySelectorAll<HTMLElement>(
        LIVE_CHANNEL_ROW_SELECTOR,
      )]
        .map((row) => [row.dataset.channelId, row] as const),
    );
    const pinnedRows = current.pinnedChannelIds
      .filter((channelId) => channelId !== dragging.channelId)
      .flatMap((channelId) => {
        const row = rows.get(channelId);
        if (row === undefined) return [];
        const bounds = row.getBoundingClientRect();
        return [{ channelId, top: bounds.top, bottom: bounds.bottom }];
      });
    const pinnedGroup = dragging.captureTarget.querySelector<HTMLElement>(
      '.channel-group[data-channel-side="pinned"]:not([drag-collapsed]):not(.channel-group-withdrawal)',
    );
    const unpinnedGroup = dragging.captureTarget.querySelector<HTMLElement>(
      '.channel-group[data-channel-side="unpinned"]:not([drag-collapsed]):not(.channel-group-withdrawal)',
    );
    const placeholderElement = dragging.captureTarget.querySelector<HTMLElement>(
      ".channel-group:not(.channel-group-withdrawal) .channel-placeholder",
    );
    const placeholderBounds = placeholderElement?.getBoundingClientRect();
    const placeholderSide = placeholderElement?.dataset.channelSide;
    const placeholderIndex = Number(placeholderElement?.dataset.channelIndex);
    const sidebar = dragging.captureTarget.getBoundingClientRect();
    const placement = calculateChannelSidebarPlacement({
      source: dragging.source,
      current,
      pointer: { x: event.clientX, y: event.clientY },
      geometry: {
        sidebar: {
          left: sidebar.left,
          right: sidebar.right,
          top: sidebar.top,
          bottom: sidebar.bottom,
        },
        pinnedRows,
        unpinnedGroupTop: unpinnedGroup?.getBoundingClientRect().top ??
          dragging.originUnpinnedGroupTop,
        pinnedContentBottom: pinnedGroup?.getBoundingClientRect().bottom ??
          dragging.originPinnedContentBottom,
        placeholder: placeholderBounds !== undefined &&
            (placeholderSide === "pinned" || placeholderSide === "unpinned") &&
            Number.isInteger(placeholderIndex)
          ? {
              side: placeholderSide,
              index: placeholderIndex,
              top: placeholderBounds.top,
              bottom: placeholderBounds.bottom,
            }
          : null,
      },
    });
    const placementChanged = !sameDragPlacement(dragging.placement, placement);
    const from = placementChanged ? this.#captureDragLayout(dragging) : null;
    dragging.placement = placement;
    if (placementChanged || renderUnchangedPosition) {
      this.#renderDragPose(dragging, from, false);
    }
    this.#updateEdgeScroll(dragging);
  }

  #updateEdgeScroll(dragging: DraggingChannel): void {
    const body = dragging.captureTarget.querySelector<HTMLElement>(".sidebar-body, .channel-switcher-pop-body");
    const velocity = body
      ? this.#edgeScrollVelocity(body, dragging.currentY)
      : 0;
    const maximum = body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
    const blocked = velocity < 0
      ? (body?.scrollTop ?? 0) <= SCROLL_EDGE_TOLERANCE_PX
      : (body?.scrollTop ?? 0) >= maximum - SCROLL_EDGE_TOLERANCE_PX;
    if (
      this.#motionSuppressed ||
      dragging.completed ||
      velocity === 0 ||
      maximum === 0 ||
      blocked ||
      typeof requestAnimationFrame !== "function"
    ) {
      this.#stopEdgeScroll(dragging);
      return;
    }
    if (dragging.edgeScrollFrame !== 0) return;
    dragging.edgeScrollFrame = requestAnimationFrame((timestamp) => {
      this.#runEdgeScrollFrame(dragging, timestamp);
    });
  }

  #runEdgeScrollFrame(dragging: DraggingChannel, timestamp: number): void {
    dragging.edgeScrollFrame = 0;
    if (this.#motionSuppressed || this.#dragging !== dragging || dragging.completed) {
      dragging.edgeScrollTimestamp = null;
      return;
    }
    const body = dragging.captureTarget.querySelector<HTMLElement>(".sidebar-body, .channel-switcher-pop-body");
    if (body === null) {
      dragging.edgeScrollTimestamp = null;
      return;
    }
    const velocity = this.#edgeScrollVelocity(body, dragging.currentY);
    const previousTimestamp = dragging.edgeScrollTimestamp;
    dragging.edgeScrollTimestamp = timestamp;
    if (velocity !== 0 && previousTimestamp !== null) {
      const elapsedSeconds = Math.max(0, timestamp - previousTimestamp) / 1_000;
      const maximum = Math.max(0, body.scrollHeight - body.clientHeight);
      const before = body.scrollTop;
      const desiredDelta = velocity * elapsedSeconds + dragging.edgeScrollRemainder;
      const target = Math.max(0, Math.min(maximum, before + desiredDelta));
      body.scrollTop = target;
      const appliedDelta = body.scrollTop - before;
      dragging.edgeScrollRemainder = target === 0 || target === maximum
        ? 0
        : desiredDelta - appliedDelta;
      if (appliedDelta !== 0) {
        body.toggleAttribute("continues-start", body.scrollTop > 0);
        this.#updateDragPlacementFromCurrentPointer(dragging);
        return;
      }
    }
    this.#updateEdgeScroll(dragging);
  }

  #updateDragPlacementFromCurrentPointer(dragging: DraggingChannel): void {
    this.#updateDragPlacement(dragging, {
      clientX: dragging.currentX,
      clientY: dragging.currentY,
    }, false);
  }

  #stopEdgeScroll(dragging: DraggingChannel): void {
    if (
      dragging.edgeScrollFrame !== 0 &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(dragging.edgeScrollFrame);
    }
    dragging.edgeScrollFrame = 0;
    dragging.edgeScrollTimestamp = null;
    dragging.edgeScrollRemainder = 0;
  }

  #edgeScrollVelocity(body: HTMLElement, pointerY: number): number {
    const box = body.getBoundingClientRect();
    if (pointerY >= box.top && pointerY < box.top + DRAG_AUTOSCROLL_ZONE_PX) {
      return -DRAG_AUTOSCROLL_SPEED_PX_S *
        (box.top + DRAG_AUTOSCROLL_ZONE_PX - pointerY) /
        DRAG_AUTOSCROLL_ZONE_PX;
    }
    if (
      pointerY > box.bottom - DRAG_AUTOSCROLL_ZONE_PX &&
      pointerY <= box.bottom
    ) {
      return DRAG_AUTOSCROLL_SPEED_PX_S *
        (pointerY - (box.bottom - DRAG_AUTOSCROLL_ZONE_PX)) /
        DRAG_AUTOSCROLL_ZONE_PX;
    }
    return 0;
  }

  #captureDragLayout(dragging: DraggingChannel): DragLayout {
    for (const animation of dragging.displacementAnimations) animation.cancel();
    dragging.displacementAnimations.clear();
    const rows = new Map<string, DragPosition>();
    for (const row of dragging.captureTarget.querySelectorAll<HTMLElement>(
      LIVE_CHANNEL_ROW_SELECTOR,
    )) {
      const channelId = row.dataset.channelId;
      if (channelId === undefined) continue;
      const bounds = row.getBoundingClientRect();
      rows.set(channelId, { left: bounds.left, top: bounds.top });
    }
    const groups = new Map<"pinned" | "unpinned", DragGroupLayout>();
    for (const group of dragging.captureTarget.querySelectorAll<HTMLElement>(
      ".channel-group:not(.channel-group-withdrawal)",
    )) {
      const side = group.dataset.channelSide;
      if (side !== "pinned" && side !== "unpinned") continue;
      const bounds = group.getBoundingClientRect();
      const withdrawal = group.cloneNode(true) as HTMLElement;
      for (const element of [
        withdrawal,
        ...withdrawal.querySelectorAll<HTMLElement>("[id], [trigger]"),
      ]) {
        element.removeAttribute("id");
        element.removeAttribute("trigger");
      }
      withdrawal.querySelector(".channel-row.dragged")?.remove();
      withdrawal.classList.add("channel-group-withdrawal");
      withdrawal.setAttribute("aria-hidden", "true");
      withdrawal.removeAttribute("drag-collapsed");
      groups.set(side, {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: group.hasAttribute("drag-collapsed") ? 0 : bounds.height,
        withdrawal,
      });
    }
    return { rows, groups };
  }

  #renderDragPose(
    dragging: DraggingChannel,
    from: DragLayout | null,
    includeCarried: boolean,
  ): void {
    const body = dragging.captureTarget.querySelector<HTMLElement>(".sidebar-body, .channel-switcher-pop-body");
    const scrollTop = body?.scrollTop ?? 0;
    this.#renderHost();
    queueMicrotask(() => {
      const currentBody = dragging.captureTarget.querySelector<HTMLElement>(".sidebar-body, .channel-switcher-pop-body");
      if (currentBody !== null) currentBody.scrollTop = scrollTop;
      if (from !== null) this.#animateDragDisplacement(dragging, from, includeCarried);
    });
  }

  #animateDragDisplacement(
    dragging: DraggingChannel,
    from: DragLayout,
    includeCarried: boolean,
  ): void {
    if (
      this.#motionSuppressed ||
      typeof HTMLElement.prototype.animate !== "function" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;

    for (const row of dragging.captureTarget.querySelectorAll<HTMLElement>(
      LIVE_CHANNEL_ROW_SELECTOR,
    )) {
      const channelId = row.dataset.channelId;
      if (channelId === undefined || (!includeCarried && channelId === dragging.channelId)) {
        continue;
      }
      const start = from.rows.get(channelId);
      if (start === undefined) continue;
      const bounds = row.getBoundingClientRect();
      const deltaX = start.left - bounds.left;
      const deltaY = start.top - bounds.top;
      if (Math.hypot(deltaX, deltaY) <= LAYOUT_TOLERANCE_PX) continue;
      this.#trackDragAnimation(dragging, row.animate(
        { translate: [`${deltaX}px ${deltaY}px`, "0px 0px"] },
        {
          duration: DRAG_DISPLACEMENT_DURATION_MS,
          easing: ROW_DISPLACEMENT_EASING,
        },
      ));
    }

    for (const group of dragging.captureTarget.querySelectorAll<HTMLElement>(
      ".channel-group:not(.channel-group-withdrawal)",
    )) {
      const side = group.dataset.channelSide;
      if (side !== "pinned" && side !== "unpinned") continue;
      const start = from.groups.get(side);
      const bounds = group.getBoundingClientRect();
      const height = group.hasAttribute("drag-collapsed") ? 0 : bounds.height;
      if (start === undefined) continue;
      if (start.height <= LAYOUT_TOLERANCE_PX && height > LAYOUT_TOLERANCE_PX) {
        this.#trackDragAnimation(dragging, group.animate(
          [
            { opacity: 0, translate: `0px -${height}px` },
            { opacity: 1, translate: "0px 0px" },
          ],
          {
            duration: DRAG_DISPLACEMENT_DURATION_MS,
            easing: ROW_DISPLACEMENT_EASING,
          },
        ));
      } else if (
        start.height > LAYOUT_TOLERANCE_PX &&
        height <= LAYOUT_TOLERANCE_PX &&
        start.withdrawal.childElementCount > 0
      ) {
        const withdrawal = start.withdrawal;
        withdrawal.style.left = `${start.left}px`;
        withdrawal.style.top = `${start.top}px`;
        withdrawal.style.width = `${start.width}px`;
        withdrawal.style.height = `${start.height}px`;
        dragging.captureTarget.append(withdrawal);
        const animation = withdrawal.animate(
          [
            { opacity: 1, translate: "0px 0px" },
            { opacity: 0, translate: `0px -${start.height}px` },
          ],
          {
            duration: DRAG_DISPLACEMENT_DURATION_MS,
            easing: ROW_DISPLACEMENT_EASING,
          },
        );
        this.#trackDragAnimation(dragging, animation);
        void animation.finished.finally(() => withdrawal.remove()).catch(() => {});
      }
    }
  }

  #trackDragAnimation(dragging: DraggingChannel, animation: Animation): void {
    dragging.displacementAnimations.add(animation);
    void animation.finished.finally(() => {
      dragging.displacementAnimations.delete(animation);
    }).catch(() => {});
  }

  #handlePointerUp = (event: PointerEvent): void => {
    const dragging = this.#dragging;
    if (dragging !== null && dragging.pointerId === event.pointerId) {
      if (dragging.completed) return;
      const captured = dragging.captureTarget.hasPointerCapture(event.pointerId);
      this.#updateDragPlacement(dragging, event);
      const operation = captured && dragging.placement.kind === "placement"
        ? dragging.placement.operation
        : null;
      const application = this.#application;
      if (operation === null || application === null) {
        this.#restoreDrag(dragging, false);
        return;
      }

      dragging.completed = true;
      this.#stopEdgeScroll(dragging);
      dragging.operation = [...operation];
      void application.setPinnedChannelIds([...operation]).then(
        () => {
          if (this.#dragging !== dragging) return;
          dragging.operationResolved = true;
          this.#synchronizeCompletedDrag(this.#snapshot);
        },
        () => {
          if (this.#dragging !== dragging) return;
          dragging.operationResolved = true;
          dragging.operationRejected = true;
          this.#queueDragRestoration(dragging);
        },
      );
      return;
    }

    if (this.#pressed?.pointerId === event.pointerId) this.#pressed = null;
  };

  #handlePointerCancel = (event: PointerEvent): void => {
    if (
      this.#dragging?.pointerId === event.pointerId &&
      !this.#dragging.completed
    ) {
      this.#abandonDrag();
    } else if (this.#pressed?.pointerId === event.pointerId) {
      this.#pressed = null;
    }
  };

  #handleLostPointerCapture = (event: PointerEvent): void => {
    const dragging = this.#dragging;
    if (
      dragging === null ||
      dragging.pointerId !== event.pointerId ||
      dragging.completed
    ) return;
    this.#restoreDrag(dragging, false);
  };

  #handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== "Escape" ||
      this.#dragging === null ||
      this.#dragging.completed
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#abandonDrag();
  };

  #invalidateChangedMembership(snapshot: ApplicationSnapshot): void {
    const current = channelMembership(snapshot);
    if (
      this.#dragging !== null &&
      !this.#dragging.completed &&
      !haveSameOrderedMembership(this.#dragging.source, current)
    ) {
      this.#abandonDrag();
    }
    if (
      this.#pressed !== null &&
      !haveSameOrderedMembership(this.#pressed.source, current)
    ) {
      this.#pressed = null;
    }
  }

  #synchronizeCompletedDrag(snapshot: ApplicationSnapshot | null): void {
    const dragging = this.#dragging;
    if (
      snapshot === null ||
      dragging === null ||
      !dragging.completed ||
      !dragging.operationResolved ||
      dragging.restorationQueued
    ) return;
    if (dragging.operationRejected) {
      this.#queueDragRestoration(dragging);
      return;
    }
    const operation = dragging.operation;
    if (
      operation !== null &&
      haveSameIds(channelMembership(snapshot).pinnedChannelIds, operation)
    ) {
      this.#queueDragRestoration(dragging);
    }
  }

  #queueDragRestoration(dragging: DraggingChannel): void {
    if (this.#dragging !== dragging || dragging.restorationQueued) return;
    dragging.restorationQueued = true;
    queueMicrotask(() => {
      if (this.#dragging === dragging) this.#restoreDrag(dragging, false);
    });
  }

  #abandonDrag(): void {
    this.#pressed = null;
    const dragging = this.#dragging;
    if (dragging === null) return;
    this.#restoreDrag(dragging, true);
  }

  #restoreDrag(dragging: DraggingChannel, releaseCapture: boolean): void {
    if (this.#dragging !== dragging) return;
    this.#stopEdgeScroll(dragging);
    const from = this.#captureDragLayout(dragging);
    this.#dragging = null;
    this.#clearDragProperties(dragging);
    if (
      releaseCapture &&
      dragging.captureTarget.hasPointerCapture(dragging.pointerId)
    ) {
      dragging.captureTarget.releasePointerCapture(dragging.pointerId);
    }
    this.#renderDragPose(dragging, from, true);
  }

  #clearDragImmediately(): void {
    this.#pressed = null;
    const dragging = this.#dragging;
    this.#dragging = null;
    if (dragging === null) return;
    this.#stopEdgeScroll(dragging);
    for (const animation of dragging.displacementAnimations) animation.cancel();
    dragging.displacementAnimations.clear();
    this.#clearDragProperties(dragging);
    if (dragging.captureTarget.hasPointerCapture(dragging.pointerId)) {
      dragging.captureTarget.releasePointerCapture(dragging.pointerId);
    }
  }

  #clearDragProperties(dragging: DraggingChannel): void {
    dragging.captureTarget.style.removeProperty("--channel-sidebar-drag-grip-x");
    dragging.captureTarget.style.removeProperty("--channel-sidebar-drag-grip-y");
    dragging.captureTarget.style.removeProperty(
      "--channel-sidebar-drag-grip-correction-x",
    );
  }

}

/** Keep the pointer's grip inside the compact preview as a wide row shrinks. */
export function calculateChannelSidebarGrip(
  input: ChannelSidebarGripInput,
): ChannelSidebarGrip {
  const wideWidth = Math.max(0, input.wideRow.right - input.wideRow.left);
  const wideHeight = Math.max(0, input.wideRow.bottom - input.wideRow.top);
  const wideOffsetX = clamp(input.pointer.x - input.wideRow.left, 0, wideWidth);
  const previewOffsetX = Math.min(
    wideOffsetX,
    Math.max(0, input.compactPreviewWidth - COMPACT_PREVIEW_GRIP_MARGIN_PX),
  );
  return {
    wideOffsetX,
    previewOffsetX,
    correctionX: wideOffsetX - previewOffsetX,
    offsetY: clamp(input.pointer.y - input.wideRow.top, 0, wideHeight),
  };
}

function channelRows(
  snapshot: ApplicationSnapshot,
  membership: ChannelSidebarMembership = channelMembership(snapshot),
): {
  pinned: readonly ChannelRow[];
  unpinned: readonly ChannelRow[];
} {
  const channels = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const pinnedChannels = membership.pinnedChannelIds.flatMap((channelId) => {
    const channel = channels.get(channelId);
    return channel === undefined ? [] : [channel];
  });
  const unpinnedChannels = membership.unpinnedChannelIds.flatMap((channelId) => {
    const channel = channels.get(channelId);
    return channel === undefined ? [] : [channel];
  });
  const focusedId = snapshot.display.focusedChannelId;
  const selectedId = focusedId !== null && channels.has(focusedId)
    ? focusedId
    : pinnedChannels[0]?.id ?? unpinnedChannels[0]?.id ?? null;
  return {
    pinned: pinnedChannels.map((channel) => ({
      channel,
      pinned: true,
      selected: channel.id === selectedId,
    })),
    unpinned: unpinnedChannels.map((channel) => ({
      channel,
      pinned: false,
      selected: channel.id === selectedId,
    })),
  };
}

function channelMembership(snapshot: ApplicationSnapshot): ChannelSidebarMembership {
  const channelIds = new Set(snapshot.channels.map(({ id }) => id));
  const pinnedChannelIds = snapshot.display.pinnedChannelIds.filter((channelId) =>
    channelIds.has(channelId)
  );
  const pinnedIds = new Set(pinnedChannelIds);
  const unpinnedChannelIds = snapshot.channels
    .filter(({ id }) => !pinnedIds.has(id))
    .map(({ id }) => id)
    .sort((left, right) => right.localeCompare(left));
  return { pinnedChannelIds, unpinnedChannelIds };
}

function haveSameOrderedMembership(
  source: ChannelSidebarMembership,
  current: ChannelSidebarMembership,
): boolean {
  return haveSameIds(source.pinnedChannelIds, current.pinnedChannelIds) &&
    haveSameIds(source.unpinnedChannelIds, current.unpinnedChannelIds);
}

function haveSameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((channelId, index) => channelId === right[index]);
}

function sameDragPlacement(
  left: ChannelSidebarPlacement,
  right: ChannelSidebarPlacement,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "invalidated" || right.kind === "invalidated") return true;
  return left.side === right.side &&
    left.placeholder?.side === right.placeholder?.side &&
    left.placeholder?.index === right.placeholder?.index &&
    (left.operation === null) === (right.operation === null) &&
    (left.operation === null || right.operation === null ||
      haveSameIds(left.operation, right.operation));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
