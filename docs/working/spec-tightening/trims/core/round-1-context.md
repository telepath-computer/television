# Round 1 context: core area

**Area:** core (the core model: artifacts, channels, tab pages, navigation, channel state, layout).

**Specs in this area:**
- specs/product/artifacts.md
- specs/product/channels.md
- specs/product/tab-pages.md
- specs/product/artifact-navigation.md
- specs/product/keyboard-navigation.md
- specs/arch/channel-state/index.md
- specs/arch/layout/index.md
- specs/arch/layout/migration.md

**Base commit:** f6cdd91e417e1f94c8617baebb016e921c21d6e5 (`git merge-base HEAD origin/thopter/spec-tightening`). See the trim with `git diff f6cdd91e..HEAD -- specs`.

**Approach the trimmer took.** These specs were already fairly lean, so the trim is conservative. The main kinds of change:
- cuts of backlog and future-work references (TV-524, TV-525, the drag-by-frame milestone, "if these states are designed later", the multi-artifact label formula, the Discord announcement);
- cuts of history (why each retired browser-persisted field was retired; "the redesign changes the semantics of layout, not the location of authority");
- cuts of restatements whose owner is linked (tab-pages' continuity paragraph and Keyboard navigation section; artifacts' Navigation details; layout's "Migration from version 1" section; keyboard-navigation's Non-goals; the successor rule restated in channel-state; the atomic-write mechanics restated in the display-field step of migration.md);
- one cut of a statement describing what the model does not have (`^ly-no-splits` in layout/index.md);
- rewording for plain English and condensation without intended change of meaning.

No block ref that anything cites was removed, so no citation needed repointing. `## Testing` headings were kept because many other specs cite them by heading.

**Code checks done.** The trimmer checked the main claims against code. Findings that are not edits (to be reported, not fixed): a folder path artifact saved without a trailing separator gets no watch; a caller-supplied duplicate channel id silently replaces the existing channel; the display-state write is all-or-nothing although `^cs-display-partial` says each field's validation applies on its own; navigating to an artifact's home keeps the forward trail; version-1 channel records are migrated only on a serving boot (a token-only startup skips the migration and its loader drops version-1 records).
