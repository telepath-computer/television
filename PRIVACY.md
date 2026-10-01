# Privacy

Television’s npm releases send fully anonymized, content-free usage telemetry to PostHog in the US by default. We use it to understand product usage and improve Television.

Telemetry records server starts and upgrades, feature usage, activity sessions, coarse configuration and versions, information about the connecting client (browser or desktop app, operating system, browser family and major version, desktop app version), aggregate content counts, and the installing agent’s harness product name. Random identifiers distinguish servers, clients and sessions. Telemetry contains no names, email addresses, IP addresses, geolocation, artifact content, paths, URLs, titles or channel names. PostHog sees the connection’s IP at the network layer; IP collection and geolocation enrichment are disabled for our telemetry.

Run `tv telemetry disable` against the running server to opt out permanently for that Television home, or `tv telemetry enable` to clear that setting. Disabling records one final opt-out event before collection stops. `tv status` shows the current state. To opt out before first use, set `DO_NOT_TRACK=1` in the environment for your `tv` commands and keep it set. A persisted service keeps the environment captured when it was installed or reinstalled.

The [telemetry rules](specs/product/telemetry.md#when-telemetry-is-sent-and-where-it-goes) define when telemetry is sent and where it goes.

Our partner ToDesktop builds and distributes the desktop app. ToDesktop has its own policies and may or may not collect IP addresses when people download the app. We do not report on that download data or correlate it with our anonymous telemetry.
