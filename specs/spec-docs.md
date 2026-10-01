*The repository docs folder: guides, working documents, and the archive; what each holds, what standing it has, and the pre-merge docs prep that moves documents from working to archived.*

# Docs

The `docs/` folder holds the repository's documents that are not specs, proofs, or code: the guides people read, the working documents a task writes while it is in flight, and an archive that carries salient working documents into the squash-merge commit of the change they informed. This spec says what goes where, what standing each part has, and how documents move from working to archived when completed work is prepared to merge. Nothing under `docs/` is authority in its own right.

## Layout

```
docs/
  README.md          points readers here; states no rules of its own
  guides/            the administrator guide
  working/           documents for work in flight; empty on main
  archive/
    YYYY-MM/         working documents included with a merge, by month
```

The namespace is open: further folders may be added under `docs/` as needs arise, each described here when it is added.

## Standing

Nothing under `docs/` is authority in its own right. This spec governs where guides live, not what they say: guide content follows the applicable specs under [spec-policy.md](spec-policy.md), and a guide carries procedural authority only where an owning spec grants it, as [arch/cli/admin-guide.md](arch/cli/admin-guide.md) does. Working documents and the archive have no standing of any kind.

## Working documents

A *working document* is anything a task writes to think or to record while the work is in flight: a proposal, a plan, a ledger, saved review findings, a task record. `docs/working/` is the default place for them, in any shape, with no review obligation. Their writing purpose is the context-dependent one the [cold-reader skill](../developer-skills/cold-reader/SKILL.md) describes for temporary task records. A *proposal* is a working document that explores a change before its decisions are written into the specs. A *note* is any working document.

`docs/working/` is empty on `main`. Pre-merge docs prep, below, is what empties it.

## Archive

The *archive*, `docs/archive/`, holds salient working documents that informed a change, in one directory per month named `YYYY-MM`. They are included when the change is squash-merged so that its commit preserves them in Git history. Archive contents may be deleted periodically because Git history preserves them. Pre-merge docs prep continues to use this folder for subsequent changes. A group of documents that belongs together may keep its internal structure in a named subdirectory of the month.

Once archived, a document is nobody's job to keep updated. Its content is expected to grow increasingly stale relative to the current system. Paths, identifiers, and concepts reflect its working context at the time; their drift after later changes is expected, not rot. Read it in the current tree or in the squash-merge commit of the change it informed when you want to know how a past change came about. A document is archived when the PR that moves it merges. Until then, the files under `docs/archive/` on the branch are part of the change under review, like every other file in the PR. ^docs-archive

A root `.ignore` file lists `docs/archive/` so ripgrep and the ripgrep-based search tools in coding agents skip it by default. Other search tools and editors still see the archive. Archived files stay fully visible in PR diffs on purpose: the PR that archives a document shows the human what the agent judged worth keeping.

## Pre-merge docs prep

*Pre-merge docs prep* is the cleanup performed once the work is complete, before the contribution is considered ready to merge into a [shared branch](spec-workflow.md#^shared-branch-workflow). Work-in-progress and draft pull requests keep their working documents. The timing of human spec review does not trigger this cleanup. The agent preparing the completed work for merge:

1. Archives a working document when it holds something a reader of the merged PR, the specs it changed, and its linked ticket could not rebuild. Two kinds qualify. A record that exists nowhere else: a rejected alternative and why, a ruling that shaped a spec, a decision the PR description only states. And a synthesized whole that the diff cannot give back: a proposal is a coherent statement of intent even when every assertion in it reached a spec, and a plan is the one coherent view of the work's shape. A document whose purpose was reaching a checkpoint is deleted once the checkpoint is passed: implementation notes, review findings, investigation notebooks, and task records that track status or restate the PR, however much work they represent. The default is deletion. The preamble's second sentence says what the reader finds here and nowhere else; a document for which that sentence cannot be written is deleted.
2. Adds the preamble below to each selected document and moves it to `docs/archive/YYYY-MM/`, where the month is the document's last substantive edit or the month of archiving, whichever is simpler. The month is not litigated. Original filenames are kept; a collision inside a month takes a suffix.
3. Deletes the rest, leaving `docs/working/` empty.

Revisions after prep may create working documents again; prep then repeats once that work is complete, before the contribution is considered ready to merge. The [workflow](spec-workflow.md#Pull requests and human revisions) names this step in merge preparation; this spec defines it. ^pre-pr-docs-prep

### The preamble

Each archived document begins with a short block written by the agent archiving it:

```markdown
> **Archived YYYY-MM from PR #n.** One or two sentences: what this document was in the process (proposal, plan, ledger, review), and how the outcome relates to it: followed as written, followed with deviations in some area, superseded by a named spec or later document, or abandoned; the preamble's second sentence also says what the reader finds here and nowhere else. The body below is unchanged from its working state and is a clue to the change, not a record of it.
```

When no PR exists yet, the branch name stands in for the PR number. The preamble has the same standing as the rest of the file: none. A group archived together may carry one preamble on its top-level document.

## Why it is arranged this way

Two things went wrong with working documents before this folder existed. The repository squash-merges and deletes branches, so a task record created and deleted inside one PR never reached a squash commit and was unreachable once the branch was gone. And anything left in the tree was present in every checkout: searches hit it, agents read it as current guidance, and reviews raised findings against it, despite instructions to ignore it.

The archive is in the tree rather than on a separate branch because the human wants to see, in the PR that archives a document, what the agent judged significant, and because the squash-merge commit then preserves those documents alongside the change, even after a later cleanup deletes them from the current tree. An in-tree archive needs a mechanical search exclusion, hence the `.ignore` entry, and one plain statement that archived documents are nobody's job to keep updated. The record of a change is its specs, its PR, and its commits; the working documents that produced them were never kept in step with the outcome.
