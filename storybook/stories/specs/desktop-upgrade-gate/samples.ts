// Sample instructions shared by the spec stages and the impl wrappers. The
// channel's instructions reach only an app that reports no downloaded update,
// so, like the built-in fallback, they send the user to download the latest
// version.
export const CHANNEL_MD = [
  "# Television 0.3.0 needs a newer desktop app",
  "",
  "This server now requires desktop app **0.3.0** or newer.",
  "",
  "[Download the latest version for Mac](https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64) and install it. Details in the [release notes](https://television.run/releases/0.3.0).",
].join("\n");

export const LONG_MD = [
  "# Television 0.4.0 desktop update",
  "",
  "This release changes the artifact sandbox and requires desktop app **0.4.0** or newer.",
  "",
  "## Before you update",
  "",
  "- Finish or save any work open in artifact editors",
  "- The new version keeps this app's saved server connection",
  "",
  "## Install the update",
  "",
  "1. [Download the latest version for Mac](https://dl.todesktop.com/260923p52umxx/mac/dmg/arm64).",
  "2. Install it in place of this copy.",
  "3. Quit this app, then open the new version.",
  "",
  "## If this screen appears again",
  "",
  "Open **About Television** and check that it reports version 0.4.0 or newer. See the [release notes](https://television.run/releases/0.4.0).",
].join("\n");

// The downloaded version the impl wrappers' stand-in bridge reports.
export const DOWNLOADED_VERSION = "1.5.0";
