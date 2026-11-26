# Server specs: task record

Working record for moving `packages/server` from code authority to spec authority. Not authority; deleted or archived at pre-merge docs prep.

## Intent (from Josh, 26 Nov)

- Move the server from code authority to spec authority.
- Follow the revised `specs/spec-policy.md` rigorously on what belongs in a spec. Existing specs are too heavy; do not reproduce that.
- This is a reorganization, not only new files: buffers held for the server in other specs move into server specs, and server content specified elsewhere may move too.
- This is one of three independent attempts that a fourth agent will compare. Do not read `wt/television/server-specs` or `wt/television/server-specs-opus55`.

## Where requirements on the server live today

Self-declared buffers and holding specs (each says a server spec should absorb it):

| Where | What it holds |
|---|---|
| `arch/cli/startup-bind-failure.md` (whole file, "provisional holding spec") | `Server.start()` all-or-nothing bind, fatal record in `logs/tv.log`, exit 69, service restart definitions, foreground semantics. Says it splits: start transaction + fatal record + error classes to server; exit propagation, foreground semantics, service restart posture stay CLI. |
| `arch/telemetry/server-telemetry-buffer.md` (whole file) | event-stream (client metadata query params, activity + client signal acceptance), server-store emit hooks at commit points, `/telemetry` routes, bootstrap (`dataDirCreated`, init order), data-directory serving-evidence definition. |
| `arch/onboarding/installer.md` "Bootstrap ordering and telemetry silence" (`^bootstrap-sequence`, `^token-only-boot`, `^storage-path-absolute`, `^telemetry-silence`) and "Onboarding channel marker" buffer note | The serving bootstrap sequence (8 steps), token-only construction, `ServerStoreOptions`, `Channel.onboarding`. |
| `arch/layout/migration.md` `^ly-boot-migration` (+ the whole "one migration" spec is server boot behavior) | Server runs the one migration at boot before serving. |
| `arch/channel-state/index.md` `^cs-display-migration`; carve-outs `^cs-connection-carve-out`, `^cs-wire-carve-out` | Display-record migration step; transport vocabulary declared code-governed lockstep. |
| `arch/resources/index.md` `^rs-artifact-record`, `^rs-share-serving`, `^rs-events-stream` | Artifact record's resource fields + save rule; proxy serving under a share ID; `/events` carries resource events, token as `token` query param, close 4401, first message `server-status`, any origin. |
| `arch/artifact-frame/reload-navigation.md` `^rn-local-content-change`, `^rn-shared-content-watcher` | `ServerStore` path-artifact watching; the shared `file-watcher.ts` module; `artifact-content-changed` event. |
| `arch/cli/index.md` `^cli-server-origins`, `^cli-acp-home-context`; "Home and config resolution" (contract of `packages/server/src/config.ts`); `^cli-serve-adapter` | `Server.getOrigins()` + `/health` fields; ACP agent home context; home resolver and config reader/writer; server constructor facts. |

Server behavior specified elsewhere without being called a buffer:

- `arch/artifact-frame/proxy-caching.md` — whole spec is the artifact proxy's cache contract.
- `arch/artifact-frame/isolation.md` — sandbox header on `/artifact/` and `/theme/`; "Cross-origin rules by route" table (`^iso-routes`) is effectively the server's route/auth table.
- `arch/updates/version-advertisement.md` — `/health` version, `X-TV-Version` header, `server-status` first message (`^events-version`), GUI bundle cache headers (`^cache-headers`), unknown-message rule.
- `arch/updates/update-channel.md` — server-side polling, lifecycle (`^poll-lifecycle`).
- `arch/updates/desktop-upgrade-gate.md` — frozen `GET /desktop/connect-check`, legacy `GET /display` projection, `REQUIRED_DESKTOP_VERSION`.
- `arch/desktop/artifact-partitions.md` `^dp-artifacts-route` — `GET /artifacts` cross-release shape.
- `arch/themes/delivery.md` — `/theme/*` routes; `arch/canonical.md` — `/canonical/v<n>/*` and `^cn-cache-policy`; `arch/resources/sdk.md` `^sdk-serving`.
- `arch/telemetry/client.md` — client metadata on `/events` query params and `X-Television-Client-Meta`; `client-signals.md`, `sessions.md` — client→server message types.
- `product/cli.md` — unanchored server rules: bind-list resolution (L307), path-artifact acceptance and stored-path normalization (L454), URL validation (L473), channel removal cascade (L420), artifact deletion removes page (L496), registry invariant `^e5b85571` (L444), `^cli-config-snapshot` (server reads config once), connect-link origins `^cli-connect-link`, pinned server error texts `Channel not found: <id>` / `Artifact not found: <id>`.
- Home paths defined by owners: `state/telemetry.json` (telemetry/identity), `state/bundled-themes.json` (themes/bundled-installation), `state/onboarding.json` + legacy `state/onboarding-artifact.json` (onboarding/installer), `state/artifacts/<id>.json`, `resources/<type>/<id>/`, `state/resource-bindings.json` (resources), `state/channels/`, `state/display.json` (layout/migration, channel-state), `config.json`, `state/token`, `logs/tv.log`, `themes/` (product/cli), `artifacts/` (agent convention dir).

Not specified anywhere (code-authoritative today): token generation/format and how requests present it; route list and shapes; channel/artifact/display record shapes as stored; log format; `/acp`; `Server.dispose`; error texts.

## Citations to update when content moves

Files citing `startup-bind-failure.md` or `server-telemetry-buffer.md`: `proofs/arch/telemetry/identity.md`, `proofs/arch/updates/index.md`, `proofs/arch/cli/index.md`, `proofs/arch/cli/startup-bind-failure.md`, `proofs/product/cli.md`, `proofs/product/telemetry.md`, `proofs/arch/telemetry/server-telemetry-buffer.md`, `packages/server/test/logging.test.ts`, `packages/server/test/server-store-bootstrap.test.ts`, `packages/cli/src/index.ts`, `test/node/cli-integration.test.ts`, `specs/spec-migration.md`, `specs/arch/telemetry/emitters.md`, `specs/arch/telemetry/index.md`, `specs/arch/cli/index.md`, `specs/arch/onboarding/installer.md`, `specs/product/cli.md`.

## Review setup

Independent spec review: `codex exec` with `gpt-6-astra` at `xhigh` reasoning effort (`xhigh` is the exact value), given the `tvdev-review` skill.
