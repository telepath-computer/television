# Trim review context: updates area, round 2

## Area and specs

Area: updates and versioning. The trimmed specs are `specs/product/update-notifications.md`, `specs/product/versioning.md`, and every Markdown file in `specs/arch/updates/` (`index.md`, `update-channel.md`, `desktop-upgrade-gate.md`, `desktop-upgrade-recommendation.md`, `desktop-self-update-notice.md`, `version-advertisement.md`, and the runbooks `runbook-channel-deploy.md` and `runbook-ux-staging.md`). `specs/arch/updates/update-channel.json` is the master copy of a public file and was not edited.

## Base commit

`f6cdd91e417e1f94c8617baebb016e921c21d6e5`. See the whole trim with `git diff f6cdd91e..HEAD`; the round-1 context is `docs/working/spec-tightening/trims/updates/round-1-context.md`.

## Previous review

`docs/working/spec-tightening/trims/updates/round-1-review.md`.

## Responses to round 1 findings

1. **Addressed.** `specs/ui/app/desktop-upgrade-gate/index.md` line 29: both links now point at the renamed `#Inputs to proof derivation that the spec does not otherwise show` sections (link text only). A search finds no other `#Testing` link into the area's specs.
2. **Addressed.** `update-channel.md` `^toast-render` no longer describes the desktop handler; it points at the owning [desktop external-link contract](../desktop/index.md#External links), which keeps the HTTP(S) restriction.
3. **Addressed, flagged for the architect.** The product's `^channel-silent-failure` now says that on a failed or broken channel the user sees no channel error, and no toast unless the server still holds an earlier valid notice, citing `^poll-silent-failure`. The update-channel introduction no longer says "everyone sees nothing"; it says a missing or broken file is never shown as an error. This aligns the product text with the arch spec and the code (the poller keeps the last-known-good document). Because it rewords a product statement, the review document lists it for Josh to confirm.
4. **Addressed.** `versioning.md` `^pv-machine-boundary` is now a one-line reference to the CLI's `tv status` rule (`product/cli.md#Server lifecycle commands`). The anchor stays because test comments cite it.
5. **Addressed.** The telemetry sections of `update-channel.md`, `desktop-upgrade-gate.md` and `version-advertisement.md` no longer list "exactly" which properties each event carries; they point at `client-signals.md` for the declared properties, and keep what each property's value is, when the event fires, deduplication and the halted-boot behavior.
