import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Imported before config setup. Context is an invocation signal, not a credential.
if (process.env.TV_TEST_RUNNER_CONTEXT !== "1" && process.env.TV_TEST_AGAINST_TEST_GUIDANCE_DIRECT_NATIVE_RUN !== "1") {
  const remote = fs.existsSync(path.join(os.homedir(), ".tvdev-use-blaxel"))
    ? " For broader work, commit and push first, then use npm test -- blaxel --surface <id> or npm run verify -- blaxel."
    : " Broader local selections and npm run verify are available without Blaxel access.";
  throw new Error("Direct native test invocation skips the canonical runner's protections. Use npm test -- local --file <path> [--grep <pattern>]." + remote
    + " For deliberate native watch/debug/editor use, set TV_TEST_AGAINST_TEST_GUIDANCE_DIRECT_NATIVE_RUN=1 (exactly 1). This is the caller's judgment: it skips the local-test mutex and marked-host file limit. Native configuration and required services remain your responsibility.");
}
