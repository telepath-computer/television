const root = "test/repo/fixtures/test-runner/shard-worker";
const preCommand = ["node", `${root}/pre-command.mjs`];
const executionGroup = { id: "unit:workspaces", name: "fixture workspace", order: 1 };
const base = { package: null, supports: ["file"], preflight: ["node"], tags: ["selftest"], agent: false, command: null, excludeRoots: [], cwd: "." };
export default {
  suites: { all: { include: ["kind:unit", "kind:e2e"] } },
  surfaces: [
    { ...base, id: "fixture:vitest-one", runner: "vitest", kind: "unit", config: `${root}/vitest-one.config.mts`, absoluteConfig: `${process.cwd()}/${root}/vitest-one.config.mts`, roots: [`${root}/vitest-one.fixture.ts`], preCommand, executionGroup },
    { ...base, id: "fixture:vitest-two", runner: "vitest", kind: "unit", config: `${root}/vitest-two.config.mts`, absoluteConfig: `${process.cwd()}/${root}/vitest-two.config.mts`, roots: [`${root}/vitest-two.fixture.ts`], executionGroup },
    { ...base, id: "fixture:playwright", runner: "playwright", kind: "e2e", config: `${root}/playwright.fixture.config.ts`, absoluteConfig: `${process.cwd()}/${root}/playwright.fixture.config.ts`, roots: [root], preCommand, executionGroup: { id: "fixture:playwright", name: "fixture browser", order: 2 } },
  ],
};
