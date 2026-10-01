import { View, view } from "@telepath-computer/utils/lit-view";
import { html } from "lit-html";
import type { ApplicationSnapshot } from "../services/application-service.ts";
import "../elements/icon.ts";
import "./channel-sidebar.css";
import {
  calculateChannelSidebarGrip,
  ChannelListController,
  type ChannelSidebarApplication,
  type ChannelSidebarGrip,
  type ChannelSidebarGripInput,
} from "./channel-list.ts";

export type {
  ChannelSidebarApplication,
  ChannelSidebarGrip,
  ChannelSidebarGripInput,
};
export { calculateChannelSidebarGrip };

/** The permanent sidebar chrome around the shared channel-list surface. */
export class ChannelSidebar extends View<[
  ChannelSidebarApplication,
  ApplicationSnapshot,
  boolean,
  () => void,
  (Node | null)?,
  boolean?,
]> {
  readonly #channelList = new ChannelListController(() => this.render());

  connected(): void {
    this.#channelList.connect();
  }

  template(
    application: ChannelSidebarApplication,
    snapshot: ApplicationSnapshot,
    electronMode: boolean,
    onCollapse: () => void,
    sidebarToggle?: Node | null,
    motionSuppressed = false,
  ): unknown {
    this.#channelList.update(application, snapshot, {
      management: true,
      motionSuppressed,
    });
    return html`
      <nav class="sidebar" ?dragging=${this.#channelList.dragging}>
        <header
          class="sidebar-titlebar"
          ?electron-draggable=${electronMode}
        >
          <button
            class="channel-create"
            variant="ghost"
            icon
            aria-label="New channel"
            title="New channel"
            type="button"
            ?disabled=${this.#channelList.creating}
            @click=${this.#channelList.create}
          >
            <tv-icon name="add"></tv-icon>
          </button>
          <span
            class="toolbar-separator"
            role="separator"
            aria-orientation="vertical"
          ></span>
          ${sidebarToggle === undefined
            ? html`
                <button
                  class="sidebar-collapse"
                  variant="ghost"
                  icon
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                  type="button"
                  @click=${onCollapse}
                >
                  <tv-icon name="sidebar" size="sm"></tv-icon>
                </button>
              `
            : sidebarToggle ?? html`
                <span class="sidebar-toggle-seat" aria-hidden="true"></span>
              `}
        </header>

        <div class="sidebar-body" @scroll=${this.#handleScroll}>
          ${this.#channelList.template()}
        </div>
      </nav>
      ${this.#channelList.overlayTemplate()}
    `;
  }

  disconnected(): void {
    this.#channelList.disconnect();
  }

  #handleScroll = (event: Event): void => {
    const body = event.currentTarget as HTMLElement;
    body.toggleAttribute("continues-start", body.scrollTop > 0);
  };
}

export const ChannelSidebarView = view(ChannelSidebar);
