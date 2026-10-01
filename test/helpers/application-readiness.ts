import type { Page } from "@playwright/test";

export type ApplicationRenderState =
  | "connected"
  | "no-channel"
  | "empty-channel"
  | "disconnected"
  | "connecting"
  | "unauthorized"
  | "error"
  | "needs-upgrade";

export const APPLICATION_SHELL_STATES = ["connected", "no-channel", "empty-channel"] as const;

export async function retryWhenNavigationInterrupts<T>(
  page: Page,
  timeout: number,
  action: (remaining: number) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("Page navigation did not settle before the application-readiness deadline");
    }

    try {
      return await action(remaining);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const navigationInterruptedAction =
        message.includes("Execution context was destroyed") ||
        message.includes("Cannot find context with specified id") ||
        message.includes("Frame was detached");
      if (!navigationInterruptedAction || page.isClosed()) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: Math.max(1, deadline - Date.now()) });
    }
  }
}

/** Wait for the root's committed-state handoff without depending on child markup. */
export async function waitForApplicationRender(
  page: Page,
  expectedStates: readonly ApplicationRenderState[],
  timeout: number,
): Promise<void> {
  await retryWhenNavigationInterrupts(page, timeout, (remaining) =>
    page.evaluate(
      ({ expectedStates, timeout }) =>
        new Promise<void>((resolve, reject) => {
          const expected = new Set<string>(expectedStates);
          const readState = (): string | null =>
            document.querySelector("#app")?.getAttribute("data-app-state") ?? null;
          const owner = window as unknown as {
            __telepath?: { renderCompleteCallbacks?: Set<(state: string) => void> };
          };
          const callbacks = (owner.__telepath ??= {}).renderCompleteCallbacks ??= new Set();
          let timeoutID: ReturnType<typeof setTimeout>;
          const cleanup = (): void => {
            callbacks.delete(handleRender);
            clearTimeout(timeoutID);
          };
          const finishIfReady = (): boolean => {
            const state = readState();
            if (state === null || !expected.has(state)) return false;
            cleanup();
            resolve();
            return true;
          };
          const handleRender = (_state: string): void => {
            finishIfReady();
          };

          callbacks.add(handleRender);
          timeoutID = setTimeout(() => {
            const state = readState();
            cleanup();
            reject(new Error(`Application root did not render an expected state; last state: ${state ?? "missing"}`));
          }, timeout);
          finishIfReady();
        }),
      { expectedStates, timeout: remaining },
    )
  );
}
