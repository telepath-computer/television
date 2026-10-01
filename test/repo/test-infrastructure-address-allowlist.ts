export interface InertNumericLoopbackURL {
  file: string;
  url: string;
  reason: string;
}

export const INERT_NUMERIC_LOOPBACK_URLS: readonly InertNumericLoopbackURL[] = [
  {
    file: "packages/desktop/test/e2e/upgrade-gate.spec.ts",
    url: "http://127.0.0.1:9",
    reason: "Deliberately unreachable update-channel input; no test listener binds this port.",
  },
  {
    file: "packages/web/test/e2e/gate-boot-barrier.spec.ts",
    url: "http://127.0.0.1:9",
    reason: "Deliberately unreachable update-channel input; no test listener binds this port.",
  },
  {
    file: "packages/web/test/e2e/update-reload.spec.ts",
    url: "http://127.0.0.1:9",
    reason: "Deliberately unreachable update-channel input; no test listener binds this port.",
  },
  {
    file: "test/node/telemetry-cli.test.ts",
    url: "http://localhost:9",
    reason: "Expected unreachable-server diagnostic text; no test listener binds this port.",
  },
  {
    file: "test/node/update-reload.e2e.helpers.ts",
    url: "http://127.0.0.1:9",
    reason: "Deliberately unreachable update-channel input; no test listener binds this port.",
  },
];
