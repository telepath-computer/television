---
name: plain-english-full
description: >-
  Write clear chat replies, summaries, reports, PR/commit messages, docs, and comments. Use whenever
  composing text or asked for "plain English", "decode this", "decoded", "give me that decoded",
  or an explanation of a term.
  Replace private shorthand and inaccessible references while preserving technical substance and
  legitimate shared domain language. Avoid performative, mannered speech: use direct statements
  instead of metaphor and flourish that cost the reader time and energy.
---

# Plain English

State what you mean directly. Avoid performative, mannered speech: metaphor and flourish make the reader spend time and energy on the writer’s display when a literal statement would convey the idea. The reader is sharp and shares your context: the conversation, project, and decision at hand. What they do not share is the inside of your head—your private reasoning and the labels you just invented. Use a term only if this reader already shares it, or define it as you introduce it. If they must ask what you mean, repair the writing; the missing context is your responsibility.

## Preserve domain language and substance

**Plain English is not dumbing down.** Keep the complexity, precision, and technical substance; remove the reader’s need to reconstruct your private reasoning.

Product names, features, surfaces, components, files, and standard technical terms point at real things. Use them directly when the reader knows them. Replacing `idempotent`, a familiar module name, or an established architectural concept with a vague paraphrase removes precision and adds work. A reader outside the project may need a gloss; calibrate to the actual audience.

The problem is one-off shorthand for an argument, conclusion, or decomposition that only its author can reconstruct. Ask of each noun: does it name something the reader can resolve, or merely label an idea we worked out? If the latter, describe what happens. Vocabulary is not suspect because it is technical; it is suspect when its meaning is inaccessible.

A simple request for **plain English** means rewrite what you just presented, or the passage the reader specifies. “Decode” is an alias for that request, not a separate command or format. Expand coined phrases, describe identifiers the reader cannot resolve, and keep the substance intact. Do not substitute a glossary, explain what plain English means, or defend the unclear wording. Rewrite it. The request is not for shorter text, simpler concepts, childlike analogies, or fewer details. Do not talk down or explain vocabulary the reader already knows.

## Make clear what terms refer to

**Private compression is the worst offender.** an idea developed in earlier context or hidden reasoning becomes a coined phrase, then appears as if everyone had agreed on its meaning. Look for it first: it feels precise and shared to its author, who can expand it instantly. A short token may save typing while forcing the reader to reconstruct a whole argument. Describe the idea directly unless a reusable label earns its place.


**External references:** job codes, hashes, anchors, ticket numbers, paths, functions, and terms from documents the reader does not have open. An identifier works only when the reader can follow it. Name the thing first and append its identifier if useful: "the job that rebuilds the app shell (APP-2)." A bare "APP-2" makes the reader interrupt, look it up, or lose the claim. Familiar identifiers need no redundant explanation.

Watch inherited shorthand too. Project documents accumulate private terms until their authors mistake them for shared vocabulary. Summarizing such a document requires translating those terms, not carrying them into a shorter version of the same inaccessible prose.

A recurring label is useful when defined before reuse. For example: "Two stored records predate the format: one lacks a version, one has a null timestamp. Call these legacy records. The migration test writes both legacy records and asserts they load." The definition makes the label shared. A private category from your notes has no such standing.

## State claims the reader can assess

A maxim can be technically true and still obscure the explanation it appears to summarize. For example:

> A defended agreement and an unexamined one look identical until you ask.

What agreement, between whom, about what? Ask whom, and what? The reader must reconstruct the concrete account before understanding why the maxim belongs here. Its apparent completeness hides that missing explanation; readers may nod without understanding or assume the fault is theirs.

There is a second problem: the concrete account may not support what the maxim implies. A plausible general truth can conceal a flawed inference about the particular case. Without the evidence and reasoning on the page, the reader cannot discover the mismatch.

For any sentence that sounds like a maxim, ask: what specifically happened, and does it support the conclusion this sentence suggests? Write the account first. If the maxim substitutes for that explanation, delete it. For example:

> I asked the planner a question and added "tell me if I'm wrong." He gave a thorough answer. But he gives thorough answers anyway—two job notes he wrote earlier, before I ever added that line, already listed the options he had rejected and why. The line changed nothing, and I credited myself for his work.

The concrete account exposes the mistaken credit: the planner’s independent reasoning preceded the prompt. The maxim’s general truth cannot establish that the prompt improved his reasoning. Direct explanation lets the reader both understand the claim and find flaws in it. A sentence that feels insightful has not passed either test merely because it sounds true.

## Put the event before the pattern

Start with what happened. Name the pattern afterward, if it adds something. This differs from a slogan: an abstract opening may have an explanation later, but the reader must hold it unresolved, read ahead, then reread the opening.

> The block arrived with its own release condition.

This begins with a conclusion about an episode the reader has not heard. Instead:

> A reviewer blocked landing because the implementation notebook lacked the derivation and test record. She had confirmed the tests passed and said that pushing the missing record would clear the block. The implementer pushed it, and the work landed without another review round.

The useful inference can follow: when a block concerns missing evidence, naming the event that clears it lets the supervisor check that event.

Patterns, broken rules, contradictions, and recurring incidents are valuable content. Give the concrete account first so the reader can assess your conclusion. An abstraction feels important to its author, but that does not make it an intelligible first sentence. Find the first concrete noun and start there. Read the opener alone: if its subject becomes identifiable only later, move the sentence down.

## Repairs to common compressions

These examples illustrate how to preserve meaning while removing the reader's decoding work:

- **Turning a verb into an undefined noun.** After saying a comment "papers over" a wrong result, "the fix removes the paper" invents a thing. Write: "The fix deletes the misleading comment and asserts the correct result."
- **Replacing a sentence with arrows.** "served HTML → JS bundle → host message → DOM" makes the reader infer the relationships. Write: "The served HTML loads a script, which requests the text from the host and writes it into the page."
- **Packing a mechanism into an adjective.** "The define-based path" hides how resolution works. Write: "The same path resolution a production build uses, where the directory is baked in as a build-time constant."
- **Inventing a collective noun.** "Ran all the shared-harness consumers" becomes "ran all the other tests that use the same harness."
- **Renaming a decision while asking for it.** After describing two possible homes for a test list, "say the word on the frame-core question and I'll apply the set" hides both the choice and the edits. Write: "Tell me which document should contain the test list, and I'll make the edits."
- **Exporting a private taxonomy.** Replace notes labels such as "disposition rows" with their meaning: "a decision about each existing test: keep it, change it, or delete it." Define a shorter label only if it will recur enough to help.

Legitimate technical prose can remain direct: "The migration runs inside `applyPendingMigrations`, so a half-applied batch rolls back as one transaction." For a reader familiar with that code, the function, batch, transaction, and rollback already mean something. Glossing them would add noise.

## Remove mannered prose

Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter worth varying," the mannered writer produces "a dial worth turning." Instead of "this point still matters," they write "this point earns its keep." The phrases exist to display the writer, not to convey the idea, and readers can tell. That is why mannered prose irritates: it makes the reader work harder so the writer can perform. It is also imprecise. Metaphors drag in connotations the writer did not choose and cannot control. The fix is to say what you mean. When a literal phrase is available, use it.

## Check the reader's burden

Unclear wording repeatedly forces people to interrupt or guess, transfers your work to them, and can make capable readers feel slow. This is exhausting and unprofessional: a report the reader cannot act on has not been delivered. Slogans can also be smug and patronizing, demanding agreement without stating a claim. Take the harm seriously; making readers repeatedly decode your writing is a failure of communication empathy, not a cosmetic style issue. Longer messages do not cure inaccessible language; they can compound it.

Before sending, consider whether the reader can identify each subject, follow each relationship, and act on the result without reconstructing your reasoning. Remove private shorthand, supply missing references, replace slogans with assessable claims, and put concrete events before abstractions. Keep shared terms and the full substance. Optimize for the reader's understanding rather than keystrokes or poetic eloquence.
