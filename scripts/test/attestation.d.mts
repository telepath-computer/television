export const PRODUCTION_TESTPASS_NAMESPACE: "refs/testpass";
export const LAB_TESTPASS_NAMESPACE: "refs/testpass-lab";
export const TESTPASS_MODES: readonly ["production", "lab"];
export const MAX_ATTESTATION_AGE_SECONDS: number;
export const MIN_TESTPASS_VERSION: number;
export const MAX_TESTPASS_VERSION: number;
export const TESTPASS_POLICY_PATH: "test/testpass-policy.json";

export type TestpassMode = "production" | "lab";

export interface TestpassPolicy {
  status: "enabled" | "disabled" | "unavailable";
  version?: number;
  objectId?: string;
  message?: string;
}

export interface AttestationPolicy {
  schemaVersion: 1;
  testpassRefsEnabled: boolean;
  testpassVersion: number;
}
export type TrustedPolicyResult =
  | { status: "available"; objectId: string; policy: AttestationPolicy }
  | { status: "unavailable"; message: string };

export function versionIsValid(version: unknown): boolean;
export function readTrustedPolicy(options?: { repoRoot?: string; remote?: string }): TrustedPolicyResult;
export function readTestpassPolicy(options?: {
  repoRoot?: string;
  remote?: string;
  policyReader?: (options: { repoRoot: string; remote: string }) => { status: string; message?: string; objectId?: string; policy?: Record<string, unknown> };
}): TestpassPolicy;
export function attestationModeFromEnv(env?: Record<string, string | undefined>): TestpassMode;
export function readAttestationPolicyForMode(mode: TestpassMode, options?: {
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  remote?: string;
}): TestpassPolicy;
export function attestationRef(mode: TestpassMode, version: number, tree: string): string;
export function computeAgeSeconds(input: { committerTime?: unknown; now?: unknown }): number | null;
export function ageWithinWindow(ageSeconds: number | null): boolean;

export interface SkipDecision {
  skip: boolean;
  reason?: string;
  version?: number;
  tree?: string;
  ageSeconds?: number;
}
export function decideSkip(facts: {
  policy?: TestpassPolicy;
  tree?: string;
  refFound?: boolean;
  refVersion?: number;
  refObjectType?: string;
  refTree?: string;
  committerTime?: number;
  now?: number;
}): SkipDecision;

export const ELIGIBILITY_CLAUSES: readonly string[];
export interface EligibilityVerdict {
  eligible: boolean;
  failures: string[];
}
export function evaluateEligibility(facts: {
  treeAtStart?: string;
  treeAtEnd?: string;
  testedTree?: string;
  cleanAtStart?: boolean;
  cleanAtEnd?: boolean;
  ignoreUncommitted?: boolean;
  qualifyingRun?: boolean;
  surfaces?: Array<{ id: string; status: string }>;
  expectedSurfaceIds?: string[];
  shardSubset?: boolean;
  targetedSelection?: boolean;
  canonicalRetries?: boolean;
  attestedSkipRun?: boolean;
  policyAtStart?: TestpassPolicy;
  policyAtEnd?: TestpassPolicy;
}): EligibilityVerdict;

export type AttestationSource = "blaxel-verify" | "github-ci";
export interface PublishOutcome {
  status: "published" | "already-attested" | "malformed-collision" | "failed" | "refused-source" | "refused-policy" | "refused-invalid";
  ref?: string;
  message?: string;
}
export function publishAttestation(options: {
  commit: string;
  tree: string;
  mode: TestpassMode;
  version: number;
  source?: AttestationSource | null;
  remote?: string;
  repoRoot?: string;
  git?: (args: string[], options?: { cwd?: string; allowFailure?: boolean }) => { status: number | null; stdout: string; stderr: string };
  policy?: TestpassPolicy | null;
  policyReader?: (options: { repoRoot: string; remote: string }) => TestpassPolicy;
}): PublishOutcome;
export interface TestpassRefEntry {
  ref: string;
  objectId: string;
  version: number | null;
  treeName: string | null;
  objectType: string | null;
  actualTree: string | null;
  committerTime: number | null;
  valid: boolean;
}
export function listTestpassRefs(options?: {
  mode?: TestpassMode;
  repoRoot?: string;
  remote?: string;
  git?: (args: string[], options?: { cwd?: string; allowFailure?: boolean }) => { status: number | null; stdout: string; stderr: string };
  fetch?: boolean;
}): TestpassRefEntry[];
export interface TestpassPruneResult {
  status: "ok" | "refused" | "refused-policy" | "failed";
  mode: "age" | "dead-version" | "delete-ref";
  apply: boolean;
  version?: number;
  message?: string;
  candidates: TestpassRefEntry[];
  deleted: string[];
  failed: Array<{ ref: string; message: string }>;
  notDeleted: string[];
}
export function pruneTestpassRefs(options?: {
  mode?: TestpassMode;
  repoRoot?: string;
  remote?: string;
  olderThanDays?: number;
  deadVersion?: number | null;
  deleteRef?: string | null;
  apply?: boolean;
  now?: number;
  git?: (args: string[], options?: { cwd?: string; allowFailure?: boolean }) => { status: number | null; stdout: string; stderr: string };
  env?: Record<string, string | undefined>;
  fetch?: boolean;
}): TestpassPruneResult;
export function collectRunSurfaces(runDir: string, options?: { fs?: { readFileSync(path: string, encoding: string): string } }): Array<{ id: string; status: string }>;
export function canonicalRetryFacts(options?: { retriesOption?: string; env?: Record<string, string | undefined> }): boolean;
export function maybePublishAttestation(options: {
  facts: Parameters<typeof evaluateEligibility>[0];
  commit: string;
  mode: TestpassMode;
  remote?: string;
  repoRoot?: string;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  publish?: typeof publishAttestation;
}): { published: boolean; reason: string; ref?: string; failures?: string[] };
