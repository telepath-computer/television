# Pre-initialized storage fixture

The declared checked-in fixture for
proofs/product/onboarding/onboarding-channels.md#^ac-preinit-focus: a storage
directory initialized by the token-only path without ever serving. Authored to
exactly that path's output — the storage directory structure plus
`state/token`, and nothing else: no channels, no display state, no onboarding
state, no artifacts (specs/arch/onboarding/installer.md#^token-only-boot).

Git cannot track empty directories, so the acceptance test recreates the empty
directory skeleton (`state/channels/`, `state/artifacts/`, `themes/`,
`artifacts/`) when materializing the fixture into a temp storage path.
