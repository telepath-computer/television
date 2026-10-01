# Television

Television is a virtual display for agents. You can run it as a local desktop app or as a standalone server, then create, update, and remove persistent artifacts in channels.

See the [spec index](specs/index.md) for the system’s requirements and [server routes](packages/server/src/routes.ts) for the current network implementation.

## Environment

- **Runtime.** Electron `43.7.6` (Chromium renderer, Node.js main process) for desktop. The published CLI package requires Node.js `>=22.12.0`. Repository development and builds use Node.js 24 with npm `>=11.5 <12`.
- **Package manager.** npm workspaces under `packages/*` (`cli`, `desktop`, `layout`, `server`, `shared`, `web`).
- **Build.** The `@telepath-computer/television` package at `packages/cli/` is the publishable CLI; its `build.mjs` orchestrates the full pipeline: Vite builds the renderer (`@telepath-computer/television-web`) to `packages/web/dist/` and each view to `packages/view-*/dist/`, then esbuild bundles the CLI to `packages/cli/dist/cli.cjs` and the renderer + views get copied into `packages/cli/dist/web/` and `packages/cli/dist/views/`. The desktop Electron app in `packages/desktop` is built, signed and hosted by ToDesktop; see [`packages/desktop/README.md`](packages/desktop/README.md).
- **Tests.** Vitest for unit/integration and server tests, Playwright for browser e2e.
- **Team developer telemetry marker.** Team developers must run `touch ~/.tv-developer` before using Television on a development host. The marker keeps production installations silent; see the authoritative [telemetry rules](specs/product/telemetry.md#when-telemetry-is-sent-and-where-it-goes).

## Getting Started

Requirements:
- Node.js `>=22.12.0` to install and run the published CLI package
- Node.js 24 with npm `>=11.5 <12` for source development (`nvm use` selects `.nvmrc`)

The published CLI package expresses the Node `>=22.12.0` floor through npm's advisory `engines` field, so npm normally warns rather than blocking installation on an older runtime. Its Node-side bundle targets Node 18 syntax, which means an older Node may parse the bundle, but versions below the published floor are unsupported and untested.

Npm releases send fully anonymized, content-free usage telemetry to PostHog by default. Opt out with `tv telemetry disable` once the server is running; check with `tv status`. To opt out before first use, run `export DO_NOT_TRACK=1` and keep it set for your `tv` commands. See the [privacy notice](PRIVACY.md).

Via npm:
```bash
npm install -g @telepath-computer/television
tv skills install ~/.openclaw/skills
tv serve
```

The desktop app runs on Apple Silicon Macs; on other computers, Television is used in the browser. The user downloads and installs the app on the Mac they view Television from, and it updates itself. The [administrator guide](docs/guides/television-admin-guide.md#desktop-client-recommended-for-url-artifacts) gives the download link and install steps.

For source development, ask an agent to use `developer-skills/tvdev-setup/SKILL.md` to prepare the machine, then use `tvdev-contribute` to work from a product request or spec edits.

Artifacts are registered by agents with `tv create-path-artifact` for existing markdown/HTML files or indexed HTML directories, and `tv create-url-artifact` for live `http(s)` pages. Edit artifact content by editing the pointed-to file; update display metadata with `tv update-artifact`. `tv help` is normal CLI help with routing pointers; see [specs/product/cli.md](specs/product/cli.md) for the CLI reference. Agents should read the installed `television` skill for channel and artifact work, and install the bundled Television skills for specialized HTML authoring such as `tv-calendar` or `tv-table`.

### System service

Television can run as a user system service:

```bash
tv serve --persist
tv status
tv stop
```

Television keeps an installation in a Television home, `~/.television` unless `--home` or the path in `~/.tv-home` names another directory. The server's settings live in the home's optional config file, which `tv config set` writes and `tv config show` prints. The server requires the bearer token unless that file sets `"auth": false`, which is only for a user who explicitly asks for tokenless mode; a tokenless server prints a startup warning because any web page the operator opens can control it. The installed service runs `tv --home <home> serve` and reads the config file at each boot, and `tv serve --persist` also captures the current `PATH`. Rerun it after changing settings, `PATH`, or the Node/TV install to refresh the service. The reinstall flow is non-atomic: if uninstall succeeds but install fails, the service is left down; fix the environment and rerun `tv serve --persist` to recover. `tv serve --persist-uninstall` and `tv stop` are idempotent.

### Verification

The [testing policy](specs/arch/testing-policy.md) owns iteration and full-verification rules; the [test runner](specs/arch/test-runner/test-runner.md) owns commands and execution.

## Contributing

Read our [contribution policy](CONTRIBUTORS.md) before opening a pull request.
