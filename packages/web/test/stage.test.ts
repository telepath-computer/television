// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit-html";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
} from "@telepath-computer/television-shared";
import type { Artifact } from "@telepath-computer/television-artifact";
import type {
  ApplicationChannelSnapshot,
  ApplicationPageSnapshot,
} from "../src/services/application-service.ts";
import { StageView } from "../src/views/stage.ts";

// Expected copy restated from specs/ui/app/stage/content.yml.
const EMPTY_LINE = "No artifacts yet — ask your agent to put something here.";

const artifacts: readonly Artifact[] = [
  { id: "artifact-a", kind: "path", title: "Alpha", path: "/tmp/alpha.html" },
  { id: "artifact-b", kind: "path", title: "Beta", path: "/tmp/beta.html" },
];

const PAGE_SIZES = {
  "artifact-a": { width: 511.25, height: 711.5 },
  "artifact-b": { width: 622.75, height: 722.25 },
} as const;

function page(artifactId: string, fullScreen = false): ApplicationPageSnapshot {
  return {
    artifactIds: [artifactId],
    geometry: { ...DEFAULT_PAGE_GEOMETRY, full_screen: fullScreen },
    size: { ...(PAGE_SIZES[artifactId as keyof typeof PAGE_SIZES] ?? DEFAULT_PAGE_SIZE) },
  };
}

function channel(pages: readonly ApplicationPageSnapshot[]): ApplicationChannelSnapshot {
  return {
    id: "channel-1",
    name: "Research",
    pages,
    selectedPage: pages[1] ?? pages[0] ?? null,
    artifacts,
  };
}

function singleArtifactChannel(
  id: string,
  artifact: Artifact,
): ApplicationChannelSnapshot {
  const onlyPage = page(artifact.id);
  return {
    id,
    name: id,
    pages: [onlyPage],
    selectedPage: onlyPage,
    artifacts: [artifact],
  };
}

class FakeApplication extends EventTarget {
  readonly pageUpdates: Array<{
    channelID: string;
    pages: readonly ApplicationPageSnapshot[];
  }> = [];

  getArtifactViewURL(artifact: Artifact): string {
    return `/artifact/${artifact.id}`;
  }

  getArtifactContentURL(): null {
    return null;
  }

  updateChannelPages(
    channelID: string,
    pages: readonly ApplicationPageSnapshot[],
  ): Promise<void> {
    this.pageUpdates.push({ channelID, pages });
    return Promise.resolve();
  }
}

function draw(
  host: HTMLElement,
  application: FakeApplication,
  value: ApplicationChannelSnapshot | null,
): void {
  render(html`${StageView(application as never, value)}`, host);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("stage channel cleanup (^st-ac-channel-cleanup)", () => {
  // spec: proofs/ui/app/stage/index.md#^st-ac-channel-cleanup
  it("changing channels releases discarded artifact frame listeners", () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    draw(host, application, singleArtifactChannel("channel-a", {
      id: "artifact-a",
      kind: "path",
      title: "Alpha",
      path: "/tmp/alpha.html",
    }));
    const discardedListener = addEventListener.mock.calls.find(
      ([type]) => type === "message",
    )?.[1];
    expect(discardedListener).toEqual(expect.any(Function));

    draw(host, application, singleArtifactChannel("channel-b", {
      id: "artifact-b",
      kind: "path",
      title: "Beta",
      path: "/tmp/beta.html",
    }));

    expect(removeEventListener).toHaveBeenCalledWith("message", discardedListener);
    const discardedRemovalIndex = removeEventListener.mock.calls.findIndex(
      ([type, listener]) => type === "message" && listener === discardedListener,
    );
    const messageAddIndexes = addEventListener.mock.calls.flatMap(
      ([type], index) => type === "message" ? [index] : [],
    );
    expect(discardedRemovalIndex).toBeGreaterThanOrEqual(0);
    expect(messageAddIndexes).toHaveLength(2);
    const replacementAddIndex = messageAddIndexes[1];
    if (replacementAddIndex === undefined) throw new Error("Expected replacement listener");
    expect(removeEventListener.mock.invocationCallOrder[discardedRemovalIndex])
      .toBeLessThan(addEventListener.mock.invocationCallOrder[replacementAddIndex]!);
    render(null, host);
  });
});

describe("stage structure (^st-ac-markup-smoke)", () => {
  it("renders no-channel, empty-channel, and ordered populated page states", () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);

    draw(host, application, null);
    expect(host.querySelectorAll(":scope > .stage")).toHaveLength(1);
    expect(host.querySelector(".stage-empty")).toBeNull();
    expect(host.querySelectorAll(".page")).toHaveLength(0);

    draw(host, application, channel([]));
    expect(host.querySelectorAll(".page")).toHaveLength(0);
    expect(host.querySelector('.stage-empty tv-icon[name="artifact"]')).not.toBeNull();
    expect(host.querySelector(".stage-empty p")?.textContent).toBe(EMPTY_LINE);

    const pages = [page("artifact-a"), page("artifact-b", true)];
    draw(host, application, channel(pages));

    expect(host.querySelector(".stage-empty")).toBeNull();
    const renderedPages = [...host.querySelectorAll<HTMLElement>(".page")];
    expect(renderedPages).toHaveLength(2);
    expect(renderedPages.map((element) => element.dataset.pageKey))
      .toEqual(["artifact-a", "artifact-b"]);
    expect(renderedPages.map((element) => element.querySelectorAll(":scope > .artifact-view").length))
      .toEqual([1, 1]);
    expect(renderedPages.map((element) => element.hasAttribute("selected"))).toEqual([false, true]);
    expect(renderedPages.map((element) =>
      element.querySelector(".artifact-view")?.hasAttribute("inert")
    )).toEqual([true, false]);
    expect(renderedPages.map((element) => element.hasAttribute("full-screen"))).toEqual([false, true]);

    const frames = renderedPages.map((element) =>
      element.querySelector(".artifact-view") as HTMLElement
    );
    const menuIds = frames.map((frame) => {
      const trigger = frame.querySelector<HTMLButtonElement>(".artifact-menu-trigger");
      const menu = frame.querySelector<HTMLElement>("tv-menu");
      if (!trigger || !menu) throw new Error("Expected artifact menu pair");
      expect(trigger.nextElementSibling).toBe(menu);
      expect(menu.getAttribute("trigger")).toBe(trigger.id);
      return trigger.id;
    });
    expect(new Set(menuIds).size).toBe(2);
    expect(frames.map((frame) => frame.hasAttribute("full-screen"))).toEqual([false, true]);

    [...frames[0]!.querySelectorAll<HTMLElement>("tv-menu-item")]
      .find((item) => item.textContent?.trim() === "Make full-screen")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(application.pageUpdates).toEqual([{
      channelID: "channel-1",
      pages: [
        page("artifact-a", true),
        page("artifact-b", true),
      ],
    }]);
  });
});
