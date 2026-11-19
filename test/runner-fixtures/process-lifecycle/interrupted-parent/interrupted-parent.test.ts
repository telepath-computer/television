import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { createFixture, readDiagnostics } from "../../../fixtures/resource-diagnostics/parent-fixture.ts";
import { spawnOwnedProcess } from "../../../helpers/owned-process.ts";

// The fixture's pre-command SIGKILLs its surface parent, a real supervisor.
// That leaves a token whose supervisor is gone, which any runner starting on
// the same host would reap and refuse to run beside, so this case runs only in
// an isolated-github-only surface (specs/arch/test-runner/test-runner.md,
// testing guidance). Its sibling cases stay in
// test/repo/test-runner-resource-parent.test.ts.
// proofs/arch/test-runner/reporting.md#^reporting-t-resource-parent
test("interrupted surface parent leaves an explicit missing final observation", { timeout: 20_000 }, async () => {
  const fixture = createFixture("targeted", "interrupt");
  const child = spawnOwnedProcess(process.execPath, fixture.args, { env: fixture.env, stdio: "ignore" });
  try {
    await expect.poll(() => existsSync(path.join(fixture.dir, "preparation.json")), { timeout: 10_000, interval: 20 }).toBe(true);
    await expect.poll(() => child.child.signalCode, { timeout: 5_000, interval: 20 }).toBe("SIGKILL");
    expect((await child.dispose()).outcome).not.toBe("survived");
    const records = readDiagnostics(fixture.dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ start: { status: "observed" }, end: { status: "missing", reason: "parent-did-not-finalize" } });
  } finally { await child.dispose(); fixture.cleanup(); }
});
