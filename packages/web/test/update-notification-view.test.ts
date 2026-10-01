// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { html, nothing, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import updateNotificationContent from "../../../specs/ui/app/update-notification/content.yml";
import { UPDATE_NOTIFICATION_COPY, UpdateNotificationView } from "../src/views/update-notification.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN } from "../src/services/desktop-upgrade-recommendation.ts";
import { desktopSelfUpdateNoticeMarkdown } from "../src/services/desktop-update.ts";

const PROMPT = "Upgrade Television following https://television.run/install.md";
// Restated from specs/ui/app/update-notification/content.yml#desktop_upgrade_recommendation.
const AUTHORED_DOWNLOAD_URL = "https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64";

interface MarkupRow {
  name: string;
  prompt?: string;
  copied: boolean;
  desktop?: boolean;
  restart?: "ready" | "restarting";
}

const rows: MarkupRow[] = [
  { name: "idle prompt", prompt: PROMPT, copied: false },
  { name: "confirmed prompt", prompt: PROMPT, copied: true },
  { name: "no prompt", copied: false },
  { name: "desktop self-update notice ready", copied: false, restart: "ready" },
  { name: "desktop self-update notice restarting", copied: false, restart: "restarting" },
  { name: "desktop recommendation", copied: false, desktop: true },
];

afterEach(() => {
  document.body.replaceChildren();
});

describe("UpdateNotificationView (^un-ac-markup-smoke)", () => {
  it("disconnects without external commit refs", () => {
    const host = document.createElement("main");
    document.body.append(host);
    render(html`${UpdateNotificationView({ body: html`<p>Update available</p>` })}`, host);

    expect(() => render(nothing, host)).not.toThrow();
    expect(host.children).toHaveLength(0);
  });

  it("carries the surface's authored labels", () => {
    for (const key of ["update_available", "copy_prompt", "later", "restart_to_update", "restarting"] as const) {
      expect(UPDATE_NOTIFICATION_COPY[key], key).toBe(updateNotificationContent[key]);
    }
  });

  it.each(rows)("renders the salient $name state", ({ prompt, copied, desktop = false, restart }) => {
    const host = document.createElement("main");
    document.body.append(host);

    render(
      html`${UpdateNotificationView({
        body: desktop
          ? unsafeHTML(renderMarkdown(DESKTOP_UPGRADE_RECOMMENDATION_MARKDOWN))
          : restart !== undefined
          ? unsafeHTML(renderMarkdown(desktopSelfUpdateNoticeMarkdown("1.5.0")))
          : html`
              <h3 data-notice-body>Television 2.0.0 is available</h3>
              <p>Use the <strong>rendered</strong> notice body.</p>
            `,
        prompt,
        copied,
        restart,
      })}`,
      host,
    );

    expect(host.children).toHaveLength(2);
    const bell = host.children[0] as HTMLButtonElement;
    const panel = host.children[1] as HTMLElement;
    expect(bell.nextElementSibling).toBe(panel);

    expect(bell.tagName).toBe("BUTTON");
    expect(bell.className).toBe("update-bell");
    expect(bell.hasAttribute("icon")).toBe(true);
    expect(bell.id).toBe("update-bell");
    expect(bell.getAttribute("intent")).toBe("alert");
    expect(bell.getAttribute("aria-label")).toBe("Update available");
    expect(bell.getAttribute("title")).toBe("Update available");
    const icon = bell.querySelector("tv-icon");
    expect(icon?.getAttribute("name")).toBe("notification");
    expect(icon?.getAttribute("size")).toBe("sm");

    expect(panel.tagName).toBe("TV-POPOVER");
    expect(panel.id).toBe("update-popover");
    expect(panel.hasAttribute("manual")).toBe(true);
    expect(panel.getAttribute("trigger")).toBe(bell.id);
    expect(panel.hasAttribute("placement")).toBe(false);
    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.className).toBe("update-popover");
    if (desktop) {
      expect(panel.querySelector("h3")?.textContent).toBe(
        "Recommended desktop upgrade available",
      );
      expect(panel.textContent).toContain(
        "The Television desktop app is now a downloaded Mac app that updates itself. This copy was installed with npm and receives no more updates.",
      );
      const link = panel.querySelector<HTMLAnchorElement>("ol a");
      expect(link?.textContent).toBe("Download Television for Mac");
      expect(link?.getAttribute("href")).toBe(AUTHORED_DOWNLOAD_URL);
    } else if (restart !== undefined) {
      expect(panel.querySelector("h3")?.textContent).toBe("Desktop app update ready");
      expect(panel.textContent).toContain("Version 1.5.0 has downloaded");
    } else {
      expect(panel.querySelector("[data-notice-body]")?.outerHTML).toBe(
        "<h3 data-notice-body=\"\">Television 2.0.0 is available</h3>",
      );
      expect(panel.querySelector("[data-notice-body] + p")?.innerHTML).toBe(
        "Use the <strong>rendered</strong> notice body.",
      );
    }

    const actions = panel.querySelector(":scope > .update-actions")!;
    expect(actions).toBe(panel.lastElementChild);
    const later = actions.firstElementChild as HTMLButtonElement;
    expect(later.tagName).toBe("BUTTON");
    expect(later.className).toBe("update-later");
    expect(later.getAttribute("size")).toBe("sm");
    expect(later.textContent?.trim()).toBe("Later");

    const copyButtons = actions.querySelectorAll<HTMLButtonElement>(":scope > .copy-button");
    expect(copyButtons).toHaveLength(prompt === undefined ? 0 : 1);
    const restartButtons = actions.querySelectorAll<HTMLButtonElement>(":scope > .update-restart");
    expect(restartButtons).toHaveLength(restart === undefined ? 0 : 1);
    if (restart !== undefined) {
      expect(actions.children).toHaveLength(2);
      const button = restartButtons[0]!;
      expect(button).toBe(actions.lastElementChild);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("size")).toBe("sm");
      expect(button.getAttribute("intent")).toBe("primary");
      expect(button.textContent?.trim()).toBe(
        restart === "ready" ? updateNotificationContent.restart_to_update : updateNotificationContent.restarting,
      );
      expect(button.disabled).toBe(restart === "restarting");
      return;
    }
    if (prompt === undefined) {
      expect(actions.children).toHaveLength(1);
      return;
    }

    const copy = copyButtons[0]!;
    expect(copy.getAttribute("intent")).toBe("primary");
    expect(copy.getAttribute("prompt")).toBe(prompt);
    expect(copy.getAttribute("aria-label")).toBe("Copy upgrade prompt");
    expect(copy.querySelector(".copy-button-idle")?.textContent?.trim()).toBe(
      "Copy upgrade prompt",
    );
    expect(copy.querySelector(".copy-button-done")?.textContent?.trim()).toBe("Copied");
    expect(copy.hasAttribute("copied")).toBe(copied);
    expect(actions.querySelectorAll(":scope > .copy-button-status")).toHaveLength(1);
  });
});
