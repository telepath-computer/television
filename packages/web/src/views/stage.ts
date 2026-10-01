import { html } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { createRef, ref, type Ref } from "lit-html/directives/ref.js";
import { view, View } from "@telepath-computer/utils/lit-view";
import type { Artifact } from "@telepath-computer/television-artifact";
import type { PageSize } from "@telepath-computer/television-shared";
import type {
  ApplicationChannelSnapshot,
  ApplicationPageSnapshot,
  ApplicationService,
} from "../services/application-service.ts";
import "../elements/icon.ts";
import { ArtifactViewView } from "./artifact-view.ts";
import { DRAG_DISPLACEMENT_DURATION_MS } from "./drag-measurements.ts";
import { setPageFullScreen } from "./page-full-screen.ts";
import { setPageSizeAndFullScreen } from "./page-size.ts";
import {
  factorForPageBox,
  renderedPageSize,
  renderedSizeFloor,
  storedPageSize,
  type PageBox,
} from "./page-sizing.ts";
import {
  CROSSING_DURATION_MS,
  HANDLE_CORNER_REACH_PX,
  HANDLE_CORNER_THICKNESS_PX,
  HANDLE_EDGE_BAND_PX,
  SNAP_ARM_PX,
} from "../constants.ts";
import type { TabReorderSnapshot } from "./tab-reorder.ts";
import "./stage.css";
import "./stage.host.css";

const CENTRE_TOLERANCE_PX = 0.5;
const CENTRE_HELD = 2;
const WINDOW_TRACKING_SETTLE_MS = 120;

const RESIZE_HANDLE_POSITIONS = [
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;
type ResizeHandlePosition = typeof RESIZE_HANDLE_POSITIONS[number];

interface RenderedPage {
  readonly page: ApplicationPageSnapshot;
  readonly artifact: Readonly<Artifact> | null;
  readonly key: string;
}

interface ResizeGesture {
  readonly application: ApplicationService;
  readonly channel: ApplicationChannelSnapshot;
  readonly page: ApplicationPageSnapshot;
  readonly pageKey: string;
  readonly pageElement: HTMLElement;
  readonly filmstrip: HTMLElement;
  readonly stage: HTMLElement;
  readonly handle: HTMLElement;
  readonly pointerId: number;
  readonly startPointer: { x: number; y: number };
  readonly startRendered: PageSize;
  readonly baselineSize: PageSize;
  readonly pageBox: PageBox;
  readonly wasFullScreen: boolean;
  readonly horizontal: boolean;
  readonly vertical: boolean;
  readonly leftish: boolean;
  readonly topish: boolean;
  lastPointer: { x: number; y: number };
  rendered: PageSize;
  option: boolean;
  armed: boolean;
  leftFullScreen: boolean;
}

/** The current channel's stage ground and identity-preserving page collection. */
export class Stage extends View<[
  ApplicationService,
  ApplicationChannelSnapshot | null,
  TabReorderSnapshot?,
  boolean?,
]> {
  #stageRef: Ref<HTMLElement> = createRef();
  #filmstripRef: Ref<HTMLElement> = createRef();
  #channelID: string | null | undefined;
  #selectedKey: string | null | undefined;
  #selectedFullScreen: boolean | null | undefined;
  #pageGeometrySignature: string | null | undefined;
  #reorderSignature: string | null | undefined;
  // Fresh-channel centring is committed to scrollLeft in the scheduled
  // pre-paint frame. It must not persist as an ancestor transform: Electron
  // 35's Chromium 134 resolves native popover anchors against pre-transform
  // geometry (Chromium issue 382294252). The architectural constraint lives
  // in specs/arch/ui/foundation.md.
  #centreFrame = 0;
  #scrollFrame = 0;
  #scrollAnimation: Animation | null = null;
  #observedFilmstrip: HTMLElement | null = null;
  #observedPage: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #renderedPages: readonly RenderedPage[] = [];
  #lastPageBox: PageBox | null = null;
  #windowTrackingTimer: ReturnType<typeof setTimeout> | null = null;
  #activeResize: ResizeGesture | null = null;
  readonly #displacementAnimations = new Set<Animation>();
  #motionSuppressed = false;

  connected(): void {
    this.#channelID = undefined;
    this.#selectedKey = undefined;
    this.#selectedFullScreen = undefined;
    this.#pageGeometrySignature = undefined;
    this.#reorderSignature = undefined;
  }

  template(
    application: ApplicationService,
    channel: ApplicationChannelSnapshot | null,
    reorder?: TabReorderSnapshot,
    motionSuppressed = false,
  ): unknown {
    const enteredMotionSuppression = !this.#motionSuppressed && motionSuppressed;
    this.#motionSuppressed = motionSuppressed;
    if (enteredMotionSuppression) {
      this.#finishResize(false);
      this.#cancelCrossing();
      for (const animation of this.#displacementAnimations) animation.cancel();
      this.#displacementAnimations.clear();
    }
    const activeReorder = reorder?.channelId === channel?.id ? reorder : null;
    const pages = renderedPages(channel, activeReorder?.pages ?? channel?.pages);
    const selectedPage = channel?.selectedPage ?? null;
    const channelID = channel?.id ?? null;
    const selectedKey = selectedPage?.artifactIds[0] ?? null;
    const selectedFullScreen = selectedPage?.geometry.full_screen ?? null;
    const hadPageGeometry = this.#pageGeometrySignature !== undefined;
    const pageGeometrySignature = pages
      .map(({ key, page }) =>
        `${key}:${page.geometry.full_screen}:${page.size.width}:${page.size.height}`
      )
      .sort()
      .join("|");
    const reorderSignature = activeReorder === null
      ? null
      : pages.map(({ key }) => key).join("|");
    const channelChanged = channelID !== this.#channelID;
    const selectionChanged = selectedKey !== this.#selectedKey;
    const selectedModeChanged = selectedFullScreen !== this.#selectedFullScreen;
    const pageGeometryChanged = pageGeometrySignature !== this.#pageGeometrySignature;
    const reorderChanged = reorderSignature !== this.#reorderSignature;
    const animateReorder = !this.#motionSuppressed && activeReorder !== null &&
      this.#reorderSignature !== undefined &&
      this.#reorderSignature !== null &&
      reorderChanged;
    const displacementFrom = animateReorder ? this.#pagePositions() : null;
    const animateSelection = !this.#motionSuppressed && selectionChanged && !channelChanged &&
      this.#selectedKey !== undefined &&
      this.#selectedKey !== null &&
      selectedKey !== null;

    if (this.#activeResize && (channelChanged || selectionChanged || selectedModeChanged)) {
      this.#finishResize(false);
    }

    this.#channelID = channelID;
    this.#selectedKey = selectedKey;
    this.#selectedFullScreen = selectedFullScreen;
    this.#pageGeometrySignature = pageGeometrySignature;
    this.#reorderSignature = reorderSignature;
    this.#renderedPages = pages;
    if (pageGeometryChanged && hadPageGeometry) {
      this.#clearWindowTracking();
    }
    if (channelChanged) {
      this.#resizeObserver?.disconnect();
      this.#observedFilmstrip = null;
      this.#observedPage = null;
      this.#lastPageBox = null;
    }
    queueMicrotask(() => this.#applyRenderedSizes());
    if (channelChanged || selectionChanged || pageGeometryChanged || enteredMotionSuppression) {
      queueMicrotask(() => this.#scheduleCentre(selectedKey, animateSelection));
    } else if (reorderChanged) {
      queueMicrotask(() => {
        const filmstrip = this.#filmstripRef.value;
        if (!filmstrip) return;
        this.#centreSelectedPage(filmstrip, selectedKey, false);
        if (displacementFrom) this.#animatePageDisplacement(displacementFrom);
      });
    }

    // Lit's keyed() resets the part's committed value before clearing, so
    // nested views miss disconnected(). A one-item keyed repeat keeps channel
    // identity while using the disconnect-aware ChildPart removal path.
    // Empty-state copy restated from specs/ui/app/stage/content.yml.
    return html`
      <section
        class="stage"
        ${ref(this.#stageRef)}
        style=${`--handle-band: ${HANDLE_EDGE_BAND_PX}px; --handle-reach: ${HANDLE_CORNER_REACH_PX}px; --handle-thickness: ${HANDLE_CORNER_THICKNESS_PX}px;`}
      >
        ${channel !== null && pages.length === 0
          ? html`
              <div class="stage-empty">
                <tv-icon name="artifact" size="xl"></tv-icon>
                <p>No artifacts yet — ask your agent to put something here.</p>
              </div>
            `
          : null}
        ${repeat(
          [channelID],
          (id) => id,
          () => html`
          <div class="filmstrip" ${ref(this.#filmstripRef)}>
            <div class="filmstrip-inner">
            ${repeat(
              pages,
              ({ key }) => key,
              ({ page, artifact, key }) => {
                if (channel === null) return null;
                const selected = key === selectedKey;
                return html`
                  <div
                    class="page"
                    data-page-key=${key}
                    ?selected=${selected}
                    ?full-screen=${page.geometry.full_screen}
                    style=${this.#pageStyle(page)}
                    @click=${selected || artifact === null
                      ? null
                      : () => application.selectPage(channel.id, artifact.id)}
                  >
                    ${artifact
                      ? ArtifactViewView(application, artifact, {
                          viewURL: application.getArtifactViewURL(artifact),
                          contentURL: application.getArtifactContentURL(artifact),
                          fullScreen: page.geometry.full_screen,
                          inert: !selected,
                          onFullScreenChange: (fullScreen) =>
                            setPageFullScreen(application, channel, page, fullScreen),
                        })
                      : null}
                    ${selected
                      ? html`
                          <div class="page-handles" aria-hidden="true">
                            ${RESIZE_HANDLE_POSITIONS.map((position) => html`
                              <span
                                class="page-handle ${position}"
                                @pointerdown=${(event: PointerEvent) =>
                                  this.#beginResize(
                                    event,
                                    position,
                                    application,
                                    channel,
                                    page,
                                    key,
                                  )}
                              ></span>
                            `)}
                          </div>
                        `
                      : null}
                  </div>
                `;
              },
            )}
            </div>
          </div>
        `,
        )}
      </section>
    `;
  }

  disconnected(): void {
    this.#finishResize(false);
    this.#clearWindowTracking();
    this.#cancelCrossing();
    cancelAnimationFrame(this.#centreFrame);
    this.#centreFrame = 0;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedFilmstrip = null;
    this.#observedPage = null;
    this.#lastPageBox = null;
    this.#renderedPages = [];
    for (const animation of this.#displacementAnimations) animation.cancel();
    this.#displacementAnimations.clear();
  }

  #scheduleCentre(
    selectedKey: string | null,
    animate: boolean,
  ): void {
    const filmstrip = this.#filmstripRef.value;
    if (!filmstrip) return;
    cancelAnimationFrame(this.#centreFrame);
    this.#centreFrame = requestAnimationFrame(() => {
      this.#centreFrame = 0;
      this.#centreSelectedPage(filmstrip, selectedKey, animate);
    });
  }

  #observeGeometry(filmstrip: HTMLElement, page: HTMLElement): void {
    if (typeof ResizeObserver === "undefined" ||
        (filmstrip === this.#observedFilmstrip && page === this.#observedPage)) return;
    this.#resizeObserver?.disconnect();
    this.#observedFilmstrip = filmstrip;
    this.#observedPage = page;
    this.#resizeObserver = new ResizeObserver(() => {
      const nextPageBox = this.#measurePageBox(filmstrip);
      if (!sameSize(nextPageBox, this.#lastPageBox)) {
        this.#beginWindowTracking();
        if (this.#activeResize) this.#finishResize(false);
        this.#applyRenderedSizes(filmstrip);
      }
      if (this.#scrollAnimation === null) {
        this.#centreSelectedPage(
          filmstrip,
          this.#selectedKey ?? null,
          false,
        );
      }
    });
    this.#resizeObserver.observe(filmstrip);
    this.#resizeObserver.observe(page);
  }

  #measurePageBox(filmstrip: HTMLElement): PageBox {
    const inset = Number.parseFloat(
      getComputedStyle(filmstrip).getPropertyValue("--page-inset"),
    ) || 0;
    return {
      width: Math.max(0, filmstrip.clientWidth - 2 * inset),
      height: Math.max(0, filmstrip.clientHeight - inset),
    };
  }

  #pageStyle(page: ApplicationPageSnapshot): string {
    if (page.geometry.full_screen || this.#lastPageBox === null) return "";
    const size = renderedPageSize(page.size, this.#lastPageBox);
    return `width: ${size.width}px; height: ${size.height}px;`;
  }

  #applyRenderedSizes(filmstrip = this.#filmstripRef.value): void {
    if (!filmstrip) return;
    const pageBox = this.#measurePageBox(filmstrip);
    this.#lastPageBox = pageBox;
    const pages = new Map(this.#renderedPages.map((rendered) => [rendered.key, rendered.page]));
    for (const pageElement of filmstrip.querySelectorAll<HTMLElement>(".page")) {
      if (pageElement === this.#activeResize?.pageElement) continue;
      const page = pages.get(pageElement.dataset.pageKey ?? "");
      if (!page) continue;
      if (page.geometry.full_screen) {
        pageElement.style.width = "";
        pageElement.style.height = "";
        continue;
      }
      const size = renderedPageSize(page.size, pageBox);
      pageElement.style.width = `${size.width}px`;
      pageElement.style.height = `${size.height}px`;
    }
  }

  #beginWindowTracking(): void {
    const stage = this.#stageRef.value;
    if (!stage) return;
    stage.setAttribute("window-tracking", "");
    if (this.#windowTrackingTimer !== null) clearTimeout(this.#windowTrackingTimer);
    this.#windowTrackingTimer = setTimeout(() => {
      this.#windowTrackingTimer = null;
      stage.removeAttribute("window-tracking");
    }, WINDOW_TRACKING_SETTLE_MS);
  }

  #clearWindowTracking(): void {
    if (this.#windowTrackingTimer !== null) {
      clearTimeout(this.#windowTrackingTimer);
      this.#windowTrackingTimer = null;
    }
    this.#stageRef.value?.removeAttribute("window-tracking");
  }

  #beginResize(
    event: PointerEvent,
    position: ResizeHandlePosition,
    application: ApplicationService,
    channel: ApplicationChannelSnapshot,
    page: ApplicationPageSnapshot,
    pageKey: string,
  ): void {
    if (this.#motionSuppressed) return;
    if (event.button !== 0 || !event.isPrimary) return;
    const handle = event.currentTarget as HTMLElement;
    const pageElement = handle.closest<HTMLElement>(".page");
    const filmstrip = this.#filmstripRef.value;
    const stage = this.#stageRef.value;
    if (!pageElement || !filmstrip || !stage) return;

    this.#finishResize(false);
    this.#clearWindowTracking();
    event.preventDefault();
    event.stopPropagation();

    const start = pageElement.getBoundingClientRect();
    const pageBox = this.#measurePageBox(filmstrip);
    const factor = factorForPageBox(pageBox);
    const wasFullScreen = page.geometry.full_screen;
    const horizontal = position.includes("left") || position.includes("right");
    const vertical = position.includes("top") || position.includes("bottom");
    this.#activeResize = {
      application,
      channel,
      page,
      pageKey,
      pageElement,
      filmstrip,
      stage,
      handle,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      lastPointer: { x: event.clientX, y: event.clientY },
      startRendered: { width: start.width, height: start.height },
      rendered: { width: start.width, height: start.height },
      baselineSize: wasFullScreen
        ? {
            width: pageBox.width / factor.width,
            height: pageBox.height / factor.height,
          }
        : { ...page.size },
      pageBox,
      wasFullScreen,
      horizontal,
      vertical,
      leftish: position.includes("left"),
      topish: position.includes("top"),
      option: event.altKey,
      armed: false,
      leftFullScreen: false,
    };
    stage.setAttribute("resizing", "");
    handle.addEventListener("pointermove", this.#onResizePointerMove);
    handle.addEventListener("pointerup", this.#onResizePointerUp);
    handle.addEventListener("pointercancel", this.#onResizePointerCancel);
    handle.addEventListener("lostpointercapture", this.#onResizeCaptureLost);
    window.addEventListener("keydown", this.#onResizeKeyChange);
    window.addEventListener("keyup", this.#onResizeKeyChange);
    window.addEventListener("resize", this.#onResizePageBoxChange);
    handle.setPointerCapture(event.pointerId);
  }

  readonly #onResizePointerMove = (event: PointerEvent): void => {
    const gesture = this.#activeResize;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.lastPointer = { x: event.clientX, y: event.clientY };
    gesture.option = event.altKey;
    this.#renderResize(gesture);
  };

  readonly #onResizePointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.#activeResize?.pointerId) this.#finishResize(true);
  };

  readonly #onResizePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.#activeResize?.pointerId) this.#finishResize(false);
  };

  readonly #onResizeCaptureLost = (event: PointerEvent): void => {
    if (event.pointerId === this.#activeResize?.pointerId) this.#finishResize(false);
  };

  readonly #onResizeKeyChange = (event: KeyboardEvent): void => {
    const gesture = this.#activeResize;
    if (!gesture) return;
    if (event.type === "keydown" && event.key === "Escape") {
      event.preventDefault();
      this.#finishResize(false);
      return;
    }
    if (gesture.option === event.altKey) return;
    gesture.option = event.altKey;
    this.#renderResize(gesture);
  };

  readonly #onResizePageBoxChange = (): void => {
    const gesture = this.#activeResize;
    if (!gesture || sameSize(this.#measurePageBox(gesture.filmstrip), gesture.pageBox)) {
      return;
    }
    this.#beginWindowTracking();
    this.#finishResize(false);
  };

  #renderResize(gesture: ResizeGesture): void {
    const pointerMoved = gesture.lastPointer.x !== gesture.startPointer.x ||
      gesture.lastPointer.y !== gesture.startPointer.y;
    if (gesture.wasFullScreen && !gesture.leftFullScreen) {
      if (!pointerMoved) return;
      gesture.leftFullScreen = true;
      gesture.pageElement.removeAttribute("full-screen");
    }

    const floor = renderedSizeFloor(gesture.pageBox);
    let width = gesture.startRendered.width;
    let height = gesture.startRendered.height;
    if (gesture.horizontal) {
      const direction = gesture.leftish ? -CENTRE_HELD : CENTRE_HELD;
      width = Math.min(
        gesture.pageBox.width,
        Math.max(
          floor.width,
          gesture.startRendered.width +
            (gesture.lastPointer.x - gesture.startPointer.x) * direction,
        ),
      );
    }
    if (gesture.vertical) {
      const direction = gesture.topish ? -CENTRE_HELD : CENTRE_HELD;
      height = Math.min(
        gesture.pageBox.height,
        Math.max(
          floor.height,
          gesture.startRendered.height +
            (gesture.lastPointer.y - gesture.startPointer.y) * direction,
        ),
      );
    }

    gesture.armed = !gesture.option && gesture.horizontal && gesture.vertical &&
      width >= gesture.pageBox.width - SNAP_ARM_PX &&
      height >= gesture.pageBox.height - SNAP_ARM_PX;
    gesture.rendered = gesture.armed
      ? { ...gesture.pageBox }
      : { width, height };
    gesture.pageElement.style.width = `${gesture.rendered.width}px`;
    gesture.pageElement.style.height = `${gesture.rendered.height}px`;
    this.#syncSnapOutline(gesture.stage, gesture.armed);
    this.#centreSelectedPage(
      gesture.filmstrip,
      gesture.pageKey,
      false,
    );
  }

  #finishResize(commit: boolean): void {
    const gesture = this.#activeResize;
    if (!gesture) return;
    this.#activeResize = null;
    gesture.handle.removeEventListener("pointermove", this.#onResizePointerMove);
    gesture.handle.removeEventListener("pointerup", this.#onResizePointerUp);
    gesture.handle.removeEventListener("pointercancel", this.#onResizePointerCancel);
    gesture.handle.removeEventListener("lostpointercapture", this.#onResizeCaptureLost);
    window.removeEventListener("keydown", this.#onResizeKeyChange);
    window.removeEventListener("keyup", this.#onResizeKeyChange);
    window.removeEventListener("resize", this.#onResizePageBoxChange);
    if (gesture.handle.hasPointerCapture(gesture.pointerId)) {
      gesture.handle.releasePointerCapture(gesture.pointerId);
    }
    this.#syncSnapOutline(gesture.stage, false);

    if (commit && gesture.armed) {
      // A full-screen drag changes the live attribute without changing the
      // immutable application snapshot. Restore it before submitting the
      // same `true` value, because lit correctly considers that value already
      // rendered and will not repair an out-of-band attribute removal.
      if (gesture.wasFullScreen) {
        gesture.pageElement.setAttribute("full-screen", "");
      }
      setPageFullScreen(
        gesture.application,
        gesture.channel,
        gesture.page,
        true,
      );
    } else if (commit) {
      const nextSize = { ...gesture.baselineSize };
      const storedRendered = storedPageSize(gesture.rendered, gesture.pageBox);
      let changed = gesture.wasFullScreen && gesture.leftFullScreen;
      if (gesture.horizontal &&
          gesture.rendered.width !== gesture.startRendered.width) {
        nextSize.width = storedRendered.width;
        changed = true;
      }
      if (gesture.vertical &&
          gesture.rendered.height !== gesture.startRendered.height) {
        nextSize.height = storedRendered.height;
        changed = true;
      }
      if (changed) {
        setPageSizeAndFullScreen(
          gesture.application,
          gesture.channel,
          gesture.page,
          nextSize,
          false,
        );
      } else {
        this.#applyRenderedSizes(gesture.filmstrip);
      }
    } else {
      gesture.pageElement.toggleAttribute("full-screen", gesture.wasFullScreen);
      this.#applyRenderedSizes(gesture.filmstrip);
    }

    // Flush the settled box while the no-transition drag rule still applies.
    gesture.pageElement.getBoundingClientRect();
    gesture.stage.removeAttribute("resizing");
    this.#centreSelectedPage(
      gesture.filmstrip,
      gesture.pageKey,
      false,
    );
  }

  #syncSnapOutline(stage: HTMLElement, armed: boolean): void {
    const current = stage.querySelector<HTMLElement>(":scope > .snap-outline");
    if (!armed) {
      current?.remove();
      return;
    }
    if (current) return;
    const outline = document.createElement("div");
    outline.className = "snap-outline";
    outline.setAttribute("aria-hidden", "true");
    stage.append(outline);
  }

  #centreSelectedPage(
    filmstrip: HTMLElement,
    selectedKey: string | null,
    animate: boolean,
  ): void {
    const page = [...filmstrip.querySelectorAll<HTMLElement>(".page")]
      .find((candidate) => candidate.dataset.pageKey === selectedKey);
    if (!page) {
      this.#cancelCrossing();
      return;
    }
    this.#observeGeometry(filmstrip, page);

    const pageBox = page.getBoundingClientRect();
    const stripBox = filmstrip.getBoundingClientRect();
    const target = Math.max(
      0,
      Math.min(
        filmstrip.scrollLeft + pageBox.left + pageBox.width / 2 - (stripBox.left + stripBox.width / 2),
        filmstrip.scrollWidth - filmstrip.clientWidth,
      ),
    );

    this.#cancelCrossing();
    if (this.#motionSuppressed || !animate ||
        Math.abs(target - filmstrip.scrollLeft) < CENTRE_TOLERANCE_PX ||
        matchMedia("(prefers-reduced-motion: reduce)").matches) {
      filmstrip.scrollLeft = target;
      return;
    }

    const from = filmstrip.scrollLeft;
    const animation = filmstrip.animate([{}, {}], {
      duration: CROSSING_DURATION_MS,
      easing: "ease",
    });
    this.#scrollAnimation = animation;

    const move = (): void => {
      if (animation !== this.#scrollAnimation) return;
      const progress = animation.playState === "finished"
        ? 1
        : animation.effect?.getComputedTiming().progress ?? 0;
      filmstrip.scrollLeft = from + (target - from) * progress;
      if (animation.playState === "finished") {
        filmstrip.scrollLeft = target;
        this.#scrollAnimation = null;
        this.#scrollFrame = 0;
      } else {
        this.#scrollFrame = requestAnimationFrame(move);
      }
    };
    this.#scrollFrame = requestAnimationFrame(move);
  }

  #pagePositions(): ReadonlyMap<string, number> {
    const filmstrip = this.#filmstripRef.value;
    if (!filmstrip) return new Map();
    return new Map(
      [...filmstrip.querySelectorAll<HTMLElement>(".page")].map((page) => [
        page.dataset.pageKey ?? "",
        page.getBoundingClientRect().left,
      ]),
    );
  }

  #animatePageDisplacement(from: ReadonlyMap<string, number>): void {
    if (this.#motionSuppressed) return;
    const filmstrip = this.#filmstripRef.value;
    if (!filmstrip) return;
    for (const page of filmstrip.querySelectorAll<HTMLElement>(".page")) {
      if (page.hasAttribute("selected")) continue;
      const start = from.get(page.dataset.pageKey ?? "");
      if (start === undefined) continue;
      const delta = start - page.getBoundingClientRect().left;
      if (Math.abs(delta) <= CENTRE_TOLERANCE_PX) continue;
      const animation = page.animate(
        { translate: [`${delta}px 0`, "0px 0"] },
        { duration: DRAG_DISPLACEMENT_DURATION_MS, easing: "ease" },
      );
      this.#displacementAnimations.add(animation);
      void animation.finished.finally(() => {
        this.#displacementAnimations.delete(animation);
      }).catch(() => {});
    }
  }

  #cancelCrossing(): void {
    cancelAnimationFrame(this.#scrollFrame);
    this.#scrollFrame = 0;
    this.#scrollAnimation?.cancel();
    this.#scrollAnimation = null;
  }
}

export const StageView = view(Stage);

function renderedPages(
  channel: ApplicationChannelSnapshot | null,
  pages: readonly ApplicationPageSnapshot[] | undefined,
): readonly RenderedPage[] {
  if (!channel || !pages) return [];
  const artifacts = new Map(channel.artifacts.map((artifact) => [artifact.id, artifact]));
  return pages.map((page, index) => {
    const artifactID = page.artifactIds[0];
    return {
      page,
      artifact: artifactID === undefined ? null : artifacts.get(artifactID) ?? null,
      key: artifactID ?? `empty-page-${index}`,
    };
  });
}

function sameSize(left: PageSize, right: PageSize | null): boolean {
  return right !== null &&
    left.width === right.width &&
    left.height === right.height;
}
