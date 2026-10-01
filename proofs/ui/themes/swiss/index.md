*How the promises in Swiss theme (UI) are proven.*

# Swiss theme (UI) — proof

Proves [specs/ui/themes/swiss/index.md](../../../../specs/ui/themes/swiss/index.md).

## Coverage model

This theme changes styling only. Visual fidelity remains a staging and review judgment under [the testing policy](../../../../specs/arch/testing-policy.md#^ui-styling-out). Sidebar selectors apply only to the application. The primary accent and lighter dark surfaces are shared with live canonical artifact documents.

Production crossing is covered by the [bundled-theme package-copy seam](../../../arch/themes/bundled-installation.md#^bundled-t-package-copy). No additional direct styling assertions are required.
