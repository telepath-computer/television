*How the promises in Tokyo Night theme (UI) are proven.*

# Tokyo Night theme (UI) — proof

Proves [specs/ui/themes/tokyo-night/index.md](../../../../specs/ui/themes/tokyo-night/index.md).

## Coverage model

This theme is a stylesheet-only surface with no markup, state, or interaction. Visual fidelity, including leaving browser `color-scheme` to the manifest-driven foundation, remains a staging and review judgment under [arch/testing-policy.md#^ui-styling-out](../../../../specs/arch/testing-policy.md#^ui-styling-out). Production crossing is covered by the [bundled-theme package-copy seam](../../../arch/themes/bundled-installation.md#^bundled-t-package-copy) and the foundation stylesheet crossing. This proof therefore orders no direct test assertions.
