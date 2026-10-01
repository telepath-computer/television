// The shared navigation-pending latch. `location.reload()` does not preempt
// the currently running task: after a reload is requested, the old page keeps
// executing until the navigation actually lands. Both sanctioned reload call
// sites — the stale-bundle reload agent (update-reload.ts,
// version-advertisement.md ^reload-action) and the gate controller's
// retraction exit (desktop-gate-runtime.ts, desktop-upgrade-gate.md
// ^gate-reevaluation) — begin their navigation THROUGH one shared latch, and
// the boot pipeline consults it, so the dying page is provably inert: no
// store bootstrap starts (server-connection.ts), no gate halt, render, or
// telemetry fires, and no second navigation is requested. This is also what
// enforces ^reload-gate-precedence beyond listener ordering: once the reload
// agent has navigated, the gate cannot act on the same (or any later) status.

export interface NavigationLatch {
  /** True once a navigation has been requested on this page. */
  readonly pending: boolean;
  /**
   * Request a navigation: runs `navigate` and latches, exactly once per page
   * — every later `begin()` is a no-op, whoever calls it.
   */
  begin(navigate: () => void): void;
}

export function createNavigationLatch(): NavigationLatch {
  let pending = false;
  return {
    get pending(): boolean {
      return pending;
    },
    begin(navigate: () => void): void {
      if (pending) return;
      pending = true;
      navigate();
    },
  };
}
