---
name: logical-merging
description: Merge a branch with another branch (typically `main`) using policy-level reconciliation, not just git's conflict list. Use whenever you run `git merge` or `git rebase` and want to avoid silent post-merge breakage. Treats git-flagged conflicts as one input among many, not the totality of the work.
---

# Logical Merging

Git's reported conflicts are textual collisions in files both sides edited. They are **not** a complete enumeration of the reconciliation work a merge requires.

A merge brings together two histories. Each history carries:

1. Specific code/spec changes git can detect when both sides edited the same lines.
2. Implicit **policies** — invariants, contracts, conventions, structural decisions — that the changes embody. Git cannot see any of this.

When the merge happens, the policies from each side apply to the **entire merged tree**, including parts the originating side never saw. Git flags none of it. If you only resolve the conflicts git surfaces and call it done, you have done the lazy merge: the textual collisions are gone, but the merged tree is logically incoherent.

## The silent-breakage classes

Each example below is a real merge problem git will not flag.

- **Main adds a new file in your policy's domain.** Your branch introduced a policy "every X must Y." Git: no conflict on the new file. Reality: the new file needs your policy applied or the policy is now violated in the merged tree.

- **Main adds a new caller of a function whose contract you changed.** Git: clean. Reality: the new caller passes the old shape and is broken.

- **Branch removes a type field; main adds a test asserting on that field.** Git: clean. Reality: the assertion now reads `undefined` and either silently passes or fails for opaque reasons.

- **Branch reworded a spec invariant; main added prose elsewhere in the same file that contradicts the reworded invariant.** Git: clean. Reality: the spec is self-contradictory.

- **Branch deleted a helper; main added a new use of it.** Git: clean (the helper still exists in main's view of the merge base). Reality: build fails or, worse, an alternative resolution silently restores the helper and undoes branch intent.

- **Both sides added a new file with overlapping responsibility (e.g., similar tests, similar config keys).** Git: no conflict — the files are independent. Reality: duplicate or contradictory definitions in the merged tree.

- **Branch changed an enum's variants; main added a new switch on that enum that doesn't list the new variants.** Git: clean. Reality: exhaustiveness lost; bugs are silent.

The pattern: **whenever a change embodies a policy, and the policy's domain is wider than the files that side touched, git cannot detect the gaps.**

## The reconciliation procedure

Do these steps in order. Do not skip ahead to git-flagged conflicts and pretend the rest will sort itself.

### 1. Establish the merge base and the two diffs

```bash
git fetch origin
MERGE_BASE=$(git merge-base HEAD origin/main)
git log --oneline $MERGE_BASE..origin/main      # what main added
git log --oneline $MERGE_BASE..HEAD             # what your branch added
```

Read both lists in full. For each commit, ask: what is the **intent** of this commit? Not "it changed file foo.ts" — what *behavior, contract, or convention* does this commit establish or modify?

### 2. Enumerate policies on each side

Write down, in plain language, the policies each side carries. A policy is anything of the form:

- "Every X must now Y."
- "Field Z no longer exists on type T."
- "Calls to F now require argument A."
- "Files matching glob G must include header H."
- "Tests in directory D must use harness E."
- "Spec section S now states invariant I."

Be explicit. If you cannot articulate the policy, you do not understand the change well enough to merge it correctly. Read the commit message, the diff, and (if needed) the surrounding code until you can.

### 3. Audit the merged tree against each policy

For each policy you enumerated:

- Identify its **domain** — the set of files, types, callers, specs, tests, configs, etc. that the policy applies to.
- Walk the merged tree and find every file in the domain. Specifically include files that were *added or modified by the other side* — those are the ones git cannot flag.
- For each, check: does this file honor the policy? If not, fix it.

Examples of how to audit:

- Policy "field `total` removed from semantic search response." Audit: grep for `\.total` near semantic search code paths in the merged tree, including new files from main. Any new test that asserts `output.total` for semantic search? Any new caller that reads it?

- Policy "all spec files must include section X." Audit: list spec files in the merged tree (including new ones from main); check each.

- Policy "function F's signature changed from `(a, b)` to `(a, b, c)`." Audit: grep for callers of F across the merged tree; check that each call site passes the new signature.

The audit is not optional just because the side that introduced the policy didn't touch a file — that's exactly the case where git is blind.

### 4. Resolve the git-flagged textual conflicts

Now (and only now) deal with the conflicted files git surfaces. For each:

- Read both sides since the merge base. `git log -p $MERGE_BASE..HEAD -- <file>` and `git log -p $MERGE_BASE..origin/main -- <file>`.
- Understand each side's intent for this file.
- Compose a merged version that expresses **both** intents — not a textual concatenation, not a pick-one-side. Often this means rewriting the section, not picking lines.
- If the two intents genuinely conflict (one wants behavior X, the other wants ¬X), surface the conflict to the human; do not silently pick.

Treat git-flagged conflicts as **one input** among the policy audit, not as the totality.

### 5. Verify

Build, type-check, test, lint — every gate the project supports — on the merged tree. A clean text resolution that fails the test suite is a failed merge.

For test failures specifically, do not "fix" them by editing tests to match new behavior unless you can articulate that the test was wrong before the merge or that the new behavior is intentional. Failing tests post-merge often indicate a missed policy reconciliation, not a stale test.

### 6. Document the reconciliation

The merge commit message must enumerate, in this order:

1. **Policies from your branch and how each was applied across the merged tree** — including any files added by main where the policy was applied.
2. **Policies/changes from main and how each was reconciled** against your branch.
3. **Per-conflicted-file resolution reasoning** — the textual conflicts, treated as the lowest-priority section.

A reviewer reading just the merge message should understand both *what* was reconciled and *why* the merged tree is now coherent. If your message has only section 3, you did the lazy merge.

## The lazy merge: what to avoid

The lazy merge looks like this:

1. `git merge origin/main`.
2. Git prints a list of conflicted files.
3. You open each, pick a side or hand-edit until conflict markers are gone.
4. `git commit`. Tests pass. Ship.

This produces a tree that compiles and may even pass tests, but is logically incoherent if any policy reconciliation was needed outside the conflicted files. It is the source of subtle production bugs that appear weeks later: "why does this new endpoint use the old auth pattern?" — because main added it after the branch refactored auth, and the merge never propagated the refactor to the new endpoint.

The tells of a lazy merge in review:

- The merge commit message only describes which files conflicted.
- Files added by either side are unchanged in the merge commit — they bypassed reconciliation.
- Conflict markers ever appeared in the working tree, even briefly, which is fine, but no audit trail follows.

## Heuristics

- **Reconciliation work scales with policy breadth, not file count.** A small textual conflict can hide a large reconciliation. A large textual conflict in a single file can be trivial to resolve once you understand both intents. Don't estimate by file count.

- **The other side's new files are the high-risk surface.** They never saw your branch's policies. Audit them first.

- **Tests are evidence, not authority.** A passing suite after a lazy merge means the policies you didn't propagate aren't covered by tests on the merged tree. That's a gap, not a green light.

- **Spec and prose files merge especially badly.** Two sides editing different sections of the same spec produce no textual conflict but often produce a self-contradictory document. Read specs end-to-end after merging.

- **Renames are silent landmines.** If main renamed `foo` to `bar` and your branch added new callers of `foo` (which still existed at the merge base), the merged tree has callers of a function that no longer exists. Git may report no conflict if the rename was a pure rename and your callers are in new files.

- **When in doubt, ask the human.** A merge is a place where two design intentions meet. If the intentions genuinely diverge, the resolution is a design question, not a syntax question. Surface it.

## Quick checklist before declaring a merge done

- [ ] I have read both sides' commit logs end-to-end.
- [ ] I have written down, in plain language, the policies each side carries.
- [ ] I have audited the merged tree against each policy, including files I did not touch and files the other side added.
- [ ] I have resolved git-flagged textual conflicts by composing both intents, not by picking sides.
- [ ] Build, type-check, tests, and lint are green on the merged tree.
- [ ] My merge commit message documents the policy reconciliation, not just the conflict resolution.
- [ ] I am confident the merged tree is logically coherent — not just compilable.
