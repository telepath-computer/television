import { View, view } from "@telepath-computer/utils/lit-view";
import { html, nothing, type TemplateResult } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import { repeat } from "lit-html/directives/repeat.js";
import type { AppTemplate } from "@telepath-computer/television-shared";
import type { TemplateCache } from "../services/template-cache.ts";
import { defaultToolboxIcon, ToolboxSelection } from "./toolbox-state.ts";
import "../elements/icon.ts";
import "../elements/popover.ts";
import "./toolbox.css";

type ToolboxSource = Pick<TemplateCache, "scan" | "icons" | "setOpen" | "addEventListener" | "removeEventListener">;
type Activate = (item: AppTemplate) => Promise<void>;

/** The navbar's searchable items; the caller supplies discovery and activation. */
export class Toolbox extends View<[ToolboxSource | undefined, Activate]> {
  #source: ToolboxSource | undefined;
  #activate: Activate | undefined;
  #panel: HTMLElement | null = null;
  #observer: MutationObserver | null = null;
  #open = false;
  readonly #selection = new ToolboxSelection<AppTemplate>();
  #pressed: string | null = null;
  #activating = false;
  readonly #failedIcons = new Map<string, string>();

  connected(): void {
    this.#source?.addEventListener("change", this.#cacheChanged);
  }

  disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#panel = null;
    this.#source?.removeEventListener("change", this.#cacheChanged);
    this.#source?.setOpen(false);
  }

  readonly #observePanel = (element: Element | undefined): void => {
    if (element === this.#panel) return;
    this.#observer?.disconnect();
    this.#panel = element instanceof HTMLElement ? element : null;
    this.#open = this.#panel?.hasAttribute("open") ?? false;
    if (!this.#panel) return;
    this.#observer = new MutationObserver(() => {
      const open = this.#panel?.hasAttribute("open") ?? false;
      if (open === this.#open) return;
      this.#open = open;
      this.#source?.setOpen(open);
      if (open) {
        this.#selection.search("");
        this.#pressed = null;
        this.render();
        this.#panel?.querySelector<HTMLInputElement>("input")?.focus();
      }
    });
    this.#observer.observe(this.#panel, { attributes: true, attributeFilter: ["open"] });
  };

  readonly #cacheChanged = (): void => {
    this.render();
    this.#revealHighlight();
  };

  #revealHighlight(): void {
    if (this.#open) this.#panel?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  readonly #input = (event: Event): void => {
    this.#selection.search((event.currentTarget as HTMLInputElement).value);
    this.render();
    this.#revealHighlight();
  };

  readonly #keydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      const entry = this.#selection.matches.find(item => item.id === this.#selection.highlighted);
      if (entry) { event.preventDefault(); void this.#run(entry); }
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    this.#selection.move(event.key === "ArrowUp" ? -1 : 1);
    this.render();
    this.#revealHighlight();
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    const id = (event.currentTarget as HTMLElement).dataset.id!;
    if (this.#selection.highlighted === id) return;
    this.#selection.highlighted = id;
    this.render();
    this.#revealHighlight();
  };

  readonly #pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.#pressed = (event.currentTarget as HTMLElement).dataset.id!;
    this.render();
  };

  readonly #clearPressed = (): void => {
    if (this.#pressed === null) return;
    this.#pressed = null;
    this.render();
  };

  readonly #click = (event: MouseEvent): void => {
    const id = (event.currentTarget as HTMLElement).dataset.id;
    const entry = this.#selection.matches.find(item => item.id === id);
    if (entry) void this.#run(entry);
  };

  async #run(entry: AppTemplate): Promise<void> {
    if (this.#activating || !this.#activate) return;
    this.#activating = true;
    try {
      await this.#activate(entry);
    } catch {
      // Activation failures close silently; the action owns application state.
    } finally {
      this.#activating = false;
      this.#panel?.removeAttribute("open");
    }
  }

  #icon(entry: AppTemplate): TemplateResult {
    const url = this.#source?.icons.get(entry.id);
    if (url && this.#failedIcons.get(entry.id) !== url) {
      return html`<img class="toolbox-icon" src=${url} alt="" draggable="false" @error=${() => {
        this.#failedIcons.set(entry.id, url);
        this.render();
      }}>`;
    }
    const { letter, color } = defaultToolboxIcon(entry.id, entry.name);
    return html`<span class="toolbox-icon toolbox-letter" aria-hidden="true" style=${`background: ${color}`}>${letter}</span>`;
  }

  template(source: ToolboxSource | undefined, activate: Activate): TemplateResult {
    if (this.#source !== source) {
      this.#source?.removeEventListener("change", this.#cacheChanged);
      this.#source?.setOpen(false);
      this.#source = source;
      source?.addEventListener("change", this.#cacheChanged);
      source?.setOpen(this.#open);
    }
    this.#activate = activate;
    const scan = source?.scan;
    this.#selection.update(scan?.templates ?? []);
    for (const [id, url] of this.#failedIcons) {
      if (source?.icons.get(id) !== url) this.#failedIcons.delete(id);
    }
    const folderError = scan?.errors.find(({ folder }) => folder === null)?.error ?? null;
    const invalid = scan?.errors.filter(({ folder }) => folder !== null) ?? [];
    const matches = this.#selection.matches;
    const showList = folderError === null && matches.length > 0;
    const highlighted = matches.findIndex(item => item.id === this.#selection.highlighted);
    const query = this.#selection.query;
    return html`
      <button class="toolbox-trigger" id="toolbox-trigger" icon variant="ghost" aria-label="Toolbox" title="Toolbox">
        <tv-icon name="skills" size="sm"></tv-icon>
      </button>
      <tv-popover class="toolbox-popover" trigger="toolbox-trigger" role="region" aria-label="Toolbox" ${ref(this.#observePanel)}
        @pointerup=${this.#clearPressed} @pointercancel=${this.#clearPressed}>
        <label class="toolbox-search">
          <tv-icon name="search"></tv-icon>
          <input type="text" role="combobox" placeholder="Search toolbox…" aria-label="Search toolbox" autocomplete="off"
            aria-expanded=${showList ? "true" : "false"}
            aria-controls=${showList ? "toolbox-list" : nothing}
            aria-activedescendant=${showList && highlighted >= 0 ? `toolbox-item-${highlighted}` : nothing}
            .value=${query} @input=${this.#input} @keydown=${this.#keydown}>
        </label>
        <div class="toolbox-body">
          ${!scan ? nothing : folderError !== null ? html`
            <div class="toolbox-folder-error"><tv-icon name="warning" size="sm"></tv-icon><span class="toolbox-error-text"><span class="toolbox-error-folder">Could not read the templates folder.</span><span>${folderError}</span></span></div>
          ` : showList ? html`
            <ul class="toolbox-list" id="toolbox-list" role="listbox" aria-label="Toolbox">
              ${repeat(matches, entry => entry.id, (entry, index) => html`
                <li role="option" id=${`toolbox-item-${index}`} class="toolbox-row" data-id=${entry.id}
                  aria-selected=${index === highlighted ? "true" : "false"}
                  ?data-highlighted=${index === highlighted} ?data-pressed=${entry.id === this.#pressed}
                  @pointermove=${this.#pointerMove} @pointerdown=${this.#pointerDown}
                  @pointerleave=${this.#clearPressed} @click=${this.#click}>
                  ${this.#icon(entry)}<span class="toolbox-name">${entry.name}</span>
                </li>
              `)}
            </ul>
          ` : query.trim() ? html`<p class="toolbox-empty">${`Nothing matches “${query}”.`}</p>`
            : invalid.length ? nothing : html`<p class="toolbox-empty">Nothing here yet.</p>`}
          ${scan && folderError === null && invalid.length ? html`
            ${showList || query.trim() ? html`<hr class="toolbox-divider">` : nothing}
            <div class="toolbox-invalid" role="note">
              <tv-icon name="warning" size="sm"></tv-icon>
              <span class="toolbox-error-text"><span class="toolbox-error-folder">${invalid.length === 1 ? "1 template had errors" : `${invalid.length} templates had errors`}</span><span>Ask your agent to read the Television skill and fix ${invalid.length === 1 ? "it" : "them"}.</span></span>
            </div>
          ` : nothing}
        </div>
        <p class="toolbox-footer">Ask your agent to add artifacts to your toolbox, then reuse them anywhere.</p>
      </tv-popover>
    `;
  }
}

export const ToolboxView = view(Toolbox);
