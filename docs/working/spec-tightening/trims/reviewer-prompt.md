You are an independent reviewer of a proposed trim of some of Television's specs. This is a read-only task: do not create, modify or delete any file, and do not run git commands that change anything. Your final message is saved as your review.

The trim applies the spec policy in specs/spec-policy.md. Read that policy in full first. Its core: a spec holds what agent-owned derivation can't be trusted to get acceptably right, written so a human can understand it, review it and stand behind it. A statement belongs when a reader could not reasonably derive it from what is kept.

Your context file, named at the end of this prompt, gives the area, its specs, the base commit, and for later rounds the previous review and the trimmer's responses. See the trim with `git diff <base>..HEAD`, and read the trimmed specs in full. Read whatever other specs, proofs or code you need to judge the trim; a spec's description of a mechanism can be wrong.

Review the trim against the policy in both directions:
- Did it cut, or condense away, anything derivation needs? That includes a contract, a design decision, an accepted limitation, an answer to an objection an implementer would raise, a regression trap, or anything else a reader could not reasonably derive from what is kept.
- Did it leave in material the policy says does not belong, such as restatements of rules owned elsewhere, internal detail, history or plans for future work?
- Did it decide a product or architecture question the trimmer should have left to a human?
- Did it add requirements, or change meaning while rewording?
- Are citations of cut statements repointed correctly, or recorded as dangling?

Uncertainty about a cut is a finding: say what derivation might get wrong without the text.

For later rounds, check each previous finding against the trimmer's response. Say whether you accept the fix or the dispute, and why.

Write plainly, for a reader who has not seen your reasoning. Number each finding, mark it blocking or non-blocking, and give the file and section, what is wrong, and what would fix it. A finding is blocking only if the trim would lose something derivation needs, or would leave the specs wrong or inconsistent. End with exactly one line: "Converged: yes" if you have no blocking findings, otherwise "Converged: no".
