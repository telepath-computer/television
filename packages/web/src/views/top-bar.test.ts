// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit-html";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type ServerStatusMessage,
} from "@telepath-computer/television-shared";
import type {
  ApplicationChannelSnapshot,
  ApplicationSnapshot,
  ApplicationService,
} from "../services/application-service.ts";
import {
  FakeUpdateConnection,
  FakeUpdateConnectionOwner,
  dispatchServerStatus,
} from "../../test/helpers/update-status.ts";
import { TopBarView } from "./top-bar.ts";

vi.stubGlobal("ResizeObserver", class {
  observe(): void {}
  disconnect(): void {}
});

const PRIMARY = "http://primary.test";
const application = {
  snapshot: {
    connection: { status: "connected" },
    display: { activeThemeName: null, appearanceMode: "system" },
  },
  listThemes: async () => ({ themes: [], errors: [] }),
  refreshThemes: async () => ({ themes: [], errors: [] }),
  setActiveTheme: async () => {},
  setAppearanceMode: async () => {},
  selectPage: () => {},
} as unknown as ApplicationService;

function channel(
  titles: readonly string[],
  name = "Top bar fixture",
  id = "channel-top-bar",
): ApplicationChannelSnapshot {
  const artifacts = titles.map((title, index) => ({
    id: `artifact-${index}`,
    kind: "path" as const,
    path: `/tmp/artifact-${index}.html`,
    title,
  }));
  const pages = artifacts.map(({ id }) => ({
    artifactIds: [id],
    geometry: DEFAULT_PAGE_GEOMETRY,
    size: DEFAULT_PAGE_SIZE,
  }));
  return {
    id,
    name,
    pages,
    selectedPage: pages[0] ?? null,
    artifacts,
  };
}

function snapshot(
  channels: readonly ApplicationChannelSnapshot[],
  focusedChannelId: string | null = channels[0]?.id ?? null,
  pinnedChannelIds: readonly string[] = [],
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

function ownerWithNotice(notice: boolean): FakeUpdateConnectionOwner {
  const owner = new FakeUpdateConnectionOwner(new FakeUpdateConnection(PRIMARY));
  if (notice) {
    const message: ServerStatusMessage = {
      type: "server-status",
      version: "1.0.0",
      requiredDesktopVersion: null,
      update: {
        toast: {
          version: "1.5.0",
          markdown: "**Television 1.5.0** is available.",
          prompt: "Upgrade Television",
        },
        desktop: null,
      },
    };
    dispatchServerStatus(owner, message, PRIMARY);
  }
  return owner;
}

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts) {
    render(null, host);
    host.remove();
  }
  hosts.length = 0;
});

describe("top-bar markup (^top-ac-markup-smoke)", () => {
  const rows = [
    { name: "empty strip without a notice", titles: [] as string[], notice: false },
    {
      name: "populated tabs without a notice",
      titles: ["Research", "Launch notes"],
      notice: false,
    },
    {
      name: "populated tabs with a notice",
      titles: ["Research", "Launch notes"],
      notice: true,
    },
  ] as const;

  for (const row of rows) {
    it(row.name, () => {
      const host = document.createElement("div");
      hosts.push(host);
      document.body.append(host);
      const focused = channel(row.titles);
      render(
        html`${TopBarView(application, snapshot([focused]), {
          connectionOwner: ownerWithNotice(row.notice),
          primaryServerURL: PRIMARY,
        })}`,
        host,
      );

      const bar = host.querySelector<HTMLElement>(":scope > .top-bar");
      expect(bar).not.toBeNull();
      expect(bar?.children).toHaveLength(2);
      expect(bar?.children[0]?.classList.contains("tab-strip")).toBe(true);
      expect(bar?.children[1]?.classList.contains("top-bar-controls")).toBe(true);

      const tabs = [...bar!.querySelectorAll<HTMLElement>(".tab-label")];
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(row.titles);

      const controls = bar!.querySelector<HTMLElement>(":scope > .top-bar-controls")!;
      expect(controls.children[0]?.classList.contains("skill-trigger")).toBe(true);
      expect(controls.children[1]?.classList.contains("skill-popover")).toBe(true);
      const settingsTrigger = controls.querySelector<HTMLElement>(".settings-trigger")!;
      expect(controls.children[2]).toBe(settingsTrigger);
      expect(settingsTrigger.nextElementSibling?.classList.contains("settings-popover")).toBe(true);
      expect(controls.querySelectorAll(".skill-trigger")).toHaveLength(1);
      expect(controls.querySelectorAll(".settings-trigger")).toHaveLength(1);
      expect(controls.querySelectorAll(".update-bell")).toHaveLength(row.notice ? 1 : 0);
      expect(controls.querySelectorAll(".update-popover")).toHaveLength(row.notice ? 1 : 0);
      if (row.notice) {
        expect(settingsTrigger.nextElementSibling?.nextElementSibling?.classList.contains("update-bell")).toBe(true);
        expect(controls.lastElementChild?.classList.contains("update-popover")).toBe(true);
      }
    });
  }
});

describe("top-bar lead markup (^top-ac-lead-markup)", () => {
  it("renders open-sidebar, collapsed-channel, open-switcher, and no-channel poses", async () => {
    const host = document.createElement("div");
    hosts.push(host);
    document.body.append(host);
    const pinned = channel([], "Pinned channel", "channel-pinned");
    const recent = channel([], "Recent channel", "channel-recent");
    const populated = snapshot(
      [recent, pinned],
      recent.id,
      [pinned.id],
    );
    const draw = (
      state: ApplicationSnapshot,
      options: Parameters<typeof TopBarView>[2] = {},
    ) => render(html`${TopBarView(application, state, options)}`, host);

    draw(populated);
    expect(host.querySelector(".top-bar-lead")).toBeNull();

    draw(populated, { collapsed: true });
    const bar = host.querySelector<HTMLElement>(":scope > .top-bar")!;
    expect([...bar.children].map(({ className }) => className)).toEqual([
      "top-bar-lead",
      "tab-strip",
      "top-bar-controls",
    ]);
    const lead = bar.querySelector<HTMLElement>(":scope > .top-bar-lead")!;
    const expand = lead.querySelector<HTMLButtonElement>(":scope > .sidebar-expand")!;
    expect(expand.tagName).toBe("BUTTON");
    expect(expand.type).toBe("button");
    expect(expand.getAttribute("variant")).toBe("ghost");
    expect(expand.hasAttribute("icon")).toBe(true);
    expect(expand.getAttribute("aria-label")).toBe("Show sidebar");
    expect(expand.title).toBe("Show sidebar");
    expect(expand.querySelector("tv-icon")?.getAttribute("name")).toBe("sidebar");

    const switcher = lead.querySelector<HTMLButtonElement>(":scope > .channel-switcher")!;
    expect(switcher.tagName).toBe("BUTTON");
    expect(switcher.type).toBe("button");
    expect(switcher.getAttribute("variant")).toBe("ghost");
    expect(switcher.hasAttribute("target")).toBe(true);
    expect(switcher.getAttribute("aria-haspopup")).toBe("listbox");
    expect(switcher.querySelector(".channel-switcher-name")?.textContent?.trim())
      .toBe("Recent channel");
    expect(switcher.querySelector("tv-icon")?.getAttribute("name")).toBe("select");
    expect(switcher.id).not.toBe("");

    expect(lead.querySelector(":scope > tv-popover.channel-switcher-pop")).toBeNull();
    expect(switcher.hasAttribute("aria-expanded")).toBe(false);

    const documentClick = vi.fn();
    document.addEventListener("click", documentClick, { once: true });
    switcher.click();
    expect(documentClick).toHaveBeenCalledOnce();
    await Promise.resolve();
    const popover = lead.querySelector<HTMLElement>(":scope > tv-popover.channel-switcher-pop")!;
    expect(popover.getAttribute("trigger")).toBe(switcher.id);
    expect(popover.hasAttribute("manual")).toBe(false);
    expect(popover.hasAttribute("open")).toBe(true);
    expect(switcher.getAttribute("aria-expanded")).toBe("true");
    expect(popover.querySelector(":scope > .channel-switcher-pop-body > .channel-list[role='listbox'][aria-label='Channels']"))
      .not.toBeNull();
    expect([...popover.querySelectorAll(".channel-group-label")].map((label) =>
      label.textContent?.trim()
    )).toEqual(["Pinned", "Recent"]);
    expect([...popover.querySelectorAll(".channel")].map((row) => row.textContent?.trim()))
      .toEqual(["Pinned channel", "Recent channel"]);
    expect(popover.querySelectorAll('.channel[aria-selected="true"]')).toHaveLength(1);
    expect(popover.querySelector('.channel[aria-selected="true"]')?.textContent?.trim())
      .toBe("Recent channel");
    expect(popover.querySelectorAll(".channel-menu-trigger")).toHaveLength(2);
    expect(popover.querySelectorAll("tv-menu")).toHaveLength(2);
    expect(popover.querySelector(".channel-menu-trigger")?.getAttribute("aria-haspopup"))
      .toBe("menu");

    const footer = popover.querySelector<HTMLElement>(":scope > .channel-switcher-pop-footer")!;
    const create = footer.querySelector<HTMLButtonElement>(":scope > .channel-create")!;
    expect(create.tagName).toBe("BUTTON");
    expect(create.type).toBe("button");
    expect(create.getAttribute("variant")).toBe("ghost");
    expect(create.hasAttribute("icon")).toBe(true);
    expect(create.getAttribute("aria-label")).toBe("New channel");
    expect(create.title).toBe("New channel");
    expect(create.querySelector("tv-icon")?.getAttribute("name")).toBe("add");

    const triggerId = switcher.id;
    draw(snapshot([pinned, recent], pinned.id, [pinned.id]), {
      collapsed: true,
    });
    expect(host.querySelector<HTMLButtonElement>(".channel-switcher")?.id).toBe(triggerId);
    expect(host.querySelector("tv-popover.channel-switcher-pop")?.hasAttribute("open"))
      .toBe(true);

    host.querySelector<HTMLButtonElement>(".channel-switcher")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.querySelector("tv-popover.channel-switcher-pop")).toBeNull();
    expect(host.querySelector(".channel-switcher")?.hasAttribute("aria-expanded"))
      .toBe(false);

    draw(snapshot([], null), { collapsed: true });
    const emptyLead = host.querySelector<HTMLElement>(".top-bar-lead")!;
    expect(emptyLead.children).toHaveLength(1);
    expect(emptyLead.querySelector(":scope > .sidebar-expand")).not.toBeNull();
    expect(emptyLead.querySelector(".channel-switcher, .channel-switcher-pop")).toBeNull();
  });
});

// Contract: proofs/ui/app/top-bar/index.md#^top-ac-switcher-edit-lifetime.
// jsdom forfeits layout and native keyboard delivery to the switcher browser tests.
describe("switcher edit lifetime", () => {
  async function flush(): Promise<void> {
    const microtaskTurns = 8;
    for (let index = 0; index < microtaskTurns; index += 1) await Promise.resolve();
  }

  function fixture() {
    const host = document.createElement("div");
    hosts.push(host);
    document.body.append(host);
    let state = snapshot([channel([], "Initial")]);
    const created = channel([], "New channel", "created");
    let resolveCreate!: (value: ApplicationChannelSnapshot) => void;
    const renameChannel = vi.fn(async () => {});
    const app = {
      ...application,
      focusChannel: vi.fn(async () => {}),
      renameChannel,
      createChannel: vi.fn(() => new Promise<ApplicationChannelSnapshot>((resolve) => {
        resolveCreate = resolve;
      })),
    } as unknown as ApplicationService;
    const draw = () => render(html`${TopBarView(app, state, { collapsed: true })}`, host);
    draw();
    const open = () => host.querySelector<HTMLButtonElement>(".channel-switcher")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    const create = () => host.querySelector<HTMLButtonElement>(".channel-create")!.click();
    const resolve = async () => {
      state = snapshot([created, ...state.channels], created.id);
      resolveCreate(created);
      draw();
      await flush();
    };
    return { host, open, create, resolve, renameChannel };
  }

  it("can create again after dismissal while a create request is pending", async () => {
    const { host, open, create, resolve } = fixture();
    open();
    create();
    host.querySelector("tv-popover.channel-switcher-pop")!.removeAttribute("open");
    await flush();
    await resolve();
    open();
    expect(host.querySelector<HTMLButtonElement>(".channel-create")!.disabled).toBe(false);
    expect(host.querySelector(".channel-rename")).toBeNull();
  });

  it("Escape abandons the newborn name without dismissing the switcher", async () => {
    const { host, open, create, resolve, renameChannel } = fixture();
    open();
    create();
    await resolve();
    const input = host.querySelector<HTMLInputElement>(".channel-rename")!;
    expect(input).not.toBeNull();
    input.value = "Do not save";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));
    await flush();
    expect(renameChannel).not.toHaveBeenCalled();
    expect(host.querySelector(".channel-rename")).toBeNull();
    expect(host.querySelector(".channel-switcher-pop")!.hasAttribute("open")).toBe(true);
  });
});
