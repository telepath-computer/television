// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit-html";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
} from "@telepath-computer/television-shared";
import type {
  ApplicationChannelSnapshot,
  ApplicationService,
} from "../services/application-service.ts";
import { TabStripView } from "./tab-strip.ts";

const application = {
  selectPage: vi.fn(),
  updateChannelPages: vi.fn(() => Promise.resolve()),
} as unknown as ApplicationService;

const PAGE_SIZES = [
  { width: 501.25, height: 701.5 },
  { width: 512.75, height: 712.25 },
  { width: 523.5, height: 723.75 },
] as const;
const TAB_HEIGHT_PX = 32;
const POINTER_ORIGIN_X = 50;
const POINTER_PICKUP_X = 55;
const CARRIED_TAB_REORDERED_LEFT_PX = 220;
const POINTER_RELEASE_X = 270;
const CAPPED_RANGE_WIDTH_PX = 102;

function channel(
  titles: readonly string[],
  selectedIndex: number,
): ApplicationChannelSnapshot {
  const artifacts = titles.map((title, index) => ({
    id: `artifact-${index}`,
    kind: "path" as const,
    path: `/tmp/artifact-${index}.html`,
    title,
  }));
  const pages = artifacts.map(({ id }, index) => ({
    artifactIds: [id],
    geometry: DEFAULT_PAGE_GEOMETRY,
    size: PAGE_SIZES[index] ?? DEFAULT_PAGE_SIZE,
  }));
  return {
    id: "channel-tabs",
    name: "Tab fixture",
    pages,
    selectedPage: pages[selectedIndex] ?? null,
    artifacts,
  };
}

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts) {
    render(null, host);
    host.remove();
  }
  hosts.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tab-strip markup (^tb-ac-markup-smoke)", () => {
  const rows = [
    {
      name: "empty strip",
      value: channel([], 0),
      titles: [] as string[],
      selectedIndex: -1,
      carriedArtifactId: null,
    },
    {
      name: "one tab",
      value: channel(["Company calendar"], 0),
      titles: ["Company calendar"],
      selectedIndex: 0,
      carriedArtifactId: null,
    },
    {
      name: "several tabs with a middle selection",
      value: channel(["Research", "Launch notes", "Customers"], 1),
      titles: ["Research", "Launch notes", "Customers"],
      selectedIndex: 1,
      carriedArtifactId: null,
    },
    {
      name: "one carried tab",
      value: channel(["Research", "Launch notes", "Customers"], 0),
      titles: ["Research", "Launch notes", "Customers"],
      selectedIndex: 0,
      carriedArtifactId: "artifact-1",
    },
  ] as const;

  for (const row of rows) {
    it(row.name, () => {
      const host = document.createElement("div");
      hosts.push(host);
      document.body.append(host);
      render(
        html`${TabStripView(application, row.value, row.carriedArtifactId)}`,
        host,
      );

      const strip = host.querySelector<HTMLElement>(".tab-strip");
      expect(strip?.getAttribute("role")).toBe("tablist");
      const tabs = [...host.querySelectorAll<HTMLElement>(".tab")];
      expect(tabs.map((tab) => tab.querySelector(".tab-label")?.textContent?.trim()))
        .toEqual(row.titles);
      expect(tabs).toHaveLength(row.titles.length);
      expect(host.querySelectorAll("tv-icon")).toHaveLength(0);

      for (const [index, tab] of tabs.entries()) {
        expect(tab.tagName).toBe("DIV");
        expect(tab.getAttribute("role")).toBe("tab");
        expect(tab.getAttribute("aria-selected")).toBe(
          index === row.selectedIndex ? "true" : "false",
        );
        expect(tab.getAttribute("tabindex")).toBe(
          index === row.selectedIndex ? "0" : "-1",
        );
        expect(tab.hasAttribute("aria-pressed")).toBe(false);
        expect(tab.hasAttribute("data-active")).toBe(false);
        expect(tab.children).toHaveLength(1);
        expect(tab.firstElementChild?.classList.contains("tab-label")).toBe(true);
        expect(tab.querySelectorAll("button, input, select, textarea, a")).toHaveLength(0);
      }

      expect(host.querySelectorAll('.tab[aria-selected="true"]')).toHaveLength(
        row.selectedIndex === -1 ? 0 : 1,
      );
      expect(host.querySelectorAll('.tab[tabindex="0"]')).toHaveLength(
        row.selectedIndex === -1 ? 0 : 1,
      );

      const placeholder = host.querySelector<HTMLElement>(".tab-placeholder");
      if (row.carriedArtifactId === null) {
        expect(placeholder).toBeNull();
        expect(host.querySelectorAll(".tab.dragged")).toHaveLength(0);
      } else {
        expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
        expect(placeholder?.nextElementSibling?.getAttribute("data-artifact-id"))
          .toBe(row.carriedArtifactId);
        expect(placeholder?.nextElementSibling?.classList.contains("dragged")).toBe(true);
        expect(host.querySelectorAll(".tab-placeholder")).toHaveLength(1);
      }
    });
  }

  it("classifies natural text without encoding an inline pixel floor", async () => {
    const host = document.createElement("div");
    hosts.push(host);
    document.body.append(host);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    const selectNodeContents = vi.fn();
    vi.spyOn(document, "createRange").mockReturnValue({
      selectNodeContents,
      getBoundingClientRect: () => new DOMRect(0, 0, CAPPED_RANGE_WIDTH_PX, 0),
    } as unknown as Range);
    render(html`${TabStripView(application, channel(["Next Actions"], 0))}`, host);

    await Promise.resolve();
    await Promise.resolve();

    const tab = host.querySelector<HTMLElement>(".tab")!;
    expect(selectNodeContents).toHaveBeenCalledWith(tab.querySelector(".tab-label"));
    expect(tab.dataset.compression).toBe("capped");
    expect(tab.style.minWidth).toBe("");
  });

  it("forwards every authored page size when a reorder commits", async () => {
    const host = document.createElement("div");
    hosts.push(host);
    document.body.append(host);
    const value = channel(["Research", "Launch notes", "Customers"], 0);
    render(html`${TabStripView(application, value)}`, host);

    const strip = host.querySelector<HTMLElement>(".tab-strip")!;
    Object.defineProperties(strip, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    const tabs = [...host.querySelectorAll<HTMLElement>(".tab")];
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => new DOMRect(index * 100, 0, 100, TAB_HEIGHT_PX);
    });
    const pointer = (type: string, clientX: number): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: 7 },
      });
      return event;
    };

    tabs[0]!.dispatchEvent(pointer("pointerdown", POINTER_ORIGIN_X));
    window.dispatchEvent(pointer("pointermove", POINTER_PICKUP_X));
    tabs[0]!.getBoundingClientRect = () =>
      new DOMRect(CARRIED_TAB_REORDERED_LEFT_PX, 0, 100, TAB_HEIGHT_PX);
    window.dispatchEvent(pointer("pointermove", POINTER_RELEASE_X));
    window.dispatchEvent(pointer("pointerup", POINTER_RELEASE_X));
    await Promise.resolve();

    expect(application.updateChannelPages).toHaveBeenCalledOnce();
    expect(application.updateChannelPages).toHaveBeenCalledWith(
      "channel-tabs",
      [value.pages[1], value.pages[2], value.pages[0]],
    );
  });
});
