*Proves the shipped Example template's package, initial value, and live page behavior.*

# Bundled artifact template — proof

Proves [specs/arch/templates/bundled-templates.md](../../../specs/arch/templates/bundled-templates.md).

## Coverage model

The package check reads the real Example source. A browser opens an artifact created from it against a running server and real resource store, then an agent-style `tv resource json` write changes the visible text. This walks the only bundled page's main use without mocking its resource connection. The ordinary copy and seed rules are covered by [template architecture](./index.md); build membership and minimum versions are covered by [bundled installation](./bundled-installation.md). Visual polish is judged in browser review.

## Test hooks

No production test hook is needed.

## Assertions

- **Contract** (real bundled source and manifest): Under [the specified behavior](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-inventory), the closed bundled-ID tuple is `['example']`, the folder's name, description, initial and minimum versions match the spec, `data.json` contains the specified `message`, and `README.md` gives the adapting agent the store command and field meaning. *(policy-grade test: `packages/server/test/bundled-template-installation.test.ts`, cases tagged `^templates-example-t-package`)* ^templates-example-t-package
- **Acceptance** (real browser → running server → copied Example artifact and resource store; no mocks except the standard CSS-motion override, which forfeits motion only): Under [the specified behavior](../../../specs/arch/templates/bundled-templates.md#^bundled-artifact-template-example), the page loads the canonical stylesheet, shows the seeded message as text, and changes the open page when a spawned `tv resource json` command writes another message; the page itself provides no edit action. *(policy-grade test: `packages/web/test/e2e/template-example-real-stack.test.ts`, cases tagged `^templates-example-ac-live`)* ^templates-example-ac-live
