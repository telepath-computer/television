PASS

Checked `specs/arch/test-runner/blaxel-testshards.md` at `6ffed2c2` against `db88693c`. The two sentences added to the Runs paragraph at line 98 are the only change to this file. No findings requiring changes.

The exception is explicit, identifies the policy rule it overrides, and leaves the described exchanges subject to compatibility and infrastructure-failure requirements. This follows spec policy's “Specific specs may state exceptions” provision. It makes the ownership of these formats clear without introducing another schema description for humans to maintain.

The validation statement matches the code. The planner validates the baseline; the worker validates the plan, including its digest over the complete canonical body; and the coordinator checks the returned summary's identity, assignments and collections. The updated reference in `sharded-execution.md` and the removal account agree with the exception.

The related CLI changes preserve the selection arguments and move refusals earlier; they do not alter this file's selection promises. The round 2 conclusions remain intact.

No tests were run. Only this report was added to the worktree.

Primitive's automatic check was truncated and later flagged `dec_961430f2`, which requires proportionate test-runner guidance and treats Primitive warnings as informational. Reading the decision showed no conflict with this report. The warning was a false positive; I recorded the decision as followed, without a bypass or supersession. The check did not establish complete decision coverage.
