// tv-sidebar-view carried behavior — implements the interaction points of
// specs/ui/skills/sidebar-view/index.md: selection on press, single
// selection across the sidebar, re-press no-op, selection showing the
// matching tv-view, and the draggable sidebar/detail boundary (width
// clamped by the stylesheet's min/max custom properties).
//
// Known gap vs spec: the no-whitespace-before-ellipsis truncation point is
// not yet implemented (CSS text-overflow offers no cut-point control).
//
// Authors: never attach your own click handlers to sidebar parts — author
// the markup, load this script, and selection just works.

const EDGE = 5;

// Width persistence is per artifact, per device (the spec's "remembered"
// point) — pathname-scoped because artifacts share an origin.
const WIDTH_KEY = `tv-sidebar-width:${location.pathname}`;

class SidebarElement extends HTMLElement {
  #dragging = false;

  connectedCallback() {
    this.addEventListener("mousedown", this.#onPress);
    this.ownerDocument.addEventListener("mousemove", this.#onMove);
    this.ownerDocument.addEventListener("mouseup", this.#onRelease);
    try {
      const width = localStorage.getItem(WIDTH_KEY);
      if (width && /^\d+(\.\d+)?px$/.test(width)) {
        this.style.setProperty("--sidebar-width", width);
      }
    } catch {
      // storage unavailable (sandboxed/denied) — width just doesn't persist
    }
    // Reconcile views with the authored initial selection.
    this.#showView(this.querySelector("tv-sidebar-item[selected]"));
  }

  disconnectedCallback() {
    this.ownerDocument.removeEventListener("mousemove", this.#onMove);
    this.ownerDocument.removeEventListener("mouseup", this.#onRelease);
  }

  #onPress = (event) => {
    if (event.button !== 0) return;

    if (this.#inEdge(event)) {
      this.#dragging = true;
      event.preventDefault();
      return;
    }

    const item = event.target.closest("tv-sidebar-item");
    if (!item || item.hasAttribute("selected")) return;
    for (const selected of this.querySelectorAll("tv-sidebar-item[selected]")) {
      selected.removeAttribute("selected");
    }
    item.setAttribute("selected", "");
    this.#showView(item);
  };

  #onMove = (event) => {
    if (this.#dragging) {
      const rect = this.getBoundingClientRect();
      this.style.setProperty("--sidebar-width", `${event.clientX - rect.left}px`);
      return;
    }
    this.style.cursor = this.#inEdge(event) ? "col-resize" : "";
  };

  #onRelease = () => {
    if (!this.#dragging) return;
    this.#dragging = false;
    const width = this.style.getPropertyValue("--sidebar-width");
    if (width) {
      try {
        localStorage.setItem(WIDTH_KEY, width);
      } catch {
        // storage unavailable — width just doesn't persist
      }
    }
  };

  #inEdge(event) {
    const rect = this.getBoundingClientRect();
    return (
      Math.abs(event.clientX - rect.right) <= EDGE &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  #showView(item) {
    if (!item) return;
    const id = item.getAttribute("item");
    for (const view of this.ownerDocument.querySelectorAll("tv-view")) {
      view.toggleAttribute("shown", view.getAttribute("item") === id);
    }
  }
}

if (!customElements.get("tv-sidebar")) {
  customElements.define("tv-sidebar", SidebarElement);
}
