# Brief for an area owner, trim run 2

You own one area of Television's specs. Read this brief in full before starting.

## The task

Apply the spec policy, `specs/spec-policy.md` on your branch, to every statement in your area's specs. Read the policy in full first. Its core is one sentence: a spec holds what agent-owned derivation can't be trusted to get acceptably right, written so a human can understand it, review it and stand behind it.

Your job is to find the core set of statements from which the rest of your area can reasonably be derived, and to cut the specs down to that core. Decide every statement on its own merits. Either it needs to be in the spec under the policy, or it can reasonably be derived from what is kept, or it doesn't belong for another reason the policy gives, and it goes. There is no default in either direction, and no preference for keeping or for cutting. Use your judgment of the policy, and decide.

Treat all spec content as written by agents. Whatever a human intended cannot be read from the text, so a statement's wording, emphasis, placement or apparent authority is no reason to keep it. Ownership paragraphs and existing pinned types get no special standing either. Only the policy decides.

Each spec's testing section is fully part of this work. The policy says what such a section holds and what heading it takes; much of what these sections currently say restates the spec's own promises, which a proof derives without help. Give the section the policy's heading, keep in it only what the policy says belongs there, and repoint citations of the old heading.

Rewording and condensing are part of the work where they say the same thing more directly. Do not add requirements. Where a spec and the code disagree, report it rather than deciding which is right: that is a question of correctness, not of what belongs in the spec. Check the specs' claims against the code as you go, because a spec's description of a mechanism can be wrong.

Write plainly, for a reader without the project's history, following the cold-reader and plain-English skills in `developer-skills/`.

## What you may edit

Edit the specs in your area. When you cut or move a statement that something cites, follow the citation. If what it pointed at lives on somewhere, repoint the link there, even in another spec, a proof or a test comment, changing only the link. If nothing replaces it, leave the citation dangling and record it. Do not edit code, and do not re-derive proofs; that happens after Josh has reviewed your trim. Your branch may fail the spec-link test because of dangling citations; record which failures are expected.

## Review

When your trim is ready, get it reviewed by an independent reviewer from a different model family, and work with its findings for up to four rounds. The area has converged when the reviewer's latest review reports no blocking findings.

Before each round, commit your work (work-in-progress commits are fine) and write a context file at `docs/working/spec-tightening/trims/<area>-2/round-<n>-context.md`. It names your area and specs, the base commit (`git merge-base HEAD origin/thopter/spec-tightening`), and from round 2 onward the previous review file and your response to each of its findings. Then run the reviewer from your worktree with this command, filling in the paths:

```bash
P=docs/working/spec-tightening/trims
nohup codex exec -m gpt-6-astra -c model_reasoning_effort=xhigh -s danger-full-access --skip-git-repo-check -C "$PWD" \
  -o "$P/<area>-2/round-<n>-review.md" \
  "$(cat $P/reviewer-prompt-2.md) Your context file for this round is $P/<area>-2/round-<n>-context.md." \
  > "$P/<area>-2/round-<n>-reviewer.log" 2>&1 &
echo $!
```

Wait for it by polling in the foreground, for example `while kill -0 <pid> 2>/dev/null; do sleep 30; done`, repeating with a long timeout as needed. Codex's own sandbox does not work on this host, so the reviewer runs without one and is told to stay read-only: afterwards, `git status --porcelain` should show only the new round files. Restore anything else it changed and note it. Do not edit a review file; it is the raw record of what the reviewer said. Respond to every finding, by acting on it or by disputing it with a reason, and record your responses.

Make no changes after the final review that the reviewer has not seen. If you want one, run another round, within the limit of four.

## Finishing

Reorganise your commits into one per trimmed spec, one for link repoints outside your area, and one for your area's review files, with clear messages and no `Co-Authored-By` trailer; for example, `git reset --soft <base>` and commit in order. Run the spec-link test:

```bash
ln -s ~/workspace/television-prerelease-archive/node_modules node_modules
~/workspace/television-prerelease-archive/node_modules/.bin/vitest run test/repo/spec-links.test.ts
rm node_modules
```

Write `docs/working/spec-tightening/trims/<area>-2/review.md` for Josh. It is built around what you removed. For each removal, explain in your own words why it could go, specific enough that Josh can check the claim against what was kept. Also explain the keeps you think a reader might question. Beyond that, shape the document however best shows Josh what happened in your area, including disagreements between spec and code, how review went, and the effects on proofs and citations.

Push your branch with `git push -u origin <branch>`; do not open a pull request. Reply with a short summary: words before and after for each spec, including how much of the reduction came from testing sections; whether the area converged and in how many rounds; the link-test result; and anything that went wrong.
