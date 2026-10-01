// Design workshop (not a spec): a dead-simple slide deck built on Swiper.
// Pass an array of slides — each one is arbitrary HTML: a string, a lit
// template, or an element (so a live mock like membersPrototypeMock() can be a
// slide). You get swipe/drag, arrow keys, and clickable dots for free.

import Swiper from "swiper";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import { render, type TemplateResult } from "lit-html";

export type Slide = TemplateResult | HTMLElement | string;

// Render static content into its own isolated slide: a real child iframe
// carrying `css`, confined to the slide. Use this for wireframe slides that
// want the clean-room styling (no adopted preview sheets leaking in) WITHOUT
// being their own story — the content lives right here in the deck. lit renders
// in this realm and the nodes adopt into the same-origin child document.
export function frameSlide(css: string, content: TemplateResult): HTMLIFrameElement {
  const root = document.createElement("div");
  render(content, root);
  const frame = document.createElement("iframe");
  frame.style.cssText = "width: 100%; height: 100%; border: 0; background: #fff;";
  frame.srcdoc = "<!doctype html><html><head></head><body></body></html>";
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const style = doc.createElement("style");
    style.textContent = css;
    doc.head.append(style);
    doc.body.style.margin = "0";
    doc.body.append(root);
  });
  return frame;
}

// Embed another Storybook story as a live, fully-isolated slide. Use this only
// for the interactive prototypes: their isolation renders a single full-viewport
// iframe parked on document.body, so they can't be dropped in as raw elements —
// but a story loaded in its own nested iframe is confined to the slide and stays
// interactive. `storyId` is the kebab id, e.g. "design-redesign-...--prototype".
export function storyFrame(storyId: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.src = `iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  frame.title = storyId;
  frame.style.cssText = "width: 100%; height: 100%; border: 0; background: #fff;";
  return frame;
}

const SLIDESHOW_CSS = /*css*/ `
  .tv-slideshow {
    height: 100vh;
    width: 100%;
    overflow: hidden;
    background: #fff;
    font-family: ui-sans-serif, system-ui, sans-serif;
    color: #1a1a1a;
  }
  .tv-slideshow .swiper { width: 100%; height: 100%; }
  .tv-slideshow .swiper-slide {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }
  /* A text/HTML slide: centered, padded, scrolls if it overflows. */
  .tv-slideshow .tv-slide-inner {
    max-width: 100%;
    max-height: 100%;
    overflow: auto;
    box-sizing: border-box;
    padding: 48px;
  }
  /* An element slide (e.g. a live mock) fills the slide edge-to-edge. */
  .tv-slideshow .swiper-slide.tv-slide-full { padding: 0; }
  .tv-slideshow .swiper-slide.tv-slide-full > * { width: 100%; height: 100%; }

  .tv-slideshow .swiper-button-prev,
  .tv-slideshow .swiper-button-next { color: #999; }
  .tv-slideshow .swiper-button-prev:hover,
  .tv-slideshow .swiper-button-next:hover { color: #333; }
  .tv-slideshow .swiper-button-prev::after,
  .tv-slideshow .swiper-button-next::after { font-size: 22px; }
  .tv-slideshow .swiper-pagination-bullet-active { background: #555; }
`;

function ensureStyles(): void {
  if (document.getElementById("tv-slideshow-css")) return;
  const style = document.createElement("style");
  style.id = "tv-slideshow-css";
  style.textContent = SLIDESHOW_CSS;
  document.head.append(style);
}

const div = (className: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = className;
  return el;
};

export function slideshow(slides: Slide[]): HTMLElement {
  ensureStyles();
  const host = div("tv-slideshow");
  const swiperEl = div("swiper");
  const wrapper = div("swiper-wrapper");
  swiperEl.append(wrapper);

  for (const slide of slides) {
    const cell = div("swiper-slide");
    if (slide instanceof HTMLElement) {
      cell.classList.add("tv-slide-full");
      cell.append(slide);
    } else {
      const inner = div("tv-slide-inner");
      if (typeof slide === "string") inner.innerHTML = slide;
      else render(slide, inner);
      cell.append(inner);
    }
    wrapper.append(cell);
  }

  const prev = div("swiper-button-prev");
  const next = div("swiper-button-next");
  const pagination = div("swiper-pagination");
  swiperEl.append(prev, next, pagination);
  host.append(swiperEl);

  // Remember the active slide across hot-reloads / re-renders so editing
  // doesn't bounce you back to slide 1. sessionStorage holds it for the tab
  // session (a fresh tab still starts at the beginning — good for presenting).
  const INDEX_KEY = "tv-slideshow-index";
  const readIndex = (): number => {
    try {
      return Math.max(0, Math.min(slides.length - 1, Number(sessionStorage.getItem(INDEX_KEY)) || 0));
    } catch {
      return 0;
    }
  };

  // Storybook mounts the returned element after render(); wait until it's in
  // the document (and sized) before initializing, or Swiper measures zero.
  const init = (): void => {
    if (!host.isConnected) {
      requestAnimationFrame(init);
      return;
    }
    new Swiper(swiperEl, {
      modules: [Keyboard, Navigation, Pagination],
      keyboard: { enabled: true },
      navigation: { prevEl: prev, nextEl: next },
      pagination: { el: pagination, clickable: true },
      observer: true,
      observeParents: true,
      initialSlide: readIndex(),
      on: {
        slideChange: (sw: Swiper) => {
          try {
            sessionStorage.setItem(INDEX_KEY, String(sw.activeIndex));
          } catch {
            /* ignore */
          }
        },
      },
    });
  };
  requestAnimationFrame(init);

  return host;
}
