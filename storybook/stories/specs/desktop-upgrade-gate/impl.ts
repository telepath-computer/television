// Mounts product code in the preview document, so this staging carries what
// that code needs in whatever realm it runs in: the production foundation and
// global sheets, and the explicit-resource-management polyfill its imports use.
// The preview itself imports no product packages.
import "@telepath-computer/utils/disposable-polyfill";
import "../../../../packages/web/src/foundation/index.css";
import "../../../../packages/web/src/global.css";
import { html, type TemplateResult } from "lit-html";
import { DesktopUpdateState } from "../../../../packages/web/src/services/desktop-update.ts";
import { DesktopUpgradeGateView } from "../../../../packages/web/src/views/desktop-upgrade-gate.ts";
import { DOWNLOADED_VERSION } from "./samples.ts";

// The implementation: the real shipped gate surface, driven by its
// instructions argument (null renders the built-in fallback) and, for the
// downloaded-update message, a desktop update state on a stand-in bridge that
// reports a version at once and ignores the restart request.
export function impl({
  upgradeMarkdown,
  restart,
}: { upgradeMarkdown?: string; restart?: "ready" | "restarting" } = {}): TemplateResult {
  const instructions = upgradeMarkdown === undefined ? null : { upgradeMarkdown };
  return html`${DesktopUpgradeGateView(instructions, restart === undefined ? undefined : downloadedUpdate(restart))}`;
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
