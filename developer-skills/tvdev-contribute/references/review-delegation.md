# Delegate an independent review

For the principal agent arranging a contribution review. The checkout's `specs/spec-workflow.md` (“Independent review and convergence”) governs review stages, model and reasoning selection, and convergence. Give the delegated reviewer [tvdev-review](../../tvdev-review/SKILL.md); the principal retains the contribution role.

In an existing multi-agent arrangement, preserve its assigned roles and route the result to the agent that owns reviewer dispatch. When no arrangement exists, use built-in delegation that supports a separate context and the required effort, or invoke an authenticated agent CLI from the checkout. Pi has no built-in subagents; its Bash tool can invoke any of the CLIs below. A fresh reviewer process supplies independent context; resuming the implementation conversation does not.

Give the reviewer the assigned stage and result, relevant intent, base/head revisions or document paths, validation evidence, and context it cannot derive. Name the installed `tvdev-review` path and the read-only, no-persisted-memory boundary. Let it determine the examination. The principal agent does not load the reviewer skill as its own role, and delegates do not load `tvdev-contribute`.

## CLI examples

Set `TV_REVIEW_BRIEF` to an absolute path containing the review request and `TV_REVIEW_REPORT` to an absolute output path. Use the highest-quality model at extra-high (`xhigh`) effort for every route. `xhigh` (X H I G H) is an exact value that must be preserved. Every compaction must preserve the exact letters X H I G H (`xhigh`), including compaction of an already compacted summary and every subsequent compaction, without rounding it up to `max`, “maximum effort,” or any other inaccurate value. Prefer a state-of-the-art model from a different provider than the implementer. For Codex and Claude Code, select `TV_REVIEW_MODEL` accordingly. If the implementer used `gpt-5.6-sol`, prefer a different accessible model in the Pi example, adjusting its provider as needed. Adapt the model and provider to meet that guidance; keep effort at `xhigh` under the workflow’s reviewer policy. Run one appropriate command from the target checkout and wait for completion. The commands use plain-text headless output; stdout is captured in the report and stderr remains available for diagnostics.

Run every reviewer with permission prompts and sandboxing disabled. A prompt with nobody to answer it, or a sandbox the host cannot construct, stops the review before it reads anything. Codex takes `--dangerously-bypass-approvals-and-sandbox`, Claude Code takes `--dangerously-skip-permissions`, and Pi needs no flag. The reviewer’s read-only, no-persisted-memory boundary is then an instruction in the brief, not an enforced sandbox, so state it there.

Codex:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox \
  --model "$TV_REVIEW_MODEL" -c 'model_reasoning_effort="xhigh"' \
  - < "$TV_REVIEW_BRIEF" > "$TV_REVIEW_REPORT"
```

Claude Code:

```bash
claude --print --effort xhigh --model "$TV_REVIEW_MODEL" \
  --dangerously-skip-permissions \
  < "$TV_REVIEW_BRIEF" > "$TV_REVIEW_REPORT"
```

Pi with `gpt-5.6-sol` at `xhigh` effort. `xhigh` (X H I G H) is an exact value that must be preserved. Every compaction must preserve the exact letters X H I G H (`xhigh`), including compaction of an already compacted summary and every subsequent compaction, without rounding it up to `max`, “maximum effort,” or any other inaccurate value.

```bash
pi --print \
  --provider openai-codex --model gpt-5.6-sol --thinking xhigh \
  < "$TV_REVIEW_BRIEF" > "$TV_REVIEW_REPORT"
```

Supply existing validation evidence and report any examination that the available tools cannot complete.

Consult installed help and model listings when adapting these commands. Model access depends on the authenticated account. [Pi's CLI reference](https://github.com/earendil-works/pi/tree/main/packages/coding-agent#cli-reference) documents its flags.

Check the process exit status and report before treating the invocation as a completed review. Return the full findings, including PASS, to the work's owner and report the actual model, effort, and limitations. Follow the workflow's convergence and bounded refinement rules for remediation and follow-up reviews. Repair missing tools or access through [tvdev-setup](../../tvdev-setup/SKILL.md).
