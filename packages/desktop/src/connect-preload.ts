import { contextBridge, ipcRenderer } from "electron";
import type { ConnectResult } from "./connect-error.ts";
import {
  GET_CONNECT_SCREEN_INTENT_CHANNEL,
  type ConnectScreenIntent,
} from "./connect-screen.ts";
import {
  isNativeNavigationKey,
  NATIVE_NAVIGATION_KEY_CHANNEL,
} from "./native-navigation-key.ts";
import {
  isDesktopAppearanceMode,
  SET_APPEARANCE_MODE_CHANNEL,
} from "./appearance-mode.ts";
import {
  DESKTOP_UPDATE_DOWNLOADED_CHANNEL,
  GET_DESKTOP_UPDATE_CHANNEL,
  isDesktopUpdateVersion,
  RESTART_TO_INSTALL_UPDATE_CHANNEL,
} from "./desktop-update.ts";

contextBridge.exposeInMainWorld("__televisionNativeBridge", {
  onNavigationKey(callback: (key: string) => void): void {
    ipcRenderer.on(NATIVE_NAVIGATION_KEY_CHANNEL, (_event, key: unknown) => {
      if (isNativeNavigationKey(key)) callback(key);
    });
  },
  setAppearanceMode(mode: unknown): void {
    if (isDesktopAppearanceMode(mode)) {
      ipcRenderer.send(SET_APPEARANCE_MODE_CHANNEL, mode);
    }
  },
  // The update operations' names, arguments and callback value stay fixed
  // once released: the upgrade gate of a newer server calls them
  // (specs/arch/desktop/updates.md#^desktop-updates-frozen).
  onDesktopUpdateDownloaded(callback: (version: string) => void): void {
    let reported: string | null = null;
    const report = (version: unknown): void => {
      if (!isDesktopUpdateVersion(version) || version === reported) return;
      reported = version;
      callback(version);
    };
    ipcRenderer.on(DESKTOP_UPDATE_DOWNLOADED_CHANNEL, (_event, version: unknown) => report(version));
    void ipcRenderer.invoke(GET_DESKTOP_UPDATE_CHANNEL).then(report, () => undefined);
  },
  restartToInstallUpdate(): void {
    ipcRenderer.send(RESTART_TO_INSTALL_UPDATE_CHANNEL);
  },
});

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("television", {
    getConnectScreenIntent: (): Promise<ConnectScreenIntent> =>
      ipcRenderer.invoke(GET_CONNECT_SCREEN_INTENT_CHANNEL),
    getConnection: (): Promise<{ serverURL: string; token: string } | null> =>
      ipcRenderer.invoke("television:get-connection"),
    connect: (serverURL: string, token: string): Promise<ConnectResult> =>
      ipcRenderer.invoke("television:connect", { serverURL, token }),
  });
}
