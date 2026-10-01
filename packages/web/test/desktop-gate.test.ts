// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit-html";
import { type ServerStatusMessage, type UpdateToast } from "@telepath-computer/television-shared";
import gateContent from "../../../specs/ui/app/desktop-upgrade-gate/content.yml";
import {
  GATE_DOWNLOADED_UPDATE_MARKDOWN,
  GATE_FALLBACK_MARKDOWN,
  decideDesktopGate,
  decideGatePresentation,
  detectElectronContext,
  selectGateInstructions,
} from "../src/services/desktop-gate.ts";
import { resetUpdateToastSignalDedup, UpdateNotificationController } from "../src/views/update-notification.ts";
import { FakeUpdateConnection, FakeUpdateConnectionOwner, dispatchServerStatus } from "./helpers/update-status.ts";
import { UpdatePresentationState } from "../src/services/update-presentation.ts";
import { DesktopUpdateState, type DesktopUpdateBridge } from "../src/services/desktop-update.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { DesktopUpgradeGateView } from "../src/views/desktop-upgrade-gate.ts";
import { StandInDesktopUpdateBridge } from "./helpers/desktop-update-bridge.ts";
import { installNativeDialogMock } from "./helpers/dialog.ts";

// Contract tests for the desktop upgrade gate's pure pieces
// (specs/arch/updates/desktop-upgrade-gate.md); every input injected —
// greenlit, the real crossings owned by ^t-gate-boot-barrier and the
// ^ac-gate-* product criteria:
//   ^t-electron-detection — Electron-context and shell-version parsing from
//     the page's search params (^electron-context: ?mode=electron alone —
//     every published shell has always sent it; no user-agent fallback);
//     `?desktopAppVersion=` values parse to a triple, `0.0.0`, or unknown.
//   ^t-gate-decision — gated only under the full ^gate-condition
//     conjunction, including the unknown-shell-version rule
//     (^gate-unknown-version); each ^gate-exemptions case yields not-gated.
//     Permutation breadth lives here.
//   ^t-gate-instructions — a reported download selects the downloaded-update
//     message; otherwise channel instructions render when present and the
//     built-in fallback (^gate-fallback-content) otherwise. Both built-in
//     messages equal the gate surface's authored copy.
//   ^t-gate-screen — the gate view with a stand-in for the bridge's update
//     operations: which message and button it shows, its switch while shown,
//     and a single restart call.
//   ^t-gate-precedence — a gated presentation suppresses notice and bell for
//     server-toast-eligible, desktop-self-update-notice-eligible and
//     desktop-recommendation-eligible states; each state with the gate down
//     shows both.

describe("Electron context and shell-version parsing (^t-electron-detection)", () => {
  it("detects Electron context from ?mode=electron, shell version from ?desktopAppVersion=", () => {
    expect(detectElectronContext({ search: "?mode=electron&desktopAppVersion=1.2.3" })).toEqual({
      electron: true,
      shellVersion: "1.2.3",
    });
  });

  it("detects Electron context from ?mode=electron alone: version unknown (the installed base)", () => {
    expect(detectElectronContext({ search: "?mode=electron" })).toEqual({
      electron: true,
      shellVersion: null,
    });
    expect(detectElectronContext({ search: "?token=abc&mode=electron" })).toEqual({
      electron: true,
      shellVersion: null,
    });
  });

  it("no ?mode=electron → not Electron, whatever else the page carries", () => {
    expect(detectElectronContext({ search: "" })).toEqual({
      electron: false,
      shellVersion: null,
    });
    expect(detectElectronContext({ search: "?serverURL=http://x.test" })).toEqual({
      electron: false,
      shellVersion: null,
    });
    // Even a declared shell version does not make a page Electron.
    expect(detectElectronContext({ search: "?desktopAppVersion=1.2.3" })).toEqual({
      electron: false,
      shellVersion: "1.2.3",
    });
  });

  it("parses ?desktopAppVersion= to a triple, 0.0.0, or unknown", () => {
    const at = (version: string) =>
      detectElectronContext({ search: `?mode=electron&desktopAppVersion=${version}` }).shellVersion;
    expect(at("0.0.0")).toBe("0.0.0");
    expect(at("10.20.30")).toBe("10.20.30");
    // Not a valid release triple → unknown, never a guess.
    expect(at("1.2")).toBeNull();
    expect(at("1.2.3-beta")).toBeNull();
    expect(at("garbage")).toBeNull();
    expect(at("")).toBeNull();
  });
});

describe("the gate decision (^t-gate-decision)", () => {
  const gatedBase = { electron: true, shellVersion: "1.0.0", requiredDesktopVersion: "2.0.0" };

  it("gates under the full conjunction: Electron context, a requirement, and an older shell", () => {
    expect(decideDesktopGate(gatedBase)).toBe(true);
  });

  it("gates an unknown shell version in unmistakable Electron context (^gate-unknown-version)", () => {
    expect(decideDesktopGate({ ...gatedBase, shellVersion: null })).toBe(true);
  });

  it("compares numerically, not lexicographically", () => {
    expect(decideDesktopGate({ electron: true, shellVersion: "1.9.0", requiredDesktopVersion: "1.10.0" })).toBe(true);
    expect(decideDesktopGate({ electron: true, shellVersion: "1.10.0", requiredDesktopVersion: "1.9.0" })).toBe(false);
  });

  it("exemption: a browser client is never gated, whatever the other inputs (^gate-exemptions)", () => {
    expect(decideDesktopGate({ ...gatedBase, electron: false })).toBe(false);
    expect(decideDesktopGate({ electron: false, shellVersion: null, requiredDesktopVersion: "2.0.0" })).toBe(false);
  });

  it("exemption: a server advertising no requirement gates nobody", () => {
    expect(decideDesktopGate({ ...gatedBase, requiredDesktopVersion: null })).toBe(false);
    expect(decideDesktopGate({ electron: true, shellVersion: null, requiredDesktopVersion: null })).toBe(false);
  });

  it("a malformed requirement is treated as no requirement — fails open, even for an unknown shell (^gate-condition)", () => {
    // The unknown-shell rule must not outrank requirement validation: with a
    // non-triple requirement there is nothing valid to gate against, so
    // NOBODY gates — including the shell-version-unknown case that would
    // otherwise gate first.
    for (const requiredDesktopVersion of ["bad", "1.2", "2.0.0-beta.1", ""]) {
      expect(decideDesktopGate({ electron: true, shellVersion: null, requiredDesktopVersion }), requiredDesktopVersion).toBe(false);
      expect(decideDesktopGate({ ...gatedBase, requiredDesktopVersion }), requiredDesktopVersion).toBe(false);
    }
  });

  it("exemption: a shell explicitly reporting 0.0.0 (development shells) is never gated", () => {
    expect(decideDesktopGate({ ...gatedBase, shellVersion: "0.0.0" })).toBe(false);
  });

  it("exemption: a shell exactly at the requirement is not gated", () => {
    expect(decideDesktopGate({ ...gatedBase, shellVersion: "2.0.0" })).toBe(false);
  });

  it("exemption: a shell above the requirement is not gated", () => {
    expect(decideDesktopGate({ ...gatedBase, shellVersion: "2.0.1" })).toBe(false);
  });
});

describe("gate message selection (^t-gate-instructions)", () => {
  it("selects the downloaded-update message for a reported download, whatever the channel publishes", () => {
    expect(selectGateInstructions({ upgradeMarkdown: "Run `upgrade-now` please." }, true)).toBe(
      GATE_DOWNLOADED_UPDATE_MARKDOWN,
    );
    expect(selectGateInstructions(null, true)).toBe(GATE_DOWNLOADED_UPDATE_MARKDOWN);
  });

  it("prefers the channel's desktop upgrade instructions when no download is reported", () => {
    expect(selectGateInstructions({ upgradeMarkdown: "Run `upgrade-now` please." }, false)).toBe("Run `upgrade-now` please.");
    expect(selectGateInstructions({ upgradeMarkdown: "Run `upgrade-now` please." })).toBe("Run `upgrade-now` please.");
  });

  it("falls back to the built-in content when the channel offers none", () => {
    expect(selectGateInstructions(null, false)).toBe(GATE_FALLBACK_MARKDOWN);
  });

  it("conforms both built-in messages to the gate surface's authored copy (^gate-fallback-content)", () => {
    expect(GATE_DOWNLOADED_UPDATE_MARKDOWN).toBe(gateContent.downloaded_update_instructions);
    expect(GATE_FALLBACK_MARKDOWN).toBe(gateContent.fallback_instructions);
  });
});

// proofs/arch/updates/desktop-upgrade-gate.md#^t-gate-screen
describe("the gate screen with the update operations (^t-gate-screen)", () => {
  let restoreDialog: () => void;
  const hosts: HTMLElement[] = [];

  beforeAll(() => {
    restoreDialog = installNativeDialogMock();
  });
  afterEach(() => {
    for (const host of hosts.splice(0)) {
      render(null, host);
      host.remove();
    }
  });
  afterAll(() => restoreDialog());

  function mountGate(
    instructions: { upgradeMarkdown: string } | null,
    state: DesktopUpdateState,
  ): HTMLElement {
    const host = document.createElement("main");
    document.body.append(host);
    hosts.push(host);
    render(DesktopUpgradeGateView(instructions, state), host);
    return host;
  }

  async function settle(): Promise<void> {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  }

  function bodyHTML(host: HTMLElement): string {
    const body = host.querySelector<HTMLElement>('[data-testid="upgrade-gate-body"]');
    if (body === null) throw new Error("the gate rendered no message body");
    return [...body.childNodes]
      .filter((node) => node.nodeType !== Node.COMMENT_NODE)
      .map((node) => node instanceof Element ? node.outerHTML : node.textContent ?? "")
      .join("");
  }

  const restartButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".upgrade-gate-restart");
  const channel = { upgradeMarkdown: "# Channel upgrade\n\nRun the channel command." };

  it.each([
    ["no bridge", null],
    ["a bridge without the operations", {}],
  ] as const)("gives a shell with %s the channel instructions or the fallback, with no restart button", async (_name, bridge) => {
    const state = new DesktopUpdateState({ electron: true, bridge: bridge as DesktopUpdateBridge | null });

    const withChannel = mountGate(channel, state);
    await settle();
    expect(bodyHTML(withChannel)).toBe(renderMarkdown(channel.upgradeMarkdown));
    expect(restartButton(withChannel)).toBeNull();
    render(null, withChannel);
    withChannel.remove();

    const withoutChannel = mountGate(null, state);
    await settle();
    expect(bodyHTML(withoutChannel)).toBe(renderMarkdown(GATE_FALLBACK_MARKDOWN));
    expect(restartButton(withoutChannel)).toBeNull();
  });

  it("shows the downloaded-update message and the restart button for a download reported before it renders, even with channel instructions", async () => {
    const bridge = new StandInDesktopUpdateBridge();
    bridge.report("1.5.0");
    const host = mountGate(channel, new DesktopUpdateState({ electron: true, bridge }));
    await settle();

    expect(bodyHTML(host)).toBe(renderMarkdown(GATE_DOWNLOADED_UPDATE_MARKDOWN));
    expect(restartButton(host)?.textContent?.trim()).toBe(gateContent.restart_to_update);
  });

  it("changes to the downloaded-update message in place when a download is reported while it is shown", async () => {
    const bridge = new StandInDesktopUpdateBridge();
    const host = mountGate(null, new DesktopUpdateState({ electron: true, bridge }));
    await settle();
    const dialog = host.querySelector("dialog");
    expect(bodyHTML(host)).toBe(renderMarkdown(GATE_FALLBACK_MARKDOWN));
    expect(restartButton(host)).toBeNull();

    bridge.report("1.5.0");
    await settle();

    expect(bodyHTML(host)).toBe(renderMarkdown(GATE_DOWNLOADED_UPDATE_MARKDOWN));
    expect(restartButton(host)).not.toBeNull();
    expect(host.querySelector("dialog")).toBe(dialog);
    expect(dialog?.hasAttribute("open")).toBe(true);
  });

  it("restarts exactly once and shows that the restart is under way", async () => {
    const bridge = new StandInDesktopUpdateBridge();
    bridge.report("1.5.0");
    const host = mountGate(null, new DesktopUpdateState({ electron: true, bridge }));
    await settle();

    restartButton(host)?.click();
    await settle();
    restartButton(host)?.click();
    await settle();

    expect(bridge.restarts).toBe(1);
    expect(restartButton(host)?.disabled).toBe(true);
    expect(restartButton(host)?.textContent?.trim()).toBe(gateContent.restarting);
  });
});

describe("gate presentation and precedence (^t-gate-precedence)", () => {
  const PRIMARY = "http://primary.test";

  function mountToast(): { el: HTMLElement; presentation: UpdatePresentationState; sendEligibleToast(): void } {
    const owner = new FakeUpdateConnectionOwner(new FakeUpdateConnection(PRIMARY));
    const presentation = new UpdatePresentationState();
    const el = document.createElement("div");
    let controller!: UpdateNotificationController;
    const draw = (): void => {
      render(controller.template(), el);
    };
    controller = new UpdateNotificationController(draw);
    controller.configure({
      connectionOwner: owner,
      primaryServerURL: PRIMARY,
      dismissalStorage: null,
      presentation,
    });
    controller.connect();
    document.body.appendChild(el);
    draw();
    const toast: UpdateToast = { version: "1.5.0", markdown: "New release!" };
    const message: ServerStatusMessage = {
      type: "server-status",
      version: "1.0.0",
      requiredDesktopVersion: "2.0.0",
      update: { toast, desktop: null },
    };
    return {
      el,
      presentation,
      sendEligibleToast: () => dispatchServerStatus(owner, message, PRIMARY),
    };
  }

  function mountRecommendation(
    presentation: UpdatePresentationState,
  ): { el: HTMLElement; connect(): void } {
    const owner = new FakeUpdateConnectionOwner(new FakeUpdateConnection(PRIMARY));
    const el = document.createElement("div");
    let controller!: UpdateNotificationController;
    const draw = (): void => {
      render(controller.template(), el);
    };
    controller = new UpdateNotificationController(draw);
    controller.configure({
      connectionOwner: owner,
      primaryServerURL: PRIMARY,
      dismissalStorage: null,
      presentation,
      desktopRecommendation: { electron: true, shellVersion: "0.1.210" },
    });
    return {
      el,
      connect() {
        controller.connect();
        document.body.appendChild(el);
        draw();
      },
    };
  }

  function mountDesktopSelfUpdateNotice(
    presentation: UpdatePresentationState,
  ): { el: HTMLElement; connect(): void } {
    const owner = new FakeUpdateConnectionOwner(new FakeUpdateConnection(PRIMARY));
    const bridge = new StandInDesktopUpdateBridge();
    bridge.report("1.5.0");
    const el = document.createElement("div");
    let controller!: UpdateNotificationController;
    const draw = (): void => {
      render(controller.template(), el);
    };
    controller = new UpdateNotificationController(draw);
    controller.configure({
      connectionOwner: owner,
      primaryServerURL: PRIMARY,
      dismissalStorage: null,
      presentation,
      desktopUpdate: new DesktopUpdateState({ electron: true, bridge }),
    });
    return {
      el,
      connect() {
        controller.connect();
        document.body.appendChild(el);
        draw();
      },
    };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    resetUpdateToastSignalDedup();
  });

  it("composes the decision with the instructions: gated yields the gate body and toast suppression", () => {
    const presentation = decideGatePresentation({
      electron: true,
      shellVersion: "1.0.0",
      requiredDesktopVersion: "2.0.0",
      desktop: { upgradeMarkdown: "Channel says upgrade." },
    });
    expect(presentation).toEqual({
      gated: true,
      instructionsMarkdown: "Channel says upgrade.",
      suppressUpdateToast: true,
    });
  });

  it("not gated: no gate body, no suppression", () => {
    const presentation = decideGatePresentation({
      electron: false,
      shellVersion: null,
      requiredDesktopVersion: "2.0.0",
      desktop: { upgradeMarkdown: "Channel says upgrade." },
    });
    expect(presentation).toEqual({ gated: false, instructionsMarkdown: null, suppressUpdateToast: false });
  });

  it("a halted presentation shows no notice and no bell for a toast-eligible update state", () => {
    // Driven through the owned suppression contract (^gate-precedence): the
    // decision's suppressUpdateToast flips the shared state's switch, never
    // a notification property.
    const { el, presentation, sendEligibleToast } = mountToast();
    const decided = decideGatePresentation({
      electron: true,
      shellVersion: null,
      requiredDesktopVersion: "2.0.0",
      desktop: null,
    });
    if (decided.suppressUpdateToast) presentation.suppressToasts();
    sendEligibleToast();
    expect(el.querySelector("tv-popover")).toBeNull();
    expect(el.querySelector(".update-bell")).toBeNull();
  });

  it("the same server update state with the gate down shows notice and bell", () => {
    const { el, presentation, sendEligibleToast } = mountToast();
    const decided = decideGatePresentation({
      electron: true,
      shellVersion: "2.0.0",
      requiredDesktopVersion: "2.0.0",
      desktop: null,
    });
    if (decided.suppressUpdateToast) presentation.suppressToasts();
    sendEligibleToast();
    expect(el.querySelector("tv-popover")).not.toBeNull();
    expect(el.querySelector(".update-bell")).not.toBeNull();
  });

  it("a halted presentation shows no notice and no bell for a recommendation-eligible state", () => {
    const presentation = new UpdatePresentationState();
    const mounted = mountRecommendation(presentation);
    const decided = decideGatePresentation({
      electron: true,
      shellVersion: "0.1.210",
      requiredDesktopVersion: "2.0.0",
      desktop: null,
    });
    if (decided.suppressUpdateToast) presentation.suppressToasts();
    mounted.connect();
    expect(mounted.el.querySelector("tv-popover")).toBeNull();
    expect(mounted.el.querySelector(".update-bell")).toBeNull();
  });

  it("the same recommendation state with the gate down shows notice and bell", () => {
    const presentation = new UpdatePresentationState();
    const mounted = mountRecommendation(presentation);
    const decided = decideGatePresentation({
      electron: true,
      shellVersion: "0.1.210",
      requiredDesktopVersion: "0.1.207",
      desktop: null,
    });
    if (decided.suppressUpdateToast) presentation.suppressToasts();
    mounted.connect();
    expect(mounted.el.querySelector("tv-popover")).not.toBeNull();
    expect(mounted.el.querySelector(".update-bell")).not.toBeNull();
  });

  it("a halted presentation shows no notice and no bell for a desktop-self-update-notice-eligible state", () => {
    const presentation = new UpdatePresentationState();
    const mounted = mountDesktopSelfUpdateNotice(presentation);
    const decided = decideGatePresentation({
      electron: true,
      shellVersion: "1.4.1",
      requiredDesktopVersion: "2.0.0",
      desktop: null,
    });
    if (decided.suppressUpdateToast) presentation.suppressToasts();
    mounted.connect();
    expect(mounted.el.querySelector("tv-popover")).toBeNull();
    expect(mounted.el.querySelector(".update-bell")).toBeNull();
  });

  it("the same desktop update state with the gate down shows notice and bell", () => {
    const presentation = new UpdatePresentationState();
    const mounted = mountDesktopSelfUpdateNotice(presentation);
    const decided = decideGatePresentation({
      electron: true,
      shellVersion: "2.0.0",
      requiredDesktopVersion: "2.0.0",
      desktop: null,
    });
    if (decided.suppressUpdateToast) presentation.suppressToasts();
    mounted.connect();
    expect(mounted.el.querySelector("tv-popover")).not.toBeNull();
    expect(mounted.el.querySelector(".update-bell")).not.toBeNull();
  });
});
