# Round 2 context: core area

**Area:** core. **Specs:** specs/product/artifacts.md, specs/product/channels.md, specs/product/tab-pages.md, specs/product/artifact-navigation.md, specs/product/keyboard-navigation.md, specs/arch/channel-state/index.md, specs/arch/layout/index.md, specs/arch/layout/migration.md.

**Base commit:** f6cdd91e417e1f94c8617baebb016e921c21d6e5. See the whole trim with `git diff f6cdd91e..HEAD -- specs`; this round's changes alone are `git diff e69d79e8..HEAD -- specs`.

**Previous review:** docs/working/spec-tightening/trims/core/round-1-review.md (no blocking findings, two non-blocking).

**Responses to round 1 findings:**
1. *Duplicated selection rules in channel-state "The client state layer".* Addressed. The `^cs-selection-memory` bullet now places the in-memory map in the client state layer and refers to tab-pages.md for its behavior, including that it is never persisted. The persistence prohibition is no longer claimed by channel-state.
2. *TV-549 tracking sentence in channels.md Identity.* Addressed. The tracking sentence is removed; the accepted caller-supplied-id limitation stays. The status line had already been reduced to name the gap without the ticket.

Please review the whole trim again, not only these two changes.
