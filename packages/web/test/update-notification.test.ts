// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit-html";
import { ChangeEvent, type ServerStatusMessage, type UpdateToast } from "@telepath-computer/television-shared";
import { FakeUpdateConnection, FakeUpdateConnectionOwner, dispatchServerStatus } from "./helpers/update-status.ts";
import {
  DISMISSED_VERSION_KEY,
  UpdateNotificationController,
  resetUpdateToastSignalDedup,
  shouldAutoPresent,
  type UpdateNotificationConnection,
} from "../src/views/update-notification.ts";
import { UpdatePresentationState } from "../src/services/update-presentation.ts";
import {
  DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY,
  RECOMMENDED_DESKTOP_VERSION,
  type DesktopUpgradeRecommendationContext,
} from "../src/services/desktop-upgrade-recommendation.ts";
import {
  DESKTOP_SELF_UPDATE_DISMISSED_VERSION_KEY,
  DesktopUpdateState,
  type DesktopUpdateBridge,
} from "../src/services/desktop-update.ts";
import { StandInDesktopUpdateBridge } from "./helpers/desktop-update-bridge.ts";

// Contract tests for the notice/bell presentation decision, consumer side of
// the update-state relay (specs/arch/updates/update-channel.md) — the
// connection RETAINS the relayed update state (^relay, as ServerConnection
// retains `channels`); owner events are notifications, and the element
// renders deterministically from the retained state, so it may mount at any
// time (the chrome mounts only once connected). Update state injected via a
// fake connection owner that maintains the same retention invariant — greenlit, the
// real crossing owned by ^t-relay-broadcast and the product acceptance
// criteria:
//   ^t-dismissal — dismissal writes the version to localStorage under
//     `tv-update-dismissed` and suppresses auto-presentation for
//     equal-or-older advertised versions; a strictly newer version
//     auto-presents again; presentation reads the owned connection's retained
//     update state rather than the status-event payload
//     (^updates-t-relay-retention). The Later path crosses the view callback
//     into the persisted dismissal decision; native close controls are proved
//     by the update-notification browser fixture.
//   ^t-bell — the bell is visible whenever the toast state applies,
//     including after dismissal, and gone when it does not. Presentation input
//     is proved in the real-browser surface contract; telemetry cases below
//     retain the page-load dedup outcomes around that callback.
//   ^t-toast-telemetry — producer side of the telemetry client signals (the
//     transport crossing owned by client-signals.md ^t-signal-forwarding):
//     `update_toast_shown` once per client per channel version per page
//     load; `update_prompt_copy_clicked` on each click; both carry only the
//     two version properties.

const PRIMARY = "http://primary.test";
const OTHER = "http://other.test";
const SERVER_VERSION = "1.0.0";

// The shared fake satisfies the controller's connection slice.
const _connectionCheck: UpdateNotificationConnection = new FakeUpdateConnection();
void _connectionCheck;

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  dump(): Record<string, string>;
}

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const backing = new Map(Object.entries(initial));
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
    dump: () => Object.fromEntries(backing),
  };
}

function toast(version: string, extra: Partial<UpdateToast> = {}): UpdateToast {
  return { version, markdown: `Release ${version} is out.`, ...extra };
}

interface Harness {
  owner: FakeUpdateConnectionOwner;
  connection: FakeUpdateConnection;
  storage: MemoryStorage;
  sendStatus(input: { toast?: UpdateToast | null; serverURL?: string; version?: string }): void;
}

function harness(
  options: { dismissed?: string; recommendationDismissed?: string; desktopSelfUpdateDismissed?: string } = {},
): Harness {
  const connection = new FakeUpdateConnection(PRIMARY);
  const owner = new FakeUpdateConnectionOwner(connection);
  const stored: Record<string, string> = {};
  if (options.dismissed !== undefined) stored[DISMISSED_VERSION_KEY] = options.dismissed;
  if (options.recommendationDismissed !== undefined) {
    stored[DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY] = options.recommendationDismissed;
  }
  if (options.desktopSelfUpdateDismissed !== undefined) {
    stored[DESKTOP_SELF_UPDATE_DISMISSED_VERSION_KEY] = options.desktopSelfUpdateDismissed;
  }
  const storage = memoryStorage(stored);
  return {
    owner,
    connection,
    storage,
    sendStatus({ toast: toastState = null, serverURL = PRIMARY, version = SERVER_VERSION }) {
      const message: ServerStatusMessage = {
        type: "server-status",
        version,
        requiredDesktopVersion: null,
        update: { toast: toastState, desktop: null },
      };
      dispatchServerStatus(owner, message, serverURL);
    },
  };
}

interface MountedUpdate {
  controller: UpdateNotificationController;
  el: HTMLElement;
  draw(): void;
}

interface MountedHarness extends Harness, MountedUpdate {}

const mountedUpdates: MountedUpdate[] = [];

function mountController(
  h: Harness,
  presentation?: UpdatePresentationState,
  desktopRecommendation?: DesktopUpgradeRecommendationContext,
  desktopUpdate?: DesktopUpdateState,
): MountedUpdate {
  const el = document.createElement("div");
  let controller!: UpdateNotificationController;
  const draw = (): void => {
    render(controller.template(), el);
  };
  controller = new UpdateNotificationController(draw);
  controller.configure({
    connectionOwner: h.owner,
    primaryServerURL: PRIMARY,
    dismissalStorage: h.storage,
    presentation,
    desktopRecommendation,
    desktopUpdate,
  });
  controller.connect();
  document.body.appendChild(el);
  draw();
  const mounted = { controller, el, draw };
  mountedUpdates.push(mounted);
  return mounted;
}

function mount(options: {
  dismissed?: string;
  recommendationDismissed?: string;
  desktopSelfUpdateDismissed?: string;
  presentation?: UpdatePresentationState;
  desktopRecommendation?: DesktopUpgradeRecommendationContext;
  desktopUpdate?: DesktopUpdateState;
} = {}): MountedHarness {
  const h = harness(options);
  return {
    ...h,
    ...mountController(h, options.presentation, options.desktopRecommendation, options.desktopUpdate),
  };
}

function unmount(mounted: MountedUpdate): void {
  mounted.controller.disconnect();
  render(null, mounted.el);
  mounted.el.remove();
}

function remount(mounted: MountedUpdate): void {
  document.body.appendChild(mounted.el);
  mounted.controller.connect();
  mounted.draw();
}

function notice(mounted: MountedUpdate): HTMLElement | null {
  return mounted.controller.presented
    ? document.querySelector<HTMLElement>("#update-popover")
    : null;
}

function bell(mounted: MountedUpdate): HTMLElement | null {
  return mounted.el.querySelector<HTMLElement>(".update-bell");
}

function laterButton(mounted: MountedUpdate): HTMLElement | null {
  return document.querySelector<HTMLElement>("#update-popover .update-later");
}

function copyButton(mounted: MountedUpdate): HTMLElement | null {
  return document.querySelector<HTMLElement>("#update-popover .copy-button");
}

function restartButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("#update-popover .update-restart");
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

async function click(target: HTMLElement | null): Promise<void> {
  await settle();
  expect(target).not.toBeNull();
  target!.click();
  await settle();
}

beforeEach(() => {
  resetUpdateToastSignalDedup();
});

afterEach(async () => {
  for (const mounted of mountedUpdates.splice(0)) unmount(mounted);
  document.body.replaceChildren();
  await settle();
});

describe("auto-presentation and dismissal (^t-dismissal)", () => {
  it("auto-presents the notice when nothing was ever dismissed", () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    expect(notice(h)).not.toBeNull();
  });

  it("dismissing writes the channel version under tv-update-dismissed and hides the notice", async () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    await click(laterButton(h));
    expect(h.storage.dump()).toEqual({ "tv-update-dismissed": "1.5.0" });
    expect(notice(h)).toBeNull();
  });

  it("does not auto-present an advertised version equal to the dismissed version", () => {
    const h = mount({ dismissed: "1.5.0" });
    h.sendStatus({ toast: toast("1.5.0") });
    expect(notice(h)).toBeNull();
    expect(bell(h)).not.toBeNull();
  });

  it("does not auto-present an advertised version older than the dismissed version", () => {
    const h = mount({ dismissed: "2.0.0" });
    h.sendStatus({ toast: toast("1.5.0") });
    expect(notice(h)).toBeNull();
  });

  it("auto-presents a strictly newer advertised version again, and dismissing it overwrites the key", async () => {
    const h = mount({ dismissed: "1.5.0" });
    h.sendStatus({ toast: toast("1.6.0") });
    expect(notice(h)).not.toBeNull();
    await click(laterButton(h));
    expect(h.storage.dump()).toEqual({ "tv-update-dismissed": "1.6.0" });
  });

  it.each(["garbage", "1.2", "", "1.5.0-beta"])(
    "fails open on a corrupted stored dismissal value (%j): the notice still auto-presents",
    (corrupted) => {
      // A non-release value under tv-update-dismissed must read as "nothing
      // dismissed" — a corrupted key must never suppress the notice forever.
      const h = mount({ dismissed: corrupted });
      h.sendStatus({ toast: toast("1.5.0") });
      expect(notice(h)).not.toBeNull();
    },
  );

  it("renders from the owned connection's retained state rather than the server-status event payload", () => {
    const h = mount();
    h.sendStatus({ toast: toast("9.9.9"), serverURL: OTHER });
    expect(notice(h)).toBeNull();
    expect(bell(h)).toBeNull();
    expect(h.connection.signals).toEqual([]);
  });

  it("shouldAutoPresent is the single dismissal comparison: newer-than-dismissed only", () => {
    expect(shouldAutoPresent("1.5.0", null)).toBe(true);
    expect(shouldAutoPresent("1.5.0", "1.5.0")).toBe(false);
    expect(shouldAutoPresent("1.5.0", "2.0.0")).toBe(false);
    expect(shouldAutoPresent("1.5.1", "1.5.0")).toBe(true);
    expect(shouldAutoPresent("1.10.0", "1.9.0")).toBe(true); // numeric, not lexicographic
  });
});

describe("the top-bar controller renders the connection's retained state", () => {
  it("a late-mounted controller renders state retained before the top bar exists", () => {
    const h = harness();
    h.sendStatus({ toast: toast("1.5.0") });
    const mounted = mountController(h);
    expect(notice(mounted)).not.toBeNull();
    expect(bell(mounted)).not.toBeNull();
    expect(h.connection.signals).toEqual([
      { event: "update_toast_shown", properties: { server_version: SERVER_VERSION, channel_version: "1.5.0" } },
    ]);
  });

  it("a disconnected controller stops rendering; reconnecting resumes from current state", () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    unmount(h);
    h.sendStatus({ toast: toast("1.6.0") });
    remount(h);
    expect(notice(h)!.textContent).toContain("Release 1.6.0");
  });

  it("rebuilds the open notice when a new version changes prompt presence under identical markdown", () => {
    const h = mount();
    h.sendStatus({ toast: { version: "1.5.0", markdown: "Same body.", prompt: "upgrade me" } });
    expect(copyButton(h)).not.toBeNull();
    h.sendStatus({ toast: { version: "1.6.0", markdown: "Same body." } });
    expect(copyButton(h)).toBeNull();
    h.sendStatus({ toast: { version: "1.7.0", markdown: "Same body.", prompt: "upgrade me" } });
    expect(copyButton(h)).not.toBeNull();
  });
});

describe("desktop recommendation presentation (^desktop-rec-t-presentation)", () => {
  const recommendation: DesktopUpgradeRecommendationContext = {
    electron: true,
    shellVersion: "1.3.2",
  };

  it("auto-presents from a null retained state with no prompt, sending no telemetry when shown", () => {
    const h = mount({ desktopRecommendation: recommendation });

    expect(notice(h)?.textContent).toContain("Recommended desktop upgrade available");
    expect(copyButton(h)).toBeNull();
    expect(h.connection.signals).toEqual([]);
  });

  it("dismisses under the recommendation key only, leaves the bell, and the bell re-presents", async () => {
    const h = mount({
      dismissed: "8.8.8",
      desktopRecommendation: recommendation,
    });

    await click(laterButton(h));
    expect(h.storage.dump()).toEqual({
      [DISMISSED_VERSION_KEY]: "8.8.8",
      [DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY]: RECOMMENDED_DESKTOP_VERSION,
    });
    expect(notice(h)).toBeNull();
    expect(bell(h)).not.toBeNull();

    await click(bell(h));
    expect(notice(h)?.textContent).toContain("Recommended desktop upgrade available");
    expect(h.connection.signals).toEqual([]);
  });

  it.each([
    ["equal", RECOMMENDED_DESKTOP_VERSION, false],
    ["newer", "1.4.1", false],
    ["older", "1.3.1", true],
    ["malformed", "not-a-version", true],
  ])("treats a %s stored recommendation version independently", (_name, stored, presents) => {
    const h = mount({
      recommendationDismissed: stored,
      desktopRecommendation: recommendation,
    });

    expect(notice(h) !== null).toBe(presents);
    expect(bell(h)).not.toBeNull();
  });

  it("keeps a dismissed server toast in precedence, then auto-presents only when retained state stops applying", async () => {
    const h = harness();
    h.sendStatus({ toast: toast("1.5.0", { prompt: "upgrade the server" }) });
    const mounted = mountController(h, undefined, recommendation);

    expect(notice(mounted)?.textContent).toContain("Release 1.5.0");
    expect(copyButton(mounted)).not.toBeNull();
    await click(laterButton(mounted));
    expect(notice(mounted)).toBeNull();
    expect(h.storage.dump()).toEqual({ [DISMISSED_VERSION_KEY]: "1.5.0" });

    await click(bell(mounted));
    expect(notice(mounted)?.textContent).toContain("Release 1.5.0");
    expect(notice(mounted)?.textContent).not.toContain("Recommended desktop upgrade available");
    await click(laterButton(mounted));
    expect(notice(mounted)).toBeNull();

    h.sendStatus({ toast: null });
    expect(notice(mounted)?.textContent).toContain("Recommended desktop upgrade available");
    expect(h.storage.dump()).toEqual({ [DISMISSED_VERSION_KEY]: "1.5.0" });
  });

  it("keeps a previously dismissed recommendation closed when retained server toast stops applying", () => {
    const h = harness({ recommendationDismissed: RECOMMENDED_DESKTOP_VERSION });
    h.sendStatus({ toast: toast("1.5.0") });
    const mounted = mountController(h, undefined, recommendation);

    expect(notice(mounted)?.textContent).toContain("Release 1.5.0");
    h.sendStatus({ toast: null });
    expect(notice(mounted)).toBeNull();
    expect(bell(mounted)).not.toBeNull();
    expect(h.storage.dump()).toEqual({
      [DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY]: RECOMMENDED_DESKTOP_VERSION,
    });
  });

  it("is absent when the gate-owned presentation switch is already suppressed", () => {
    const presentation = new UpdatePresentationState();
    presentation.suppressToasts();
    const h = mount({ presentation, desktopRecommendation: recommendation });

    expect(notice(h)).toBeNull();
    expect(bell(h)).toBeNull();
  });
});

describe("the bell (^t-bell)", () => {
  it("is visible while the toast state applies and stays after dismissal", async () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    expect(bell(h)).not.toBeNull();
    await click(laterButton(h));
    expect(bell(h)).not.toBeNull();
  });

  it("disappears together with the notice when the update state stops applying", () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    expect(bell(h)).not.toBeNull();
    h.sendStatus({ toast: null });
    expect(bell(h)).toBeNull();
    expect(notice(h)).toBeNull();
  });
});

describe("notice telemetry, producer side (^t-toast-telemetry)", () => {
  it("signals update_toast_shown once on auto-present, carrying exactly the two version properties", () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    expect(h.connection.signals).toEqual([
      { event: "update_toast_shown", properties: { server_version: SERVER_VERSION, channel_version: "1.5.0" } },
    ]);
  });

  it("does not re-emit for the same channel version within a page load — re-renders, bell re-shows, repeat statuses", async () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    h.sendStatus({ toast: toast("1.5.0") }); // relay re-broadcast, same state
    await click(laterButton(h));
    await click(bell(h)); // bell-triggered re-presentation
    expect(h.connection.signals.filter((s) => s.event === "update_toast_shown")).toHaveLength(1);
  });

  it("does not re-emit across a controller remount for the same version (the ledger is page-load state)", () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    unmount(h);
    remount(h);
    expect(h.connection.signals.filter((s) => s.event === "update_toast_shown")).toHaveLength(1);
  });

  it("emits again for a NEW channel version in the same page load", () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0") });
    h.sendStatus({ toast: toast("1.6.0") });
    expect(h.connection.signals.filter((s) => s.event === "update_toast_shown").map((s) => s.properties.channel_version))
      .toEqual(["1.5.0", "1.6.0"]);
  });

  it("emits update_toast_shown for a bell-first presentation (dismissed version, never auto-presented this load)", async () => {
    const h = mount({ dismissed: "1.5.0" });
    h.sendStatus({ toast: toast("1.5.0") });
    expect(h.connection.signals).toEqual([]);
    await click(bell(h));
    expect(h.connection.signals).toEqual([
      { event: "update_toast_shown", properties: { server_version: SERVER_VERSION, channel_version: "1.5.0" } },
    ]);
  });

  it("does not signal update_toast_shown for a toast that arrives while suppressed — it never becomes visible", () => {
    const presentation = new UpdatePresentationState();
    const h = mount({ presentation });
    presentation.suppressToasts();
    h.sendStatus({ toast: toast("1.5.0") });
    expect(h.connection.signals).toEqual([]);
  });

  it("signals update_prompt_copy_clicked on EACH copy click with exactly the two version properties", async () => {
    const h = mount();
    h.sendStatus({ toast: toast("1.5.0", { prompt: "upgrade me" }) });
    await click(copyButton(h));
    await click(copyButton(h));
    expect(h.connection.signals.filter((s) => s.event === "update_prompt_copy_clicked")).toEqual([
      { event: "update_prompt_copy_clicked", properties: { server_version: SERVER_VERSION, channel_version: "1.5.0" } },
      { event: "update_prompt_copy_clicked", properties: { server_version: SERVER_VERSION, channel_version: "1.5.0" } },
    ]);
  });

  it("defers signals until the primary connection reports connected (server-status precedes bootstrap)", () => {
    const h = mount();
    h.connection.status = "disconnected";
    h.sendStatus({ toast: toast("1.5.0") });
    expect(h.connection.signals).toEqual([]);
    h.connection.status = "connected";
    h.owner.dispatchEvent(new ChangeEvent("change"));
    expect(h.connection.signals).toEqual([
      { event: "update_toast_shown", properties: { server_version: SERVER_VERSION, channel_version: "1.5.0" } },
    ]);
  });
});

describe("notice content basics (breadth owned by ^t-toast-render in the browser spec)", () => {
  it("renders nothing at all once the shared presentation state suppresses (^gate-precedence contract)", () => {
    // The controller subscribes to the shared presentation state; flipping
    // its one-way switch is the only sanctioned suppression path.
    const presentation = new UpdatePresentationState();
    const h = mount({ presentation });
    h.sendStatus({ toast: toast("1.5.0") });
    expect(bell(h)).not.toBeNull();
    presentation.suppressToasts();
    expect(notice(h)).toBeNull();
    expect(bell(h)).toBeNull();
  });
});

// proofs/arch/updates/desktop-self-update-notice.md#^desktop-self-update-notice-t-presentation
describe("desktop self-update notice presentation (^desktop-self-update-notice-t-presentation)", () => {
  function desktopUpdate(
    options: { electron?: boolean; version?: string; bridge?: DesktopUpdateBridge | null } = {},
  ): { bridge: StandInDesktopUpdateBridge; state: DesktopUpdateState } {
    const bridge = new StandInDesktopUpdateBridge();
    if (options.version !== undefined) bridge.report(options.version);
    const state = new DesktopUpdateState({
      electron: options.electron ?? true,
      bridge: options.bridge === undefined ? bridge : options.bridge,
    });
    return { bridge, state };
  }

  const heading = "Desktop app update ready";

  it.each([
    ["a browser", { electron: false, version: "1.5.0" }],
    ["a bridge without the operation", { version: "1.5.0", bridge: {} }],
    ["a bridge that has reported nothing", {}],
  ] as const)("gives %s no desktop self-update notice and no bell", (_name, options) => {
    const { state } = desktopUpdate(options);
    const h = mount({ desktopUpdate: state });

    expect(notice(h)).toBeNull();
    expect(bell(h)).toBeNull();
  });

  it("gives a gated client no desktop self-update notice and no bell", () => {
    const presentation = new UpdatePresentationState();
    presentation.suppressToasts();
    const { state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({ presentation, desktopUpdate: state });

    expect(notice(h)).toBeNull();
    expect(bell(h)).toBeNull();
  });

  it("presents a version reported before mount with the bell, Later and the restart button, sending no telemetry", () => {
    const { state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({ desktopUpdate: state });

    expect(notice(h)?.querySelector("h3")?.textContent).toBe(heading);
    expect(notice(h)?.textContent).toContain("Version 1.5.0 has downloaded");
    expect(bell(h)).not.toBeNull();
    expect(copyButton(h)).toBeNull();
    expect(laterButton(h)).not.toBeNull();
    expect(restartButton()?.textContent?.trim()).toBe("Restart to update");
    expect(h.connection.signals).toEqual([]);
  });

  it("presents a version reported after the surface has mounted", () => {
    const { bridge, state } = desktopUpdate();
    const h = mount({ desktopUpdate: state });
    expect(bell(h)).toBeNull();

    bridge.report("1.6.0");

    expect(notice(h)?.textContent).toContain("Version 1.6.0 has downloaded");
    expect(bell(h)).not.toBeNull();
  });

  it("keeps an applying server notice first, dismissed or not, then presents once it stops applying", async () => {
    const h = harness();
    h.sendStatus({ toast: toast("1.5.0", { prompt: "upgrade the server" }) });
    const { state } = desktopUpdate({ version: "1.6.0" });
    const mounted = mountController(h, undefined, undefined, state);

    expect(notice(mounted)?.textContent).toContain("Release 1.5.0");
    expect(restartButton()).toBeNull();
    await click(laterButton(mounted));
    expect(notice(mounted)).toBeNull();
    expect(bell(mounted)).not.toBeNull();

    await click(bell(mounted));
    expect(notice(mounted)?.textContent).toContain("Release 1.5.0");
    expect(notice(mounted)?.textContent).not.toContain(heading);
    await click(laterButton(mounted));

    h.sendStatus({ toast: null });
    expect(notice(mounted)?.textContent).toContain(heading);
    expect(h.storage.dump()).toEqual({ [DISMISSED_VERSION_KEY]: "1.5.0" });
  });

  it("dismisses under its own key only; the bell remains and presents it again", async () => {
    const { state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({
      dismissed: "1.5.0",
      recommendationDismissed: RECOMMENDED_DESKTOP_VERSION,
      desktopUpdate: state,
    });
    expect(notice(h)?.textContent).toContain(heading);

    await click(laterButton(h));
    expect(h.storage.dump()).toEqual({
      [DISMISSED_VERSION_KEY]: "1.5.0",
      [DESKTOP_RECOMMENDATION_DISMISSED_VERSION_KEY]: RECOMMENDED_DESKTOP_VERSION,
      [DESKTOP_SELF_UPDATE_DISMISSED_VERSION_KEY]: "1.5.0",
    });
    expect(notice(h)).toBeNull();
    expect(bell(h)).not.toBeNull();

    await click(bell(h));
    expect(notice(h)?.textContent).toContain(heading);
    expect(h.connection.signals).toEqual([]);
  });

  it.each([
    ["equal", "1.5.0", false],
    ["higher", "9.9.9", true],
    ["lower", "1.4.1", true],
    ["simulated", "1.5.0-simulated", true],
  ])("compares a %s stored version for equality", (_name, stored, presents) => {
    const { state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({ desktopSelfUpdateDismissed: stored, desktopUpdate: state });

    expect(notice(h) !== null).toBe(presents);
    expect(bell(h)).not.toBeNull();
  });

  it("presents a different version reported after the dismissed one", () => {
    const { bridge, state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({ desktopSelfUpdateDismissed: "1.5.0", desktopUpdate: state });
    expect(notice(h)).toBeNull();

    bridge.report("1.6.0");

    expect(notice(h)?.textContent).toContain("Version 1.6.0 has downloaded");
  });

  it("leaves the server notice and the recommendation unaffected by its key", () => {
    const serverFirst = mount({ desktopSelfUpdateDismissed: "1.5.0" });
    serverFirst.sendStatus({ toast: toast("1.5.0") });
    expect(notice(serverFirst)?.textContent).toContain("Release 1.5.0");
    unmount(serverFirst);

    const recommended = mount({
      desktopSelfUpdateDismissed: RECOMMENDED_DESKTOP_VERSION,
      desktopRecommendation: { electron: true, shellVersion: "1.3.2" },
    });
    expect(notice(recommended)?.textContent).toContain("Recommended desktop upgrade available");
  });

  it("comes before a recommendation that would also apply", () => {
    const { state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({
      desktopRecommendation: { electron: true, shellVersion: "1.3.2" },
      desktopUpdate: state,
    });

    expect(notice(h)?.textContent).toContain(heading);
    expect(notice(h)?.textContent).not.toContain("Recommended desktop upgrade available");
  });

  it("restarts exactly once from the button and stays open, restarting", async () => {
    const { bridge, state } = desktopUpdate({ version: "1.5.0" });
    const h = mount({ desktopUpdate: state });

    await click(restartButton());
    restartButton()?.click();
    await settle();

    expect(bridge.restarts).toBe(1);
    expect(notice(h)).not.toBeNull();
    expect(restartButton()?.disabled).toBe(true);
    expect(restartButton()?.textContent?.trim()).toBe("Restarting…");
    expect(h.storage.dump()).toEqual({});
    expect(h.connection.signals).toEqual([]);
  });
});
