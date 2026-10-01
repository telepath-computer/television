import {
  DEV_VERSION,
  isNewerVersion,
  isReleaseVersion,
  type DesktopUpgradeInstructions,
} from "@telepath-computer/television-shared";
import { isElectronMode, resolveDesktopAppVersion } from "../config.ts";

// The desktop upgrade gate's pure pieces
// (specs/arch/updates/desktop-upgrade-gate.md): Electron-context and
// shell-version parsing from the raw page inputs (^electron-context), the
// gate decision (^gate-condition, ^gate-unknown-version, ^gate-exemptions),
// the gate-surface message selection with its built-in messages
// (^gate-instructions, ^gate-fallback-content), and the presentation
// precedence over the toast and bell (^gate-precedence). Everything here is
// pure logic over injected inputs — no DOM, no ServerConnection; the boot
// barrier that wires these into startup (^boot-barrier) is owned by the
// runtime slice.

export interface ElectronDetection {
  /** The page runs inside the desktop app's Electron window. */
  electron: boolean;
  /** The shell's declared release version; null when unknown. */
  shellVersion: string | null;
}

/**
 * Electron context and shell version from the page's search params
 * (^electron-context): the `?mode=electron` parameter alone — every
 * published shell has always sent it, so no fallback detection exists,
 * deliberately. The shell version comes only from `?desktopAppVersion=`
 * (client.md ^desktop-version-param); anything but a valid release triple —
 * including its absence, the norm for the installed base, which predates the
 * parameter — is unknown (^gate-unknown-version treats unknown as older than
 * any requirement).
 */
export function detectElectronContext(input: { search: string }): ElectronDetection {
  const electron = isElectronMode(input.search);
  const declared = resolveDesktopAppVersion(input.search);
  const shellVersion = declared !== null && isReleaseVersion(declared) ? declared : null;
  return { electron, shellVersion };
}

export interface DesktopGateInput {
  electron: boolean;
  /** Parsed shell version; null = unknown (gates, per ^gate-unknown-version). */
  shellVersion: string | null;
  /** The server-advertised requirement; null = the server advertises none. */
  requiredDesktopVersion: string | null;
}

/**
 * The gate decision (^gate-condition): gated iff Electron context, a valid
 * requirement, and a shell version that is unknown or a valid triple other
 * than 0.0.0 numerically below the requirement. Everything else — browser
 * clients, development shells at 0.0.0, no requirement, at/above the
 * requirement — boots normally (^gate-exemptions). A requirement that is not
 * a valid release-version triple is treated as no requirement — it gates
 * nobody (fails open), and this is checked BEFORE the unknown-shell rule so
 * a malformed requirement cannot gate a version-less shell.
 */
export function decideDesktopGate(input: DesktopGateInput): boolean {
  if (!input.electron) return false;
  if (input.requiredDesktopVersion === null || !isReleaseVersion(input.requiredDesktopVersion)) return false;
  if (input.shellVersion === null) return true;
  if (input.shellVersion === DEV_VERSION) return false;
  return isNewerVersion(input.requiredDesktopVersion, input.shellVersion);
}

/**
 * The gate's built-in messages. The words are the gate surface's copy
 * (specs/ui/app/desktop-upgrade-gate/content.yml, delegated by
 * ^gate-fallback-content); these constants conform to it verbatim. The
 * downloaded-update message goes with the restart action; the fallback is for
 * an app that reports no downloaded update.
 */
export const GATE_DOWNLOADED_UPDATE_MARKDOWN =
  "# Desktop app update required\n" +
  "\n" +
  "This version of the Television desktop app does not work with this server and needs to be updated. The new version has already downloaded and installs when you restart the app.";

export const GATE_FALLBACK_MARKDOWN =
  "# Desktop app update required\n" +
  "\n" +
  "This version of the Television desktop app does not work with this server and needs to be updated. [Download the latest version for Mac](https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64) and install it.";

/**
 * Gate-screen message selection (^gate-instructions): the downloaded-update
 * message when the shell has reported a download, whatever the channel
 * publishes; otherwise the channel's desktop upgrade instructions when the
 * current update state carries them, and the built-in fallback when it does
 * not. The gate is never an instructions-less dead end.
 */
export function selectGateInstructions(
  desktop: DesktopUpgradeInstructions | null,
  downloadedUpdate = false,
): string {
  if (downloadedUpdate) return GATE_DOWNLOADED_UPDATE_MARKDOWN;
  return desktop === null ? GATE_FALLBACK_MARKDOWN : desktop.upgradeMarkdown;
}

export interface GatePresentation {
  gated: boolean;
  /**
   * The gate screen's markdown body with no reported download; null exactly
   * when not gated. The screen shows the downloaded-update message instead
   * once the shell reports a download.
   */
  instructionsMarkdown: string | null;
  /** The gate supersedes toast and bell (^gate-precedence). */
  suppressUpdateToast: boolean;
}

/**
 * The composed presentation decision the boot barrier consumes: decision,
 * gate body, and toast/bell suppression from one set of inputs.
 */
export function decideGatePresentation(
  input: DesktopGateInput & { desktop: DesktopUpgradeInstructions | null },
): GatePresentation {
  const gated = decideDesktopGate(input);
  return {
    gated,
    instructionsMarkdown: gated ? selectGateInstructions(input.desktop) : null,
    suppressUpdateToast: gated,
  };
}
