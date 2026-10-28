*How the testing policy’s development discipline is checked.*

# Testing policy — proof

Proves [specs/arch/testing-policy.md](../../specs/arch/testing-policy.md).

The policy governs authoring, focused iteration, verification, and agent permissions, which are checked by review of the contribution and its recorded validation. That review includes the instruction path from AGENTS.md to the policy: narrow local feedback, shared-host risk, waiting and override judgment, pushed Blaxel revisions for broader team-host work, no serial local evasion, and the distinction between ordinary one-file zero retries and broader validation with defaults. Development-branch commits, pushes, and coordinator holds are owned by the linked workflow and checked the same way. This policy orders no tests of its wording or of an agent’s compliance. Runtime admission, diagnostics, lock lifetime, and retry behavior are proven by [the runner proof](test-runner/test-runner.md); the guidance creates no second runtime test suite.
