import { View, view } from "@telepath-computer/utils/lit-view";
import { html, nothing, type TemplateResult } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import type { ArtifactTemplate, ArtifactTemplateScan } from "@telepath-computer/television-shared";
import type { ApplicationService } from "../services/application-service.ts";
import type { ServerConnection } from "../services/server-connection.ts";
import "../elements/icon.ts";
import "../elements/popover.ts";
import "./skill-selector.css";

/** The top bar's live artifact-template scan and create surface. */
export class TemplatesPopover extends View<[ApplicationService, ServerConnection?]> {
  #application: ApplicationService | null = null;
  #connection: ServerConnection | null = null;
  #panel: HTMLElement | null = null;
  #observer: MutationObserver | null = null;
  #open = false;
  #sequence = 0;
  #scan: ArtifactTemplateScan = { templates: [], errors: [] };
  #query = "";
  #highlighted: number | null = null;
  #pressed: number | null = null;
  #creating = false;
  readonly #images = new Map<string, string>();

  disconnected(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#panel = null;
    this.#sequence++;
    this.#releaseImages();
    this.#application = null;
    this.#connection = null;
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
      if (open) void this.#load();
      else {
        this.#sequence++;
        this.#releaseImages();
      }
    });
    this.#observer.observe(this.#panel, { attributes: true, attributeFilter: ["open"] });
  };

  #releaseImages(): void {
    for (const url of this.#images.values()) URL.revokeObjectURL(url);
    this.#images.clear();
  }

  async #load(): Promise<void> {
    const sequence = ++this.#sequence;
    this.#releaseImages();
    this.#scan = { templates: [], errors: [] };
    this.#query = "";
    this.#highlighted = null;
    this.#pressed = null;
    this.render();
    queueMicrotask(() => this.#panel?.querySelector<HTMLInputElement>(".templates-search input")?.focus());
    const templates = this.#connection?.client.templates;
    if (!templates) return;
    try {
      const scan = await templates.list();
      if (sequence !== this.#sequence) return;
      this.#scan = scan;
      this.#highlighted = this.#query && this.#matches().length ? 0 : null;
      this.render();
      for (const entry of scan.templates) {
        if (!entry.hasThumbnail) continue;
        void templates.thumbnail(entry.id).then((bytes) => {
          if (sequence !== this.#sequence) return;
          const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
          this.#images.set(entry.id, url);
          this.render();
        }).catch(() => {});
      }
    } catch (error) {
      if (sequence !== this.#sequence) return;
      this.#scan = { templates: [], errors: [{ folder: null, error: String(error) }] };
      this.render();
    }
  }

  #matches(): ArtifactTemplate[] {
    const needle = this.#query.toLocaleLowerCase();
    return this.#scan.templates.filter(({ name, description }) =>
      name.toLocaleLowerCase().includes(needle) || description.toLocaleLowerCase().includes(needle));
  }

  readonly #input = (event: Event): void => {
    this.#query = (event.currentTarget as HTMLInputElement).value;
    this.#highlighted = this.#query && this.#matches().length ? 0 : null;
    this.render();
  };

  readonly #keydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      if (this.#highlighted !== null) {
        event.preventDefault();
        void this.#create(this.#matches()[this.#highlighted]);
      }
      return;
    }
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } as Record<string, number>)[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const last = this.#matches().length - 1;
    if (last < 0) return;
    if (this.#highlighted === null) this.#highlighted = 0;
    else {
      const next = this.#highlighted + delta;
      if (next >= 0 && next <= last) this.#highlighted = next;
    }
    this.render();
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    const index = Number((event.currentTarget as HTMLElement).dataset.index);
    if (this.#highlighted === index) return;
    this.#highlighted = index;
    this.render();
  };

  readonly #pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.#pressed = Number((event.currentTarget as HTMLElement).dataset.index);
    this.render();
  };

  readonly #clearPressed = (): void => {
    if (this.#pressed === null) return;
    this.#pressed = null;
    this.render();
  };

  readonly #click = (event: MouseEvent): void => {
    const index = Number((event.currentTarget as HTMLElement).dataset.index);
    void this.#create(this.#matches()[index]);
  };

  async #create(entry: ArtifactTemplate | undefined): Promise<void> {
    if (!entry || this.#creating || !this.#application || !this.#connection) return;
    const channel = this.#application.snapshot.focusedChannel;
    if (!channel) return;
    this.#creating = true;
    const after = channel.selectedPage?.artifactIds[0];
    try {
      const result = await this.#connection.client.templates.create({
        templateID: entry.id,
        channelID: channel.id,
        source: "ui",
        ...(after ? { after } : {}),
      });
      await this.#connection.client.display.focus({ artifactID: result.artifactID });
      this.#application.selectPage(channel.id, result.artifactID);
    } catch {
      // Failed creation or focus leaves the browser's selected page and focus alone.
    } finally {
      this.#creating = false;
      this.#panel?.removeAttribute("open");
    }
  }

  template(application: ApplicationService, connection?: ServerConnection): TemplateResult {
    this.#application = application;
    this.#connection = connection ?? null;
    const folderError = this.#scan.errors.find(({ folder }) => folder === null)?.error ?? null;
    const invalid = this.#scan.errors.filter(({ folder }) => folder !== null);
    const matches = this.#matches();
    const showGrid = folderError === null && matches.length > 0;
    return html`
      <button class="templates-trigger" id="templates-trigger" icon variant="ghost" aria-label="Templates" title="Templates">
        <tv-icon name="skills" size="sm"></tv-icon>
      </button>
      <tv-popover class="templates-popover" trigger="templates-trigger" ${ref(this.#observePanel)}
        @pointerup=${this.#clearPressed} @pointercancel=${this.#clearPressed}>
        <h2 class="templates-heading">Artifact templates</h2>
        <p class="templates-intro">Each template is a kind of artifact. Click one to add it to this channel. To make your own, ask your agent.</p>
        <label class="templates-search">
          <tv-icon name="search"></tv-icon>
          <input type="text" role="combobox" placeholder="Search templates" aria-label="Search templates"
            aria-expanded=${showGrid ? "true" : "false"}
            aria-controls=${showGrid ? "templates-grid" : nothing}
            aria-activedescendant=${showGrid && this.#highlighted !== null ? `template-${this.#highlighted}` : nothing}
            .value=${this.#query} @input=${this.#input} @keydown=${this.#keydown}>
        </label>
        <div class="templates-body">
          ${folderError !== null ? html`
            <div class="templates-folder-error"><tv-icon name="warning"></tv-icon><span class="template-invalid-text"><span class="template-invalid-folder">Television couldn't read the templates folder.</span><span>${folderError}</span></span></div>
          ` : showGrid ? html`
            <ul class="templates-grid" id="templates-grid" role="listbox" aria-label="Templates">
              ${matches.map((entry, index) => html`
                <li role="option" id=${`template-${index}`} class="template-tile" data-index=${index}
                  ?data-highlighted=${index === this.#highlighted} ?data-pressed=${index === this.#pressed}
                  @pointermove=${this.#pointerMove} @pointerdown=${this.#pointerDown}
                  @pointerleave=${this.#clearPressed} @click=${this.#click}>
                  <span class="template-tile-card">${this.#images.has(entry.id)
                    ? html`<img src=${this.#images.get(entry.id)!} alt="" draggable="false">`
                    : html`<tv-icon name="artifact"></tv-icon>`}</span>
                  <span class="template-tile-name">${entry.name}</span>
                </li>
              `)}
            </ul>
          ` : html`<p class="templates-empty">${this.#query
            ? `No templates match “${this.#query}”.`
            : invalid.length
              ? "No valid templates. Ask your agent to fix or make one."
              : "No templates yet. Ask your agent to make one."}</p>`}
          ${invalid.length ? html`
            <ul class="templates-invalid" aria-label="Templates with errors">
              ${invalid.map(({ folder, error }) => html`
                <li class="template-invalid"><tv-icon name="warning"></tv-icon><span class="template-invalid-text"><span class="template-invalid-folder">${folder}</span><span>${error}</span></span></li>
              `)}
            </ul>
          ` : nothing}
        </div>
      </tv-popover>
    `;
  }
}

export const TemplatesPopoverView = view(TemplatesPopover);
