*Proves the bundled Example manifest and its live page behavior with an unwritten or caller-supplied store.*

# Bundled artifact template — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

A contract reads the actual bundled files and checks the closed inventory and manifest schema.
One real-browser journey uses the installed Example through a production creation request and the served resource SDK.
It proves the empty-state default without a write, live agent updates, an empty string and non-string/missing data.
These few value changes reuse the open page and real CLI, rather than creating separate browser journeys.
The page has no edit action; the README explains how agents change data and detach before changing one page.
[Template architecture](./index.md) owns schema validation and creation mechanics, and [bundled installation](./bundled-installation.md) owns the build and boot crossings.
Template revision compatibility is assessed against retained accepted data during content review; Television does not compare schemas or migrate stores.
Only the standing CSS-motion override is allowed in the browser; it forfeits motion, which this page does not promise.

## Test hooks

No production test hook is needed; temporary homes and caller/store values are fixtures.

## Assertions

- **Contract** (bundled source files → package content check; no mocks): under [inventory](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory) and [Example content](../../../specs/arch/templates/bundled-templates.md#bundled-artifact-template), the tuple is `['example']`; the ID, name, description, initial/minimum versions and exact `dataSchema` agree with the spec; `url` and starting data are absent. The README explains the per-artifact message, resource command and copy/detach rule. *(test to be written)* ^templates-example-t-package
- **Contract** (real source manifest; no mocks): under [Example content](../../../specs/arch/templates/bundled-templates.md#bundled-artifact-template), the manifest omits `display`. *(policy-grade test: `packages/server/test/bundled-template-installation.test.ts`, “declares the sole Example with its minimum version, manifest, starting data, and adapting guidance”, no-display check only)* ^templates-example-t-no-display
- **Acceptance** (real browser → running server → installed Example and SDK, with built `tv resource json` commands): under [page behavior](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-example), a linked Example with an unwritten store loads the canonical stylesheet and displays “Hello from a template.” while the store remains unwritten. Caller data renders on a separately seeded creation; live CLI writes change the open page. HTML-like text stays text, an empty string displays empty, and absent/non-string `message` displays the default without writing it. The page provides no edit action. No mocks except CSS-motion disablement. *(test to be written)* ^templates-example-ac-live
