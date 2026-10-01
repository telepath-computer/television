// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render } from "lit-html";
import gateContent from "../../../specs/ui/app/desktop-upgrade-gate/content.yml";
import { renderMarkdown } from "../src/markdown.ts";
import { GATE_DOWNLOADED_UPDATE_MARKDOWN, GATE_FALLBACK_MARKDOWN } from "../src/services/desktop-gate.ts";
import { DesktopUpdateState } from "../src/services/desktop-update.ts";
import { DESKTOP_UPGRADE_GATE_COPY, DesktopUpgradeGateView } from "../src/views/desktop-upgrade-gate.ts";
import { StandInDesktopUpdateBridge } from "./helpers/desktop-update-bridge.ts";
import { installNativeDialogMock } from "./helpers/dialog.ts";

let restoreDialog: () => void;

beforeAll(() => {
  restoreDialog = installNativeDialogMock();
});

afterEach(() => document.body.replaceChildren());
afterAll(() => restoreDialog());

function downloadedUpdate(restarting: boolean): DesktopUpdateState {
  const bridge = new StandInDesktopUpdateBridge();
  bridge.report("1.5.0");
  const state = new DesktopUpdateState({ electron: true, bridge });
  state.subscribe();
  if (restarting) state.restart();
  return state;
}

describe("desktop upgrade gate salient markup", () => {
  it("carries the surface's authored button labels", () => {
    expect(DESKTOP_UPGRADE_GATE_COPY.restart_to_update).toBe(gateContent.restart_to_update);
    expect(DESKTOP_UPGRADE_GATE_COPY.restarting).toBe(gateContent.restarting);
  });

  it("renders each message as the only dialog body, with the restart button only for a downloaded update (^dug-ac-markup-smoke)", () => {
    const channelMarkdown =
      "# Channel upgrade\n\nUse the release prepared for this server.\n\nSee the [release notes](https://television.run/releases).\n\n```bash\ntv-desktop --version\n```";
    const cases = [
      { name: "channel", instructions: { upgradeMarkdown: channelMarkdown }, markdown: channelMarkdown },
      { name: "fallback", instructions: null, markdown: GATE_FALLBACK_MARKDOWN },
      {
        name: "downloaded update",
        instructions: { upgradeMarkdown: channelMarkdown },
        update: downloadedUpdate(false),
        markdown: GATE_DOWNLOADED_UPDATE_MARKDOWN,
        restart: "ready",
      },
      {
        name: "downloaded update restarting",
        instructions: null,
        update: downloadedUpdate(true),
        markdown: GATE_DOWNLOADED_UPDATE_MARKDOWN,
        restart: "restarting",
      },
    ] as const;

    for (const row of cases) {
      const host = document.createElement("main");
      document.body.append(host);
      render(DesktopUpgradeGateView(row.instructions, "update" in row ? row.update : undefined), host);
      const gate = host.querySelector<HTMLElement>(".desktop-upgrade-gate");
      if (gate === null) throw new Error("Desktop upgrade gate view did not render");

      const overlays = gate.querySelectorAll(":scope > .dialog-overlay");
      const dialogs = gate.querySelectorAll("dialog[open]");
      const bodies = gate.querySelectorAll<HTMLElement>('[data-testid="upgrade-gate-body"]');
      expect(overlays, row.name).toHaveLength(1);
      expect(dialogs, row.name).toHaveLength(1);
      expect(bodies, row.name).toHaveLength(1);
      expect(overlays[0]?.children, row.name).toHaveLength(1);
      expect(overlays[0]?.firstElementChild, row.name).toBe(dialogs[0]);
      expect(dialogs[0]?.children, row.name).toHaveLength(1);
      const content = dialogs[0]?.firstElementChild;
      expect(content?.className, row.name).toBe("dialog-content");
      expect(content?.firstElementChild, row.name).toBe(bodies[0]);
      expect(renderedContentHTML(bodies[0]!), row.name).toBe(renderMarkdown(row.markdown));

      if ("restart" in row) {
        expect(content?.children, row.name).toHaveLength(2);
        const actions = content?.lastElementChild;
        expect(actions?.className, row.name).toBe("upgrade-gate-actions");
        expect(actions?.children, row.name).toHaveLength(1);
        const button = actions?.firstElementChild as HTMLButtonElement;
        expect(button.tagName, row.name).toBe("BUTTON");
        expect(button.className, row.name).toBe("upgrade-gate-restart");
        expect(button.getAttribute("intent"), row.name).toBe("primary");
        expect(button.textContent?.trim(), row.name).toBe(
          row.restart === "ready" ? gateContent.restart_to_update : gateContent.restarting,
        );
        expect(button.disabled, row.name).toBe(row.restart === "restarting");
        expect(
          gate.querySelectorAll('button, [role="button"], form, input, textarea, select, [data-dismiss], [data-action="dismiss"]'),
          row.name,
        ).toHaveLength(1);
        expect(bodies[0]?.querySelector("h1")?.textContent).toBe("Desktop app update required");
        expect(bodies[0]?.textContent).toContain("The new version has already downloaded");
      } else {
        expect(content?.children, row.name).toHaveLength(1);
        expect(
          gate.querySelector(
            'button, [role="button"], form, input, textarea, select, [data-dismiss], [data-action="dismiss"]',
          ),
          row.name,
        ).toBeNull();
      }

      if (row.name === "channel") {
        expect(bodies[0]?.querySelector("h1")?.textContent).toBe("Channel upgrade");
        expect(bodies[0]?.textContent).toContain("Use the release prepared for this server.");
        expect(bodies[0]?.querySelector("a")?.textContent).toBe("release notes");
        expect(bodies[0]?.querySelector("code")?.textContent.trim()).toBe("tv-desktop --version");
        expect(bodies[0]?.textContent).not.toContain("Desktop app update required");
      } else if (row.name === "fallback") {
        expect(bodies[0]?.querySelector("h1")?.textContent).toBe("Desktop app update required");
        expect(bodies[0]?.textContent).toContain("does not work with this server and needs to be updated.");
        const links = [...bodies[0]!.querySelectorAll("a")];
        expect(links.map((link) => [link.getAttribute("href"), link.textContent])).toEqual(
          authoredLinks(gateContent.fallback_instructions as string),
        );
        expect(links).toHaveLength(1);
        expect(bodies[0]?.querySelectorAll("pre")).toHaveLength(0);
      }

      render(null, host);
      host.remove();
    }
  });
});

/** The [text](href) links an authored markdown string contains, as [href, text] pairs. */
function authoredLinks(markdown: string): Array<[string, string]> {
  return [...markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => [match[2]!, match[1]!]);
}

function renderedContentHTML(element: HTMLElement): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType !== Node.COMMENT_NODE)
    .map((node) => node instanceof Element ? node.outerHTML : node.textContent ?? "")
    .join("");
}
