// tv-sidebar-view carried behavior — implements the interaction points of
// specs/ui/skills/sidebar-view/index.md: selection on press, single
// selection across the sidebar, re-press no-op, selection showing the
// matching tv-view, and the draggable sidebar/detail boundary (width
// clamped by the stylesheet's min/max custom properties). The width is shared
// by everyone viewing the artifact through its own JSON store
// (specs/arch/skills/sidebar-view.md, Storage).
//
// Known gap vs spec: the no-whitespace-before-ellipsis truncation point is
// not yet implemented (CSS text-overflow offers no cut-point control).
//
// Authors: never attach your own click handlers to sidebar parts — author
// the markup, load this script, and selection just works.

const EDGE = 5;

const WIDTH_PATH = "tv-sidebar-view/width";

class SidebarElement extends HTMLElement {
  #dragging = false;
  #saveWidth = () => {};
  #stopFollowing = () => {};

  connectedCallback() {
    this.addEventListener("mousedown", this.#onPress);
    this.ownerDocument.addEventListener("mousemove", this.#onMove);
    this.ownerDocument.addEventListener("mouseup", this.#onRelease);
    this.#followStoredWidth();
    // Reconcile views with the authored initial selection.
    this.#showView(this.querySelector("tv-sidebar-item[selected]"));
  }

  disconnectedCallback() {
    this.ownerDocument.removeEventListener("mousemove", this.#onMove);
    this.ownerDocument.removeEventListener("mouseup", this.#onRelease);
    this.#stopFollowing();
    this.#stopFollowing = () => {};
    this.#saveWidth = () => {};
  }

  // The SDK is imported here, not at the top, so that selection still works
  // on a page that cannot use it; the sidebar then keeps its default width
  // and saves nothing.
  async #followStoredWidth() {
    try {
      const sdk = await import("/sdk/v1/resources.js");
      if (!this.isConnected) return;
      const width = sdk.ref(sdk.getStore(), WIDTH_PATH);
      this.#stopFollowing = sdk.onValue(
        width,
        (snapshot) => this.#showWidth(snapshot.val()),
        () => {}, // a store that cannot be read leaves the width as it is
      );
      // A refused or failed write keeps the new width in this page. A write
      // the SDK rolls back shows the stored width again before its promise
      // rejects, so the new width is shown once more.
      this.#saveWidth = (value) => {
        sdk.set(width, value).catch(() => this.#showWidth(value));
      };
    } catch {
      // no SDK or no artifact address
    }
  }

  #showWidth(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      this.style.setProperty("--sidebar-width", `${value}px`);
    } else {
      this.style.removeProperty("--sidebar-width");
    }
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
    // The shown width, within the stylesheet's minimum and maximum.
    const width = this.getBoundingClientRect().width;
    this.#showWidth(width);
    this.#saveWidth(width);
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
