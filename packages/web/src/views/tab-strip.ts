import { html } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { createRef, ref, type Ref } from "lit-html/directives/ref.js";
import { styleMap } from "lit-html/directives/style-map.js";
import { view, View } from "@telepath-computer/utils/lit-view";
import type {
  ApplicationChannelSnapshot,
  ApplicationPageSnapshot,
  ApplicationService,
} from "../services/application-service.ts";
import {
  CROSSING_DURATION_MS,
  TAB_COMPRESSION_FLOOR_PX,
  TAB_COMPRESSION_FLOOR_SLACK_PX,
  TAB_OVERFLOW_FADE_PX,
} from "../constants.ts";
import {
  DRAG_AUTOSCROLL_SPEED_PX_S,
  DRAG_AUTOSCROLL_ZONE_PX,
  DRAG_DISPLACEMENT_DURATION_MS,
  DRAG_PRESS_THRESHOLD_PX,
} from "./drag-measurements.ts";
import { mountItemEdgeFade } from "../item-edge-fade.ts";
import { setPageFullScreen } from "./page-full-screen.ts";
import {
  type TabReorderChange,
  type TabReorderSnapshot,
} from "./tab-reorder.ts";
import "./tab-strip.css";
import "./tab-strip.host.css";
import "./tab-strip.drag.css";

const SCROLL_EDGE_TOLERANCE_PX = 0.5;
interface RenderedTab {
  readonly page: ApplicationPageSnapshot;
  readonly artifactId: string | null;
  readonly label: string;
  readonly key: string;
}

interface PointerGesture {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly tab: HTMLElement;
  readonly application: ApplicationService;
  readonly channelId: string;
  readonly artifactId: string;
  readonly originalPages: readonly ApplicationPageSnapshot[];
  readonly onReorderChange: TabReorderChange | undefined;
  readonly displacementAnimations: Set<Animation>;
  provisionalPages: readonly ApplicationPageSnapshot[];
  slot: number;
  currentX: number;
  currentY: number;
  tabLeft: number;
  tabTop: number;
  tabWidth: number;
  tabHeight: number;
  edgeScrollFrame: number;
  edgeScrollTimestamp: number | null;
  edgeScrollRemainder: number;
  edgeScrollMoved: boolean;
  dragging: boolean;
}

/** The focused channel's ordered, locally selected page tabs. */
export class TabStrip extends View<[
  ApplicationService,
  ApplicationChannelSnapshot | null,
  (string | null)?,
  TabReorderChange?,
  boolean?,
]> {
  #stripRef: Ref<HTMLElement> = createRef();
  #selectedArtifactId: string | null | undefined;
  #listSignature: string | undefined;
  #layoutQueued = false;
  #layoutFrame = 0;
  #centreRequested = false;
  #selectionCentreRequested = false;
  #selectionMotionRequested = false;
  #selectionCrossingFrame = 0;
  #selectionCrossing: Animation | null = null;
  #compressionClassificationRequested = false;
  #resizeObserver: ResizeObserver | null = null;
  #observedStrip: HTMLElement | null = null;
  #edgeFade: ReturnType<typeof mountItemEdgeFade> | null = null;
  #appearanceObserver: MutationObserver | null = null;
  #fontsReadyRequested = false;
  #pointerGesture: PointerGesture | null = null;
  #suppressPointerClick = false;
  #preserveEdgeScroll = false;
  #motionSuppressed = false;

  connected(): void {
    this.#selectedArtifactId = undefined;
    this.#listSignature = undefined;
    this.#compressionClassificationRequested = false;
    this.#requestFontSettlement();
    if (typeof document !== "undefined") {
      document.fonts?.addEventListener("loadingdone", this.#handleFontsLoadingDone);
    }
    document.addEventListener("television-theme-styles-changed", this.#handleStylesChanged);
    this.#appearanceObserver = new MutationObserver(this.#handleStylesChanged);
    this.#appearanceObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme"],
    });
    window.addEventListener("pointermove", this.#handlePointerMove);
    window.addEventListener("pointerup", this.#handlePointerUp);
    window.addEventListener("pointercancel", this.#handlePointerCancel);
    window.addEventListener("keydown", this.#handleWindowKeyDown);
  }

  template(
    application: ApplicationService,
    channel: ApplicationChannelSnapshot | null,
    carriedArtifactId: string | null = null,
    onReorderChange?: TabReorderChange,
    motionSuppressed = false,
  ): unknown {
    this.#setMotionSuppressed(motionSuppressed);
    const pointerGesture = this.#pointerGesture?.dragging
      ? this.#pointerGesture
      : null;
    const pages = pointerGesture?.provisionalPages ?? channel?.pages;
    const tabs = renderedTabs(channel, pages);
    const activeCarriedArtifactId = pointerGesture?.artifactId ?? carriedArtifactId;
    const selectedArtifactId = channel?.selectedPage?.artifactIds[0] ?? null;
    const listSignature = `${channel?.id ?? ""}:${tabs.map(({ key, label }) => `${key}:${label}`).join("|")}`;
    const selectionChanged = selectedArtifactId !== this.#selectedArtifactId;
    const listChanged = listSignature !== this.#listSignature;
    if (selectionChanged) this.#preserveEdgeScroll = false;
    const shouldCentre = selectionChanged ||
      (pointerGesture === null && listChanged);
    if (listChanged) this.#compressionClassificationRequested = true;
    this.#selectedArtifactId = selectedArtifactId;
    this.#listSignature = listSignature;
    this.#requestLayout(
      shouldCentre,
      selectionChanged,
      selectionChanged && !listChanged,
    );

    return html`
      <div
        class="tab-strip"
        role="tablist"
        ${ref(this.#stripRef)}
        ?tab-held=${pointerGesture !== null}
        @scroll=${this.#handleScroll}
        @lostpointercapture=${this.#handleLostPointerCapture}
      >
        ${repeat(
          tabs,
          ({ key }) => key,
          (tab, index) => {
            const selected = tab.artifactId !== null &&
              tab.artifactId === selectedArtifactId;
            const carried = tab.artifactId !== null &&
              tab.artifactId === activeCarriedArtifactId;
            const pointerCarried = carried && pointerGesture !== null;
            return html`
              ${carried
                ? html`
                    <span
                      class="tab-placeholder"
                      aria-hidden="true"
                      style=${styleMap(pointerCarried
                        ? {
                            width: `${pointerGesture.tabWidth}px`,
                            height: `${pointerGesture.tabHeight}px`,
                          }
                        : {})}
                    ></span>
                  `
                : null}
              <div
                class=${carried ? "tab dragged" : "tab"}
                ?dragging=${pointerCarried}
                style=${styleMap(pointerCarried
                  ? {
                      left: `${pointerGesture.tabLeft + pointerGesture.currentX - pointerGesture.originX}px`,
                      top: `${pointerGesture.tabTop + pointerGesture.currentY - pointerGesture.originY}px`,
                      width: `${pointerGesture.tabWidth}px`,
                      height: `${pointerGesture.tabHeight}px`,
                    }
                  : {})}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  (event.currentTarget as HTMLElement).click();
                }}
                role="tab"
                aria-selected=${selected ? "true" : "false"}
                tabindex=${selected ? "0" : "-1"}
                data-artifact-id=${tab.artifactId ?? ""}
                @pointerdown=${activeCarriedArtifactId === null
                  ? (event: PointerEvent) =>
                    this.#handlePointerDown(
                      event,
                      application,
                      channel,
                      tab,
                      onReorderChange,
                    )
                  : null}
                @click=${(event: MouseEvent) =>
                  this.#handleClick(event, application, channel, tab)}
                @dblclick=${selected && channel !== null && !pointerCarried
                  ? () => setPageFullScreen(
                      application,
                      channel,
                      tab.page,
                      !tab.page.geometry.full_screen,
                    )
                  : null}
              >
                <span class="tab-label">${tab.label}</span>
              </div>
            `;
          },
        )}
      </div>
    `;
  }

  disconnected(): void {
    this.#layoutQueued = false;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.#layoutFrame);
    }
    this.#layoutFrame = 0;
    this.#centreRequested = false;
    this.#selectionCentreRequested = false;
    this.#selectionMotionRequested = false;
    this.#cancelSelectionCrossing();
    this.#preserveEdgeScroll = false;
    this.#compressionClassificationRequested = false;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedStrip = null;
    this.#edgeFade?.dispose();
    this.#edgeFade = null;
    this.#appearanceObserver?.disconnect();
    this.#appearanceObserver = null;
    document.removeEventListener("television-theme-styles-changed", this.#handleStylesChanged);
    if (typeof document !== "undefined") {
      document.fonts?.removeEventListener("loadingdone", this.#handleFontsLoadingDone);
    }
    window.removeEventListener("pointermove", this.#handlePointerMove);
    window.removeEventListener("pointerup", this.#handlePointerUp);
    window.removeEventListener("pointercancel", this.#handlePointerCancel);
    window.removeEventListener("keydown", this.#handleWindowKeyDown);
    this.#finishPointerGesture(false, false);
    this.#suppressPointerClick = false;
  }

  readonly #handleScroll = (): void => {
    this.#updateOverflow();
  };

  #handlePointerDown(
    event: PointerEvent,
    application: ApplicationService,
    channel: ApplicationChannelSnapshot | null,
    tab: RenderedTab,
    onReorderChange: TabReorderChange | undefined,
  ): void {
    if (this.#motionSuppressed || this.#pointerGesture !== null || channel === null ||
        tab.artifactId === null || event.button !== 0 || !event.isPrimary) return;
    this.#suppressPointerClick = false;
    this.#pointerGesture = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      tab: event.currentTarget as HTMLElement,
      application,
      channelId: channel.id,
      artifactId: tab.artifactId,
      originalPages: channel.pages,
      onReorderChange,
      displacementAnimations: new Set(),
      provisionalPages: [...channel.pages],
      slot: channel.pages.indexOf(tab.page),
      currentX: event.clientX,
      currentY: event.clientY,
      tabLeft: 0,
      tabTop: 0,
      tabWidth: 0,
      tabHeight: 0,
      edgeScrollFrame: 0,
      edgeScrollTimestamp: null,
      edgeScrollRemainder: 0,
      edgeScrollMoved: false,
      dragging: false,
    };
  }

  #handleClick(
    event: MouseEvent,
    application: ApplicationService,
    channel: ApplicationChannelSnapshot | null,
    tab: RenderedTab,
  ): void {
    if (event.detail !== 0 && this.#suppressPointerClick) {
      this.#suppressPointerClick = false;
      return;
    }
    this.#suppressPointerClick = false;
    if (this.#pointerGesture?.dragging || channel === null || tab.artifactId === null) return;
    application.selectPage(channel.id, tab.artifactId);
  }

  readonly #handlePointerMove = (event: PointerEvent): void => {
    const gesture = this.#pointerGesture;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging && Math.hypot(
      event.clientX - gesture.originX,
      event.clientY - gesture.originY,
    ) <= DRAG_PRESS_THRESHOLD_PX) return;

    const strip = this.#stripRef.value;
    if (!strip) return;
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    if (!gesture.dragging) {
      this.#cancelSelectionCrossing();
      const box = gesture.tab.getBoundingClientRect();
      this.#suppressPointerClick = true;
      gesture.dragging = true;
      gesture.tabLeft = box.left;
      gesture.tabTop = box.top;
      gesture.tabWidth = box.width;
      gesture.tabHeight = box.height;
      strip.setPointerCapture(event.pointerId);
      this.render();
      gesture.onReorderChange?.(this.#reorderSnapshot(gesture));
    } else {
      this.render();
    }
    this.#updateProvisionalOrder(gesture);
    this.#updateEdgeScroll(gesture);
  };

  readonly #handlePointerUp = (event: PointerEvent): void => {
    const gesture = this.#pointerGesture;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    this.#finishPointerGesture(true, true);
  };

  readonly #handlePointerCancel = (event: PointerEvent): void => {
    if (this.#pointerGesture?.pointerId !== event.pointerId) return;
    this.#finishPointerGesture(false, true);
  };

  readonly #handleLostPointerCapture = (event: PointerEvent): void => {
    if (this.#pointerGesture?.pointerId !== event.pointerId) return;
    this.#finishPointerGesture(false, true);
  };

  readonly #handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#pointerGesture?.dragging) return;
    event.preventDefault();
    this.#finishPointerGesture(false, true);
  };

  #finishPointerGesture(commit: boolean, rerender: boolean): void {
    const gesture = this.#pointerGesture;
    if (gesture === null) return;
    this.#stopEdgeScroll(gesture);
    if (gesture.edgeScrollMoved) this.#preserveEdgeScroll = true;
    if (gesture.dragging) {
      this.#centreRequested = this.#selectionCentreRequested;
      if (!this.#selectionCentreRequested) this.#selectionMotionRequested = false;
    }
    if (gesture.dragging && commit &&
        !samePageOrder(gesture.originalPages, gesture.provisionalPages)) {
      const pages = gesture.provisionalPages.map((page) => ({
        artifactIds: [...page.artifactIds],
        geometry: { ...page.geometry },
        size: { ...page.size },
      }));
      void gesture.application.updateChannelPages(gesture.channelId, pages).catch(() => {});
    }
    if (!commit) {
      for (const animation of gesture.displacementAnimations) animation.cancel();
    }
    this.#pointerGesture = null;
    gesture.onReorderChange?.(null);
    const strip = this.#stripRef.value;
    if (gesture.dragging && strip?.hasPointerCapture(gesture.pointerId)) {
      strip.releasePointerCapture(gesture.pointerId);
    }
    if (rerender) this.render();
  }

  #updateEdgeScroll(gesture: PointerGesture): void {
    const strip = this.#stripRef.value;
    const velocity = strip ? this.#edgeScrollVelocity(strip, gesture.currentX) : 0;
    const maximum = strip ? Math.max(0, strip.scrollWidth - strip.clientWidth) : 0;
    const blocked = velocity < 0
      ? (strip?.scrollLeft ?? 0) <= SCROLL_EDGE_TOLERANCE_PX
      : (strip?.scrollLeft ?? 0) >= maximum - SCROLL_EDGE_TOLERANCE_PX;
    if (this.#motionSuppressed || !gesture.dragging || velocity === 0 || maximum === 0 || blocked ||
        typeof requestAnimationFrame !== "function") {
      this.#stopEdgeScroll(gesture);
      return;
    }
    if (gesture.edgeScrollFrame !== 0) return;
    gesture.edgeScrollFrame = requestAnimationFrame((timestamp) => {
      this.#runEdgeScrollFrame(gesture, timestamp);
    });
  }

  #runEdgeScrollFrame(gesture: PointerGesture, timestamp: number): void {
    gesture.edgeScrollFrame = 0;
    if (this.#motionSuppressed || this.#pointerGesture !== gesture || !gesture.dragging) {
      gesture.edgeScrollTimestamp = null;
      return;
    }
    const strip = this.#stripRef.value;
    if (!strip) {
      gesture.edgeScrollTimestamp = null;
      return;
    }
    const velocity = this.#edgeScrollVelocity(strip, gesture.currentX);
    const previousTimestamp = gesture.edgeScrollTimestamp;
    gesture.edgeScrollTimestamp = timestamp;
    if (velocity !== 0 && previousTimestamp !== null) {
      const elapsedSeconds = Math.max(0, timestamp - previousTimestamp) / 1_000;
      const maximum = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const before = strip.scrollLeft;
      const desiredDelta = velocity * elapsedSeconds + gesture.edgeScrollRemainder;
      const target = Math.max(0, Math.min(maximum, before + desiredDelta));
      strip.scrollLeft = target;
      const appliedDelta = strip.scrollLeft - before;
      if (appliedDelta !== 0) gesture.edgeScrollMoved = true;
      gesture.edgeScrollRemainder = target === 0 || target === maximum
        ? 0
        : desiredDelta - appliedDelta;
      if (appliedDelta !== 0) {
        this.#updateOverflow(strip);
        this.#updateProvisionalOrder(gesture);
      }
    }
    this.#updateEdgeScroll(gesture);
  }

  #stopEdgeScroll(gesture: PointerGesture): void {
    if (gesture.edgeScrollFrame !== 0 &&
        typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(gesture.edgeScrollFrame);
    }
    gesture.edgeScrollFrame = 0;
    gesture.edgeScrollTimestamp = null;
    gesture.edgeScrollRemainder = 0;
  }

  #edgeScrollVelocity(strip: HTMLElement, pointerX: number): number {
    const box = strip.getBoundingClientRect();
    if (pointerX >= box.left && pointerX < box.left + DRAG_AUTOSCROLL_ZONE_PX) {
      return -DRAG_AUTOSCROLL_SPEED_PX_S *
        (box.left + DRAG_AUTOSCROLL_ZONE_PX - pointerX) /
        DRAG_AUTOSCROLL_ZONE_PX;
    }
    if (pointerX > box.right - DRAG_AUTOSCROLL_ZONE_PX && pointerX <= box.right) {
      return DRAG_AUTOSCROLL_SPEED_PX_S *
        (pointerX - (box.right - DRAG_AUTOSCROLL_ZONE_PX)) /
        DRAG_AUTOSCROLL_ZONE_PX;
    }
    return 0;
  }

  #updateProvisionalOrder(gesture: PointerGesture): void {
    const strip = this.#stripRef.value;
    const placeholder = strip?.querySelector<HTMLElement>(".tab-placeholder");
    if (!strip || !placeholder) return;
    const carried = placeholder.nextElementSibling;
    const carriedBox = gesture.tab.getBoundingClientRect();
    const centre = carriedBox.left + carriedBox.width / 2;
    let target = gesture.slot;
    let previous = placeholder.previousElementSibling;
    while (previous?.classList.contains("tab")) {
      const box = previous.getBoundingClientRect();
      if (centre >= box.left + box.width / 2) break;
      target -= 1;
      previous = previous.previousElementSibling;
    }
    let next = carried?.nextElementSibling;
    while (next?.classList.contains("tab")) {
      const box = next.getBoundingClientRect();
      if (centre <= box.left + box.width / 2) break;
      target += 1;
      next = next.nextElementSibling;
    }
    if (target === gesture.slot) return;

    const from = this.#tabPositions(strip);
    const provisionalPages = [...gesture.provisionalPages];
    const [page] = provisionalPages.splice(gesture.slot, 1);
    if (!page) return;
    provisionalPages.splice(target, 0, page);
    gesture.provisionalPages = provisionalPages;
    gesture.slot = target;
    this.render();
    gesture.onReorderChange?.(this.#reorderSnapshot(gesture));
    queueMicrotask(() => this.#animateTabDisplacement(gesture, from));
  }

  #reorderSnapshot(gesture: PointerGesture): TabReorderSnapshot {
    return {
      channelId: gesture.channelId,
      pages: gesture.provisionalPages,
      carriedArtifactId: gesture.artifactId,
    };
  }

  #tabPositions(strip: HTMLElement): ReadonlyMap<string, number> {
    return new Map(
      [...strip.querySelectorAll<HTMLElement>(".tab:not([dragging])")].map((tab) => [
        tab.dataset.artifactId ?? "",
        tab.getBoundingClientRect().left,
      ]),
    );
  }

  #animateTabDisplacement(
    gesture: PointerGesture,
    from: ReadonlyMap<string, number>,
  ): void {
    if (this.#motionSuppressed) return;
    const strip = this.#stripRef.value;
    if (!strip) return;
    for (const tab of strip.querySelectorAll<HTMLElement>(".tab:not([dragging])")) {
      const start = from.get(tab.dataset.artifactId ?? "");
      if (start === undefined) continue;
      const delta = start - tab.getBoundingClientRect().left;
      if (Math.abs(delta) <= SCROLL_EDGE_TOLERANCE_PX) continue;
      const animation = tab.animate(
        { translate: [`${delta}px 0`, "0px 0"] },
        { duration: DRAG_DISPLACEMENT_DURATION_MS, easing: "ease" },
      );
      gesture.displacementAnimations.add(animation);
      void animation.finished.finally(() => {
        gesture.displacementAnimations.delete(animation);
      }).catch(() => {});
    }
  }

  readonly #handleStylesChanged = (): void => {
    this.#compressionClassificationRequested = true;
    this.#requestLayout(false);
  };

  readonly #handleFontsLoadingDone = (): void => {
    // Font loading is external to this view's layout writes, so it cannot form
    // a classification feedback loop.
    this.#compressionClassificationRequested = true;
    this.#requestLayout(true);
  };

  #requestFontSettlement(): void {
    if (this.#fontsReadyRequested || typeof document === "undefined" || !document.fonts) return;
    this.#fontsReadyRequested = true;
    void document.fonts.ready.then(() => {
      if (!this.isConnected) return;
      this.#compressionClassificationRequested = true;
      this.#requestLayout(true);
    });
  }

  #requestLayout(
    centre: boolean,
    selected = false,
    animateSelection = false,
  ): void {
    this.#centreRequested ||= centre;
    if (centre && selected) {
      this.#selectionCentreRequested = true;
      this.#selectionMotionRequested = animateSelection && !this.#motionSuppressed;
    }
    if (this.#layoutQueued || this.#layoutFrame !== 0) return;
    this.#layoutQueued = true;
    queueMicrotask(() => {
      this.#layoutQueued = false;
      if (!this.isConnected) return;
      if (typeof requestAnimationFrame !== "function") {
        this.#applyLayout();
        return;
      }
      this.#layoutFrame = requestAnimationFrame(() => {
        this.#layoutFrame = 0;
        this.#applyLayout();
      });
    });
  }

  #applyLayout(): void {
    const strip = this.#stripRef.value;
    if (!strip) return;
    if (this.#compressionClassificationRequested) {
      this.#compressionClassificationRequested = false;
      this.#updateCompressionClassifications(strip);
    }
    this.#observeStrip(strip);
    this.#updateLabelOverflow(strip);
    const dragging = this.#pointerGesture?.dragging === true;
    const selectionCentre = this.#selectionCentreRequested;
    const animateSelection = selectionCentre && this.#selectionMotionRequested;
    const centre = !dragging && (
      selectionCentre || (this.#centreRequested && !this.#preserveEdgeScroll)
    );
    if (dragging) {
      this.#centreRequested = selectionCentre;
    } else {
      this.#centreRequested = false;
      this.#selectionCentreRequested = false;
      this.#selectionMotionRequested = false;
      if (selectionCentre) this.#preserveEdgeScroll = false;
    }
    if (centre) this.#centreSelectedTab(strip, animateSelection);
    this.#updateOverflow(strip);
    this.#edgeFade?.refresh();
  }

  #updateLabelOverflow(strip: HTMLElement): void {
    for (const label of strip.querySelectorAll<HTMLElement>(".tab-label")) {
      label.toggleAttribute("data-overflow", label.scrollWidth > label.clientWidth);
    }
  }

  #updateCompressionClassifications(strip: HTMLElement): void {
    for (const tab of strip.querySelectorAll<HTMLElement>(".tab")) {
      const label = tab.querySelector<HTMLElement>(".tab-label");
      if (!label) continue;
      const range = document.createRange();
      range.selectNodeContents(label);
      // JSDOM omits Range geometry; real browsers always provide this method.
      const rangeBox = range.getBoundingClientRect?.();
      if (!rangeBox || rangeBox.width <= 0) continue;
      const style = getComputedStyle(tab);
      // Gecko's device-pixel-rounded borders can move a boundary by less than
      // one CSS pixel until the next label or font classification pass.
      const horizontalChrome = px(style.paddingLeft) + px(style.paddingRight) +
        px(style.borderLeftWidth) + px(style.borderRightWidth);
      const naturalTextWidth = Math.ceil(rangeBox.width);
      const compression = naturalTextWidth + horizontalChrome >
          TAB_COMPRESSION_FLOOR_PX + TAB_COMPRESSION_FLOOR_SLACK_PX
        ? "capped"
        : "hugging";
      if (tab.dataset.compression !== compression) {
        tab.dataset.compression = compression;
      }
    }
  }

  #observeStrip(strip: HTMLElement): void {
    if (typeof ResizeObserver === "undefined" || this.#observedStrip === strip) return;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver ??= new ResizeObserver(() => {
      if (this.#motionSuppressed) {
        // The sidebar has already moved this frame; update its tab layout before paint.
        this.#centreRequested = true;
        this.#applyLayout();
      } else {
        this.#requestLayout(true);
      }
    });
    this.#resizeObserver.observe(strip);
    this.#observedStrip = strip;
    this.#edgeFade?.dispose();
    this.#edgeFade = mountItemEdgeFade(strip, {
      items: ".tab:not(.dragged)",
      distance: TAB_OVERFLOW_FADE_PX,
      edges: "both",
    });
  }

  #centreSelectedTab(strip: HTMLElement, animate: boolean): void {
    const selected = strip.querySelector<HTMLElement>('.tab[aria-selected="true"]');
    if (!selected) {
      this.#cancelSelectionCrossing();
      return;
    }
    const stripBox = strip.getBoundingClientRect();
    const selectedBox = selected.getBoundingClientRect();
    // Reorder displacement may still be running when a drag releases.
    const selectedTranslateX = px(getComputedStyle(selected).translate);
    const target = Math.max(
      0,
      Math.min(
        strip.scrollLeft + selectedBox.left - selectedTranslateX + selectedBox.width / 2 -
          (stripBox.left + stripBox.width / 2),
        strip.scrollWidth - strip.clientWidth,
      ),
    );
    this.#cancelSelectionCrossing();
    if (this.#motionSuppressed || !animate ||
        Math.abs(strip.scrollLeft - target) <= SCROLL_EDGE_TOLERANCE_PX ||
        matchMedia("(prefers-reduced-motion: reduce)").matches) {
      strip.scrollLeft = target;
      return;
    }

    const from = strip.scrollLeft;
    const animation = strip.animate([{}, {}], {
      duration: CROSSING_DURATION_MS,
      easing: "ease",
    });
    this.#selectionCrossing = animation;

    const move = (): void => {
      if (animation !== this.#selectionCrossing) return;
      const progress = animation.playState === "finished"
        ? 1
        : animation.effect?.getComputedTiming().progress ?? 0;
      strip.scrollLeft = from + (target - from) * progress;
      if (animation.playState === "finished") {
        strip.scrollLeft = target;
        this.#selectionCrossing = null;
        this.#selectionCrossingFrame = 0;
        this.#updateOverflow(strip);
      } else {
        this.#selectionCrossingFrame = requestAnimationFrame(move);
      }
    };
    this.#selectionCrossingFrame = requestAnimationFrame(move);
  }

  #cancelSelectionCrossing(): void {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.#selectionCrossingFrame);
    }
    this.#selectionCrossingFrame = 0;
    this.#selectionCrossing?.cancel();
    this.#selectionCrossing = null;
  }

  #setMotionSuppressed(suppressed: boolean): void {
    if (this.#motionSuppressed === suppressed) return;
    this.#motionSuppressed = suppressed;
    if (!suppressed) return;
    this.#cancelSelectionCrossing();
    this.#selectionMotionRequested = false;
    this.#preserveEdgeScroll = false;
    const gesture = this.#pointerGesture;
    if (gesture !== null) {
      this.#stopEdgeScroll(gesture);
      for (const animation of gesture.displacementAnimations) animation.cancel();
      gesture.displacementAnimations.clear();
      this.#pointerGesture = null;
      if (gesture.dragging && this.#stripRef.value?.hasPointerCapture(gesture.pointerId)) {
        this.#stripRef.value.releasePointerCapture(gesture.pointerId);
      }
      queueMicrotask(() => gesture.onReorderChange?.(null));
    }
    this.#requestLayout(true, true, false);
  }

  #updateOverflow(strip = this.#stripRef.value): void {
    if (!strip) return;
    const maximum = Math.max(0, strip.scrollWidth - strip.clientWidth);
    strip.toggleAttribute("data-overflow", maximum > SCROLL_EDGE_TOLERANCE_PX);
  }
}

export const TabStripView = view(TabStrip);

function renderedTabs(
  channel: ApplicationChannelSnapshot | null,
  pages: readonly ApplicationPageSnapshot[] | undefined,
): readonly RenderedTab[] {
  if (!channel || !pages) return [];
  const artifacts = new Map(channel.artifacts.map((artifact) => [artifact.id, artifact]));
  return pages.map((page, index) => {
    const artifactId = page.artifactIds[0] ?? null;
    return {
      page,
      artifactId,
      label: artifactId === null ? "" : artifacts.get(artifactId)?.title ?? "",
      key: artifactId ?? `empty-page-${index}`,
    };
  });
}

function samePageOrder(
  left: readonly ApplicationPageSnapshot[],
  right: readonly ApplicationPageSnapshot[],
): boolean {
  return left.length === right.length && left.every((page, index) => page === right[index]);
}

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
