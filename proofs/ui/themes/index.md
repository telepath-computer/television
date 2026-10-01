*How the authoritative bundled theme inventory is proven through package generation and delivery.*

# Bundled themes — proof

Proves [specs/ui/themes/index.md](../../../specs/ui/themes/index.md).

The inventory has no independent UI behavior, and this proof does not duplicate version literals from its authoritative YAML. [Runtime generation](../../arch/themes/bundled-installation.md#^bundled-t-manifest-generation) proves that YAML records become runtime data; [source declarations](../../arch/themes/bundled-installation.md#^bundled-t-color-scheme-versions) pair each minimum with the required source version and color scheme; [build validation](../../arch/themes/bundled-installation.md#^bundled-t-build-validation) proves package membership and minimum versions. [Design copying](../../arch/themes/bundled-installation.md#^bundled-t-package-copy) checks matching stylesheets and assets, while [server copying](../../arch/themes/bundled-installation.md#^bundled-t-server-copy) and [CLI copying](../../arch/themes/bundled-installation.md#^bundled-t-cli-copy) prove distribution copies. [Theme selection acceptance](../../product/themes-and-appearance.md#^theme-ac-selection) proves that a fresh installation offers those packages and the unthemed choice. Individual theme proofs retain visual-design scope.
