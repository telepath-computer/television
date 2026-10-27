import { html } from "lit-html";
import { view, View } from "@telepath-computer/utils/lit-view";
import type {
  ApplicationSnapshot,
  ApplicationService,
} from "../services/application-service.ts";
import { createRef, ref } from "lit-html/directives/ref.js";
import type { UpdatePresentationState } from "../services/update-presentation.ts";
import type { DesktopUpgradeRecommendationContext } from "../services/desktop-upgrade-recommendation.ts";
import type { DesktopUpdateState } from "../services/desktop-update.ts";
import {
  type DismissalStorage,
  UpdateNotificationController,
  type UpdateNotificationConnectionOwner,
} from "./update-notification.ts";
import { SkillSelectorView } from "./skill-selector.ts";
import { SettingsView } from "./settings.ts";
import type { TabReorderChange } from "./tab-reorder.ts";
import { TabStripView } from "./tab-strip.ts";
import { ChannelListController } from "./channel-list.ts";
import { focusOption, navigateOptions } from "../elements/option-navigation.js";
import "../elements/icon.ts";
import "../elements/popover.ts";
import "./top-bar.css";

let switcherCounter = 0;

interface DeleteRestoration {
  channelId: string;
  scrollTop: number;
  result: "cancelled" | "deleted" | null;
}

export interface TopBarOptions {
  connectionOwner?: UpdateNotificationConnectionOwner | null;
  updatePresentation?: UpdatePresentationState | null;
  desktopRecommendation?: DesktopUpgradeRecommendationContext | null;
  desktopUpdate?: DesktopUpdateState | null;
  dismissalStorage?: DismissalStorage | null;
  onTabReorderChange?: TabReorderChange;
  collapsed?: boolean;
  onExpandSidebar?: () => void;
  /** Shell-owned control; null reserves its seat during collapse motion. */
  sidebarToggle?: Node | null;
  sidebarTransitioning?: boolean;
  /** Fixture hook fired after this view's template commit. */
  onRenderComplete?: () => void;
}

/** The focused channel's tabs and the stage's fixed trailing controls. */
export class TopBar extends View<[
  ApplicationService,
  ApplicationSnapshot,
  TopBarOptions?,
]> {
  readonly #update = new UpdateNotificationController(() => this.render());
  readonly #channelList = new ChannelListController(() => this.render());
  readonly #switcherTriggerId = `channel-switcher-trigger-${++switcherCounter}`;
  #switcherPopover: HTMLElement | null = null;
  #switcherObserver: MutationObserver | null = null;
  #switcherMounted = false;
  #application: ApplicationService | null = null;
  #snapshot: ApplicationSnapshot | null = null;
  readonly #barRef = createRef<HTMLElement>();
  #deleteRestore: DeleteRestoration | null = null;

  connected(): void {
    this.#update.connect();
    document.addEventListener("keydown", this.#handleSwitcherKeyDown);
  }

  template(
    application: ApplicationService,
    snapshot: ApplicationSnapshot,
    options: TopBarOptions = {},
  ): unknown {
    this.#application = application;
    this.#snapshot = snapshot;
    const showLead = options.collapsed || options.sidebarTransitioning;
    if (options.sidebarTransitioning || !showLead || snapshot.focusedChannel === null) {
      this.#switcherMounted = false;
    }
    this.#channelList.update(application, snapshot, {
      management: true,
      dragging: true,
      revealMovedRow: true,
      onDeleteStart: this.#handleDeleteStart,
      onDeleteEnd: this.#handleDeleteEnd,
      selectChannel: this.#selectChannel,
      highlightOnPointerMove: true,
      motionSuppressed: options.sidebarTransitioning,
    });
    const deletion = this.#deleteRestore;
    if (
      deletion?.result &&
      (snapshot.channels.length === 0 || snapshot.focusedChannel !== null) &&
      (deletion.result === "cancelled" || !snapshot.channels.some(({ id }) => id === deletion.channelId))
    ) queueMicrotask(() => this.#restoreAfterDelete(deletion));
    this.#update.configure({
      connectionOwner: options.connectionOwner,
      presentation: options.updatePresentation,
      desktopRecommendation: options.desktopRecommendation,
      desktopUpdate: options.desktopUpdate,
      dismissalStorage: options.dismissalStorage,
    });
    if (options.onRenderComplete) queueMicrotask(options.onRenderComplete);

    return html`
      <header class="top-bar" ${ref(this.#barRef)}>
        ${showLead
          ? html`
              <div class="top-bar-lead">
                ${options.sidebarToggle === undefined
                  ? html`
                      <button
                        class="sidebar-expand"
                        variant="ghost"
                        icon
                        aria-label="Show sidebar"
                        title="Show sidebar"
                        type="button"
                        @click=${options.onExpandSidebar}
                      >
                        <tv-icon name="sidebar" size="sm"></tv-icon>
                      </button>
                    `
                  : options.sidebarToggle ?? html`
                      <span class="sidebar-toggle-seat" aria-hidden="true"></span>
                    `}
                ${snapshot.focusedChannel === null
                  ? null
                  : html`
                      <button
                        class="channel-switcher"
                        variant="ghost"
                        target
                        aria-haspopup="listbox"
                        id=${this.#switcherTriggerId}
                        type="button"
                        @click=${this.#handleSwitcherTriggerClick}
                      >
                        <span class="channel-switcher-name">
                          ${snapshot.focusedChannel.name}
                        </span>
                        <tv-icon name="select" size="sm"></tv-icon>
                      </button>
                      ${this.#switcherMounted
                        ? html`
                            <tv-popover
                              class="channel-switcher-pop"
                              ?dragging=${this.#channelList.dragging}
                              trigger=${this.#switcherTriggerId}
                              ${ref(this.#observeSwitcherPopover)}
                            >
                              <div class="channel-switcher-pop-body">
                                ${this.#channelList.template()}
                              </div>
                              <footer class="channel-switcher-pop-footer">
                                <button
                                  class="channel-create"
                                  variant="ghost"
                                  icon
                                  aria-label="New channel"
                                  title="New channel"
                                  type="button"
                                  ?disabled=${this.#channelList.creating}
                                  @click=${this.#channelList.create}
                                >
                                  <tv-icon name="add"></tv-icon>
                                </button>
                              </footer>
                            </tv-popover>
                          `
                        : null}
                    `}
              </div>
            `
          : null}
        ${TabStripView(
          application,
          snapshot.focusedChannel,
          null,
          options.onTabReorderChange,
          options.sidebarTransitioning,
        )}
        <div class="top-bar-controls">
          ${SkillSelectorView(options.connectionOwner?.connection)}
          ${SettingsView(application)}
          ${this.#update.template()}
        </div>
      </header>
      ${this.#channelList.overlayTemplate()}
    `;
  }

  disconnected(): void {
    this.#update.disconnect();
    document.removeEventListener("keydown", this.#handleSwitcherKeyDown);
    this.#channelList.disconnect();
    this.#switcherObserver?.disconnect();
    this.#switcherObserver = null;
    this.#switcherPopover = null;
    this.#switcherMounted = false;
    this.#application = null;
    this.#snapshot = null;
    this.#deleteRestore = null;
  }

  readonly #selectChannel = (channelId: string): void => {
    this.#switcherPopover?.removeAttribute("open");
    if (this.#snapshot?.display.focusedChannelId === channelId) return;
    void this.#application?.focusChannel(channelId).catch(() => {});
  };

  readonly #handleSwitcherTriggerClick = (event: MouseEvent): void => {
    if (this.#switcherMounted) return;
    this.#switcherMounted = true;
    this.render();
    if (event.detail === 0) {
      requestAnimationFrame(() => {
        if (this.#switcherPopover?.hasAttribute("open")) this.#focusSwitcherOption(0);
      });
    }
  };

  readonly #handleSwitcherKeyDown = (event: KeyboardEvent): void => {
    const popover = this.#switcherPopover;
    if (popover === null || !popover.hasAttribute("open")) return;
    if (this.#channelList.dragging || popover.querySelector("input, tv-menu[open]")) return;
    navigateOptions(event, [...popover.querySelectorAll<HTMLElement>('.channel[role="option"]')]);
  };

  #focusSwitcherOption(index: number): void {
    focusOption(this.#switcherPopover
      ?.querySelectorAll<HTMLElement>('.channel[role="option"]')[index]);
  }

  readonly #handleDeleteStart = (channelId: string): void => {
    this.#deleteRestore = {
      channelId,
      scrollTop: this.#switcherPopover?.querySelector(".channel-switcher-pop-body")?.scrollTop ?? 0,
      result: null,
    };
  };

  readonly #handleDeleteEnd = (channelId: string, deleted: boolean): void => {
    if (this.#deleteRestore?.channelId !== channelId) return;
    this.#deleteRestore.result = deleted ? "deleted" : "cancelled";
    this.render();
  };

  #restoreAfterDelete(deletion: DeleteRestoration): void {
    if (this.#deleteRestore !== deletion || this.#snapshot === null) return;
    this.#deleteRestore = null;
    const selected = this.#snapshot.focusedChannel;
    this.#switcherMounted = selected !== null;
    this.render();
    const popover = this.#switcherPopover;
    if (popover === null) {
      this.#channelList.disconnect();
      this.#barRef.value?.querySelector<HTMLButtonElement>(".sidebar-expand")?.focus();
      return;
    }
    popover.setAttribute("open", "");
    const body = popover.querySelector(".channel-switcher-pop-body");
    if (body) body.scrollTop = deletion.scrollTop;
    const channelId = deletion.result === "cancelled" &&
        this.#snapshot.channels.some(({ id }) => id === deletion.channelId)
      ? deletion.channelId
      : selected?.id;
    const row = [...popover.querySelectorAll<HTMLElement>(".channel-row")]
      .find((candidate) => candidate.dataset.channelId === channelId);
    const option = row?.querySelector<HTMLElement>(".channel");
    option?.focus({ preventScroll: true });
    if (deletion.result === "deleted") option?.scrollIntoView({ block: "nearest" });
  }

  readonly #observeSwitcherPopover = (element: Element | undefined): void => {
    this.#switcherObserver?.disconnect();
    this.#switcherObserver = null;
    if (this.#switcherPopover !== null && this.#deleteRestore === null) this.#channelList.disconnect();
    this.#switcherPopover = element instanceof HTMLElement ? element : null;
    if (this.#switcherPopover === null) return;
    this.#channelList.connect();
    this.#switcherObserver = new MutationObserver(this.#handleSwitcherPopoverMutation);
    this.#switcherObserver.observe(this.#switcherPopover, {
      attributes: true,
      attributeFilter: ["open"],
    });
  };

  readonly #handleSwitcherPopoverMutation = (): void => {
    if (this.#switcherPopover?.hasAttribute("open") ?? true) return;
    if (this.#deleteRestore !== null) return;
    this.#switcherMounted = false;
    this.render();
  };
}

export const TopBarView = view(TopBar);
