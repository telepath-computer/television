*The Electron end-to-end harness: preparing the exact runtime, planning its Linux environment, handing a validated executable to Playwright, launching the package, and proving real-Electron seams.*

# Electron e2e harness

Desktop tests use a real Electron process when browser-only testing cannot exercise the behavior at issue, such as webviews, Electron IPC, native main-process events, or application paths. The harness prepares that process before a timed launch, then gives tests a BrowserWindow page and main-process handle through Playwright.

## What this owns

This spec owns how `e2e:desktop` obtains and launches Electron: `packages/desktop/test/e2e/global-setup.ts`, the Electron-specific parts of `packages/desktop/test/e2e/helpers.ts`, the shared Linux environment planner in `scripts/electron-e2e-env.mjs`, the test fixture hook, and the harness's real-process seams. [runtime.md](./runtime.md) owns runtime validity. The canonical runner, registry surface, preflight timing, and provider setup remain under [test-runner](../test-runner/test-runner.md), [registry](../test-runner/test-registry.md), [preflight](../test-runner/preflight.md), [GitHub CI](../test-runner/github-ci.md), and [Blaxel](../test-runner/blaxel-testshards.md) authority.

Electron e2e is used only when the claim depends on Electron. Browser e2e remains the less expensive boundary for ordinary web behavior.

## Shared environment plan

The runner preflight and Playwright global setup use one environment planner. Its logical result is: ^desktop-e2e-environment-plan

```ts
type ElectronRuntimePresence =
  | { state: "absent" }
  | { state: "valid"; executablePath: string }
  | { state: "invalid"; reason: string };

interface ElectronE2EEnvironmentPlan {
  platform: string;
  runtime: ElectronRuntimePresence;
  useXvfb: boolean;
  disableSandbox: boolean;
  failures: string[][];
  notes: string[];
}
```

The planner first requires a resolvable `electron/package.json` at the declared exact version. Native runtime presence is then classified with [runtime.md](./runtime.md):

- an absent runtime is valid before global setup; no sandbox conclusion is drawn from a missing helper;
- a valid existing runtime contributes its constructed `executablePath` and, on Linux, proceeds to sandbox inspection;
- a partial, mismatched, or otherwise invalid existing runtime is a failure rather than an absent-runtime shortcut.

On headless Linux the plan uses `xvfb-run -a` when neither `DISPLAY` nor `WAYLAND_DISPLAY` exists and fails with installation guidance when `xvfb-run` is unavailable. For a valid Linux runtime, its `chrome-sandbox` runs enabled only when root-owned with setuid mode; otherwise the documented test-only path sets `ELECTRON_DISABLE_SANDBOX=1`. An explicit incoming `ELECTRON_DISABLE_SANDBOX=1` is preserved. This sandbox decision is repeated after a fresh runtime installation, so an absent pre-setup helper can never be misreported as a malformed installed helper. ^desktop-e2e-linux-plan

The planner consumes the [test runner's shared Cursor environment rule](../test-runner/test-runner.md) rather than defining a second contamination policy.


## Global setup

Playwright global setup is the native-runtime installation site for local and GitHub `e2e:desktop` runs. Before any test launches Electron, it: ^desktop-e2e-global-setup

1. resolves the installed Electron package and confirms its package version matches the exact declaration;
2. reuses a valid runtime, or, when the runtime is absent, invokes Electron's own `node_modules/electron/install.js` once and validates the resulting runtime;
3. fails on invalid existing state or on an installer result that does not satisfy [runtime validity](./runtime.md), without deleting or repairing files;
4. runs the shared environment planner over the installed runtime and applies its Linux sandbox decision to the test process;
5. builds the web bundle and desktop package bundles required by the suite;
6. publishes the validated absolute executable path to the Playwright workers.

Download and extraction belong entirely to setup. The helper refuses to launch without the published validated executable path and passes it as `_electron.launch({ executablePath, ... })`, so Playwright does not load Electron's resolver inside the launch timeout. ^desktop-e2e-executable-handoff

When [Blaxel's owned setup](../test-runner/blaxel-testshards.md) supplies a valid runtime before Playwright begins, global setup follows its ordinary validation and environment-plan path and makes no second install. [GitHub CI](../test-runner/github-ci.md) owns how its workflow reaches this setup.


## Launch contract

`launchDesktop()` starts the installed package directory, not a bare main-process bundle. Electron therefore resolves `packages/desktop/package.json` and production `app.getVersion()` behavior remains represented. The argument list is:

```text
<desktop-package-directory>
[--user-data-dir=<isolated-path>]
--test-fixture <fixture-url>
[<extra-arguments>]
```

or the package directory plus an isolated profile for the real connect flow, followed by any extra arguments the test passes, such as the update runtime's simulation flag ([desktop updates](./updates.md#Testing)). A fixture beginning with `/` resolves against the runner-published desktop Vite origin; an absolute URL passes through unchanged. The `e2e:desktop` [registry service](../test-runner/test-registry.md#Surface services) publishes its bound fixture URL as `TV_DESKTOP_E2E_URL`. The desktop Playwright configuration requires this variable. Fixture helpers require the value to be an HTTP URL on `127.0.0.1` and use its origin. The helper's inherited environment carries `TV_TEST_MODE=true`, with per-test overrides applied explicitly. ^desktop-e2e-launch-contract

Each launch phase has an **eight-second timeout**: `_electron.launch`, first `BrowserWindow`, and its `domcontentloaded` state. Runtime installation and bundle builds finish in global setup and are excluded. A later product-readiness wait can carry its own owning timeout; it does not extend a launch phase. If a phase after process creation fails, the helper closes the Electron application before rethrowing the named phase error. ^desktop-e2e-launch-timeout

The main process's `--test-fixture <url>` hook loads the supplied URL directly, bypassing saved-connection lookup and the connect screen. It is active only when explicitly passed and has no user-facing help or menu surface. Connect-flow tests instead use an isolated `--user-data-dir` and real connection state. Each `launchDesktop()` invocation returns Playwright's `ElectronApplication` and first `Page`; tests close the app in `finally` or teardown and remove profiles they create. One BrowserWindow per invocation is the supported helper contract. ^desktop-e2e-fixture-hook

Tests that exercise native input inside a `<webview>` use the real Electron boundary and assertions owned by [artifact-bridge](../artifact-frame/artifact-bridge.md); this harness does not define a second input or message contract.

## Operations

Run desktop tests through the canonical runner. A file selection is the normal iteration boundary; the complete surface is the desktop gate:

```sh
npm test -- local --file packages/desktop/test/e2e/smoke.test.ts
npm test -- local --surface e2e:desktop
```

On macOS, `packages/desktop/test/e2e/user-data-identity.test.ts` uses Electron's real default `~/Library/Application Support/Television` application-data directory; expect the run to write Chromium profile files there.

On a fresh Linux host, install Playwright's Chromium browser and shared system dependencies once with `npx playwright install --with-deps chromium`. The Electron preflight names a missing display or sandbox prerequisite; global setup owns Electron runtime preparation and desktop bundle builds, so neither is a manual prerequisite.

An Electron-only scenario belongs under `packages/desktop/test/e2e/`. Add authored static pages under `packages/desktop/test/e2e/fixtures/` when the scenario needs one, launch them through `launchDesktop()`, drive renderer behavior through its returned Playwright `Page`, and use the returned `ElectronApplication` only for a real main-process boundary. Every test closes the application in teardown or `finally` and removes any profile directory it creates.

## Provider integration

The canonical command surface and surface selection are owned by [the test runner](../test-runner/test-runner.md) and [registry](../test-runner/test-registry.md). Whenever a provider selects `e2e:desktop`, this harness applies its shared environment plan, global setup, and launch contract. Provider setup does not change the [launch-phase timeout](#^desktop-e2e-launch-timeout).

## Testing

Contract tests may supply the host facts that the environment planner reads as inputs. Tests must exercise runtime setup and desktop launch with the real installed Electron package, the real filesystem and host, and the real Playwright Electron transport. These tests do not replace any of them with test doubles.

