*The update-notifications architecture root: the npm publishing eligibility and serialization rules, the release-version validation and comparison rules every update mechanism shares, the lockstep rule that exempts server↔client update contracts from compatibility discipline, and the map to the module specs.*

# Updates architecture

This is the root of the architecture behind [product/update-notifications.md](../../product/update-notifications.md): how servers and clients tell each other their versions, the published update channel, the desktop self-update notice, the recommendation that moves desktop apps installed from npm to the downloaded app, and the gate that blocks an outdated desktop app. It owns the ground rules those pieces share: how the release version is stamped and published, what counts as a valid version, how versions are compared, and which messages may change freely between releases. [Product versioning](../../product/versioning.md) owns release naming and the exact release identity. Each piece is owned by a module spec in the [Module map](#module-map).

## The release version

The release pipeline stamps the product's exact [release version](../../product/versioning.md#^pv-exact-version) into npm packages and build artifacts. The CLI/server build inlines it as the `__TV_VERSION__` build-time constant. The publish workflow versions every workspace before the release build, then finishes that build before publishing the CLI package, which keeps `__TV_VERSION__` equal to the version in the published `package.json`. The web bundle carries its own stamp of the same version ([version-advertisement.md#Web bundle version](./version-advertisement.md#Web bundle version)), and the desktop shell reports its package version through Electron's `app.getVersion()`.

Every workspace package, including the private desktop workspace, has the same release version as the root manifest. The publish workflow publishes that version if npm does not have it yet, and otherwise raises the patch number first. A commit that sets a new version is therefore published under it, even when publishing resumes from a later commit. While `.github/PAUSE_PUBLISH` exists on `main`, the publish workflow publishes nothing, and it publishes again from the first commit on `main` without that file. A desktop build takes its version from the commit it is built from, so a build of a commit that carries a release's version and code carries that release's version, as [product versioning](../../product/versioning.md#^pv-desktop-release-version) requires.

A desktop release usually follows a publish ([distribution.md](../desktop/distribution.md#^desktop-dist-release)). A release that raises the required desktop version reverses that order: publishing is paused until its desktop release is out ([the gate's operations](./desktop-upgrade-gate.md#^ops-bump)). ^updates-publication-order

For update behavior, the server's version comes from the stamp alone: `__TV_VERSION__` when defined, otherwise `0.0.0`. The `package.json` fallback inside `readServerPackageVersion()` serves telemetry's own reporting and never feeds this domain. `0.0.0` means *development build*, and every consumer in this domain treats it as unknown and exempt: it never triggers a reload ([version-advertisement.md](./version-advertisement.md)), suppresses update-channel polling ([update-channel.md](./update-channel.md)), and never gates ([desktop-upgrade-gate.md](./desktop-upgrade-gate.md)). It is never treated as older than everything. The build is the only development signal in this domain: neither the `~/.tv-developer` marker ([update-channel.md#^dev-marker-no-bypass](./update-channel.md#^dev-marker-no-bypass)) nor `NODE_ENV` is consulted. ^updates-dev-version

A release version is valid in this domain only when it is a plain `major.minor.patch` triple, as `npm version` produces; a string not matching `^\d+\.\d+\.\d+$` is invalid wherever a version is validated. Exactly two comparisons exist in this domain, and both are deliberately minimal, with no semver library and no prerelease or precedence rules, because the pipeline never produces anything but plain triples: ^updates-version-comparisons

- **Reload staleness is string inequality.** The bundle either is or is not the one this server serves; ordering is meaningless for that question (subject to the `0.0.0` exemption above).
- **"Newer" is numeric triple greater-than.** The ordering comparisons compare the three numeric components in order: the channel's announced release against the server's version ([update-channel.md](./update-channel.md)), the recommended desktop version against the shell's version ([desktop-upgrade-recommendation.md](./desktop-upgrade-recommendation.md)), and the server's required desktop version against the shell's version ([desktop-upgrade-gate.md](./desktop-upgrade-gate.md)).

## npm publishing eligibility

The npm publishing job runs only in `telepath-computer/television`, after successful CI for a push to that repository's `main`. It skips the job when the triggering CI run has another event or head repository, before obtaining release credentials or checking out that run's commit. Eligible publishing jobs run one at a time without cancelling an active publication. Waiting eligible jobs do not replace one another; ineligible runs neither join the queue nor displace eligible jobs. Once admitted, each checks that its commit is still the tip of `main` and applies the pause checks before publishing. This does not make npm publication and the subsequent Git push atomic. External actions used by the publishing job are pinned to full commit SHAs. ^updates-publish-eligibility

## Lockstep contracts need no compatibility discipline

The server→client and client→server shapes defined in this domain (the version advertisement, the update-state relay and the update telemetry signals, all on the `/events` websocket) are **internal contracts that ship in lockstep with the web bundle**. The server serves the bundle, and auto-reload ([version-advertisement.md](./version-advertisement.md)) restores a matched pair after a server upgrade. So these shapes carry no schema versioning and no requirement to tolerate unknown variants, and may change freely between releases. In the brief mismatch window between a server restart and the client's reload, neither side may crash; the client ignores `/events` messages it does not recognize ([version-advertisement.md#^unknown-messages](./version-advertisement.md#^unknown-messages)). ^updates-lockstep-contracts

Contracts consumed across releases take the opposite posture. The public update channel's readers are old installs by definition, so it has a strict evolution protocol ([update-channel.md#Evolution protocol](./update-channel.md#Evolution protocol)). The installed desktop shell's pre-page identity contracts are also outside the lockstep; [desktop-upgrade-gate.md#^pre-gate-handshake](./desktop-upgrade-gate.md#^pre-gate-handshake) owns their compatibility discipline so that an admitted shell can reach the served gate. The desktop app's update operations on the native preload bridge, which the gate calls, are consumed across releases too; [desktop updates](../desktop/updates.md#^desktop-updates-frozen) keeps them stable.

## Module map

| Spec | Owns |
|---|---|
| [version-advertisement.md](./version-advertisement.md) | the server's version surfaces, the web bundle's version stamp, interface cache headers, and client auto-reload with its loop guard |
| [update-channel.md](./update-channel.md) | the public update-channel file and its evolution, server-side polling, the relay of update state to clients, the server notice's contracts and dismissal, and channel deploys |
| [desktop-self-update-notice.md](./desktop-self-update-notice.md) | the notice that tells a downloaded desktop app's user an update has downloaded |
| [desktop-upgrade-recommendation.md](./desktop-upgrade-recommendation.md) | the deprecated recommendation that moves apps installed from npm to the downloaded app |
| [desktop-upgrade-gate.md](./desktop-upgrade-gate.md) | the desktop upgrade gate: the cross-release shell entrance, the required desktop version and how it is raised, the boot barrier, and the gate screen |

Two runbooks ([spec-policy.md#^runbook-type](../../spec-policy.md#^runbook-type)) exercise these mechanisms: [runbook-channel-deploy.md](./runbook-channel-deploy.md) for announcing a release on the channel, and [runbook-ux-staging.md](./runbook-ux-staging.md) for staging every user-visible update state for design review.

## Telemetry

This domain's four events (*client autoreloaded*, *update toast shown*, *update prompt copy clicked*, *desktop upgrade gate shown*) split their authority three ways. Their names, properties and validation patterns belong to the closed vocabulary in [arch/telemetry/index.md](../telemetry/index.md), a privacy guarantee whose value is one complete reviewable list. Their transport is the shared telemetry client signal ([client-signals.md](../telemetry/client-signals.md)). When and why each fires is owned by the module spec for the mechanism it observes. ^telemetry-split

## Inputs to proof derivation that the spec does not otherwise show

### Coverage owned by another spec

- The [version advertisement](./version-advertisement.md#Web bundle version) spec owns coverage of the built web stamp.
- [Product CLI](../../product/cli.md#Command model, help, version, and recovery text) owns coverage of the packaged `tv --version` and running-server `tv status` outcomes.
