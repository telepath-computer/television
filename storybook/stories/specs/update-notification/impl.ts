// Mounts product code in the preview document, so this staging carries what
// that code needs in whatever realm it runs in: the production foundation and
// global sheets, and the explicit-resource-management polyfill its imports use.
// The preview itself imports no product packages.
import "@telepath-computer/utils/disposable-polyfill";
import "../../../../packages/web/src/foundation/index.css";
import "../../../../packages/web/src/global.css";
import { EventTarget } from "@rupertsworld/event-target";
import type { ChangeEvent, ServerStatusMessage, UpdateState, UpdateToast } from "@telepath-computer/television-shared";
import { html, render } from "lit-html";
import { ServerStatusEvent } from "../../../../packages/web/src/events.ts";
import { DesktopUpdateState } from "../../../../packages/web/src/services/desktop-update.ts";
import {
  UpdateNotificationController,
  type DismissalStorage,
} from "../../../../packages/web/src/views/update-notification.ts";
import { DOWNLOADED_VERSION } from "./samples.ts";

const PRIMARY = "http://primary.test";

// The implementation: the real shipped update notification, mounted via a
// fake connection owner and driven by a server-status event. Without
// markdown the server relays no notice; with `desktopUpdate`, a desktop
// update state on a stand-in bridge reports a downloaded version at once and
// ignores the restart request.
export function impl({
  markdown,
  prompt,
  dismissed = false,
  copied = false,
  desktopUpdate,
}: {
  markdown?: string;
  prompt?: string;
  dismissed?: boolean;
  copied?: boolean;
  desktopUpdate?: "ready" | "restarting";
}): HTMLElement {
  const connection = {
    url: PRIMARY,
    status: "connected",
    serverVersion: null as string | null,
    updateState: null as UpdateState | null,
    sendTelemetrySignal(): void {},
  };
  const owner = new (class extends EventTarget<ServerStatusEvent | ChangeEvent> {
    readonly connection = connection;
  })();
  const store = new Map<string, string>();
  const el = document.createElement("div");
  const surface = document.createElement("div");
  const dismissalStorage: DismissalStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };
  let controller!: UpdateNotificationController;
  const draw = (): void => {
    render(html`<div class="top-bar-controls">${controller.template()}</div>`, surface);
  };
  controller = new UpdateNotificationController(draw);
  controller.configure({
    connectionOwner: owner,
    primaryServerURL: PRIMARY,
    dismissalStorage,
    desktopUpdate: desktopUpdate === undefined ? null : downloadedUpdate(desktopUpdate),
  });
  controller.connect();
  draw();

  const toast: UpdateToast | null =
    markdown === undefined ? null : { version: "0.2.0", markdown, ...(prompt === undefined ? {} : { prompt }) };
  const message: ServerStatusMessage = {
    type: "server-status",
    version: "0.1.0",
    requiredDesktopVersion: null,
    update: toast === null ? null : { toast, desktop: null },
  };
  // Bounded mount wait: an abandoned render (story switched away before the
  // element ever connected) must not spin rAF forever.
  let mountWaitFrames = 300;
  const drive = (): void => {
    if (!el.isConnected) {
      if (mountWaitFrames-- > 0) requestAnimationFrame(drive);
      return;
    }
    // The retention invariant the real ServerConnection maintains.
    connection.serverVersion = message.version;
    connection.updateState = message.update ?? null;
    owner.dispatchEvent(new ServerStatusEvent("server-status", { serverURL: PRIMARY, message }));
    draw();
    queueMicrotask(() => {
      if (dismissed) el.querySelector<HTMLButtonElement>(".update-later")?.click();
      if (copied) el.querySelector<HTMLButtonElement>(".update-copy")?.click();
    });
  };
  queueMicrotask(drive);
  el.append(surface);
  return el;
}

function downloadedUpdate(restart: "ready" | "restarting"): DesktopUpdateState {
  const state = new DesktopUpdateState({
    electron: true,
    bridge: {
      onDesktopUpdateDownloaded: (callback) => callback(DOWNLOADED_VERSION),
      restartToInstallUpdate: () => {},
    },
  });
  state.subscribe();
  if (restart === "restarting") state.restart();
  return state;
}
