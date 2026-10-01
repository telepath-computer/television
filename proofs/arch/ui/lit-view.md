*How the promises in lit-view are proven.*

# lit-view — proof

Proves [specs/arch/ui/lit-view.md](../../../specs/arch/ui/lit-view.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Test assertions

Shared contract declaration ([../testing-policy.md#^declaration-schema](../../../specs/arch/testing-policy.md#^declaration-schema)): the five cited assertions below exercise the real `View` module and real lit-html directive machinery under jsdom, using authored probe subclasses, host arguments, and external state as fixtures. jsdom replaces the browser DOM and therefore forfeits real-browser node and iframe behavior to [#^lv-t-browser-stable-node](#^lv-t-browser-stable-node). No other mechanism is mocked and no test hook is used. These tests were authored alongside this spec and module under the testing policy, so their plain citations are policy-grade cited.

- **Contract** (shared module boundary above): `view(Class)` gives each bound child position one reusable instance; host renders pass the latest arguments to `template()`, argument changes derive fresh output, and the default template leaves the committed value unchanged — *covered by `packages/utils/test/lit-view.test.ts` “derives output from template() with host arguments”, “re-derives on new host arguments”, “a bare subclass renders nothing”, and “separate positions get separate instances”*. ^lv-t-host
- **Contract** (shared module boundary above): first attachment calls `connected()` once, ordinary host renders do not call it again, removal calls `disconnected()`, and returning from a cached swap calls `connected()` for the next attachment period — *covered by `packages/utils/test/lit-view.test.ts` “connected() runs once across host re-renders”, “disconnected() runs when the view leaves the tree”, and “a cached swap pauses and resumes: connected() again on return”*. ^lv-t-lifecycle
- **Contract** (shared module boundary above): bare `render()` commits `template()` with stored host arguments, `render(value)` commits that value, and calls while detached or during the host render are safe no-ops; a synchronous notification from first `connected()` is carried exactly once by the host result — *covered by `packages/utils/test/lit-view.test.ts` “render() commits template() from outside a host render”, “render(t) commits the given template”, “render() after removal is a safe no-op”, “render() during a host render defers to the host result”, and “a synchronous notification during connected() defers to the host render”*. ^lv-t-commit
- **Contract** (shared module boundary above): reconnection without a host render commits current state in the deferred microtask; a same-pass host render carries that state once; disconnecting cancels a pending catch-up; and rapid reconnects coalesce to one commit — *covered by `packages/utils/test/lit-view.test.ts` “reattachment without a host render catches up in a microtask”, “a synchronous notification during reconnection commits once, with current state”, “a disconnect before the catch-up flushes cancels it”, and “rapid reconnects before the flush coalesce to one commit”*. ^lv-t-reconnect
- **Contract** (shared module boundary above): when `template()` returns the same owned node across host renders, the committed node keeps its identity and imperative mutations while receiving the latest host argument — *covered by `packages/utils/test/lit-view.test.ts` “a stable node returned from template() keeps its identity and mutations”*. ^lv-t-stable-node
- **Seam** (a `View` returning one owned iframe to lit-html's real `ChildPart`, crossed in a real browser; an authored same-origin iframe document and host arguments are fixtures; no mocks or test hooks): after the iframe has loaded and acquired document state, rerendering the host with new arguments preserves the iframe node, its `contentWindow`, and that state without another document load — *(covered by test: `packages/web/test/e2e/lit-view-stable-iframe.test.ts` “preserves an owned iframe across host rerenders”)*. ^lv-t-browser-stable-node

Coverage relationship: the contract and browser seam prove the base class and browser commit behavior once. The real production artifact-frame composition and its live-document outcome remain [product/artifacts.md#^af-ac-tab-continuity](../../product/artifacts.md#^af-ac-tab-continuity)'s acceptance spine; surface rows do not need to repeat the base lifecycle matrix.

