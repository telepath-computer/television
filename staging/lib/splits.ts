// Shared staging machinery for the Stage design workshops (not spec

// A split with no stated ratio shares the space evenly.
const EVEN_SPLIT = 0.5;
// content): the pane grammar's tree, its DOM, ratio setting, and divider
// drags. The grammar itself is the stage spec's (specs/ui/app/stage/index.md,
// Panes); this file only mechanizes it for workshops.
import artifactFrame from "../../specs/ui/app/artifact-frame/template.liquid";

export type PaneNode = { type: "pane"; src: string | null };
export type SplitNode = { type: "split"; dir: "h" | "v"; ratio: number; a: TreeNode; b: TreeNode };
export type TreeNode = PaneNode | SplitNode;

/** A pane; src null makes a ghost — an empty placeholder pane. */
export const pane = (src: string | null = "https://example.com"): PaneNode => ({ type: "pane", src });
export const split = (dir: "h" | "v", a: TreeNode, b: TreeNode, ratio = EVEN_SPLIT): SplitNode => ({
  type: "split",
  dir,
  ratio,
  a,
  b,
});

const styles = new Set<string>();

export const paneMarkup = (src: string): string => {
  const { markup, styles: s } = artifactFrame({ src, title: "Artifact" });
  for (const rule of s) styles.add(rule);
  return markup;
};

/** Append the collected artifact-frame styles once; call after first build. */
export const flushStyles = (): void => {
  document.head.insertAdjacentHTML("beforeend", `<style>${[...styles].join("\n")}</style>`);
};

export interface BuildOptions {
  /** The effective minimum pane size for a container of the given extent. */
  minPx: (containerSize: number) => number;
  /** Called after a divider drag commits (pointer up). */
  onSettle?: () => void;
}

export const setRatio = (el: HTMLElement, ratio: number): void => {
  const [a, , b] = el.children as unknown as HTMLElement[];
  a.style.flex = `0 1 calc(${ratio * 100}% - var(--pane-gap) / 2)`;
  b.style.flex = `0 1 calc(${(1 - ratio) * 100}% - var(--pane-gap) / 2)`;
};

const wireDivider = (divider: HTMLElement, el: HTMLElement, node: SplitNode, opts: BuildOptions) => {
  divider.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    divider.setPointerCapture(down.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const size = node.dir === "h" ? rect.width : rect.height;
      const pos = node.dir === "h" ? ev.clientX - rect.left : ev.clientY - rect.top;
      const min = opts.minPx(size);
      const low = min / size;
      const high = 1 - min / size;
      if (low > high) return; // minimum unsatisfiable at this size: freeze
      node.ratio = Math.min(high, Math.max(low, pos / size));
      setRatio(el, node.ratio);
    };
    const up = () => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      opts.onSettle?.();
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
};

/**
 * Build the DOM for a node. Ratios live on the elements as flex-basis, so a
 * drag mutates styles without re-rendering (a re-render reloads iframes).
 * Split elements carry their node via `nodeOf` for workshops that mutate the
 * tree surgically.
 */
export const nodeOf = new WeakMap<HTMLElement, TreeNode>();

export const build = (node: TreeNode, opts: BuildOptions): HTMLElement => {
  if (node.type === "pane") {
    const el = document.createElement("div");
    el.className = "pane";
    if (node.src != null) el.innerHTML = paneMarkup(node.src);
    else el.classList.add("ghost");
    nodeOf.set(el, node);
    return el;
  }
  const el = document.createElement("div");
  el.className = `split ${node.dir}`;
  const a = document.createElement("div");
  const b = document.createElement("div");
  a.className = b.className = "slot";
  a.append(build(node.a, opts));
  b.append(build(node.b, opts));
  const divider = document.createElement("div");
  divider.className = "divider";
  el.append(a, divider, b);
  setRatio(el, node.ratio);
  wireDivider(divider, el, node, opts);
  nodeOf.set(el, node);
  return el;
};

/** The shared workshop CSS for boards built by build(). */
export const SPLIT_CSS = /* css */ `
  .shape {
    --pane-gap: var(--space-8);

    height: 100%;
    background: var(--color-background);
    padding: var(--space-12);
    display: grid;
  }

  .split {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .split.h { flex-direction: row; }
  .split.v { flex-direction: column; }

  .slot {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }

  /* The divider is the strip of ground between slots: a grab, not a
     drawing. */
  .divider {
    flex: none;
    align-self: stretch;
  }

  .split.h > .divider { width: var(--pane-gap); cursor: col-resize; }
  .split.v > .divider { height: var(--pane-gap); cursor: row-resize; }

  .pane {
    min-height: 0;
    min-width: 0;
    display: grid;
    position: relative;
  }

  .pane > .artifact-frame {
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
`;
