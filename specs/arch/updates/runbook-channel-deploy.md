*Runbook: announcing a curated release on the update channel — authoring and deploying `update-channel.json`, bumping the required desktop version when the release needs it, and verifying the deploy.*

**Plain english:** this is the step-by-step process a release manager (human or agent) follows when a Television release is worth announcing to users: write the small JSON notice in the Television repository, copy it to television.run, and — for the rare release that requires a desktop-app upgrade — bump the server's required desktop version so outdated desktop apps show the upgrade gate.

# Runbook: deploying an update-channel notice

This is a *runbook* ([spec-policy.md#^runbook-type](../../spec-policy.md#^runbook-type)): authoritative for the procedure, derived from the mechanism specs it cites — [update-channel.md](./update-channel.md) (the channel file, validation, polling, operations), [desktop-upgrade-gate.md](./desktop-upgrade-gate.md) (the requirement and the gate), [product/update-notifications.md](../../product/update-notifications.md) (what users experience), and [product/versioning.md](../../product/versioning.md) (how a release number is communicated). On conflict, those specs win.

## When to run this

A channel deploy is a deliberate human decision, per release worth announcing — most releases never appear on the channel ([product/update-notifications.md#^channel-curated](../../product/update-notifications.md#^channel-curated)). Run this when a release matters enough that users should hear about it, and additionally follow the [required-desktop-version steps](#3-if-the-release-requires-a-desktop-upgrade-bump-the-requirement) when the release includes a desktop shell change users must take. To publish a merged change to the master copy that users should see before the next announcement, such as updated desktop instructions, follow steps [4](#4-publish) and [5](#5-verify-the-deploy).

## 1. Author the document

Write the channel document ([update-channel.md#The channel file](./update-channel.md#The channel file)) in its master copy, [update-channel.json](./update-channel.json) ([update-channel.md#^channel-master-copy](./update-channel.md#^channel-master-copy)), in a Television pull request, under [the authoring rules](./update-channel.md#^ops-author):

```json
{
  "schemaVersion": 1,
  "version": "<the announced release, x.y.z>",
  "toast": {
    "markdown": "<short notice; links allowed — they open externally>",
    "prompt": "Please upgrade my Television server following https://television.run/install.md"
  },
  "desktop": {
    "upgradeMarkdown": "<how gated users should update, kept current under the authoring rules>"
  }
}
```

The pull request's CI checks the master copy against [update-channel.md#^channel-validation](./update-channel.md#^channel-validation): a document that fails shape validation is **silently ignored by the entire fleet** ([update-channel.md#^poll-silent-failure](./update-channel.md#^poll-silent-failure)).

## 2. Dry-run against a staging URL

`TV_UPDATE_CHANNEL_URL` is an operational override honored in every build, exactly for dry-running a deploy ([update-channel.md#^channel-url-override](./update-channel.md#^channel-url-override)). Serve the authored document locally and point a real server at it:

```bash
# from specs/arch/updates in the Television checkout, which holds the master copy:
python3 -m http.server 8399 --bind 127.0.0.1
# any Television server, even a release build:
TV_UPDATE_CHANNEL_URL=http://127.0.0.1:8399/update-channel.json tv serve ...
```

Open the server in a browser and confirm the toast renders as intended (markdown, links, copy button). [runbook-ux-staging.md](./runbook-ux-staging.md) has fuller staging recipes, including the gate.

On a developer host, keep `~/.tv-developer` in place while dry-running: it has no effect on channel polling ([update-channel.md#^dev-marker-no-bypass](./update-channel.md#^dev-marker-no-bypass)), and telemetry follows the [authoritative rules](../../product/telemetry.md#^telemetry-rules).

The dry-run works for persisted daemons too: `tv serve --persist` captures `TV_UPDATE_CHANNEL_URL` and `TV_UPDATE_CHANNEL_POLL_INTERVAL_MS` from the installing shell into the daemon's environment ([update-channel.md#^hook-persist-capture](./update-channel.md#^hook-persist-capture)), so installing with the override set stages the daemon against the local channel; rerun `tv serve --persist` without it to return to production polling.

## 3. If the release requires a desktop upgrade: bump the requirement

The *required desktop version* is `REQUIRED_DESKTOP_VERSION` in `packages/server/src/required-desktop-version.ts` ([desktop-upgrade-gate.md#^required-desktop-constant](./desktop-upgrade-gate.md#^required-desktop-constant)). When the release needs it raised:

1. Follow steps 1–4 of [the gate's procedure](./desktop-upgrade-gate.md#^ops-bump): raise the constant in the pull request that makes the change, with publishing paused, then release the desktop app and resume publishing. At merge time, also follow the release-specific compatibility record next to it ([desktop-upgrade-gate.md#^ops-first-gate](./desktop-upgrade-gate.md#^ops-first-gate)).
2. Write the `desktop.upgradeMarkdown` block in step 1 for this release's sequencing, as [the authoring rules](./update-channel.md#^ops-author) describe.

## 4. Publish

When the release raises the required desktop version, finish [step 3](#3-if-the-release-requires-a-desktop-upgrade-bump-the-requirement) first and publish only once the release is on npm ([desktop-upgrade-gate.md#^ops-release-order](./desktop-upgrade-gate.md#^ops-release-order)). Publish the document to the production channel URL — `https://television.run/update-channel.json` ([product/update-notifications.md#^channel-url](../../product/update-notifications.md#^channel-url)) — **and to every other supported channel URL** if a breaking schema change has ever added one ([update-channel.md#^evolution-new-url](./update-channel.md#^evolution-new-url)); while only v1 exists, that is the one URL.

Copy the master copy from merged Television `origin/main` into the site repository, as [update-channel.md#^channel-master-copy](./update-channel.md#^channel-master-copy) sets out. In that repository the file is `site/public/update-channel.json`, in the Vite public directory served at `https://television.run/update-channel.json`. A DigitalOcean GitHub app auto-deploys the site from its `main`, so **merge = deploy** — there is no separate deploy command. Agents stage the change on a `thopter/*` branch and open a pull request into the site's `main`; merging it publishes the document.

```bash
# in the Television checkout: fetch main and note the commit being published
git fetch origin main && git rev-parse origin/main
# in the site checkout, on a branch from its latest main:
git -C <television-checkout> show origin/main:specs/arch/updates/update-channel.json > site/public/update-channel.json
git diff --stat   # no change means the site already serves this master copy
```

## 5. Verify the deploy

```bash
# in the Television checkout, with the commit published in step 4:
curl -s https://television.run/update-channel.json | cmp - <(git show <commit>:specs/arch/updates/update-channel.json) && echo IDENTICAL
```

- Confirm the plain channel URL, with no query string, serves the master copy at the published commit byte for byte. Each site deployment invalidates the CDN's cached copy, so a match shows the new document reached the edge. A cache-busting query does not check the cached response at the plain channel URL, so it does not verify the deploy.
- Expect propagation within one poll interval, as [update-channel.md's operations](./update-channel.md#Operations) describe; there is no push and no fleet-wide force-refresh.
- Optionally confirm end-to-end with a real server pointed at the **production** URL on a non-developer host, or via the dry-run hook against the now-live document.

## Retracting

Retract a toast, or only its desktop instructions, by changing the master copy as [update-channel.md#^ops-deploy](./update-channel.md#^ops-deploy) describes, then publish and verify as in steps 4 and 5.
