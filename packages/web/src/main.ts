import "@telepath-computer/utils/disposable-polyfill";
import { dependencies } from "@rupertsworld/dependencies";
import { ApplicationService } from "./services/application-service.ts";
import { handleApplicationNavigationKey } from "./services/application-navigation.ts";
import { ServerConnectionOwner } from "./services/server-connection-owner.ts";
import { pruneStaleNavigationHistory } from "./services/artifact-navigation-state.ts";
import { ChannelSidebarCollapsedPreference } from "./services/channel-sidebar-collapsed.ts";
import { ChannelSidebarWidthPreference } from "./services/channel-sidebar-width.ts";
import { LocalStore, createDefaultLocalState, normalizeServerURL } from "./store.ts";
import { createUpdateReloadAgent } from "./services/update-reload.ts";
import { detectElectronContext } from "./services/desktop-gate.ts";
import { createDesktopGateController } from "./services/desktop-gate-runtime.ts";
import { createNavigationLatch } from "./services/navigation-latch.ts";
import { UpdatePresentationState } from "./services/update-presentation.ts";
import { DesktopUpdateState, type DesktopUpdateBridge } from "./services/desktop-update.ts";
import { getBrowserLocalStorage } from "./services/acp-session-store.ts";
import { buildClientTelemetryMeta } from "./services/telemetry-client.ts";
import { isElectronMode, resolveAuthToken, resolveDesktopAppVersion, resolveServerURL } from "./config.ts";
import type {
  AppearanceChangedEvent,
  ThemeChangedEvent,
} from "@telepath-computer/television-shared";
import { TelevisionAppView } from "./views/television-app.ts";
import { render } from "lit-html";
import { resolveBundleVersion } from "./version.ts";
import {
  applyConfirmedAppearance,
  getAppearanceResolver,
  resolveAppearanceInput,
} from "./appearance.ts";
import {
  clearThemeFrames,
  clearThemeLink,
  clearThemeScript,
  getThemeScript,
  refreshThemeFrames,
  refreshThemeLink,
  refreshThemeScript,
} from "./theme.ts";
import "./foundation/index.css";
import "./foundation/app.css";
import "./global.css";

// The bundle's version stamp, surfaced as console-visible diagnostics
// (specs/arch/updates/version-advertisement.md ^version-probe): a read-only
// window.__tvVersion global plus the document-root data attribute. Not an
// API — nothing in the product may read these.
document.documentElement.dataset.tvBundleVersion = resolveBundleVersion();
Object.defineProperty(window, "__tvVersion", { value: resolveBundleVersion(), writable: false, configurable: false });
// The built classic bootstrap installs this before styles. Development and
// source-driven test pages adopt the same controller here as a fallback.
getAppearanceResolver();

const reopenSettingsAfterThemeReset = consumeSettingsReopenMarker();

const electronMode = isElectronMode();
if (electronMode) {
  document.documentElement.dataset.platform = "electron";
} else {
  delete document.documentElement.dataset.platform;
}
const runtimeServerURL = resolveServerURL();
const launchToken = resolveAuthToken();
const localStore = new LocalStore(
  electronMode ? "television-electron" : "television-browser",
  createDefaultLocalState(),
);
const sidebarWidthPreference = new ChannelSidebarWidthPreference(
  window.localStorage,
);
const sidebarCollapsedPreference = new ChannelSidebarCollapsedPreference(
  window.localStorage,
);
const telemetryStorage = getBrowserLocalStorage();
const telemetryMeta = telemetryStorage
  ? buildClientTelemetryMeta({
      storage: telemetryStorage,
      clientApp: electronMode ? "desktop" : "browser",
      desktopAppVersion: electronMode ? resolveDesktopAppVersion() : null,
    })
  : null;
// The bundle-serving origin's connection URL: the page origin, or in Electron
// mode the connected server URL the page was loaded from. Both the reload
// contract (^reload-origin-rule) and the desktop gate key on it exclusively.
const primaryServerURL = electronMode
  ? normalizeServerURL(runtimeServerURL)
  : normalizeServerURL(window.location.origin);

// The desktop upgrade gate's boot barrier
// (specs/arch/updates/desktop-upgrade-gate.md ^boot-barrier). Electron
// context is the ?mode=electron parameter alone (^electron-context — every
// published shell has always sent it); the detection also parses the shell
// version from ?desktopAppVersion=, absent on most of the installed base.
const gateDetection = detectElectronContext({
  search: window.location.search,
});

// One latch per page (navigation-latch.ts): both sanctioned reload sites
// navigate through it, and the connection consults it, so a dying page
// neither bootstraps nor gates.
const navigationLatch = createNavigationLatch();

// The owned toast-suppression contract (desktop-upgrade-gate.md
// ^gate-precedence): one shared presentation state per page — the gate flips
// its suppress switch, the toast subscribes.
const updatePresentation = new UpdatePresentationState();

const gateController = createDesktopGateController({
  detection: gateDetection,
  primaryServerURL,
  navigationLatch,
  presentation: updatePresentation,
});

const connectionOwner = new ServerConnectionOwner({
  localStore,
  serverURL: runtimeServerURL,
  launchToken,
  telemetryMeta,
  navigationPending: () => navigationLatch.pending,
  ...(gateDetection.electron
    ? { decideBoot: (message) => gateController.decideBoot(message) }
    : {}),
});
type ApplicationNavigationKey = Parameters<
  ApplicationService["handleNavigationKey"]
>[0];
const navigationKeyHandler = (key: ApplicationNavigationKey): void => {
  handleApplicationNavigationKey(applicationService, key);
};
const applicationService = new ApplicationService({
  connectionOwner,
  navigationKeyHandler,
  // CLIENT-3/APP-1 retained-gate projection gap, closed by APP-3: the
  // controller remains the presentation owner between fresh boot decisions.
  retainedGateHalted: () => gateController.gated,
});

const nativeBridge = (globalThis as typeof globalThis & {
  __televisionNativeBridge?: {
    onNavigationKey(callback: (key: ApplicationNavigationKey) => void): void;
    setAppearanceMode?(mode: "system" | "light" | "dark"): void;
  } & DesktopUpdateBridge;
}).__televisionNativeBridge;
if (electronMode && nativeBridge) {
  nativeBridge.onNavigationKey((key) => applicationService.handleNavigationKey(key));
}

// The downloaded desktop app's update, reported through the bridge's update
// operations where the shell has them (specs/arch/desktop/updates.md
// #^desktop-updates-ops). The notice and the gate share it; each subscribes
// when it renders.
const desktopUpdate = new DesktopUpdateState({
  electron: electronMode,
  bridge: nativeBridge,
});

if (launchToken) {
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

// Client auto-reload (specs/arch/updates/version-advertisement.md): only the
// bundle-serving origin can be version-matched against this bundle
// (^reload-origin-rule). A browser page loaded with a differing ?serverURL=
// (the dev affordance) therefore never reloads. Attached BEFORE the gate
// controller: the reload decision evaluates each server-status first
// (^reload-gate-precedence).
createUpdateReloadAgent({
  owner: connectionOwner,
  primaryServerURL,
  navigationLatch,
});
gateController.attach(connectionOwner);

const pruneNavigationHistoryForConnectedServer = (): void => {
  const connection = connectionOwner.connection;
  if (connection.status !== "connected") return;

  void connection.client.artifacts.list()
    .then(({ artifacts }) => {
      const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
      pruneStaleNavigationHistory(artifactIds);
    })
    .catch(() => {
      // Cleanup is opportunistic; never interrupt app startup or reconnect.
    });
};

const refreshApplicationThemeLink = (): void => {
  if (connectionOwner.connection.status !== "connected") return;
  refreshThemeLink(connectionOwner.connection.url);
};

type ConfirmedThemeScriptState = {
  readonly activeThemeName: string | null;
  readonly consentIds: ReadonlySet<string>;
};

type EffectiveThemeFrameAppearance = "light" | "dark";

type ConfirmedThemeFrameState = {
  readonly activeThemeName: string | null;
  readonly serverURL: string;
  readonly appearance: EffectiveThemeFrameAppearance;
};

let confirmedThemeScriptState: ConfirmedThemeScriptState | null = null;
let confirmedThemeFrameState: ConfirmedThemeFrameState | null = null;
let observedThemeConnectionStatus = connectionOwner.connection.status;

const forceThemeScriptReset = (): void => {
  if (navigationLatch.pending) return;
  navigationLatch.begin(() => {
    const settings = document.querySelector<HTMLElement>("#settings-popover");
    if (settings?.hasAttribute("open")) {
      const url = new URL(window.location.href);
      url.searchParams.set("reopenSettings", "1");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    window.location.reload();
  });
};

const applyConfirmedThemeScriptState = (
  activeThemeName: string | null,
  consentIds: readonly string[],
  refreshUnchanged: boolean,
): void => {
  if (
    navigationLatch.pending ||
    connectionOwner.connection.status !== "connected" ||
    applicationService.snapshot.connection.status !== "connected" ||
    !applicationService.snapshot.ready
  ) return;

  const next: ConfirmedThemeScriptState = {
    activeThemeName,
    consentIds: new Set(consentIds),
  };
  const previous = confirmedThemeScriptState;
  const include = getThemeScript();
  const activeChanged = previous !== null &&
    previous.activeThemeName !== next.activeThemeName;
  const previousActiveWasConsented = previous?.activeThemeName !== null &&
    previous?.activeThemeName !== undefined &&
    previous.consentIds.has(previous.activeThemeName);
  const nextActiveIsConsented = next.activeThemeName !== null &&
    next.consentIds.has(next.activeThemeName);
  const activeConsentWithdrawn = previous !== null &&
    !activeChanged &&
    previousActiveWasConsented &&
    !nextActiveIsConsented;
  const consentSetUnchanged = previous !== null &&
    sameStringSet(previous.consentIds, next.consentIds);

  confirmedThemeScriptState = next;
  if (include !== null && (activeChanged || activeConsentWithdrawn)) {
    forceThemeScriptReset();
    return;
  }
  if (include === null && nextActiveIsConsented) {
    refreshThemeScript(connectionOwner.connection.url);
    return;
  }
  if (
    include !== null &&
    nextActiveIsConsented &&
    refreshUnchanged &&
    !activeChanged &&
    consentSetUnchanged
  ) {
    refreshThemeScript(connectionOwner.connection.url);
  }
};

const currentEffectiveThemeFrameAppearance = (): EffectiveThemeFrameAppearance => {
  const appearance = document.documentElement.dataset.theme;
  if (appearance !== "light" && appearance !== "dark") {
    throw new Error("Application root has no effective theme-frame appearance");
  }
  return appearance;
};

const applyConfirmedThemeFrameState = (
  activeThemeName: string | null,
  refreshUnchanged: boolean,
): void => {
  if (
    navigationLatch.pending ||
    connectionOwner.connection.status !== "connected" ||
    applicationService.snapshot.connection.status !== "connected" ||
    !applicationService.snapshot.ready
  ) return;

  const next: ConfirmedThemeFrameState = {
    activeThemeName,
    serverURL: connectionOwner.connection.url,
    appearance: currentEffectiveThemeFrameAppearance(),
  };
  const previous = confirmedThemeFrameState;
  confirmedThemeFrameState = next;
  if (
    !refreshUnchanged &&
    previous?.activeThemeName === next.activeThemeName &&
    previous.serverURL === next.serverURL &&
    previous.appearance === next.appearance
  ) return;

  void refreshThemeFrames(
    next.serverURL,
    next.activeThemeName,
    () => applicationService.listThemes(),
  );
};

const applyForConnection = (): void => {
  if (navigationLatch.pending) return;
  observedThemeConnectionStatus = connectionOwner.connection.status;
  if (connectionOwner.connection.status !== "connected") {
    clearThemeLink();
    clearThemeScript();
    clearThemeFrames();
    confirmedThemeScriptState = null;
    confirmedThemeFrameState = null;
    return;
  }
  refreshApplicationThemeLink();
  pruneNavigationHistoryForConnectedServer();
};

let appliedBrowserAppearanceInput: "system" | "light" | "dark" | undefined;
let appliedNativeAppearanceMode: "system" | "light" | "dark" | undefined;

const applyResolvedAppearance = (
  appearanceMode: "system" | "light" | "dark",
  activeThemeColorScheme: "light" | "dark" | "light dark" | null,
): void => {
  const input = resolveAppearanceInput(appearanceMode, activeThemeColorScheme);
  if (input !== appliedBrowserAppearanceInput) {
    applyConfirmedAppearance(input);
    appliedBrowserAppearanceInput = input;
  }
  if (
    input !== appliedNativeAppearanceMode &&
    electronMode &&
    typeof nativeBridge?.setAppearanceMode === "function"
  ) {
    nativeBridge.setAppearanceMode(input);
    appliedNativeAppearanceMode = input;
  }
};

const applyForApplication = (): void => {
  const snapshot = applicationService.snapshot;
  if (snapshot.connection.status !== "connected") {
    appliedBrowserAppearanceInput = undefined;
    appliedNativeAppearanceMode = undefined;
    return;
  }
  if (!snapshot.ready) return;

  // Confirm appearance before a ready-state publish can mount connected
  // content or its first artifact frame.
  applyResolvedAppearance(
    snapshot.display.appearanceMode,
    snapshot.display.activeThemeColorScheme,
  );

  // On a connection transition, ApplicationService publishes once before its
  // complete display refresh settles. Wait for the next ready publish rather
  // than applying retained consent from the prior connection.
  if (observedThemeConnectionStatus !== connectionOwner.connection.status) return;
  applyConfirmedThemeScriptState(
    snapshot.display.activeThemeName,
    snapshot.display.themeJavaScriptConsentIds,
    false,
  );
  applyConfirmedThemeFrameState(snapshot.display.activeThemeName, false);
};

const applyForThemeChange = (event: ThemeChangedEvent): void => {
  if (navigationLatch.pending) return;
  applyResolvedAppearance(
    applicationService.snapshot.display.appearanceMode,
    event.activeThemeColorScheme,
  );
  const previous = confirmedThemeScriptState;
  const consentOnlyChange = previous !== null &&
    previous.activeThemeName === event.themeName &&
    !sameStringSet(previous.consentIds, new Set(event.themeJavaScriptConsentIds));
  applyConfirmedThemeScriptState(
    event.themeName,
    event.themeJavaScriptConsentIds,
    true,
  );
  if (navigationLatch.pending || consentOnlyChange) return;
  refreshApplicationThemeLink();
  applyConfirmedThemeFrameState(event.themeName, true);
};

const applyForAppearanceChange = (event: AppearanceChangedEvent): void => {
  if (navigationLatch.pending) return;
  applyResolvedAppearance(
    event.appearanceMode,
    applicationService.snapshot.display.activeThemeColorScheme,
  );
};

applyForConnection();
applyForApplication();
connectionOwner.addEventListener("change", applyForConnection);
applicationService.addEventListener("change", applyForApplication);
applicationService.addEventListener("theme-changed", applyForThemeChange);
applicationService.addEventListener("appearance-changed", applyForAppearanceChange);

const themeFrameAppearanceObserver = new MutationObserver(() => {
  applyForApplication();
});
themeFrameAppearanceObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

dependencies.register("ServerConnectionOwner", () => connectionOwner);
dependencies.register("ApplicationService", () => applicationService);

// E2e seam for the one connection, application-state operations, and the
// app view's render-complete signal. A test's init script may register a
// callback before this module runs, so the set is shared, not replaced.
type TelepathSeam = {
  applicationService?: unknown;
  connectionOwner?: unknown;
  renderCompleteCallbacks?: Set<(state: string) => void>;
};
const seam = ((globalThis as { __telepath?: TelepathSeam }).__telepath ??= {});
seam.applicationService = applicationService;
seam.connectionOwner = connectionOwner;
const renderCompleteCallbacks = (seam.renderCompleteCallbacks ??= new Set());

if (electronMode) {
  document.body.classList.add("electron");
}

let applicationPresented = false;
let settingsReopened = false;

const reopenSettingsAfterConnectedMount = (state: string): void => {
  if (
    !reopenSettingsAfterThemeReset ||
    settingsReopened ||
    (state !== "connected" && state !== "no-channel" && state !== "empty-channel")
  ) return;

  const settings = document.querySelector<HTMLElement>("#settings-popover");
  if (settings === null) return;
  settingsReopened = true;
  settings.setAttribute("open", "");
};

const presentApplication = (): void => {
  if (applicationPresented) return;
  render(TelevisionAppView(applicationService, {
    runtimeServerURL,
    electronMode,
    connectionOwner,
    primaryServerURL,
    updatePresentation,
    desktopRecommendation: gateDetection,
    desktopUpdate,
    sidebarWidthPreference,
    sidebarCollapsedPreference,
    onRenderComplete(state) {
      reopenSettingsAfterConnectedMount(state);
      for (const callback of renderCompleteCallbacks) callback(state);
    },
  }), document.body);
  applicationPresented = true;
  // Electron can receive confirmed display state before its boot barrier lets
  // the stable application anchors mount. Reapply that retained state only
  // after the view has committed so frame lookup has somewhere to install.
  applyForApplication();
};

// APP-1 bootstrap-ordering repair, closed by APP-3: an Electron page does not
// present the ordinary connecting state while its existing boot barrier is
// still waiting for server-status. The connection's own settled boot/auth/error
// state and change event supply the decision; browser composition stays
// immediate and no second boot or application-state owner is introduced.
const presentElectronApplicationAfterBoot = (): void => {
  const connection = connectionOwner.connection;
  if (
    connection.bootState === "pending" &&
    !connection.hasAuthRejected &&
    connectionOwner.connectError === null
  ) return;
  connectionOwner.removeEventListener("change", presentElectronApplicationAfterBoot);
  presentApplication();
};

if (electronMode) {
  connectionOwner.addEventListener("change", presentElectronApplicationAfterBoot);
} else {
  presentApplication();
}

void connectionOwner.connect();

function consumeSettingsReopenMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("reopenSettings") !== "1") return false;
  url.searchParams.delete("reopenSettings");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return true;
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
