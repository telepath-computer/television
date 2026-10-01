import {
  SIDEBAR_COLLAPSE_DURATION_MS,
} from "../constants.ts";
import { sidebarProgressAt } from "./sidebar-transition-pose.ts";

export interface SidebarBoundaryRun {
  readonly root: HTMLElement;
  readonly width: number;
  readonly target: number;
  readonly onFrame: (boundary: number) => void;
  readonly onFinish: (boundary: number) => void;
}

/** Drives the sidebar boundary with one fresh, per-direction easing clock. */
export class SidebarCollapseTransition {
  #animation: Animation | null = null;
  #animationFrame = 0;
  #boundary: number;
  #startBoundary: number;
  #targetBoundary: number;
  #width = 1;

  constructor(initialBoundary: number) {
    this.#boundary = initialBoundary;
    this.#startBoundary = initialBoundary;
    this.#targetBoundary = initialBoundary;
  }

  get boundary(): number {
    this.#sampleCurrentBoundary();
    return this.#boundary;
  }

  /** Starts or reverses the envelope from the boundary visible right now. */
  move(run: SidebarBoundaryRun): void {
    const start = this.boundary;
    this.#cancelClock();
    this.#startBoundary = start;
    this.#targetBoundary = run.target;
    this.#width = run.width;
    run.onFrame(start);

    if (matchMedia("(prefers-reduced-motion: reduce)").matches ||
        Math.abs(run.target - start) < Number.EPSILON) {
      this.#boundary = run.target;
      run.onFrame(run.target);
      run.onFinish(run.target);
      return;
    }

    const remaining = Math.abs(run.target - start) / run.width;
    const animation = run.root.animate([{}, {}], {
      duration: SIDEBAR_COLLAPSE_DURATION_MS * remaining,
      easing: "linear",
    });
    animation.id = "sidebar-collapse-boundary";
    this.#animation = animation;

    const applyFrame = (): void => {
      if (this.#animation !== animation) return;
      this.#sampleCurrentBoundary();
      run.onFrame(this.#boundary);
      if (animation.playState === "finished") {
        this.#animation = null;
        this.#animationFrame = 0;
        this.#boundary = run.target;
        run.onFrame(run.target);
        run.onFinish(run.target);
        return;
      }
      this.#animationFrame = requestAnimationFrame(applyFrame);
    };
    this.#animationFrame = requestAnimationFrame(applyFrame);
  }

  /** Stops the clock while leaving the most recently visible boundary applied. */
  cancel(): void {
    this.#sampleCurrentBoundary();
    this.#cancelClock();
  }

  #sampleCurrentBoundary(): void {
    const animation = this.#animation;
    if (animation === null) return;
    const progress = sidebarProgressAt(
      1 - this.#startBoundary / this.#width,
      1 - this.#targetBoundary / this.#width,
      Number(animation.currentTime ?? 0),
      SIDEBAR_COLLAPSE_DURATION_MS,
    );
    this.#boundary = this.#width * (1 - progress);
  }

  #cancelClock(): void {
    cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = 0;
    this.#animation?.cancel();
    this.#animation = null;
  }
}
