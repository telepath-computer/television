export interface TestService {
  id: string;
  kind: "vite";
  config: string;
  publishUrlEnv: string;
}

export interface TestSurface {
  id: string;
  runner: "vitest" | "playwright";
  config: string;
  kind: string;
  package: string | null;
  roots: string[];
  excludeRoots: string[];
  supports: string[];
  preflight: string[];
  tags: string[];
  agent: boolean;
  command: string[] | null;
  preCommand: string[] | null;
  services: TestService[];
  executionGroup: { id: string; name?: string; order?: number } | null;
  cwd: string;
  absoluteConfig: string;
}

export interface TestExecutionGroup {
  id: string;
  name: string;
  order: number;
  surfaces: TestSurface[];
}

export interface TestConfig {
  suites: Record<string, { include?: string[]; exclude?: string[] }>;
  executionGroups?: TestExecutionGroup[];
  surfaces: TestSurface[];
}

export interface SelectionOptions {
  all?: unknown;
  suite?: string;
  surface?: string;
  package?: string;
  file?: string;
  grep?: string;
  runner?: string;
  tag?: string;
  [key: string]: unknown;
}

export const CANONICAL_TEST_INCLUDE_ROOTS: readonly string[];
export function loadTestConfig(options?: { root?: string }): TestConfig;
export function validateRegistry(config: TestConfig, options?: { root?: string }): string[];
export function selectSurfaces(config: TestConfig, options: SelectionOptions): TestSurface[];
export function owningSurfaces(surfaces: TestSurface[], file: string): TestSurface[];
