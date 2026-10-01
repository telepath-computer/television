---
name: pr-writing
description: >-
  Write or revise pull request descriptions for squash-merge review, explaining the final net change
  against the merge base with the actual target branch rather than development history.
---

# PR writing

Write for a capable reviewer who sees the final squash diff and the PR's base branch. Describe the complete net change against the merge base with that actual target. For stacked PRs, the target is the predecessor branch: explain only this PR's own diff.

Explain the system change, not merely the changed files or "implements feature X." Scale detail to the change, giving enough context to understand what it is, how it works, its important moving parts, and why significant decisions make sense. Cover relevant architecture, runtime behavior, primary mechanisms and tools, technologies or dependencies, data flow, module design, and integration boundaries. Include cross-file invariants or relationships the diff does not make obvious. When relevant, discuss how policies and conflicts between the branch and its target were reconciled.

Organize around the final behavior, architecture, validation, and important decisions. Neither the latest incremental edits nor the sequence of branch work describes the full result the reviewer must assess.

## Write for the visible diff

Apply [cold-reader](../cold-reader/SKILL.md) and [plain-English](../plain-english-full/SKILL.md), including the cold-reader self-audit search before publishing.

Comparisons with the base are useful when both sides appear in the review: "removed flag `--foo`" works if the flag exists in the base and its deletion is visible. Intermediate commits, reverted renames, design conversations, and abandoned implementations are unavailable to the squash reviewer. Do not describe replacing code absent from the squashed diff or compare with an unshipped alternative.

Explain rationale positively: "Library X provides Y." Include it when a reviewer would plausibly wonder about the choice. Rationale that depends on discussing an alternative absent from the final diff belongs in design records or the relevant incremental commit, not the PR body.

State what was actually validated and any material limits. Never imply an unperformed check passed.

## Publish exact text

Treat the body as publication content. Draft long-form PR text in a plain temporary Markdown file exactly as reviewers should read it, with actual newlines and no diff markers, patch prefixes, or shell interpolation. Send that file through a file-based GitHub API path, then verify the stored body. Never compose PR prose inline in shell commands or reuse patch-formatted text as the body.
