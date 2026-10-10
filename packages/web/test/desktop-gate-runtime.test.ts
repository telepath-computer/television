// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit-html";
import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent, type ServerStatusMessage, type UpdateState } from "@telepath-computer/television-shared";
import { ServerStatusEvent } from "../src/events.ts";
import { ServerConnection } from "../src/services/server-connection.ts";
import { createUpdateReloadAgent, RELOAD_MARKER_KEY } from "../src/services/update-reload.ts";
import { createDesktopGateController } from "../src/services/desktop-gate-runtime.ts";
import { createNavigationLatch } from "../src/services/navigation-latch.ts";
import { resetUpdateToastSignalDedup, UpdateNotificationController } from "../src/views/update-notification.ts";
import { dispatchServerStatus } from "./helpers/update-status.ts";
import { UpdatePresentationState } from "../src/services/update-presentation.ts";
import { installNativeDialogMock } from "./helpers/dialog.ts";

// Contract tests for the boot-barrier runtime
// (specs/arch/updates/desktop-upgrade-gate.md), inputs injected — greenlit;
// the real websocket/browser crossings are owned by ^t-gate-boot-barrier
// (test/e2e/gate-boot-barrier.spec.ts) and the
// ^ac-gate-* product criteria (packages/desktop/test/e2e/upgrade-gate.spec.ts):
//   phase split (^boot-barrier) — with a decideBoot hook the store bootstrap
//     waits for the connection's FIRST server-status and runs only on
//     "boot"; "halt" leaves the socket open with no channels/display fetch;
//     without the hook the bootstrap runs on socket open exactly as before.
//   ^t-gate-guard-exhausted — with the loop-guard marker matching a
//     still-mismatched server version AND the gate condition holding, boot
//     halts at the gate with the current bundle; with the mismatch but no
//     gate condition, the existing silent behavior stands.
//   ^t-gate-telemetry — desktop_upgrade_gate_shown once per client per
//     required desktop version per page load, carrying only the version
//     properties (desktop_app_version omitted when unknown); producer side,
//     the transport crossing owned by client-signals.md ^t-signal-forwarding.
//   ^gate-reevaluation — a halted client that receives a server-status no
//     longer satisfying the condition reloads into a normal boot rather
//     than un-halting incrementally.

const PRIMARY = "http://primary.test";

function status(overrides: Partial<ServerStatusMessage> = {}): ServerStatusMessage {
  return {
    type: "server-status",
    version: "1.0.0",
    requiredDesktopVersion: null,
    update: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The ServerConnection connect/bootstrap phase split.

class FakeSocket {
  readyState = 0;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  sent: string[] = [];
  closed = false;
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  emitMessage(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }
}

function fakeClient() {
  return {
    channels: { list: vi.fn(async () => ({ channels: [] })) },
    display: { get: vi.fn(async () => ({
      focusedChannelId: null,
      pinnedChannelIds: [],
      activeThemeName: null,
      acpEnabled: false,
    })) },
  } as any;
}

function splitHarness(
  decideBoot: ((message: ServerStatusMessage) => "boot" | "halt") | undefined,
  navigationPending?: () => boolean,
) {
  const sockets: FakeSocket[] = [];
  const client = fakeClient();
  const connection = new ServerConnection({
    url: PRIMARY,
    name: "test",
    token: null,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    createClient: () => client,
    visibilityEventTarget: null,
    networkEventTarget: null,
    telemetryMeta: { clientId: "client-1", clientApp: "desktop", desktopAppVersion: "1.0.0", userAgent: "test" },
    ...(decideBoot ? { decideBoot } : {}),
    ...(navigationPending ? { navigationPending } : {}),
  });
  return { connection, sockets, client };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ServerConnection boot phase split (^boot-barrier)", () => {
  it("without a hook, bootstraps on socket open exactly as before", async () => {
    const { connection, sockets, client } = splitHarness(undefined);
    const connected = connection.connect(null);
    sockets[0]!.emit("open");
    await connected;
    expect(client.channels.list).toHaveBeenCalledTimes(1);
    expect(connection.bootState).toBe("booted");
    connection.dispose();
  });

  it("with a hook, socket open does NOT bootstrap; the first server-status decides 'boot'", async () => {
    const decideBoot = vi.fn(() => "boot" as const);
    const { connection, sockets, client } = splitHarness(decideBoot);
    const connected = connection.connect(null);
    sockets[0]!.emit("open");
    await flush();
    expect(client.channels.list).not.toHaveBeenCalled();
    expect(connection.bootState).toBe("pending");

    sockets[0]!.emitMessage(status({ version: "1.0.0" }));
    await connected;
    expect(decideBoot).toHaveBeenCalledTimes(1);
    expect(client.channels.list).toHaveBeenCalledTimes(1);
    expect(connection.bootState).toBe("booted");
    expect(connection.status).toBe("connected");
    connection.dispose();
  });

  it("'halt' leaves the socket open, publishes the application-state change, and performs no store fetch", async () => {
    const { connection, sockets, client } = splitHarness(() => "halt");
    const changes = vi.fn();
    connection.addEventListener("change", changes);
    void connection.connect(null).catch(() => {});
    sockets[0]!.emit("open");
    const changesBeforeStatus = changes.mock.calls.length;
    sockets[0]!.emitMessage(status({ requiredDesktopVersion: "2.0.0" }));
    await flush();
    expect(changes).toHaveBeenCalledTimes(changesBeforeStatus + 1);
    expect(client.channels.list).not.toHaveBeenCalled();
    expect(client.display.get).not.toHaveBeenCalled();
    expect(connection.bootState).toBe("halted");
    expect(connection.status).not.toBe("connected");
    expect(sockets[0]!.closed).toBe(false); // the halted client keeps its /events connection
    connection.dispose();
  });

  it("starts the bootstrap only AFTER the server-status dispatch — the reload agent evaluates first (^reload-gate-precedence)", async () => {
    const order: string[] = [];
    const { connection, sockets, client } = splitHarness(() => "boot");
    client.channels.list.mockImplementation(async () => {
      order.push("bootstrap");
      return { channels: [] };
    });
    connection.addEventListener("server-status", () => order.push("event"));
    const connected = connection.connect(null);
    sockets[0]!.emit("open");
    sockets[0]!.emitMessage(status());
    await connected;
    expect(order).toEqual(["event", "bootstrap"]);
    connection.dispose();
  });

  it("settles bootState to 'halted' before the server-status dispatch, so the gate telemetry can ride the halted connection", async () => {
    let bootStateDuringDispatch: string | null = null;
    const { connection, sockets } = splitHarness(() => "halt");
    connection.addEventListener("server-status", () => {
      bootStateDuringDispatch = connection.bootState;
    });
    void connection.connect(null).catch(() => {});
    sockets[0]!.emit("open");
    sockets[0]!.emitMessage(status({ requiredDesktopVersion: "2.0.0" }));
    await flush();
    expect(bootStateDuringDispatch).toBe("halted");
    connection.dispose();
  });

  it("later halted statuses publish retained inputs without re-deciding the attempt", async () => {
    const decideBoot = vi.fn(() => "halt" as const);
    const { connection, sockets } = splitHarness(decideBoot);
    const changes = vi.fn();
    connection.addEventListener("change", changes);
    void connection.connect(null).catch(() => {});
    sockets[0]!.emit("open");
    const changesBeforeStatus = changes.mock.calls.length;
    sockets[0]!.emitMessage(status({ update: { toast: null, desktop: { upgradeMarkdown: "First" } } }));
    sockets[0]!.emitMessage(status({ update: { toast: null, desktop: { upgradeMarkdown: "Second" } } }));
    await flush();
    expect(decideBoot).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(changesBeforeStatus + 2);
    expect(connection.updateState?.desktop?.upgradeMarkdown).toBe("Second");
    connection.dispose();
  });

  it("sendTelemetrySignal works from the halted state over the open socket (^gate-telemetry ordering)", async () => {
    const { connection, sockets } = splitHarness(() => "halt");
    void connection.connect(null).catch(() => {});
    sockets[0]!.emit("open");
    sockets[0]!.emitMessage(status({ requiredDesktopVersion: "2.0.0" }));
    await flush();
    connection.sendTelemetrySignal("desktop_upgrade_gate_shown", { required_desktop_version: "2.0.0" });
    const signals = sockets[0]!.sent.map((raw) => JSON.parse(raw) as { type: string; event?: string });
    expect(signals.filter((s) => s.type === "telemetry-signal").map((s) => s.event)).toEqual([
      "desktop_upgrade_gate_shown",
    ]);
    connection.dispose();
  });
});

// ---------------------------------------------------------------------------
// The gate controller.

interface RecordedSignal {
  event: string;
  properties: Record<string, string>;
}

class FakeConnection {
  status = "disconnected";
  serverVersion: string | null = null;
  updateState: UpdateState | null = null;
  signals: RecordedSignal[] = [];
  sendTelemetrySignal(event: string, properties: Record<string, string>): void {
    this.signals.push({ event, properties });
  }
}

class FakeOwner<T> extends EventTarget<ServerStatusEvent | ChangeEvent> {
  readonly connection: T;

  constructor(connection: T) {
    super();
    this.connection = connection;
  }
}

function controllerHarness(options: { shellVersion?: string | null; electron?: boolean } = {}) {
  const connection = new FakeConnection();
  const owner = new FakeOwner(connection);
  const reload = vi.fn();
  const presentation = new UpdatePresentationState();
  const controller = createDesktopGateController({
    detection: { electron: options.electron ?? true, shellVersion: options.shellVersion === undefined ? "1.0.0" : options.shellVersion },
    reload,
    presentation,
  });
  controller.attach(owner);
  const send = (message: ServerStatusMessage) => dispatchServerStatus(owner, message);
  return { controller, owner, connection, reload, send, presentation };
}

let restoreDialog: () => void;

beforeAll(() => {
  restoreDialog = installNativeDialogMock();
});

beforeEach(() => {
  document.body.innerHTML = "";
  resetUpdateToastSignalDedup();
});

afterAll(() => restoreDialog());

describe("gate controller: halt and re-evaluation (^boot-barrier, ^gate-reevaluation)", () => {
  it("decideBoot returns 'halt' under the gate condition and 'boot' otherwise", () => {
    const { controller } = controllerHarness({ shellVersion: "1.0.0" });
    expect(controller.decideBoot(status({ requiredDesktopVersion: "2.0.0" }))).toBe("halt");
    expect(controller.decideBoot(status({ requiredDesktopVersion: "1.0.0" }))).toBe("boot");
    expect(controller.decideBoot(status({ requiredDesktopVersion: null }))).toBe("boot");
  });

  it("outside Electron context it never halts", () => {
    const { controller } = controllerHarness({ electron: false, shellVersion: null });
    expect(controller.decideBoot(status({ requiredDesktopVersion: "2.0.0" }))).toBe("boot");
  });

  it("a gating server-status records the halt without mounting a competing surface", () => {
    const { send, controller, connection } = controllerHarness();
    const update: UpdateState = { toast: null, desktop: { upgradeMarkdown: "Channel gate body." } };
    send(status({ requiredDesktopVersion: "2.0.0", update }));
    expect(controller.gated).toBe(true);
    expect(connection.updateState).toEqual(update);
    expect(document.querySelector(".desktop-upgrade-gate")).toBeNull();
  });

  it("a later status no longer satisfying the condition reloads into a normal boot instead of un-halting", () => {
    const { send, reload, controller } = controllerHarness();
    send(status({ requiredDesktopVersion: "2.0.0" }));
    expect(controller.gated).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    send(status({ requiredDesktopVersion: null }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a not-gated client that was never halted does not reload on requirement-free statuses", () => {
    const { send, reload } = controllerHarness({ shellVersion: "2.0.0" });
    send(status({ requiredDesktopVersion: "2.0.0" }));
    send(status({ requiredDesktopVersion: null }));
    expect(reload).not.toHaveBeenCalled();
  });

  it("while gated, notice and bell stay down for a toast-eligible update state (gate supersedes)", () => {
    // The owned suppression contract (^gate-precedence), driven by the
    // controller: it flips the SHARED presentation state's switch, and the
    // subscribed notification goes down — the gate controller never reaches
    // into notification state. The ^t-gate-precedence decision contract lives
    // in desktop-gate.test.ts; this proves the runtime wiring.
    const { owner, send, presentation } = controllerHarness();
    const notificationMount = document.createElement("div");
    let notification!: UpdateNotificationController;
    const draw = (): void => {
      render(notification.template(), notificationMount);
    };
    notification = new UpdateNotificationController(draw);
    notification.configure({
      connectionOwner: owner,
      dismissalStorage: null,
      presentation,
    });
    notification.connect();
    document.body.appendChild(notificationMount);
    draw();

    const update: UpdateState = {
      toast: { version: "9.9.9", markdown: "New release!" },
      desktop: null,
    };
    send(status({ requiredDesktopVersion: "2.0.0", update }));
    expect(notificationMount.querySelector("[popover]")).toBeNull();
    expect(notificationMount.querySelector(".update-bell")).toBeNull();
  });
});

describe("guard exhaustion halts at the gate (^t-gate-guard-exhausted)", () => {
  function guardHarness(input: { requiredDesktopVersion: string | null }) {
    const harness = controllerHarness({ shellVersion: "1.0.0" });
    const reloadAgentReload = vi.fn();
    const storage = new Map<string, string>([
      // The one permitted reload already happened for this server version.
      [RELOAD_MARKER_KEY, JSON.stringify({ serverVersion: "9.9.9", fromVersion: "1.0.0" })],
    ]);
    createUpdateReloadAgent({
      owner: harness.owner,
      bundleVersion: "1.0.0",
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
        removeItem: (key) => void storage.delete(key),
      },
      reload: reloadAgentReload,
    });
    const message = status({
      version: "9.9.9", // still mismatched vs bundle 1.0.0 after the one attempt
      requiredDesktopVersion: input.requiredDesktopVersion,
    });
    return { ...harness, reloadAgentReload, message };
  }

  it("marker matches + mismatch persists + gate condition → no reload, halt at the gate with the current bundle", () => {
    const h = guardHarness({ requiredDesktopVersion: "2.0.0" });
    expect(h.controller.decideBoot(h.message)).toBe("halt");
    h.send(h.message);
    expect(h.reloadAgentReload).not.toHaveBeenCalled(); // the guard holds
    expect(h.controller.gated).toBe(true); // the gate still evaluates, stale bundle and all
  });

  it("marker matches + mismatch persists + NO gate condition → the existing silent behavior stands", () => {
    const h = guardHarness({ requiredDesktopVersion: null });
    expect(h.controller.decideBoot(h.message)).toBe("boot");
    h.send(h.message);
    expect(h.reloadAgentReload).not.toHaveBeenCalled();
    expect(h.controller.gated).toBe(false);
  });
});

describe("navigation-pending latch: the dying page goes inert (^gate-reevaluation, ^reload-gate-precedence)", () => {
  // Full real composition — real ServerConnection (fake socket/client), real
  // reload agent, real gate controller, one SHARED latch — wired exactly as
  // main.ts wires them, reload agent attached first. location.reload() does
  // not preempt the current task, so everything after a reload request must
  // be provably inert.
  function composedHarness(input: { marker?: { serverVersion: string; fromVersion: string } } = {}) {
    const latch = createNavigationLatch();
    const gateReload = vi.fn();
    const agentReload = vi.fn();
    const controller = createDesktopGateController({
      detection: { electron: true, shellVersion: "1.0.0" },
      reload: gateReload,
      navigationLatch: latch,
    });
    const { connection, sockets, client } = splitHarness(
      (message) => controller.decideBoot(message),
      () => latch.pending,
    );
    const owner = new FakeOwner(connection);
    connection.addEventListener("server-status", (event) =>
      owner.dispatchEvent(
        new ServerStatusEvent("server-status", { message: event.message }),
      ),
    );
    const telemetrySignal = vi.spyOn(connection, "sendTelemetrySignal");
    const storage = new Map<string, string>(
      input.marker ? [[RELOAD_MARKER_KEY, JSON.stringify(input.marker)]] : [],
    );
    createUpdateReloadAgent({
      owner,
      bundleVersion: "1.0.0",
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
        removeItem: (key) => void storage.delete(key),
      },
      reload: agentReload,
      navigationLatch: latch,
    });
    controller.attach(owner); // after the reload agent, as in main.ts
    return { latch, owner, controller, connection, sockets, client, gateReload, agentReload, telemetrySignal };
  }

  it("halted-reconnect retraction reloads WITHOUT bootstrapping — the halted page never begins a functional boot", async () => {
    const h = composedHarness();
    // Attempt 1: gated → halted.
    void h.connection.connect(null).catch(() => {});
    h.sockets[0]!.emit("open");
    h.sockets[0]!.emitMessage(status({ version: "1.0.0", requiredDesktopVersion: "2.0.0" }));
    await flush();
    expect(h.connection.bootState).toBe("halted");
    expect(h.controller.gated).toBe(true);

    // Attempt 2 (the reconnect): the requirement is gone — the gate exit is a
    // reload into a normal boot; the OLD page must not bootstrap meanwhile.
    void h.connection.connect(null).catch(() => {});
    h.sockets[1]!.emit("open");
    h.sockets[1]!.emitMessage(status({ version: "1.0.0", requiredDesktopVersion: null }));
    await flush();

    expect(h.gateReload).toHaveBeenCalledTimes(1);
    expect(h.client.channels.list).not.toHaveBeenCalled(); // zero bootstrap requests, ever
    expect(h.client.display.get).not.toHaveBeenCalled();
  });

  it("a reload-agent navigation suppresses the gate entirely: no published halt, telemetry, or bootstrap", async () => {
    const h = composedHarness(); // guard NOT exhausted: no marker
    const changes = vi.fn();
    h.connection.addEventListener("change", changes);
    void h.connection.connect(null).catch(() => {});
    h.sockets[0]!.emit("open");
    const changesBeforeStatus = changes.mock.calls.length;
    // Mismatched server version AND a gate condition on the same status: the
    // reload agent navigates; everything after it must be inert.
    h.sockets[0]!.emitMessage(status({ version: "9.9.9", requiredDesktopVersion: "2.0.0" }));
    await flush();

    expect(h.agentReload).toHaveBeenCalledTimes(1); // the reload won
    expect(h.controller.gated).toBe(false);
    expect(changes).toHaveBeenCalledTimes(changesBeforeStatus); // no state publication in the dying page
    expect(h.telemetrySignal).not.toHaveBeenCalled(); // no gate telemetry
    expect(h.client.channels.list).not.toHaveBeenCalled(); // no bootstrap
    expect(h.gateReload).not.toHaveBeenCalled();
  });

  it("the latch runs its navigation exactly once, and later reload requests are no-ops", () => {
    const latch = createNavigationLatch();
    const first = vi.fn();
    const second = vi.fn();
    expect(latch.pending).toBe(false);
    latch.begin(first);
    latch.begin(second);
    expect(latch.pending).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("the reload agent itself goes inert once navigation is pending: no marker writes, no reloads", () => {
    const latch = createNavigationLatch();
    const owner = new FakeOwner(new FakeConnection());
    const reload = vi.fn();
    const storage = new Map<string, string>();
    createUpdateReloadAgent({
      owner,
      bundleVersion: "1.0.0",
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
        removeItem: (key) => void storage.delete(key),
      },
      reload,
      navigationLatch: latch,
    });
    latch.begin(() => {}); // some other site began a navigation (e.g. the gate exit)
    owner.dispatchEvent(
      new ServerStatusEvent("server-status", { message: status({ version: "9.9.9" }) }),
    );
    expect(reload).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });
});

describe("gate telemetry, producer side (^t-gate-telemetry)", () => {
  it("signals desktop_upgrade_gate_shown once per required version per page load, with only the version properties", () => {
    const { send, connection } = controllerHarness({ shellVersion: "1.0.0" });
    send(status({ requiredDesktopVersion: "2.0.0" }));
    send(status({ requiredDesktopVersion: "2.0.0" })); // re-broadcast, same requirement
    expect(connection.signals).toEqual([
      {
        event: "desktop_upgrade_gate_shown",
        properties: { desktop_app_version: "1.0.0", required_desktop_version: "2.0.0" },
      },
    ]);
  });

  it("emits again for a DIFFERENT required version in the same page load", () => {
    const { send, connection } = controllerHarness({ shellVersion: "1.0.0" });
    send(status({ requiredDesktopVersion: "2.0.0" }));
    send(status({ requiredDesktopVersion: "3.0.0" }));
    expect(connection.signals.map((s) => s.properties.required_desktop_version)).toEqual(["2.0.0", "3.0.0"]);
  });

  it("omits desktop_app_version when the shell version is unknown (omission-allowed validation)", () => {
    const { send, connection } = controllerHarness({ shellVersion: null });
    send(status({ requiredDesktopVersion: "2.0.0" }));
    expect(connection.signals).toEqual([
      { event: "desktop_upgrade_gate_shown", properties: { required_desktop_version: "2.0.0" } },
    ]);
  });
});
