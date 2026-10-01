import {
  type AppearanceMode,
  type InstalledTheme,
  type ThemeRegistrySnapshot,
} from "@telepath-computer/television-shared";
import { View, view } from "@telepath-computer/utils/lit-view";
import { html, type TemplateResult } from "lit-html";
import { createRef, ref } from "lit-html/directives/ref.js";
import type { SelectElement } from "../elements/select.ts";
import "../elements/select.ts";
import "../elements/popover.ts";
import { live } from "lit-html/directives/live.js";
import type { ApplicationSnapshot } from "../services/application-service.ts";
import "../elements/icon.ts";
import "./settings.css";

const SETTINGS_LABEL = "Settings";
const REFRESH_LABEL = "Refresh themes";
const DIRECTORY_LABEL = "Themes directory";
const NULL_THEME_LABEL = "None";

export interface SettingsApplication {
  readonly snapshot: Pick<ApplicationSnapshot, "connection" | "display">;
  listThemes(): Promise<ThemeRegistrySnapshot>;
  refreshThemes(): Promise<ThemeRegistrySnapshot>;
  setActiveTheme(activeThemeName: string | null): Promise<void>;
  setAppearanceMode(appearanceMode: AppearanceMode): Promise<void>;
  setThemeJavaScriptConsent(themeId: string, enabled: boolean): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The top bar's settings trigger and paired popover. */
export class Settings extends View<[SettingsApplication]> {
  #application: SettingsApplication | null = null;
  #registry: ThemeRegistrySnapshot | null = null;
  #loading = false;
  #failure: string | null = null;
  #connected = false;
  #requestSequence = 0;
  #panelObserver: MutationObserver | null = null;
  #panelOpen = false;
  readonly #appearance = createRef<SelectElement>();
  readonly #theme = createRef<SelectElement>();

  template(application: SettingsApplication): TemplateResult {
    this.#application = application;
    const connected = application.snapshot.connection.status === "connected";
    if (this.#connected && !connected) this.#resetRegistry();
    this.#connected = connected;

    const {
      activeThemeName,
      appearanceMode,
      themeJavaScriptConsentIds,
    } = application.snapshot.display;
    const themes: readonly InstalledTheme[] = this.#registry?.themes ?? [];
    const errors = this.#registry?.errors ?? [];
    const activeExecutableTheme = activeThemeName === null
      ? undefined
      : themes.find((theme) =>
        theme.id === activeThemeName && theme.enableMainJS === true
      );
    const activeThemeJavaScriptConsented = activeThemeName !== null &&
      themeJavaScriptConsentIds.includes(activeThemeName);

    // Property parts run before newly rendered option children exist. Commit
    // the confirmed values after the complete template has reached the DOM.
    queueMicrotask(() => {
      if (!this.isConnected) return;
      if (this.#appearance.value) this.#appearance.value.value = this.#application?.snapshot.display.appearanceMode ?? "system";
      if (this.#theme.value) this.#theme.value.value = this.#application?.snapshot.display.activeThemeName ?? "";
    });

    return html`
      <button
        class="settings-trigger"
        variant="ghost"
        icon
        id="settings-trigger"
        aria-label=${SETTINGS_LABEL}
        title=${SETTINGS_LABEL}
      >
        <tv-icon name="settings" size="sm"></tv-icon>
      </button>

      <tv-popover
        id="settings-popover"
        trigger="settings-trigger"
        class="settings-popover"
        ${ref(this.#observePanel)}
      >
        <div class="settings-heading">Settings</div>

        <div class="settings-field">
          <label id="settings-appearance-label">Light/dark mode</label>
          <button id="settings-appearance" aria-labelledby="settings-appearance-label"></button>
          <tv-select
            trigger="settings-appearance"
            name="appearance-mode"
            ${ref(this.#appearance)}
            @change=${this.#handleAppearanceChange}
          >
            <tv-option value="system" ?selected=${appearanceMode === "system"}>Adapt to system</tv-option>
            <tv-option value="light" ?selected=${appearanceMode === "light"}>Light</tv-option>
            <tv-option value="dark" ?selected=${appearanceMode === "dark"}>Dark</tv-option>
          </tv-select>
        </div>

        <div class="settings-field">
          <label id="settings-theme-label">Theme</label>
          <div class="settings-theme-control">
            <button id="settings-theme" aria-labelledby="settings-theme-label"></button>
            <tv-select
              trigger="settings-theme"
              name="theme"
              ${ref(this.#theme)}
              @change=${this.#handleThemeChange}
            >
              <tv-option value="" ?selected=${activeThemeName === null}>${NULL_THEME_LABEL}</tv-option>
              ${themes.map((theme) => html`
                <tv-option
                  value=${theme.id}
                  ?selected=${theme.id === activeThemeName}
                >${theme.name}</tv-option>
              `)}
            </tv-select>
            <button
              type="button"
              variant="ghost"
              icon
              aria-label=${REFRESH_LABEL}
              title=${REFRESH_LABEL}
              ?disabled=${this.#loading || !connected}
              @click=${this.#handleRefresh}
            >
              <tv-icon name="reload" size="sm"></tv-icon>
            </button>
          </div>
        </div>

        ${activeExecutableTheme
          ? html`
              <section
                class="settings-javascript-consent"
                aria-label="Experimental main-page JavaScript"
              >
                <p class="settings-javascript-disclosure">This theme uses experimental JavaScript. JavaScript can access your Television content, so only enable for themes you trust or have had your agent inspect.</p>
                <label class="settings-javascript-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    name="theme-javascript-consent"
                    value=${activeExecutableTheme.id}
                    .checked=${live(activeThemeJavaScriptConsented)}
                    @change=${this.#handleThemeJavaScriptConsentChange}
                  >
                  <span>Enable experimental javascript for this theme</span>
                </label>
              </section>
            `
          : null}

        ${this.#loading
          ? html`<p class="settings-status" role="status">Loading themes…</p>`
          : null}
        ${this.#failure
          ? html`<p class="settings-failure" role="alert">${this.#failure}</p>`
          : null}
        ${errors.length > 0
          ? html`
              <div class="settings-errors" aria-label="Theme validation errors">
                ${errors.map((item) => html`
                  <p><strong>${item.folder ?? DIRECTORY_LABEL}</strong>: ${item.error}</p>
                `)}
              </div>
            `
          : null}
      </tv-popover>
    `;
  }

  disconnected(): void {
    this.#panelObserver?.disconnect();
    this.#panelObserver = null;
    this.#panelOpen = false;
    this.#application = null;
    this.#requestSequence += 1;
  }

  #resetRegistry(): void {
    this.#registry = null;
    this.#failure = null;
    this.#loading = false;
    this.#requestSequence += 1;
  }

  readonly #observePanel = (element: Element | undefined): void => {
    this.#panelObserver?.disconnect();
    this.#panelObserver = null;
    this.#panelOpen = false;
    if (!element) return;
    const observe = (): void => {
      const open = element.hasAttribute("open");
      if (open === this.#panelOpen) return;
      this.#panelOpen = open;
      if (open) void this.#loadRegistry(false);
    };
    this.#panelObserver = new MutationObserver(observe);
    this.#panelObserver.observe(element, { attributes: true, attributeFilter: ["open"] });
    observe();
  };

  readonly #handleRefresh = (): void => {
    void this.#loadRegistry(true);
  };

  async #loadRegistry(refresh: boolean): Promise<void> {
    const application = this.#application;
    if (
      application === null ||
      application.snapshot.connection.status !== "connected" ||
      this.#loading
    ) return;

    const sequence = ++this.#requestSequence;
    this.#loading = true;
    this.#failure = null;
    this.render();
    try {
      const snapshot = await (refresh
        ? application.refreshThemes()
        : application.listThemes());
      if (sequence !== this.#requestSequence) return;
      this.#registry = snapshot;
    } catch (error) {
      if (sequence !== this.#requestSequence) return;
      this.#failure = `${refresh ? "Unable to refresh themes" : "Unable to load themes"}: ${errorMessage(error)}`;
    } finally {
      if (sequence === this.#requestSequence) {
        this.#loading = false;
        this.render();
      }
    }
  }

  readonly #handleAppearanceChange = (event: Event): void => {
    const select = event.currentTarget as SelectElement;
    const requested = select.value as AppearanceMode;
    select.value = this.#application?.snapshot.display.appearanceMode ?? "system";
    this.render();
    void this.#writePreference(
      () => this.#application?.setAppearanceMode(requested),
      "Unable to change light/dark mode",
    );
  };

  readonly #handleThemeChange = (event: Event): void => {
    const select = event.currentTarget as SelectElement;
    const requested = select.value || null;
    select.value = this.#application?.snapshot.display.activeThemeName ?? "";
    this.render();
    void this.#writePreference(
      () => this.#application?.setActiveTheme(requested),
      "Unable to change theme",
    );
  };

  readonly #handleThemeJavaScriptConsentChange = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    const themeId = input.value;
    const requested = input.checked;
    input.checked = this.#application?.snapshot.display
      .themeJavaScriptConsentIds.includes(themeId) ?? false;
    this.render();
    void this.#writePreference(
      () => this.#application?.setThemeJavaScriptConsent(themeId, requested),
      "Unable to change theme JavaScript consent",
    );
  };

  async #writePreference(
    write: () => Promise<void> | undefined,
    failurePrefix: string,
  ): Promise<void> {
    this.#failure = null;
    this.render();
    try {
      await write();
    } catch (error) {
      this.#failure = `${failurePrefix}: ${errorMessage(error)}`;
      this.render();
    }
  }
}

export const SettingsView = view(Settings);
