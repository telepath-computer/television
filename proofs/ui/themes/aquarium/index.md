*Aquarium theme package and stylesheet-copy coverage.*

# Aquarium theme (UI) — proof

Proves [specs/ui/themes/aquarium/index.md](../../../../specs/ui/themes/aquarium/index.md).

## Coverage model

This imported theme orders no new behavioral assertions. Existing [bundled installation coverage](../../../arch/themes/bundled-installation.md) checks package validity and stylesheet copies; [theme delivery coverage](../../../arch/themes/delivery.md) owns sandboxed script loading. The original animation is copied unchanged, not independently behavior-verified by these checks.
