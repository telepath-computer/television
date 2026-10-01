# Desktop connect links: task record

Working record for `thopter/desktop-connect-links`. Not authority. The approved intent is [proposal.md](./proposal.md), approved by Josh for spec authoring only (not implementation).

## Method

- Specs are written fresh from the proposal. From prerelease PR #387 (`telepath-computer/television-prerelease-archive`, `feat/new-onboarding` at `1fedba8`), only visual design authority is imported: the markup and styling of `specs/ui/setup/setup.frame`, `specs/ui/app/system-modal/system-modal.frame`, the artifact-frame and copy-button frame parameters, the large button and input sizes and the `--line-control-lg` token, and the workshop frames that stage them. No product, architecture or UI prose, testing directive or copy decision is taken from that PR.
- Reviews: Codex CLI, `gpt-6-astra`, `xhigh` effort, fresh process, read-only; the brief points the reviewer at the proposal.

## Obligations carried to implementation

- `specs/arch/updates/runbook-ux-staging.md` step 4 names the old connect window and "Connect to server…". Update it once the shell implements the setup screen and Disconnect from Server, executing the new steps before editing.
- `packages/skills/skills/television/src/app-shell-reference.md` documents the token form's markup for theme authors; it changes with the implementation.
- Publishing the updated admin guide to `television.run/install.md` happens after merge, no later than the desktop release that ships the setup screen.

## Review record

(none yet)
