// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit-html";
import type {
  ApplicationChannelSnapshot,
  ApplicationSnapshot,
} from "../src/services/application-service.ts";
import {
  calculateChannelSidebarGrip,
  ChannelSidebarView,
} from "../src/views/channel-sidebar.ts";

function channel(id: string, name: string): ApplicationChannelSnapshot {
  return {
    id,
    name,
    pages: [],
    selectedPage: null,
    artifacts: [],
  };
}

function snapshot(
  channels: readonly ApplicationChannelSnapshot[],
  pinnedChannelIds: readonly string[],
  focusedChannelId: string | null,
): ApplicationSnapshot {
  return {
    ready: true,
    channels,
    display: {
      focusedChannelId,
      pinnedChannelIds,
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    },
    focusedChannel: channels.find(({ id }) => id === focusedChannelId) ?? null,
    connection: {
      authorizationRequired: false,
      authorizationRejected: false,
      gateHalted: false,
      status: "connected",
      hasEverConnected: true,
      firstConnectError: null,
      nextRetryAt: null,
      upgradeInstructions: null,
    },
  };
}

class FakeApplication {
  focusChannel = vi.fn(async (_channelId: string) => undefined);
  setPinnedChannelIds = vi.fn(async (_channelIds: readonly string[]) => undefined);
  renameChannel = vi.fn(async (_channelId: string, _name: string) => undefined);
  createChannel = vi.fn(async (_name: string) => ({ id: "created" }));
  deleteChannel = vi.fn(async (_channelId: string) => undefined);
}

function draw(
  host: HTMLElement,
  application: FakeApplication,
  value: ApplicationSnapshot,
): void {
  render(
    html`${ChannelSidebarView(application as never, value, true, () => undefined)}`,
    host,
  );
}

function rowNames(host: HTMLElement, group: number): string[] {
  return [...host.querySelectorAll(`.channel-group:nth-of-type(${group}) .channel`)]
    .map((element) => element.textContent?.trim() ?? "");
}

function pointerEvent(
  type: string,
  { x, y, buttons = 1 }: { x: number; y: number; buttons?: number },
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    buttons,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerId", { value: 17 });
  return event;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("channel sidebar drag grip (partial ^sb-ac-drag)", () => {
  it("keeps a grip that already fits inside the compact preview", () => {
    expect(calculateChannelSidebarGrip({
      wideRow: { left: 100, right: 400, top: 20, bottom: 52 },
      compactPreviewWidth: 160,
      pointer: { x: 180, y: 30 },
    })).toEqual({
      wideOffsetX: 80,
      previewOffsetX: 80,
      correctionX: 0,
      offsetY: 10,
    });
  });

  it("moves a far-edge grip inward when the row becomes compact", () => {
    expect(calculateChannelSidebarGrip({
      wideRow: { left: 100, right: 400, top: 20, bottom: 52 },
      compactPreviewWidth: 160,
      pointer: { x: 380, y: 46 },
    })).toEqual({
      wideOffsetX: 280,
      previewOffsetX: 136,
      correctionX: 144,
      offsetY: 26,
    });
  });
});

describe("channel sidebar base markup (^sb-ac-markup-smoke)", () => {
  it("renders empty, single-group, and combined ordered channel states", () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);

    draw(host, application, snapshot([], [], null));
    expect(host.querySelectorAll(":scope > .sidebar")).toHaveLength(1);
    expect(host.querySelector(".sidebar-titlebar")?.hasAttribute("electron-draggable")).toBe(true);
    expect(host.querySelectorAll(".channel-group")).toHaveLength(0);
    const create = host.querySelector(".sidebar-titlebar > .channel-create");
    expect(create?.getAttribute("aria-label")).toBe("New channel");
    expect(create?.getAttribute("title")).toBe("New channel");
    expect(create?.getAttribute("variant")).toBe("ghost");
    expect(create?.hasAttribute("icon")).toBe(true);

    const channels = [
      channel("01J00000000000000000000004", "Pinned second"),
      channel("01J00000000000000000000005", "Pinned first"),
      channel("01J00000000000000000000003", "Recent older"),
      channel("01J00000000000000000000009", "A complete and deliberately very long channel name"),
    ];

    draw(host, application, snapshot(channels, [channels[1].id, channels[0].id], channels[0].id));
    expect([...host.querySelectorAll(".channel-group-label")].map((label) => label.textContent))
      .toEqual(["Pinned", "Recent"]);
    expect(rowNames(host, 1)).toEqual(["Pinned first", "Pinned second"]);
    expect(rowNames(host, 2)).toEqual([
      "A complete and deliberately very long channel name",
      "Recent older",
    ]);
    expect(host.querySelectorAll('.sidebar-body > .channel-list[role="listbox"][aria-label="Channels"] .channel[role="option"]')).toHaveLength(channels.length);
    expect(host.querySelectorAll('.channel[aria-selected="true"]')).toHaveLength(1);
    expect(host.querySelector('.channel[aria-selected="true"]')?.textContent?.trim())
      .toBe("Pinned second");

    draw(host, application, snapshot([channels[3], channels[2]], [], channels[3].id));
    expect([...host.querySelectorAll(".channel-group-label")].map((label) => label.textContent))
      .toEqual(["Recent"]);
    expect(rowNames(host, 1)).toEqual([
      "A complete and deliberately very long channel name",
      "Recent older",
    ]);

    draw(host, application, snapshot([channels[3], channels[2]], [], null));
    expect(host.querySelectorAll('.channel[aria-selected="true"]')).toHaveLength(1);
    expect(host.querySelector('.channel[aria-selected="true"]')?.textContent?.trim())
      .toBe("A complete and deliberately very long channel name");
  });

  it("renders the authored menu commands for pinned and unpinned rows", () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);
    const pinned = channel("01J00000000000000000000002", "Pinned channel");
    const unpinned = channel("01J00000000000000000000001", "Recent channel");

    draw(host, application, snapshot([pinned, unpinned], [pinned.id], pinned.id));

    const rows = [...host.querySelectorAll<HTMLElement>(".channel-row")];
    const menus = rows.map((row) => {
      const trigger = row.querySelector<HTMLButtonElement>(".channel-menu-trigger");
      const menu = row.querySelector<HTMLElement>("tv-menu");
      if (!trigger || !menu) throw new Error("Expected channel menu pair");
      expect(trigger.id).not.toBe("");
      expect(trigger.nextElementSibling).toBe(menu);
      expect(menu.getAttribute("trigger")).toBe(trigger.id);
      return menu;
    });
    expect(menus).toHaveLength(2);
    expect(new Set(menus.map((menu) => menu.getAttribute("trigger"))).size).toBe(2);
    expect(menus.map((menu) => [...menu.querySelectorAll("tv-menu-item")]
      .map((item) => item.textContent?.trim()))).toEqual([
      ["Rename", "Unpin", "Delete"],
      ["Rename", "Pin", "Delete"],
    ]);
    expect(menus.map((menu) => menu.querySelectorAll("hr").length))
      .toEqual([1, 1]);
    expect(menus.map((menu) => menu.querySelector('[intent="danger"]')?.textContent?.trim()))
      .toEqual(["Delete", "Delete"]);
  });

  it("renders beginning, middle, and end placeholders plus the carried Unpin action", async () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);
    const pinned = [
      channel("01J00000000000000000000004", "Pinned first"),
      channel("01J00000000000000000000003", "Pinned second"),
      channel("01J00000000000000000000002", "Pinned third"),
    ];
    const recent = channel("01J00000000000000000000001", "Recent channel");
    const captures = new WeakMap<HTMLElement, Set<number>>();
    const setPointerCapture = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "setPointerCapture",
    );
    const hasPointerCapture = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "hasPointerCapture",
    );
    const releasePointerCapture = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "releasePointerCapture",
    );
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: {
        configurable: true,
        value(pointerId: number) {
          const held = captures.get(this) ?? new Set<number>();
          held.add(pointerId);
          captures.set(this, held);
        },
      },
      hasPointerCapture: {
        configurable: true,
        value(pointerId: number) {
          return captures.get(this)?.has(pointerId) ?? false;
        },
      },
      releasePointerCapture: {
        configurable: true,
        value(pointerId: number) {
          captures.get(this)?.delete(pointerId);
        },
      },
    });
    const rowTops = new Map([
      [pinned[0]!.id, 72],
      [pinned[1]!.id, 104],
      [pinned[2]!.id, 136],
      [recent.id, 232],
    ]);
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.matches(".sidebar")) return rect(0, 0, 300, 500);
        if (this.matches(".channel-placeholder")) {
          const base = this.dataset.channelSide === "pinned" ? 72 : 232;
          return rect(16, base + Number(this.dataset.channelIndex) * 32, 268, 32);
        }
        if (this.matches('.channel-group[data-channel-side="pinned"]')) {
          return rect(8, 48, 284, 136);
        }
        if (this.matches('.channel-group[data-channel-side="unpinned"]')) {
          return rect(8, 216, 284, 80);
        }
        const row = this.matches(".channel-row")
          ? this
          : this.closest<HTMLElement>(".channel-row");
        if (row !== null) {
          if (row.classList.contains("dragged")) {
            if (row.style.left === "-10000px") return rect(-10_000, -10_000, 160, 32);
            return rect(
              Number.parseFloat(row.style.left),
              Number.parseFloat(row.style.top),
              Number.parseFloat(row.style.width),
              Number.parseFloat(row.style.height),
            );
          }
          return rect(16, rowTops.get(row.dataset.channelId ?? "") ?? 0, 268, 32);
        }
        if (this.classList.contains("dragged")) return rect(-10_000, -10_000, 160, 32);
        return rect(0, 0, 0, 0);
      });

    try {
      draw(
        host,
        application,
        snapshot([...pinned, recent], pinned.map(({ id }) => id), pinned[0]!.id),
      );
      const recentButton = [...host.querySelectorAll<HTMLButtonElement>(".channel")]
        .find((button) => button.textContent?.trim() === recent.name);
      if (recentButton === undefined) throw new Error("Recent row did not render");
      recentButton.dispatchEvent(pointerEvent("pointerdown", { x: 260, y: 248 }));
      window.dispatchEvent(pointerEvent("pointermove", { x: 80, y: 60 }));
      await Promise.resolve();
      expect(host.querySelector(".channel-placeholder")?.getAttribute("data-channel-index"))
        .toBe("0");

      window.dispatchEvent(pointerEvent("pointermove", { x: 80, y: 112 }));
      await Promise.resolve();
      expect(host.querySelector(".channel-placeholder")?.getAttribute("data-channel-index"))
        .toBe("1");

      window.dispatchEvent(pointerEvent("pointermove", { x: 80, y: 176 }));
      await Promise.resolve();
      expect(host.querySelector(".channel-placeholder")?.getAttribute("data-channel-index"))
        .toBe("3");
      expect(host.querySelector<HTMLElement>(".channel-row.dragged")?.dataset.channelId)
        .toBe(recent.id);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
      const pinnedButton = [...host.querySelectorAll<HTMLButtonElement>(".channel")]
        .find((button) => button.textContent?.trim() === pinned[1]!.name);
      if (pinnedButton === undefined) throw new Error("Pinned row did not render");
      pinnedButton.dispatchEvent(pointerEvent("pointerdown", { x: 260, y: 120 }));
      window.dispatchEvent(pointerEvent("pointermove", { x: 380, y: 120 }));
      await Promise.resolve();
      expect(host.querySelector(".channel-row.unpinning .channel-drag-action")
        ?.textContent?.trim()).toBe("Unpin");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
    } finally {
      bounds.mockRestore();
      for (const [name, descriptor] of [
        ["setPointerCapture", setPointerCapture],
        ["hasPointerCapture", hasPointerCapture],
        ["releasePointerCapture", releasePointerCapture],
      ] as const) {
        if (descriptor === undefined) {
          delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
        } else {
          Object.defineProperty(HTMLElement.prototype, name, descriptor);
        }
      }
    }
  });
});

describe("channel sidebar titlebar controls (^sb-ac-titlebar-controls)", () => {
  it("renders create, separator, and collapse controls in order", () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);

    draw(host, application, snapshot([], [], null));

    const titlebar = host.querySelector<HTMLElement>(".sidebar-titlebar")!;
    expect([...titlebar.children].map((element) => ({
      tag: element.tagName,
      className: element.className,
    }))).toEqual([
      { tag: "BUTTON", className: "channel-create" },
      { tag: "SPAN", className: "toolbar-separator" },
      { tag: "BUTTON", className: "sidebar-collapse" },
    ]);

    const create = titlebar.querySelector<HTMLButtonElement>(":scope > .channel-create")!;
    expect(create.type).toBe("button");
    expect(create.getAttribute("variant")).toBe("ghost");
    expect(create.hasAttribute("icon")).toBe(true);
    expect(create.getAttribute("aria-label")).toBe("New channel");
    expect(create.title).toBe("New channel");
    expect(create.querySelector("tv-icon")?.getAttribute("name")).toBe("add");

    const separator = titlebar.querySelector<HTMLElement>(":scope > .toolbar-separator")!;
    expect(separator.getAttribute("role")).toBe("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");

    const collapse = titlebar.querySelector<HTMLButtonElement>(":scope > .sidebar-collapse")!;
    expect(collapse.type).toBe("button");
    expect(collapse.getAttribute("variant")).toBe("ghost");
    expect(collapse.hasAttribute("icon")).toBe(true);
    expect(collapse.getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(collapse.title).toBe("Collapse sidebar");
    expect([...collapse.children].map((child) => ({
      tag: child.tagName,
      name: child.getAttribute("name"),
    }))).toEqual([{ tag: "TV-ICON", name: "sidebar" }]);
  });
});

describe("channel sidebar create identity", () => {
  it("waits for the local create result before choosing the entering row", async () => {
    const application = new FakeApplication();
    const host = document.createElement("div");
    document.body.append(host);
    const existing = channel("01J00000000000000000000001", "Existing");
    const remote = channel("01J00000000000000000000003", "New channel");
    const local = channel("01J00000000000000000000002", "New channel");
    let resolveCreate!: (value: { id: string }) => void;
    application.createChannel.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    draw(host, application, snapshot([existing], [], existing.id));
    (host.querySelector(".channel-create") as HTMLButtonElement).click();
    expect(application.createChannel).toHaveBeenCalledWith("New channel");

    draw(host, application, snapshot([existing, remote], [], existing.id));
    await Promise.resolve();
    expect(host.querySelectorAll('.channel-row[data-channel-id="01J00000000000000000000003"] .channel-rename'))
      .toHaveLength(0);

    resolveCreate({ id: local.id });
    await Promise.resolve();
    draw(host, application, snapshot([existing, remote, local], [], local.id));
    await Promise.resolve();
    expect(host.querySelector('.channel-row[data-channel-id="01J00000000000000000000002"] .channel-rename'))
      .not.toBeNull();
    expect(host.querySelector('.channel-row[data-channel-id="01J00000000000000000000003"] .channel-rename'))
      .toBeNull();
  });
});
