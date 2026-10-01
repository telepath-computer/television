import { describe, expect, it } from "vitest";
import updateNotificationContent from "../../../specs/ui/app/update-notification/content.yml";
import {
  DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN,
  DesktopUpdateState,
  desktopSelfUpdateNoticeMarkdown,
} from "../src/services/desktop-update.ts";
import { StandInDesktopUpdateBridge } from "./helpers/desktop-update-bridge.ts";

// Contract tests for the page's desktop update state and the notice body
// (specs/arch/updates/desktop-self-update-notice.md). The bridge is a stand-in —
// greenlit by the spec's Testing section; real IPC is crossed by the
// product's real-Electron acceptance (^ac-desktop-self-update-notice).

function changes(state: DesktopUpdateState): { count: number } {
  const counter = { count: 0 };
  state.addEventListener("change", () => {
    counter.count += 1;
  });
  return counter;
}

// proofs/arch/updates/desktop-self-update-notice.md#^desktop-self-update-notice-t-state
describe("the page's desktop update state (^desktop-self-update-notice-t-state)", () => {
  it("subscribes once, on the first request, and keeps the latest reported version", () => {
    const bridge = new StandInDesktopUpdateBridge();
    const state = new DesktopUpdateState({ electron: true, bridge });
    const changed = changes(state);

    expect(bridge.subscriptions).toBe(0);
    state.subscribe();
    state.subscribe();
    expect(bridge.subscriptions).toBe(1);
    expect(state.version).toBeNull();

    bridge.report("1.5.0");
    expect(state.version).toBe("1.5.0");
    bridge.report("1.5.0");
    bridge.report("");
    expect(state.version).toBe("1.5.0");
    expect(changed.count).toBe(1);

    bridge.report("1.6.0");
    expect(state.version).toBe("1.6.0");
    expect(changed.count).toBe(2);
  });

  it("hears a version reported before it subscribed", () => {
    const bridge = new StandInDesktopUpdateBridge();
    bridge.report("1.5.0");
    const state = new DesktopUpdateState({ electron: true, bridge });

    state.subscribe();

    expect(state.version).toBe("1.5.0");
  });

  it("never subscribes in a browser, and reports nothing for a bridge without the operation", () => {
    const bridge = new StandInDesktopUpdateBridge();
    bridge.report("1.5.0");
    const browser = new DesktopUpdateState({ electron: false, bridge });
    browser.subscribe();
    expect(bridge.subscriptions).toBe(0);
    expect(browser.version).toBeNull();

    const older = new DesktopUpdateState({ electron: true, bridge: { restartToInstallUpdate: () => {} } });
    older.subscribe();
    expect(older.version).toBeNull();

    const none = new DesktopUpdateState({ electron: true, bridge: null });
    none.subscribe();
    expect(none.version).toBeNull();
  });

  it("restarts once, only after a reported version, and marks itself restarting", () => {
    const bridge = new StandInDesktopUpdateBridge();
    const state = new DesktopUpdateState({ electron: true, bridge });
    state.subscribe();
    const changed = changes(state);

    state.restart();
    expect(bridge.restarts).toBe(0);
    expect(state.restarting).toBe(false);

    bridge.report("1.5.0");
    state.restart();
    state.restart();
    expect(bridge.restarts).toBe(1);
    expect(state.restarting).toBe(true);
    expect(changed.count).toBe(2);
  });
});

// proofs/arch/updates/desktop-self-update-notice.md#^desktop-self-update-notice-t-body
describe("the desktop self-update notice body (^desktop-self-update-notice-t-body)", () => {
  it("conforms the notice body to its authored copy and fills in the version", () => {
    expect(DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN).toBe(updateNotificationContent.desktop_self_update_notice);
    expect(DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN).toContain("{version}");

    const body = desktopSelfUpdateNoticeMarkdown("1.5.0-simulated");
    expect(body).toBe(DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN.replace("{version}", "1.5.0-simulated"));
    expect(body).not.toContain("{version}");
  });
});
