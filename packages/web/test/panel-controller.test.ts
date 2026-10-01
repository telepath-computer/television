// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PanelController } from "../src/elements/panel-controller.ts";

// Contract: proofs/ui/foundation/popover/index.md#^po-ac-resource-cleanup.
// jsdom and the recording frame scheduler forfeit real browser scheduling,
// observation, layout, and input delivery to test/e2e/panel-elements.test.ts.
describe("PanelController shared resource cleanup (^po-ac-resource-cleanup)", () => {
  it("retains shared resources until the last disconnect and recreates them on reconnect", () => {
    const fixture = document.createElement("section");
    fixture.innerHTML = `
      <button id="cleanup-first">First</button>
      <div trigger="cleanup-first" manual open></div>
      <button id="cleanup-second">Second</button>
      <div trigger="cleanup-second" manual open></div>
    `;
    document.body.append(fixture);
    const hosts = fixture.querySelectorAll<HTMLElement>("div");
    const first = new PanelController(hosts[0]!);
    const second = new PanelController(hosts[1]!);
    const registration = vi.spyOn(document, "addEventListener");
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const pending = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
      const id = nextFrame++;
      pending.set(id, callback);
      return id;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => {
      pending.delete(id);
    });

    function registeredSignals(): AbortSignal[] {
      const calls = registration.mock.calls.filter(([type]) =>
        ["click", "keydown", "pointermove"].includes(type));
      expect(calls.map(([type]) => type).sort()).toEqual(["click", "click", "keydown", "keydown", "pointermove"]);
      return calls.map(([, , options]) => {
        expect(options).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
        return (options as AddEventListenerOptions).signal!;
      });
    }

    try {
      first.connect();
      second.connect();

      const signals = registeredSignals();
      expect(new Set(signals).size).toBe(1);
      for (const signal of signals) expect(signal.aborted).toBe(false);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe.mock.calls[0]?.[0]).toBe(document);
      const observer = observe.mock.contexts[0];
      expect(disconnect).not.toHaveBeenCalled();
      expect(requestFrame).toHaveBeenCalledTimes(1);
      const frame = requestFrame.mock.results[0]!.value as number;
      expect(pending.has(frame)).toBe(true);
      expect(first.open).toBe(true);
      expect(second.open).toBe(true);

      first.disconnect();

      for (const signal of signals) expect(signal.aborted).toBe(false);
      expect(disconnect).not.toHaveBeenCalled();
      expect(cancelFrame).not.toHaveBeenCalled();
      expect(pending.has(frame)).toBe(true);
      expect(second.open).toBe(true);

      second.disconnect();

      for (const signal of signals) expect(signal.aborted).toBe(true);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(disconnect.mock.contexts[0]).toBe(observer);
      expect(cancelFrame).toHaveBeenCalledTimes(1);
      expect(cancelFrame).toHaveBeenCalledWith(frame);
      expect(pending.size).toBe(0);

      registration.mockClear();
      first.host.setAttribute("open", "");
      first.connect();

      const freshSignals = registeredSignals();
      expect(new Set(freshSignals).size).toBe(1);
      for (const signal of freshSignals) {
        expect(signal).not.toBe(signals[0]);
        expect(signal.aborted).toBe(false);
      }
      expect(observe).toHaveBeenCalledTimes(2);
      expect(observe.mock.calls[1]?.[0]).toBe(document);
      const freshObserver = observe.mock.contexts[1];
      expect(freshObserver).not.toBe(observer);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(requestFrame).toHaveBeenCalledTimes(2);
      const freshFrame = requestFrame.mock.results[1]!.value as number;
      expect(freshFrame).not.toBe(frame);
      expect(pending.has(freshFrame)).toBe(true);
      expect(first.open).toBe(true);

      first.disconnect();

      for (const signal of freshSignals) expect(signal.aborted).toBe(true);
      expect(disconnect).toHaveBeenCalledTimes(2);
      expect(disconnect.mock.contexts[1]).toBe(freshObserver);
      expect(cancelFrame).toHaveBeenCalledTimes(2);
      expect(cancelFrame).toHaveBeenNthCalledWith(2, freshFrame);
      expect(pending.size).toBe(0);
    } finally {
      first.disconnect();
      second.disconnect();
      // Also release recorded observers if an assertion exposes broken cleanup.
      for (const observer of observe.mock.contexts) (observer as MutationObserver).disconnect();
      vi.restoreAllMocks();
      fixture.remove();
    }
  });

  it("tracks descendant scrollers without walking the panel subtree during placement", () => {
    const fixture = document.createElement("section");
    fixture.innerHTML = `
      <button id="scroll-tracking-trigger">Open</button>
      <div trigger="scroll-tracking-trigger" open style="--popover-distance: 8px">
        <div class="scroller"></div>
      </div>
    `;
    document.body.append(fixture);
    const host = fixture.querySelector<HTMLElement>("[trigger]")!;
    const scroller = fixture.querySelector<HTMLElement>(".scroller")!;
    const query = vi.spyOn(host, "querySelectorAll");
    const controller = new PanelController(host);

    try {
      controller.connect();
      query.mockClear();
      scroller.scrollTop = 24;
      scroller.dispatchEvent(new Event("scroll"));

      controller.place();

      expect(query).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(24);
    } finally {
      controller.disconnect();
      vi.restoreAllMocks();
      fixture.remove();
    }
  });
});
