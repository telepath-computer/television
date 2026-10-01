---
name: cold-reader
description: >-
  Write or edit guides, READMEs, PR descriptions, specs, proposals, commit bodies, and code comments
  for readers without the development history. Use for "cold-reader policy", "forward-looking"
  documents, or requests to remove iteration-history framing and references to "old", "previous",
  "deprecated", or "removed" behavior the reader cannot see.
---

# Cold-reader policy

Write for someone who sees the document but did not attend the design conversation or watch implementation iterate. Describe what exists. Every reference should be findable in the document, its visible diff, or the current code or system; otherwise it makes the reader wonder about context they should not need.

## Establish what the reader can see

- **Guides and READMEs:** a user who installed today and knows no prior release.
- **PR descriptions:** a reviewer with the final squash diff against the PR's actual base branch and that base's state, without intermediate commits.
- **Specs and proposals:** an implementer or reviewer reading in isolation, without chat transcripts.
- **Commit messages:** someone using `git log -p` or `git blame`, with this commit's diff and message.
- **Code comments:** a maintainer reading the function in isolation, perhaps years later or after refactoring.

Ask: can this reader find every thing the text references? A fact known only from your reasoning, chat, or abandoned work is unavailable even if it feels established to you.

## Describe the present and make comparisons visible

Describe what is, without narrating what was considered, renamed, or removed unless the reader can see it. For phrases such as "Y not X", "X is removed", "instead of X", or "X is no longer supported", check whether X is visible. If it is not, state Y directly.

Comparisons work when both sides are available:

- "Removed flag `--foo`" in a PR when the flag exists in the base and its deletion is in the diff.
- An export rename in a migration guide or changelog whose purpose is to bridge versions.
- A comment comparing behavior with another real, current function.
- A spec referring to an earlier section of itself.

A squash reviewer cannot see an implementation abandoned during the branch's development. Compare against the base, even for a branch with a long history.

Explain useful rationale positively: "Library X provides Y." Unshipped library W adds no context to that statement. Rationale that requires discussing unshipped alternatives belongs in design or architectural decision records, internal notes, or the incremental commit recording the choice. Those records explicitly preserve history; user docs and PR bodies do not serve that purpose.

Migration sections may discuss prior behavior because their readers need it. Feature descriptions, API references, and conceptual overviews in the same document should still describe the present.

## Self-audit before publishing

Mechanically search the draft for these markers:

- `not`, `no longer`, `not yet`, `not currently`
- `instead of`, `rather than`, `in place of`, `as opposed to`
- `previously`, `formerly`, `used to`, `was`, `had been`
- `new`, `now`, `this change`, `this update`, `we now`
- `removed`, `deprecated`, `replaced`, `dropped`
- `we considered`, `we explored`, `we tried`, `we chose`
- `instead`, `however`

Inspect each hit for an invisible comparison; these words are signals, not automatic violations. Rewrite references the reader cannot resolve as statements of what exists.

Then read end-to-end. Search misses implicit baselines and structures that assume the reader watched the work. Check whether someone opening the document today would wonder about something unavailable to them. Repeated rewrites often leave stale "new system" framing. When replacing a paragraph, inspect the surrounding structure too; changing individual words does not repair an argument built around an unseen alternative.
