*Proves the bundled Table package, store contract, page dependencies, icon and agent guidance.*

# Table artifact template — proof

Proves [specs/arch/templates/table.md](../../../specs/arch/templates/table.md).

## Assertions

- **Contract.** Under [Store](../../../specs/arch/templates/table.md#store), the pure Table model accepts an empty `rows` object and arbitrary JSON cells, rejects a malformed root, rows or orders, sorts by numeric `order` and then key, and removes `order` from visible cells without changing its input. It derives columns from every base row in first-seen order, searches stringified cell values only, compares numeric pairs numerically and other pairs as natural text, keeps empty cells last, and returns stored order when no page sort is active. *(policy-grade tests: `packages/server/test/table-model.test.ts`)* ^templates-table-t-model
- **Contract.** Under [Store](../../../specs/arch/templates/table.md#^bundled-artifact-template-table-store), the packaged manifest declares the exact stated `dataSchema`, the seed is exactly `{"rows":{}}`, the page exists, and the manifest leaves `display` absent for the shared default. *(policy-grade test: `packages/server/test/table-template.test.ts`)* ^templates-table-t-package
- **Contract.** Under [Packaged page and guidance](../../../specs/arch/templates/table.md#packaged-page-and-guidance), `index.html` loads the canonical stylesheet before the local stylesheet and loads canonical components. *(policy-grade test: `packages/server/test/table-template.test.ts`)* ^templates-table-t-assets
- **Contract.** Under [Packaged page and guidance](../../../specs/arch/templates/table.md#^bundled-artifact-template-table-page), the manifest has one SVG icon entry, package validation accepts it, and icon selection returns that file with the SVG content type. *(policy-grade test: `packages/server/test/table-template.test.ts`)* ^templates-table-t-icon
- **Contract plus review.** Under [Packaged page and guidance](../../../specs/arch/templates/table.md#^bundled-artifact-template-table-readme), review establishes the README meaning. File checks keep the store terms, concrete scoped commands, page-only search and sort, live no-write rule, invalid-data rule, adaptation stylesheet and independent-copy guidance present. *(policy-grade test: `packages/server/test/table-template.test.ts`)* ^templates-table-t-readme

The [Table UI proof](../../ui/templates/table.md) owns the real running page, resource SDK, Toolbox creation, live writes, read-only and access-loss behaviour, disconnection, unavailable saved data, appearance and conformance to the stories.
