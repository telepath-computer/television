export default {
  suites: {
    unit: { include: ["kind:unit"] },
    e2e: { include: ["kind:e2e"] },
    "e2e-ci": { include: ["kind:e2e"], exclude: ["tag:electron"] },
    agent: { include: ["kind:agent"] },
    experiment: { include: ["kind:experiment"] },
    "telemetry-posthog-roundtrip": { include: ["kind:telemetry-posthog-roundtrip"] },
    "daemon-acceptance": { include: ["kind:daemon-acceptance"] },
    all: { include: ["kind:unit", "kind:e2e"] },
  },
  executionGroups: [
    executionGroup("unit:root", "unit: root", 1, [
      surface("unit:root", "vitest", "vitest.config.ts", { kind: "unit", roots: ["test/repo"], excludeRoots: ["test/repo/build-config-integrity.test.ts"] }),
      surface("unit:build-config", "vitest", "test/repo/vitest.build-config.config.ts", { kind: "unit", roots: ["test/repo/build-config-integrity.test.ts"], tags: ["build", "telemetry"] }),
    ]),
    executionGroup("unit:workspaces", "unit: workspaces", 2, [
      surface("unit:artifact", "vitest", "packages/artifact/vitest.config.ts", { package: "@telepath-computer/television-artifact", kind: "unit", roots: ["packages/artifact/test", "packages/artifact/src"], excludeRoots: ["packages/artifact/test/e2e"] }),
      surface("unit:canonical", "vitest", "packages/canonical/vitest.config.ts", { package: "@telepath-computer/canonical", kind: "unit", roots: ["packages/canonical/test"] }),
      surface("unit:cli", "vitest", "packages/cli/vitest.config.ts", { package: "@telepath-computer/television", kind: "unit", roots: ["packages/cli/test"] }),
      surface("unit:desktop", "vitest", "packages/desktop/vitest.config.ts", { package: "@telepath-computer/television-desktop", kind: "unit", roots: ["packages/desktop/test"], excludeRoots: ["packages/desktop/test/e2e"] }),
      surface("unit:shared", "vitest", "packages/shared/vitest.config.ts", { package: "@telepath-computer/television-shared", kind: "unit", roots: ["packages/shared/test"] }),
      surface("unit:utils", "vitest", "packages/utils/vitest.config.ts", { package: "@telepath-computer/utils", kind: "unit", roots: ["packages/utils/test"] }),
      surface("unit:server", "vitest", "packages/server/vitest.config.ts", { package: "@telepath-computer/television-server", kind: "unit", roots: ["packages/server/src", "packages/server/test"], excludeRoots: ["packages/server/test/e2e", "packages/server/test/telemetry-posthog.integration.test.ts"] }),
      surface("unit:view-markdown", "vitest", "packages/view-markdown/vitest.config.ts", { package: "@telepath-computer/television-view-markdown", kind: "unit", roots: ["packages/view-markdown/test"], excludeRoots: ["packages/view-markdown/test/e2e"] }),
      surface("unit:browser-app", "vitest", "packages/web/vitest.config.ts", { package: "@telepath-computer/television-web", kind: "unit", roots: ["packages/web/test", "packages/web/src"], excludeRoots: ["packages/web/test/e2e"] }),
      surface("unit:skills", "vitest", "packages/skills/vitest.config.ts", { package: "@telepath-computer/television-skills", kind: "unit", roots: ["packages/skills/skills"], excludeRoots: ["packages/skills/skills/tv-calendar/test/e2e", "packages/skills/skills/tv-tasks/test/e2e"] }),
      surface("unit:skillbench", "vitest", "packages/skillbench/vitest.config.ts", { package: "@telepath-computer/skillbench", kind: "unit", roots: ["packages/skillbench/test"] }),
      surface("unit:staging", "vitest", "staging/vitest.config.ts", { kind: "unit", roots: ["staging/test"] }),
    ]),
    executionGroup("e2e:node", "e2e: node", 3, [
      surface("e2e:node", "vitest", "test/node/vitest.config.ts", { kind: "e2e", roots: ["test/node"], excludeRoots: ["test/node/daemon-acceptance.test.ts"], tags: ["node"], preflight: ["node", "playwright-chromium", "playwright-firefox"], preCommand: ["node", "scripts/licenses/build-suite.mjs"] }),
    ]),
    executionGroup("e2e:browser-app", "e2e: web", 5, [
      surface("e2e:browser-app", "playwright", "packages/web/playwright.config.ts", { package: "@telepath-computer/television-web", kind: "e2e", roots: ["packages/web/test/e2e"], excludeRoots: ["packages/web/test/e2e/appearance-delivery.test.ts", "packages/web/test/e2e/onboarding-browser.test.ts", "packages/web/test/e2e/path-artifact-real-stack-coverage.test.ts", "packages/web/test/e2e/sidebar-collapse.test.ts", "packages/web/test/e2e/sidebar-resize.test.ts", "packages/web/test/e2e/theme-product-acceptance.test.ts"], preflight: ["node", "playwright-chromium", "playwright-firefox"], tags: ["browser"], preCommand: ["npm", "run", "build:web-and-artifact-documents"], services: [{ id: "browser-app", kind: "vite", config: "config/vite.e2e.ts", publishUrlEnv: "TV_WEB_E2E_URL" }] }),
    ]),
    // These files boot product servers per test; sharing a Playwright invocation
    // with a parallel worker starves those servers on 2-vCPU CI runners
    // (specs/arch/test-runner/github-ci.md, worker counts). Their one-worker
    // surface runs every product-server acceptance serially.
    executionGroup("e2e:browser-app-real-stack", "e2e: web real-stack", 7, [
      surface("e2e:browser-app-real-stack", "playwright", "packages/web/playwright.real-stack.config.ts", { kind: "e2e", roots: ["packages/web/test/e2e/appearance-delivery.test.ts", "packages/web/test/e2e/onboarding-browser.test.ts", "packages/web/test/e2e/path-artifact-real-stack-coverage.test.ts", "packages/web/test/e2e/sidebar-collapse.test.ts", "packages/web/test/e2e/sidebar-resize.test.ts", "packages/web/test/e2e/theme-product-acceptance.test.ts"], preflight: ["node", "playwright-chromium", "playwright-firefox"], tags: ["browser"], preCommand: ["npm", "run", "build:web-and-artifact-documents"], services: [{ id: "browser-app-real-stack", kind: "vite", config: "config/vite.e2e.ts", publishUrlEnv: "TV_WEB_E2E_URL" }] }),
    ]),
    executionGroup("e2e:artifact", "e2e: artifact", 6, [
      surface("e2e:artifact", "playwright", "packages/artifact/test/e2e/playwright.config.ts", {
        package: "@telepath-computer/television-artifact",
        kind: "e2e",
        roots: ["packages/artifact/test/e2e"],
        preflight: ["node", "playwright-chromium"],
        tags: ["browser"],
        services: [
          { id: "artifact-view", kind: "vite", config: "packages/artifact/test/e2e/harness/view/vite.config.ts", publishUrlEnv: "TV_ARTIFACT_E2E_VIEW_URL" },
          { id: "artifact-host", kind: "vite", config: "packages/artifact/test/e2e/harness/host/vite.config.ts", publishUrlEnv: "TV_ARTIFACT_E2E_HOST_URL" },
        ],
      }),
    ]),
    executionGroup("e2e:view-markdown", "e2e: view-markdown", 8, [
      surface("e2e:view-markdown", "playwright", "packages/view-markdown/playwright.config.ts", { package: "@telepath-computer/television-view-markdown", kind: "e2e", roots: ["packages/view-markdown/test/e2e"], preflight: ["node", "playwright-chromium"], tags: ["browser"], preCommand: ["npm", "--workspace", "@telepath-computer/television-view-markdown", "run", "build"], services: [{ id: "view-markdown", kind: "vite", config: "packages/view-markdown/vite.config.ts", publishUrlEnv: "TV_VIEW_MARKDOWN_E2E_URL" }] }),
    ]),
    executionGroup("e2e:calendar-skill", "e2e: skill-tv-calendar", 9, [
      surface("e2e:calendar-skill", "playwright", "packages/skills/skills/tv-calendar/playwright.config.ts", { package: "@telepath-computer/skill-tv-calendar", kind: "e2e", roots: ["packages/skills/skills/tv-calendar/test/e2e"], preflight: ["node", "playwright-chromium"], tags: ["browser", "skill"], services: [{ id: "calendar-skill", kind: "vite", config: "packages/skills/skills/tv-calendar/vite.config.ts", publishUrlEnv: "TV_CALENDAR_E2E_URL" }] }),
    ]),
    executionGroup("e2e:tasks-skill", "e2e: skill-tv-tasks", 15, [
      surface("e2e:tasks-skill", "playwright", "packages/skills/skills/tv-tasks/playwright.config.ts", { package: "@telepath-computer/skill-tv-tasks", kind: "e2e", roots: ["packages/skills/skills/tv-tasks/test/e2e"], preflight: ["node", "playwright-chromium"], tags: ["browser", "skill"], services: [{ id: "tasks-skill", kind: "vite", config: "packages/skills/skills/tv-tasks/vite.config.ts", publishUrlEnv: "TV_TASKS_E2E_URL" }] }),
    ]),
    executionGroup("e2e:desktop", "e2e: desktop", 10, [
      surface("e2e:desktop", "playwright", "packages/desktop/playwright.config.ts", {
        package: "@telepath-computer/television-desktop",
        kind: "e2e",
        roots: ["packages/desktop/test/e2e"],
        command: ["node", "scripts/run-electron-e2e.mjs"],
        preflight: ["node", "playwright-chromium", "electron"],
        tags: ["electron"],
        preCommand: ["npm", "run", "build:web-and-artifact-documents"],
        services: [{ id: "desktop-fixtures", kind: "vite", config: "config/vite.e2e.ts", publishUrlEnv: "TV_DESKTOP_E2E_URL" }],
      }),
    ]),
    executionGroup("daemon-acceptance:cli", "daemon acceptance: CLI", 11, [
      surface("daemon-acceptance:cli", "vitest", "test/node/vitest.daemon-acceptance.config.ts", {
        kind: "daemon-acceptance",
        roots: ["test/node/daemon-acceptance.test.ts"],
        preflight: ["node", "daemon-test-host"],
        tags: ["node", "daemon", "service-manager", "host-mutating"],
        preCommand: ["npm", "--workspace", "@telepath-computer/television", "run", "build"],
      }),
    ]),
    executionGroup("e2e:server", "e2e: server", 12, [
      surface("e2e:server", "playwright", "packages/server/playwright.config.ts", { package: "@telepath-computer/television-server", kind: "e2e", roots: ["packages/server/test/e2e"], preflight: ["node", "playwright-chromium"], tags: ["browser"], preCommand: ["npm", "--workspace", "@telepath-computer/television-server", "run", "build"] }),
    ]),
    executionGroup("telemetry-posthog-roundtrip:integration", "telemetry PostHog roundtrip: integration", 13, [
      surface("telemetry-posthog-roundtrip:integration", "vitest", "packages/server/vitest.telemetry.config.ts", { package: "@telepath-computer/television-server", kind: "telemetry-posthog-roundtrip", roots: ["packages/server/test/telemetry-posthog.integration.test.ts"], preflight: ["node", "posthog-test-key"], tags: ["telemetry", "posthog", "roundtrip"] }),
    ]),
    executionGroup("agent:root", "agent: root", 14, [
      surface("agent:root", "vitest", "test/agent/vitest.config.ts", { kind: "agent", roots: ["test/agent"], agent: true, tags: ["agent"] }),
    ]),
    executionGroup("experiment:dynamic-services", "experiment: dynamic services", 89, [
      surface("experiment:dynamic-services", "playwright", "test/runner-fixtures/dynamic-services/playwright.config.ts", {
        kind: "experiment",
        roots: ["test/runner-fixtures/dynamic-services"],
        tags: ["browser", "dynamic-services"],
        preflight: ["node", "playwright-chromium"],
        services: [
          { id: "first", kind: "vite", config: "test/runner-fixtures/dynamic-services/first.vite.config.ts", publishUrlEnv: "TV_DYNAMIC_FIRST_URL" },
          { id: "second", kind: "vite", config: "test/runner-fixtures/dynamic-services/second.vite.config.ts", publishUrlEnv: "TV_DYNAMIC_SECOND_URL" },
        ],
      }),
    ]),
    executionGroup("experiment:lifecycle-faults", "experiment: lifecycle fault injection", 90, [
      surface("experiment:lifecycle-orchestrator", "vitest", "test/runner-fixtures/process-lifecycle/orchestrator/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/orchestrator"], tags: ["isolated-github-only", "process-lifecycle"] }),
      surface("experiment:lifecycle-clean", "vitest", "test/runner-fixtures/process-lifecycle/clean/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/clean"], tags: ["isolated-github-only", "process-lifecycle"] }),
      surface("experiment:lifecycle-leak", "vitest", "test/runner-fixtures/process-lifecycle/leak/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/leak"], tags: ["isolated-github-only", "process-lifecycle"] }),
      surface("experiment:lifecycle-term-resistant", "vitest", "test/runner-fixtures/process-lifecycle/term-resistant/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/term-resistant"], tags: ["isolated-github-only", "process-lifecycle"] }),
      surface("experiment:lifecycle-precommand-leak", "vitest", "test/runner-fixtures/process-lifecycle/precommand-leak/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/precommand-leak"], tags: ["isolated-github-only", "process-lifecycle"], preCommand: ["node", "test/runner-fixtures/process-lifecycle/precommand-leak/spawn-leak.mjs"] }),
      surface("experiment:lifecycle-active", "vitest", "test/runner-fixtures/process-lifecycle/active/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/active"], tags: ["isolated-github-only", "process-lifecycle"] }),
      surface("experiment:lifecycle-recovered-leak", "vitest", "test/runner-fixtures/process-lifecycle/recovered-leak/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/recovered-leak"], tags: ["isolated-github-only", "process-lifecycle"] }),
      surface("experiment:lifecycle-late-spawn", "vitest", "test/runner-fixtures/process-lifecycle/late-spawn/vitest.config.ts", { kind: "experiment", roots: ["test/runner-fixtures/process-lifecycle/late-spawn"], tags: ["isolated-github-only", "process-lifecycle"] }),
    ]),
  ],
};

function executionGroup(id, name, order, surfaces) {
  return { id, name, order, surfaces };
}

function surface(id, runner, config, options) {
  return {
    id,
    runner,
    config,
    kind: options.kind,
    package: options.package ?? null,
    roots: options.roots ?? [],
    excludeRoots: options.excludeRoots ?? [],
    supports: options.supports ?? ["file", "grep", "shard"],
    preflight: options.preflight ?? ["node"],
    tags: options.tags ?? [],
    agent: options.agent ?? false,
    command: options.command ?? null,
    preCommand: options.preCommand ?? null,
    services: options.services ?? [],
  };
}
