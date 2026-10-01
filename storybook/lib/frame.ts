// The isolation primitive: a story renders into a pre-configured document
// under `storybook/frames/` rather than into the preview — a separate document
// with its own custom-element registry, so surface implementations registered
// in the preview structurally cannot hijack staged spec markup, and one
// surface's global CSS cannot reach another's.
//
// A frame's boot is ordinary markup: a `<script type="module">` in its HTML.
// Module scripts are deferred, so whatever a frame loads has executed by the
// time `load` fires — there is no generated script and no readiness protocol.
// What a frame may load is constrained by `frames/` being served verbatim; see
// `lib/imports/`.
//
// Frames are built fresh on every render, deliberately. Caching one and
// returning the same element does not help: the renderer re-inserts what it is
// given, and re-insertion alone discards and reloads an iframe's document —
// verified, with element identity preserved across the render. Holding a warm
// document would mean parking the frame outside the story tree so the renderer
// never touches it, at the cost of every frame becoming a positioned overlay.
// Building fresh costs a handful of cache-warm requests and leaves no stale
// state to reason about.

// What a story renders into its frame: markup parsed in the child realm, or a
// builder handed the child document. A string is the important case — setting
// it as innerHTML there upgrades custom elements against the CHILD registry,
// whereas DOM built in the preview would already have resolved against the
// preview's. A builder is the escape hatch for staging that must set
// properties, attach listeners, or re-render on state.
export type FrameContent = string | ((doc: Document) => void);

// A story whose render returns its frame's content rather than DOM. Storybook's
// own StoryObj cannot express that — its render is typed to the renderer's
// return type — so a framed story is declared with this instead.
export type FrameStory = {
  render: (...args: any[]) => FrameContent;
  [key: string]: unknown;
};

// Which pre-configured document to render into, and how big a box it gets. A
// story's `frame` parameter is exactly this; every field is optional, so
// `frame: { width: 640 }` is a design-system box at a chosen width.
export interface FrameOptions {
  name?: string;
  width?: number | string;
  height?: number | string;
}

const length = (value: number | string | undefined, fallback: string): string =>
  value === undefined ? fallback : typeof value === "number" ? `${value}px` : value;

function fill(doc: Document, content: FrameContent): void {
  if (typeof content === "function") content(doc);
  else doc.body.innerHTML = content;
}

// Asking for a size is what makes a frame a box: it gets the box chrome from
// lib/storybook.css and sits at that size on the stage. Left unsized, it fills
// the stage instead — width and flex against the stage's column, so no
// viewport units are needed and the stage's padding stays honest.
export function frame(
  { name = "ui", width, height }: FrameOptions,
  content: FrameContent,
): HTMLIFrameElement {
  const el = document.createElement("iframe");
  el.src = `/frames/${name}.html`;
  el.style.display = "block";
  el.style.border = "0";
  if (width === undefined && height === undefined) {
    el.style.width = "100%";
    el.style.flex = "1";
  } else {
    el.className = "storybook-frame";
    el.style.width = length(width, "100%");
    el.style.height = length(height, "100%");
  }
  el.addEventListener("load", () => {
    const doc = el.contentDocument;
    if (doc) fill(doc, content);
  });
  return el;
}

// The neutral backdrop a box sits on (styling in lib/storybook.css).
export function stage(child: Node): HTMLElement {
  const el = document.createElement("div");
  el.className = "storybook-stage";
  el.append(child);
  return el;
}
