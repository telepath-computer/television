*How the promises in Nord theme (UI) are proven.*

# Nord theme (UI) — proof

Proves [specs/ui/themes/nord/index.md](../../../../specs/ui/themes/nord/index.md).

## Coverage model

This theme is a stylesheet-only surface with no markup, state, or interaction. Visual fidelity, including leaving browser `color-scheme` to the manifest-driven foundation, remains a staging and review judgment under [arch/testing-policy.md#^ui-styling-out](../../../../specs/arch/testing-policy.md#^ui-styling-out). Production crossing is covered by the [bundled-theme package-copy seam](../../../arch/themes/bundled-installation.md#^bundled-t-package-copy) and the foundation stylesheet crossing. This proof therefore orders no direct test assertions.
