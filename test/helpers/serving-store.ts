import { ServerStore, type ServerStoreOptions } from "@telepath-computer/television-server";

export type ServingStoreOverrides = Omit<ServerStoreOptions, "storagePath" | "installOnboardingChannels">;

/**
 * A `ServerStore` constructed in **serving** mode: the full bootstrap
 * including the onboarding install phase, the default-screen invariant,
 * display state, and watchers (`installOnboardingChannels: true` —
 * specs/arch/onboarding/installer.md#^bootstrap-sequence). This is the mode
 * almost every test wants; the helper's name carries the semantics and
 * absorbs future `ServerStoreOptions` churn at one site.
 *
 * Deliberately token-only (non-serving) constructions must NOT use this
 * helper: they stay as raw `new ServerStore({ ..., installOnboardingChannels:
 * false })` so non-serving-ness is visible at the call site. Tests whose
 * subject is the constructor's mode/option behavior itself also stay raw.
 */
export function createServingStore(storagePath: string, overrides: ServingStoreOverrides = {}): ServerStore {
  return new ServerStore({ storagePath, installOnboardingChannels: true, ...overrides });
}
