import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type Workflow = {
  concurrency?: { group: string; "cancel-in-progress": boolean | string; queue?: string };
  jobs: Record<string, {
    if?: string;
    concurrency?: Workflow["concurrency"];
    steps: Array<{ uses?: string }>;
  }>;
};

function workflow(name: string): Workflow {
  return parseYaml(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as Workflow;
}

// These are contracts for the configuration sent to GitHub, not an imitation
// of its expression evaluator, authorization checks, or hosted scheduler.
describe("public repository workflow boundaries", () => {
  // proofs/arch/updates/index.md#^updates-t-publish-eligibility
  it("requires a successful upstream main push before the publishing job starts", () => {
    const condition = workflow("publish").jobs.publish.if ?? "";
    expect(condition).toMatch(/^\$\{\{[\s\S]*\}\}$/);
    const clauses = condition.slice(3, -2).split("&&").map((clause) => clause.trim());
    expect(clauses.sort()).toEqual([
      "github.repository == 'telepath-computer/television'",
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "github.event.workflow_run.head_branch == 'main'",
    ].sort());
  });

  // proofs/arch/updates/index.md#^updates-t-publish-eligibility
  it("retains eligible publishing jobs in a non-cancelling queue separate from ineligible runs", () => {
    const publish = workflow("publish");
    expect(publish.concurrency).toBeUndefined();
    expect(publish.jobs.publish.concurrency).toEqual({
      group: "npm-publish-${{ github.event.workflow_run.event }}-${{ github.event.workflow_run.head_repository.full_name }}-${{ github.event.workflow_run.head_branch }}-${{ github.event.workflow_run.conclusion }}",
      queue: "max",
      "cancel-in-progress": false,
    });
  });

  // proofs/arch/desktop/distribution.md#^desktop-dist-t-workflow-origin
  it.each(["desktop-build", "desktop-candidate-build"])("restricts %s at job level to the official repository", (name) => {
    expect(workflow(name).jobs.build.if).toBe("${{ github.repository == 'telepath-computer/television' }}");
  });

  // proofs/arch/updates/index.md#^updates-t-publish-eligibility
  // proofs/arch/desktop/distribution.md#^desktop-dist-t-workflow-origin
  it.each(["publish", "desktop-build", "desktop-candidate-build"])("pins external actions in %s to full commit SHAs", (name) => {
    const actions = Object.values(workflow(name).jobs)
      .flatMap((job) => job.steps)
      .flatMap((step) => step.uses ? [step.uses] : [])
      .filter((uses) => !uses.startsWith("./"));
    expect(actions.length).toBeGreaterThan(0);
    for (const uses of actions) {
      expect(uses).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });

  // proofs/arch/test-runner/github-ci.md#^gha-t-pr-concurrency
  it("cancels only superseded runs of the same PR while keeping other CI runs independent", () => {
    expect(workflow("ci").concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
  });
});
