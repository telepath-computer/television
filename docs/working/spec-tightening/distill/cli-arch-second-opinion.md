**FAIL — I would revise the wording before accepting it.** Most deletions are justified: internal TypeScript interfaces, command-to-client call tables, and behavior already owned by the product spec do not need restoring. The remaining problems are chiefly statements that became broader or less accurate through compression.

Findings 1–4 need correction. Findings 5–6 are smaller refinements.

1. **The dependency-injection claim promises more architecture than exists.**  
   [Layering, line 29](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/cli/index.md:29) says “Everything that reaches outside the process” is injectable. Config and token reads, log writes, and skill copying use the filesystem directly. For example, [token handling](/home/user/workspace/wt/television/distill-cli-arch/packages/cli/src/index.ts:787) reads files and constructs a real store. Test isolation depends on temporary directories as well as injection.

   This introduces an unnecessary obligation to abstract every external effect. Replace “Everything that reaches outside the process” with “The following dependencies are injectable,” retaining the useful list. Explain separately that tests use temporary homes and substitute the service-manager boundary. Also describe in-process testing as an available technique; ordinary acceptance tests do spawn the executable.

2. **The asset summary incorrectly generalizes across different asset types.**  
   [Build and packaged asset layout, lines 15–17](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/cli/index.md:15) says source execution uses workspace build outputs. Onboarding and themes instead use source directories under `packages/server/assets/`. This is visible in the [resolvers](/home/user/workspace/wt/television/distill-cli-arch/packages/cli/src/index.ts:621), and the [owning theme spec](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/themes/bundled-installation.md:33) explicitly requires it.

   The next paragraph also treats the listed directories as though all are passed to the server and tolerated when absent. Skills are consumed by the CLI installer, which [fails when their root cannot be resolved](/home/user/workspace/wt/television/distill-cli-arch/packages/cli/src/index.ts:1533).

   Say “source execution uses workspace asset locations,” and scope the missing-directory statement to assets supplied to the server. Keep the full-build completeness requirement. The detailed resolver table need not return.

3. **An executable-only public API is confused with technical non-importability.**  
   [Package surface, line 11](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/cli/index.md:11) says the package publishes “nothing importable” and therefore has “no outside callers.” The release check actually [requires `cli.cjs` and calls its exported diagnostic](/home/user/workspace/wt/television/distill-cli-arch/scripts/check-release-telemetry.mjs:7). The ledger acknowledges this dependency.

   The useful decision concerns the supported public interface, not whether loading the module is possible. Proposed wording:

   > The package’s supported public interface is the `tv` executable. Its metadata declares no `main` or `exports` entry; it offers no supported module API.

   Delete the inference that the code has no callers. There is no need to restore the internal export inventory.

4. **The health deadline now appears to require request cancellation.**  
   [Daemon boundary, line 43](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/cli/index.md:43) says “No health request runs past the deadline.” The [implementation](/home/user/workspace/wt/television/distill-cli-arch/packages/cli/src/index.ts:178) races the request against a timer; it stops waiting without cancelling the request. The old spec described a pending request counting as no answer.

   Preserve that meaning:

   > The health wait ends at the deadline even if a request is still pending, so a peer that accepts the connection without replying cannot hold the command open.

   This preserves the bounded command without introducing a cancellation mechanism.

5. **The redaction wording changes which variables are concealed.**  
   [Daemon boundary, line 41](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/cli/index.md:41) promises to redact “the ACP agent variables.” That includes the selector `TELEVISION_ACP_AGENT`, which the implementation logs unchanged. The old spec and [redaction function](/home/user/workspace/wt/television/distill-cli-arch/packages/cli/src/index.ts:818) identify the actual prefixes.

   Restore the precise rule:

   > Environment values whose names start with `OPENCLAW_` or `HERMES_`, or end with `_API_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD`, are replaced with a placeholder in the install log.

   Remove the broader assurance that “credentials never reach the log”; these name-based rules do not establish that universal guarantee.

6. **The developer-stamp rule loses its no-marker behavior.**  
   [Build stamping, line 23](/home/user/workspace/wt/television/distill-cli-arch/specs/arch/cli/index.md:23) preserves the marked-build requirement but omits the old statement that an unmarked build requires no Git provenance. The [code still deliberately returns before invoking Git](/home/user/workspace/wt/television/distill-cli-arch/packages/cli/build.mjs:61). The product spec’s display conditions do not preserve this build property.

   Add:

   > Without the build user’s developer marker, no developer commit is baked and the build does not require Git commit provenance.

   This preserves an intentional build distinction without restoring implementation detail.

The ledger’s identified citation and proof repairs remain integration work. They do not justify restoring the deleted internal contracts.

This review used the policy, both spec versions, the ledger, neighboring specs, and relevant code and tests. No files were changed and no tests were run.