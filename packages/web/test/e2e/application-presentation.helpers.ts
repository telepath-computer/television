import type { Page } from "@playwright/test";

const PRESENTATION_BINDING = "__tvRecordApplicationPresentation";
const SETTLEMENT_FRAME_LIMIT = 600;

export interface ApplicationPresentationRecord {
  readonly documentID: number;
  readonly source: "initial" | "mutation" | "render-complete" | "settled" | "stop";
  readonly eventState: string | null;
  readonly appState: string | null;
  readonly shellRegionCount: number;
  readonly sidebarCount: number;
  readonly mainCount: number;
  readonly modalHostCount: number;
  readonly authFormCount: number;
  readonly gateCount: number;
  readonly connectingCount: number;
  readonly disconnectedCount: number;
  readonly errorCount: number;
}

export interface ApplicationPresentationObservation {
  records(): readonly ApplicationPresentationRecord[];
  settle(): Promise<void>;
  stop(): Promise<void>;
}

interface BrowserPresentationRecorder {
  observer: MutationObserver;
  onRenderComplete: (state: string) => void;
  pending: Promise<void>;
  record(source: ApplicationPresentationRecord["source"], eventState?: string | null): void;
}

/**
 * Record every committed application presentation and every intervening root
 * mutation. Install before navigation when the boot handoff itself is the
 * subject; the binding keeps records across a top-level reload.
 */
export async function observeApplicationPresentations(
  page: Page,
): Promise<ApplicationPresentationObservation> {
  const records: ApplicationPresentationRecord[] = [];
  await page.exposeBinding(PRESENTATION_BINDING, (_source, record: ApplicationPresentationRecord) => {
    records.push(record);
  });
  await page.addInitScript(installRecorderInDocument);
  await page.evaluate(installRecorderInDocument);

  return {
    records: () => [...records],
    settle: () => settleApplicationPresentation(page),
    stop: () => stopApplicationPresentationRecorder(page),
  };
}

function installRecorderInDocument(): void {
  const owner = window as unknown as {
    __tvApp3PresentationRecorder?: BrowserPresentationRecorder;
    __tvRecordApplicationPresentation?: (record: ApplicationPresentationRecord) => Promise<void>;
    __telepath?: { renderCompleteCallbacks?: Set<(state: string) => void> };
  };
  if (owner.__tvApp3PresentationRecorder) return;
  const publish = owner.__tvRecordApplicationPresentation;
  if (!publish) throw new Error("APP-3 presentation binding is unavailable");

  const recorder = {} as BrowserPresentationRecorder;
  recorder.pending = Promise.resolve();
  recorder.record = (source, eventState = null) => {
    const root = document.querySelector("#app");
    const record: ApplicationPresentationRecord = {
      documentID: performance.timeOrigin,
      source,
      eventState,
      appState: root?.getAttribute("data-app-state") ?? null,
      shellRegionCount: root?.querySelectorAll(":scope > .app-sidebar, :scope > .app-main").length ?? 0,
      sidebarCount: root?.querySelectorAll(":scope > .app-sidebar").length ?? 0,
      mainCount: root?.querySelectorAll(":scope > .app-main").length ?? 0,
      modalHostCount: root?.querySelectorAll(":scope > .system-modal-host").length ?? 0,
      authFormCount: root?.querySelectorAll(".system-modal-host .auth-form").length ?? 0,
      gateCount: root?.querySelectorAll(".system-modal-host .desktop-upgrade-gate").length ?? 0,
      connectingCount: root?.querySelectorAll(".system-modal-host .system-modal h2").length
        ? [...root.querySelectorAll(".system-modal-host .system-modal h2")]
          .filter((heading) => heading.textContent?.trim() === "Connecting").length
        : 0,
      disconnectedCount: root?.querySelectorAll(".system-modal-host .system-modal h2").length
        ? [...root.querySelectorAll(".system-modal-host .system-modal h2")]
          .filter((heading) => heading.textContent?.trim() === "Disconnected").length
        : 0,
      errorCount: root?.querySelectorAll(".system-modal-host .system-modal h2").length
        ? [...root.querySelectorAll(".system-modal-host .system-modal h2")]
          .filter((heading) => heading.textContent?.trim() === "Can’t connect with server").length
        : 0,
    };
    recorder.pending = recorder.pending.then(() => publish(record));
  };
  recorder.onRenderComplete = (state: string) => {
    recorder.record("render-complete", state);
  };
  recorder.observer = new MutationObserver(() => recorder.record("mutation"));
  recorder.observer.observe(document, {
    attributes: true,
    attributeFilter: ["data-app-state"],
    childList: true,
    subtree: true,
  });
  ((owner.__telepath ??= {}).renderCompleteCallbacks ??= new Set()).add(
    recorder.onRenderComplete,
  );
  owner.__tvApp3PresentationRecorder = recorder;
  recorder.record("initial");
}

async function settleApplicationPresentation(page: Page): Promise<void> {
  await page.evaluate(async (frameLimit) => {
    const owner = window as unknown as {
      __tvApp3PresentationRecorder?: BrowserPresentationRecorder;
    };
    const recorder = owner.__tvApp3PresentationRecorder;
    if (!recorder) throw new Error("APP-3 presentation recorder is not installed");

    let stableFrames = 0;
    for (let frame = 0; frame < frameLimit; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const app = document.querySelector("#app");
      const active = app?.getAnimations({ subtree: true }).some((animation) =>
        animation.pending || animation.playState === "running"
      ) ?? false;
      stableFrames = active ? 0 : stableFrames + 1;
      if (stableFrames >= 2) {
        recorder.record("settled");
        await recorder.pending;
        return;
      }
    }
    throw new Error(`Application presentation did not settle within ${frameLimit} animation frames`);
  }, SETTLEMENT_FRAME_LIMIT);
}

async function stopApplicationPresentationRecorder(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const owner = window as unknown as {
      __tvApp3PresentationRecorder?: BrowserPresentationRecorder;
      __telepath?: { renderCompleteCallbacks?: Set<(state: string) => void> };
    };
    const recorder = owner.__tvApp3PresentationRecorder;
    if (!recorder) return;
    recorder.record("stop");
    await recorder.pending;
    recorder.observer.disconnect();
    owner.__telepath?.renderCompleteCallbacks?.delete(recorder.onRenderComplete);
    delete owner.__tvApp3PresentationRecorder;
  });
}
