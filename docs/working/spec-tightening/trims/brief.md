# Brief for an area owner in the overnight trim run

You own one area of Television's specs for this run. Your job is to trim the area's specs so they conform to the sharper spec policy, get the trim through independent review, and write a review document that lets Josh, the architect, review your work tomorrow. Read this brief in full before starting. The background and the run's design are in `docs/working/spec-tightening/overnight-trim-plan.md`.

## The policy

The policy you apply is `specs/spec-policy.md` on your branch. Read all of it first. Its core is one sentence: a spec holds what agent-owned derivation can't be trusted to get acceptably right, written so a human can understand it, review it and stand behind it.

Judge each statement on its own merits. Keep it when a reader could not reasonably derive it from what is kept. You will not always be able to tell whether a statement records a decision a human made or detail an agent filled in. Use your judgment, and do not go looking through git history for its origin.

Important points of judgment:
- **Unsure means keep, and say so.** When unsure whether something belongs, keep it and list it in your review document as kept but doubtful. A missed cut can be made later; a wrong cut can silently lose a decision.
- **Product and architecture decisions are named, not made.** Where conforming depends on one, leave the text as it is and list the decision.
- **Mismatches and missing contracts are reported, not fixed.** This covers mismatches between a spec and the code, and contracts the specs do not name. Check the specs' claims against the code, because a spec's description of a mechanism can be wrong.
- **Cutting is not the only change.** Condensing and rewording to say the same thing more plainly are fine. Do not add new requirements.
- **Plain English.** Write in plain English, for a reader without the project's history, following the repository's cold-reader and plain-English skills in `developer-skills/`.

## What you may edit

- Only the specs in your area.
- One exception: a cited statement you cut.
  - When its content lives on elsewhere, repoint the citation to the new owner, even in another area's spec, a proof or a test comment. Change only the link.
  - When nothing replaces the content, leave the citation dangling and record it.
- Do not edit code, and do not re-derive proofs. Proofs are re-derived after Josh accepts your trims.

Your branch may fail the spec-link test because of dangling citations. That is expected; list every expected failure.

## Review rounds

After your first trim, get it reviewed by an independent reviewer from a different model family, and repeat for up to four rounds.

1. **Commit your work before each round.** Work-in-progress commits are fine; you will reorganise them at the end.
2. **Write a context file** at `docs/working/spec-tightening/trims/<area>/round-<n>-context.md`. It names:
   - your area and its specs;
   - the base commit (`git merge-base HEAD origin/thopter/spec-tightening`);
   - for round 2 onward, the previous round's review file and your response to each finding.
3. **Run the reviewer** from your worktree with exactly this command, filling in the paths. It runs Codex GPT-6 Astra at extra-high effort. Codex's own sandbox does not work on this host, so it runs without one, and the prompt tells it to stay read-only.

   ```bash
   P=docs/working/spec-tightening/trims
   nohup codex exec -m gpt-6-astra -c model_reasoning_effort=xhigh -s danger-full-access --skip-git-repo-check -C "$PWD" \
     -o "$P/<area>/round-<n>-review.md" \
     "$(cat $P/reviewer-prompt.md) Your context file for this round is $P/<area>/round-<n>-context.md." \
     > "$P/<area>/round-<n>-reviewer.log" 2>&1 &
   echo $!
   ```

   Wait for it to finish by polling in the foreground, for example `while kill -0 <pid> 2>/dev/null; do sleep 30; done`, with a long timeout, repeating the call if needed. A review can take 15–30 minutes.
4. **Check the reviewer changed nothing.** `git status --porcelain` must show only the new review, context and log files. If the reviewer changed anything else, restore it with `git checkout -- <path>`, and note that in your review document.
5. **Do not edit the review file.** It is the raw record of what the reviewer said.
6. **Respond to every finding:** address it, or dispute it with a reason. Record your responses in the next round's context file. For the last round, record them in the review document.

The area has converged when the reviewer's latest review reports no blocking findings. Stop after round 4 whether or not it has converged.

## Finishing

1. **Reorganise your commits** into one commit per trimmed spec, plus one commit for link-only repoints and one for your area's review files, with clear messages. For example, use `git reset --soft <base>` and then commit in order. Do not add a `Co-Authored-By` trailer.
2. **Run the spec-link test.** The worktree has no installed dependencies, so link a borrowed copy, run the test, then remove the link:

   ```bash
   ln -s ~/workspace/wt/television/serve-persist-fix-tv-856/node_modules node_modules
   ~/workspace/wt/television/serve-persist-fix-tv-856/node_modules/.bin/vitest run test/repo/spec-links.test.ts
   rm node_modules
   ```
3. **Write the review document,** `docs/working/spec-tightening/trims/<area>/review.md`. The shape suggested in the plan's section "What the run produces" is an initial idea, not a requirement. Structure your document so it captures what Josh needs to review your area. In particular, cover:
   - decisions for Josh;
   - the convergence trajectory, if the area did not converge, built from the raw review files;
   - judgment calls, each with what the remaining text still lets a reader derive;
   - statements kept but doubtful;
   - routine cuts, one bullet each;
   - findings that are not edits;
   - the effects on proofs, citations and the link test.
4. **Push your branch** with `git push -u origin <branch>`. Do not open a pull request.
5. **Reply with a short summary,** about 300 words:
   - words before and after for each spec;
   - whether the area converged, and in how many rounds;
   - the number of decisions for Josh and of judgment calls;
   - the link-test result;
   - anything that went wrong.
