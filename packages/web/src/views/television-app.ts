import { isNavigationKeyChord } from "@telepath-computer/television-artifact/browser";
import { View, view } from "@telepath-computer/utils/lit-view";
import { html, type TemplateResult } from "lit-html";
import type { Part } from "lit-html/directive.js";
import type {
  ApplicationService,
  ApplicationSnapshot,
} from "../services/application-service.ts";
import type { ServerConnectionOwner } from "../services/server-connection-owner.ts";
import type { ChannelSidebarCollapsedPreference } from "../services/channel-sidebar-collapsed.ts";
import {
  CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX,
  type ChannelSidebarWidthPreference,
  clampSidebarWidth,
} from "../services/channel-sidebar-width.ts";
import type { UpdatePresentationState } from "../services/update-presentation.ts";
import type { DesktopUpgradeRecommendationContext } from "../services/desktop-upgrade-recommendation.ts";
import type { DesktopUpdateState } from "../services/desktop-update.ts";
import {
  selectApplicationState,
  type ApplicationState,
} from "./application-state.ts";
import { ChannelSidebarView } from "./channel-sidebar.ts";
import { SidebarCollapseTransition } from "./sidebar-collapse-transition.ts";
import { sidebarPose, type SidebarGeometry } from "./sidebar-transition-pose.ts";
import { StageView } from "./stage.ts";
import { SystemModalView, windowDragStripTemplate } from "./system-modal.ts";
import { DesktopUpgradeGateView } from "./desktop-upgrade-gate.ts";
import type { TabReorderSnapshot } from "./tab-reorder.ts";
import { TopBarView } from "./top-bar.ts";
import "./television-app.css";
import "./television-app.host.css";

export interface TelevisionAppOptions {
  serverURL: string;
  electronMode: boolean;
  connectionOwner?: ServerConnectionOwner;
  updatePresentation?: UpdatePresentationState;
  desktopRecommendation?: DesktopUpgradeRecommendationContext;
  desktopUpdate?: DesktopUpdateState;
  sidebarWidthPreference: ChannelSidebarWidthPreference;
  sidebarCollapsedPreference: ChannelSidebarCollapsedPreference;
  onRenderComplete?: (state: string) => void;
}

interface SidebarResizeGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  readonly root: HTMLElement;
}

interface SidebarTransitionGeometry extends SidebarGeometry {
  readonly toggleTop: number;
  readonly toggleHeight: number;
  readonly barInset: number;
}

/** The production application root and application-state/view handoff. */
export class TelevisionApp extends View<[ApplicationService, TelevisionAppOptions]> {
  #application: ApplicationService | null = null;
  #tabReorder: TabReorderSnapshot | undefined;
  #sidebarWidthPreference: ChannelSidebarWidthPreference | null = null;
  #sidebarCollapsedPreference: ChannelSidebarCollapsedPreference | null = null;
  #sidebarWidth = CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX;
  #sidebarCollapsed = false;
  #sidebarResize: SidebarResizeGesture | null = null;
  #sidebarToggle: HTMLButtonElement | null = null;
  #sidebarTransition: SidebarCollapseTransition | null = null;
  #sidebarTransitioning = false;
  #sidebarTransitionTargetCollapsed = false;
  #sidebarBoundary = CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX;
  #sidebarTransitionToggleTop = 0;
  #sidebarTransitionGeometry: SidebarTransitionGeometry | null = null;

  override update(
    part: Part,
    args: [ApplicationService, TelevisionAppOptions],
  ): unknown {
    const application = args[0];
    const sidebarWidthPreference = args[1].sidebarWidthPreference;
    const sidebarCollapsedPreference = args[1].sidebarCollapsedPreference;
    if (this.#application !== application) {
      if (this.#application !== null && this.isConnected) {
        this.#application.removeEventListener("change", this.#render);
        application.addEventListener("change", this.#render);
      }
      this.#application = application;
    }
    const widthPreferenceChanged = this.#sidebarWidthPreference !== sidebarWidthPreference;
    const collapsedPreferenceChanged =
      this.#sidebarCollapsedPreference !== sidebarCollapsedPreference;
    if (widthPreferenceChanged) {
      this.#cancelSidebarResize();
      this.#sidebarWidthPreference = sidebarWidthPreference;
      this.#sidebarWidth = sidebarWidthPreference.read()
        ?? CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX;
    }
    if (collapsedPreferenceChanged) {
      this.#cancelSidebarResize();
      this.#sidebarCollapsedPreference = sidebarCollapsedPreference;
      this.#sidebarCollapsed = sidebarCollapsedPreference.read();
    }
    if (widthPreferenceChanged || collapsedPreferenceChanged) {
      this.#settleSidebarTransition(this.#sidebarCollapsed);
    }
    return super.update(part, args);
  }

  connected(): void {
    this.#application?.addEventListener("change", this.#render);
    document.addEventListener("keydown", this.#handleNavigationKey, { capture: true });
  }

  disconnected(): void {
    this.#cancelSidebarResize();
    if (this.#sidebarTransitioning) {
      this.#settleSidebarTransition(this.#sidebarTransitionTargetCollapsed);
    } else {
      this.#sidebarTransition?.cancel();
    }
    this.#application?.removeEventListener("change", this.#render);
    document.removeEventListener("keydown", this.#handleNavigationKey, { capture: true });
  }

  template(
    application: ApplicationService,
    options: TelevisionAppOptions,
  ): TemplateResult {
    const state = selectApplicationState(
      application.snapshot,
      options.serverURL,
    );
    const snapshot = application.snapshot;
    const hasShell = hasApplicationShell(state, snapshot.connection.hasEverConnected);
    if (options.onRenderComplete) {
      queueMicrotask(() => {
        if (this.isConnected) options.onRenderComplete?.(state.kind);
      });
    }
    return html`
      <div
        id="app"
        tabindex="-1"
        data-app-state=${state.kind}
        ?data-sidebar-transition=${this.#sidebarTransitioning}
        ?data-sidebar-motion=${this.#sidebarTransitioning}
        style=${this.#appStyle()}
      >
        ${hasShell ? this.#shell(application, snapshot, options) : null}
        ${state.kind === "needs-upgrade"
          ? DesktopUpgradeGateView(state.instructions, options.desktopUpdate, windowDragStripTemplate(options.electronMode && !hasShell))
          : isInterruptingState(state) ? SystemModalView(state, {
            context: options.electronMode ? "desktop" : "browser",
            dragStrip: options.electronMode && !hasShell,
          }) : null}
      </div>
      <div id="foreground-overlay" inert aria-hidden="true"></div>
    `;
  }

  readonly #handleNavigationKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.#sidebarResize !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.#cancelSidebarResize();
      return;
    }
    if (!isNavigationKeyChord(event, navigator.platform)) return;
    event.preventDefault();
    // The chord is application-level input. Do not also deliver it to a
    // surface's unmodified-arrow handler after entering the shell operation.
    event.stopPropagation();
    this.#application?.handleNavigationKey(event.key);
  };

  readonly #handleTabReorder = (reorder: TabReorderSnapshot | null): void => {
    this.#tabReorder = reorder ?? undefined;
    this.render();
  };

  readonly #render = (): void => {
    this.render();
  };

  readonly #collapseSidebar = (): void => this.#setSidebarCollapsed(true);

  readonly #expandSidebar = (): void => this.#setSidebarCollapsed(false);

  readonly #toggleSidebar = (): void => {
    const target = this.#sidebarTransitioning
      ? !this.#sidebarTransitionTargetCollapsed
      : !this.#sidebarCollapsed;
    this.#setSidebarCollapsed(target);
  };

  #setSidebarCollapsed(collapsed: boolean): void {
    if (!this.#sidebarTransitioning && this.#sidebarCollapsed === collapsed) return;
    if (this.#sidebarTransitioning &&
        this.#sidebarTransitionTargetCollapsed === collapsed) return;
    this.#cancelSidebarResize();
    const restoreToggleFocus = document.activeElement === this.#sidebarToggle;
    this.#sidebarCollapsedPreference?.setCollapsed(collapsed);

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.#settleSidebarTransition(collapsed);
      this.render();
      if (restoreToggleFocus) this.#sidebarToggle?.focus({ preventScroll: true });
      return;
    }

    this.#sidebarTransitionTargetCollapsed = collapsed;
    if (this.#sidebarTransitioning) {
      this.#configureSidebarToggle();
      this.#runSidebarTransition();
      return;
    }

    const toggle = this.#sidebarToggleNode();
    const root = toggle.closest<HTMLElement>("#app");
    const toggleBox = toggle.getBoundingClientRect();
    const rootBox = root?.getBoundingClientRect();
    if (!root || !rootBox || toggleBox.width === 0) {
      this.#settleSidebarTransition(collapsed);
      this.render();
      return;
    }

    for (const animation of root.getAnimations({ subtree: true })) {
      animation.cancel();
    }
    this.#sidebarTransitioning = true;
    this.#sidebarTransitionToggleTop = toggleBox.top - rootBox.top;
    this.#sidebarTransitionGeometry = null;
    toggle.style.left = `${toggleBox.left - rootBox.left}px`;
    toggle.style.top = `${this.#sidebarTransitionToggleTop}px`;
    this.#configureSidebarToggle();
    this.render();
    queueMicrotask(() => {
      if (!this.#sidebarTransitioning) return;
      this.#measureSidebarTransition();
      // Reparenting and measuring the resting layouts may temporarily hide the button.
      if (restoreToggleFocus) toggle.focus({ preventScroll: true });
      this.#runSidebarTransition();
    });
  }

  #runSidebarTransition(): void {
    const root = this.#sidebarToggleNode().closest<HTMLElement>("#app");
    const transition = this.#sidebarTransition;
    if (!root || !transition || !this.#sidebarTransitionGeometry) return;
    const target = this.#sidebarTransitionTargetCollapsed ? 0 : this.#sidebarWidth;
    transition.move({
      root,
      width: this.#sidebarWidth,
      target,
      onFrame: this.#applySidebarTransitionFrame,
      onFinish: this.#finishSidebarTransition,
    });
  }

  #measureSidebarTransition(): void {
    const toggle = this.#sidebarToggleNode();
    const root = toggle.closest<HTMLElement>("#app");
    const sidebarSeat = root?.querySelector<HTMLElement>(
      ".sidebar-titlebar > .sidebar-toggle-seat",
    );
    const lead = root?.querySelector<HTMLElement>(".top-bar > .top-bar-lead");
    const leadSeat = lead?.querySelector<HTMLElement>(":scope > .sidebar-toggle-seat");
    const switcher = lead?.querySelector<HTMLElement>(":scope > .channel-switcher");
    const topBar = lead?.closest<HTMLElement>(".top-bar");
    if (!root || !sidebarSeat || !lead || !leadSeat || !topBar) {
      this.#settleSidebarTransition(this.#sidebarTransitionTargetCollapsed);
      this.render();
      return;
    }

    // Measure each resting layout before painting, without replacing any artifact.
    const sidebar = sidebarSeat.closest<HTMLElement>(".app-sidebar")!;
    root.removeAttribute("data-sidebar-motion");
    const rootBox = root.getBoundingClientRect();
    const leadDisplay = lead.style.display;
    lead.style.display = "none";
    const sidebarSeatBox = sidebarSeat.getBoundingClientRect();
    sidebar.style.marginLeft = `${-this.#sidebarWidth}px`;
    lead.style.display = leadDisplay;
    const leadSeatBox = leadSeat.getBoundingClientRect();
    const switcherBox = switcher?.getBoundingClientRect();
    this.#sidebarTransitionGeometry = {
      expandedSidebarWidth: this.#sidebarWidth,
      expandedToggleLeft: sidebarSeatBox.left - rootBox.left,
      collapsedToggleLeft: leadSeatBox.left - rootBox.left,
      toggleTop: this.#sidebarTransitionToggleTop,
      toggleWidth: leadSeatBox.width,
      toggleHeight: leadSeatBox.height,
      toggleSwitcherGap: switcherBox ? switcherBox.left - leadSeatBox.right : 0,
      collapsedLeadReservation: lead.getBoundingClientRect().width,
      hasSwitcher: Boolean(switcher),
      barInset: topBar.getBoundingClientRect().left - rootBox.left,
    };
    sidebar.style.removeProperty("margin-left");
    root.setAttribute("data-sidebar-motion", "");
    this.#applySidebarTransitionFrame(this.#sidebarBoundary);
  }

  readonly #applySidebarTransitionFrame = (boundary: number): void => {
    const geometry = this.#sidebarTransitionGeometry;
    const root = this.#sidebarToggleNode().closest<HTMLElement>("#app");
    if (!geometry || !root) return;
    this.#sidebarBoundary = boundary;
    const pose = sidebarPose(1 - boundary / geometry.expandedSidebarWidth, geometry);
    const pixels = (name: string, value: number): void => {
      root.style.setProperty(`--motion-${name}`, `${value}px`);
    };
    pixels("boundary", pose.sidebarBoundary);
    pixels("toggle-left", pose.toggleLeft);
    pixels("toggle-top", geometry.toggleTop);
    pixels("toggle-width", geometry.toggleWidth);
    pixels("toggle-height", geometry.toggleHeight);
    pixels("toggle-wipe", pose.toggleWipe);
    pixels("lead-reservation", pose.leadReservation);
    pixels("switcher-left", geometry.collapsedToggleLeft + geometry.toggleWidth +
      geometry.toggleSwitcherGap - pose.sidebarBoundary - geometry.barInset);
    root.style.setProperty("--motion-titlebar-opacity", String(pose.titlebarOpacity));
    root.style.setProperty("--motion-switcher-opacity", String(pose.switcherOpacity));
    // Initial placement used inline coordinates before the authored motion variables existed.
    const toggle = this.#sidebarToggleNode();
    toggle.style.removeProperty("left");
    toggle.style.removeProperty("top");
  };

  readonly #finishSidebarTransition = (boundary: number): void => {
    if (!this.#sidebarTransitioning) return;
    const collapsed = boundary === 0;
    if (collapsed !== this.#sidebarTransitionTargetCollapsed) return;
    const restoreToggleFocus = document.activeElement === this.#sidebarToggle;
    this.#settleSidebarTransition(collapsed);
    this.render();
    if (restoreToggleFocus) this.#sidebarToggle?.focus({ preventScroll: true });
  };

  #settleSidebarTransition(collapsed: boolean): void {
    this.#sidebarTransition?.cancel();
    this.#sidebarCollapsed = collapsed;
    this.#sidebarTransitioning = false;
    this.#sidebarBoundary = collapsed ? 0 : this.#sidebarWidth;
    this.#sidebarTransition = new SidebarCollapseTransition(this.#sidebarBoundary);
    this.#sidebarTransitionGeometry = null;
    this.#clearSidebarToggleTransitionStyle();
    this.#configureSidebarToggle();
  }

  #sidebarToggleNode(): HTMLButtonElement {
    if (this.#sidebarToggle !== null) return this.#sidebarToggle;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.setAttribute("variant", "ghost");
    toggle.setAttribute("icon", "");
    toggle.append(this.#sidebarToggleIcon());
    toggle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      toggle.setPointerCapture(event.pointerId);
    });
    toggle.addEventListener("click", this.#toggleSidebar);
    this.#sidebarToggle = toggle;
    this.#configureSidebarToggle();
    return toggle;
  }

  #configureSidebarToggle(): void {
    const toggle = this.#sidebarToggle;
    if (toggle === null) return;
    const expands = this.#sidebarTransitioning
      ? this.#sidebarTransitionTargetCollapsed
      : this.#sidebarCollapsed;
    toggle.className = this.#sidebarTransitioning
      ? "sidebar-motion-toggle sidebar-toggle"
      : expands ? "sidebar-expand" : "sidebar-collapse";
    if (this.#sidebarTransitioning) {
      if (toggle.querySelectorAll(":scope > .sidebar-toggle-paint").length !== 2) {
        toggle.replaceChildren(
          this.#sidebarTogglePaint("expanded-paint"),
          this.#sidebarTogglePaint("collapsed-paint"),
        );
      }
    } else if (
      toggle.children.length !== 1 ||
      !toggle.firstElementChild?.matches("tv-icon[name='sidebar']")
    ) {
      toggle.replaceChildren(this.#sidebarToggleIcon());
    }
    const label = expands ? "Show sidebar" : "Collapse sidebar";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }

  #sidebarToggleIcon(): HTMLElement {
    const icon = document.createElement("tv-icon");
    icon.setAttribute("name", "sidebar");
    icon.setAttribute("size", "sm");
    return icon;
  }

  #sidebarTogglePaint(className: string): HTMLElement {
    const paint = document.createElement("span");
    paint.className = `sidebar-toggle-paint ${className}`;
    paint.setAttribute("aria-hidden", "true");
    paint.append(this.#sidebarToggleIcon());
    return paint;
  }

  #clearSidebarToggleTransitionStyle(): void {
    const toggle = this.#sidebarToggle;
    if (toggle === null) return;
    toggle.style.removeProperty("left");
    toggle.style.removeProperty("top");
  }

  #appStyle(): string {
    const properties = [`--sidebar-width: ${this.#sidebarWidth}px`];
    if (this.#sidebarTransitioning) {
      properties.push(`--motion-boundary: ${this.#sidebarBoundary}px`);
    }
    return properties.join("; ");
  }

  readonly #beginSidebarResize = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#sidebarResize !== null) return;
    const handle = event.currentTarget as HTMLElement;
    const root = handle.closest<HTMLElement>("#app");
    if (root === null) return;
    handle.setPointerCapture(event.pointerId);
    this.#sidebarResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.#sidebarWidth,
      root,
    };
    event.preventDefault();
  };

  readonly #moveSidebarResize = (event: PointerEvent): void => {
    const resize = this.#sidebarResize;
    if (resize === null || event.pointerId !== resize.pointerId) return;
    this.#setSidebarWidth(
      resize.root,
      resize.startWidth + event.clientX - resize.startX,
    );
  };

  readonly #commitSidebarResize = (event: PointerEvent): void => {
    const resize = this.#sidebarResize;
    if (resize === null || event.pointerId !== resize.pointerId) return;
    this.#sidebarResize = null;
    const committedWidth = this.#sidebarWidthPreference?.commit(this.#sidebarWidth)
      ?? this.#sidebarWidth;
    this.#setSidebarWidth(resize.root, committedWidth);
  };

  readonly #cancelSidebarResizeEvent = (event: PointerEvent): void => {
    const resize = this.#sidebarResize;
    if (resize === null || event.pointerId !== resize.pointerId) return;
    this.#cancelSidebarResize();
  };

  readonly #clearSidebarWidth = (event: MouseEvent): void => {
    const root = (event.currentTarget as HTMLElement).closest<HTMLElement>("#app");
    if (root === null) return;
    this.#sidebarWidthPreference?.clear();
    this.#setSidebarWidth(root, CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX);
  };

  #cancelSidebarResize(): void {
    const resize = this.#sidebarResize;
    if (resize === null) return;
    this.#sidebarResize = null;
    this.#setSidebarWidth(resize.root, resize.startWidth);
    const handle = resize.root.querySelector<HTMLElement>(".app-sidebar-resize");
    if (handle?.hasPointerCapture(resize.pointerId)) {
      handle.releasePointerCapture(resize.pointerId);
    }
  }

  #setSidebarWidth(root: HTMLElement, width: number): void {
    this.#sidebarWidth = clampSidebarWidth(width);
    this.#settleSidebarTransition(this.#sidebarCollapsed);
    root.style.setProperty("--sidebar-width", `${this.#sidebarWidth}px`);
  }

  #shell(
    application: ApplicationService,
    snapshot: ApplicationSnapshot,
    options: TelevisionAppOptions,
  ): TemplateResult {
    const showSidebar = !this.#sidebarCollapsed || this.#sidebarTransitioning;
    const toggle = this.#sidebarToggleNode();
    return html`
      ${showSidebar
        ? html`
            <aside class="app-sidebar">
              ${ChannelSidebarView(
                application,
                snapshot,
                options.electronMode,
                this.#collapseSidebar,
                this.#sidebarTransitioning ? null : toggle,
                this.#sidebarTransitioning,
              )}
            </aside>
            ${this.#sidebarTransitioning
              ? null
              : html`
                  <div
                    class="app-sidebar-resize"
                    aria-hidden="true"
                    @pointerdown=${this.#beginSidebarResize}
                    @pointermove=${this.#moveSidebarResize}
                    @pointerup=${this.#commitSidebarResize}
                    @pointercancel=${this.#cancelSidebarResizeEvent}
                    @lostpointercapture=${this.#cancelSidebarResizeEvent}
                    @dblclick=${this.#clearSidebarWidth}
                  ></div>
                `}
          `
        : null}
      <main class="app-main">
        ${TopBarView(application, snapshot, {
          connectionOwner: options.connectionOwner,
          updatePresentation: options.updatePresentation,
          desktopRecommendation: options.desktopRecommendation,
          desktopUpdate: options.desktopUpdate,
          onTabReorderChange: this.#handleTabReorder,
          collapsed: this.#sidebarCollapsed,
          onExpandSidebar: this.#expandSidebar,
          sidebarToggle: this.#sidebarTransitioning
            ? null
            : this.#sidebarCollapsed ? toggle : undefined,
          sidebarTransitioning: this.#sidebarTransitioning,
        })}
        ${StageView(
          application,
          snapshot.focusedChannel,
          this.#tabReorder,
          this.#sidebarTransitioning,
        )}
      </main>
      ${this.#sidebarTransitioning ? toggle : null}
    `;
  }
}

export const TelevisionAppView = view(TelevisionApp);

function hasApplicationShell(state: ApplicationState, hasEverConnected: boolean): boolean {
  return state.kind === "connected" ||
    state.kind === "no-channel" ||
    state.kind === "empty-channel" ||
    state.kind === "disconnected" ||
    (state.kind === "error" && hasEverConnected);
}

function isInterruptingState(
  state: ApplicationState,
): state is Exclude<ApplicationState, { kind: "connected" | "no-channel" | "empty-channel" }> {
  return state.kind !== "connected" &&
    state.kind !== "no-channel" &&
    state.kind !== "empty-channel";
}
