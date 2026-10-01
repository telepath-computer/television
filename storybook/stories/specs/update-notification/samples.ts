// Sample content shared by the spec stages and the impl wrappers.
export const SAMPLE_MD =
  "**Television 0.2.0** is out: faster screens and a redesigned artifact gallery. See the [release notes](https://television.run/releases/0.2.0).";

export const NO_PROMPT_MD =
  "Television 0.1.9 fixes a data-loss bug in screen saving. Upgrading is strongly recommended.";

export const LONG_MD = [
  "**Television 0.3.0** is a major release and needs a coordinated upgrade:",
  "",
  "- New artifact permission model — existing shares keep working",
  "- The desktop app downloads its update and offers a restart when the update is ready",
  "- Persisted daemons restart automatically",
  "",
  "Details in the [release notes](https://television.run/releases/0.3.0).",
].join("\n");

export const SAMPLE_PROMPT =
  "Please upgrade my Television server to the latest release: npm install -g @telepath-computer/television@latest, then restart it.";

// The downloaded desktop version the impl wrapper's stand-in bridge reports.
export const DOWNLOADED_VERSION = "1.5.0";
