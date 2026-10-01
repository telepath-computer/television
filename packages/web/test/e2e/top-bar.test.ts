import { expect, type Locator, type Page } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { test } from "../../../../test/helpers/playwright.ts";
import {
  launchProductServer,
  type ProductServer,
} from "../../../../test/helpers/product-server.ts";
import {
  APPLICATION_SHELL_STATES,
  waitForApplicationRender,
} from "../../../../test/helpers/application-readiness.ts";
import {
  configureTestMotion,
  createArtifactFile,
  startMotionObservation,
  type MotionReport,
} from "./helpers.ts";

const LEFT_GAP_PX = 8;
const RIGHT_DRAG_GAP_PX = 48;

const FIXTURE = "/packages/web/test/e2e/fixtures/top-bar.html";
const LONG_TITLES = [
  "Quarterly planning and research notes",
  "Customer interviews and launch decisions",
  "Implementation evidence and follow-up work",
];

interface FixtureApi {
  readonly renderCount: number;
  readonly resizeCount: number;
  readonly createCount: number;
  setWidth(width: number): void;
  setChannel(titles: readonly string[]): Promise<void>;
  setNotice(applies: boolean): Promise<void>;
  setLead(input: {
    isCollapsed: boolean;
    channelName: string;
    channelCount: number;
  }): Promise<void>;
}

interface Box {
  left: number;
  right: number;
  width: number;
  midpoint: number;
}

interface BarMetrics {
  bar: Box;
  stage: Box;
  strip: Box;
  controls: Box;
}

interface LeadMetrics extends BarMetrics {
  lead: Box;
  switcher: Box;
  stripContentLeft: number;
  overflow: boolean;
}

type LeadMutation =
  | { readonly kind: "lead"; readonly value: Parameters<FixtureApi["setLead"]>[0] }
  | { readonly kind: "channel"; readonly value: readonly string[] }
  | { readonly kind: "width"; readonly value: number }
  | { readonly kind: "notice"; readonly value: boolean };

async function setup(page: Page, fixture = FIXTURE): Promise<void> {
  await page.goto(fixture);
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
  await configureTestMotion(page, { allowCSSMotion: true });
}

function appIndexURL(appURL: string): string {
  const url = new URL("/packages/web/src/index.html", appURL);
  url.searchParams.set("serverURL", appURL);
  return url.toString();
}

async function openCollapsedProductApp(
  page: Page,
  product: ProductServer,
  baseURL: string | undefined,
  { realMotion = false }: { realMotion?: boolean } = {},
): Promise<void> {
  if (!baseURL) throw new Error("Expected Playwright baseURL");
  await page.addInitScript(() => {
    localStorage.setItem("tv-channel-sidebar-collapsed", "true");
  });
  const appURL = await product.appURL(baseURL);
  await page.goto(appIndexURL(appURL));
  await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
  if (!realMotion) await configureTestMotion(page);
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.locator(".channel-switcher")).toBeVisible();
}

async function clearChannels(client: TelevisionClient): Promise<void> {
  const { channels } = await client.channels.list();
  for (const channel of channels) {
    await client.channels.remove({ channelID: channel.id });
  }
}

async function seedLiveChannel(
  client: TelevisionClient,
  product: ProductServer,
  name: string,
): Promise<{ readonly id: string; readonly name: string; readonly artifactID: string }> {
  const { channel } = await client.channels.create({ name });
  const artifactPath = createArtifactFile(
    product.home,
    `switcher-${channel.id}`,
    `<!doctype html><title>${name}</title><h1>${name}</h1>`,
    "html",
  );
  const { artifact } = await client.artifacts.create({
    channelID: channel.id,
    kind: "path",
    title: `${name} artifact`,
    path: artifactPath,
  });
  return { id: channel.id, name: channel.name, artifactID: artifact.id };
}

function switcherOption(page: Page, name: string): Locator {
  return page.locator(".channel-switcher-pop")
    .getByRole("option", { name, exact: true });
}

async function expectDismissedSwitcher(page: Page): Promise<void> {
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect.poll(() => page.locator(".channel-switcher").getAttribute("aria-expanded"))
    .toBeNull();
  await expect(page.locator(".channel-switcher-pop")).toHaveCount(0);
}

async function pose(
  page: Page,
  { width, titles, notice }: { width: number; titles: readonly string[]; notice: boolean },
): Promise<void> {
  await page.evaluate(async ({ width, titles, notice }) => {
    const api = (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture;
    await api.setWidth(width);
    await api.setChannel(titles);
    await api.setNotice(notice);
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  }, { width, titles, notice });
}

async function expectClearDragBands(page: Page): Promise<void> {
  const bands = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".top-bar")!;
    const strip = bar.querySelector<HTMLElement>(".tab-strip")!.getBoundingClientRect();
    const controls = bar.querySelector<HTMLElement>(".top-bar-controls")!.getBoundingClientRect();
    const lead = bar.querySelector<HTMLElement>(".top-bar-lead")?.getBoundingClientRect();
    const barBox = bar.getBoundingClientRect();
    const leftEdge = lead?.right ?? barBox.left;
    const middleY = barBox.top + barBox.height / 2;
    return {
      left: strip.left - leftEdge,
      right: controls.left - strip.right,
      leftIsGround: document.elementFromPoint((leftEdge + strip.left) / 2, middleY) === bar,
      rightIsGround: document.elementFromPoint((strip.right + controls.left) / 2, middleY) === bar,
    };
  });
  expect(bands.left, "left clear gap").toBeGreaterThanOrEqual(LEFT_GAP_PX - 0.1);
  expect(bands.right, "right clear drag band").toBeGreaterThanOrEqual(RIGHT_DRAG_GAP_PX - 0.1);
  expect(bands.leftIsGround, "left band belongs to navbar ground").toBe(true);
  expect(bands.rightIsGround, "right band belongs to navbar ground").toBe(true);
}

async function metrics(page: Page): Promise<BarMetrics> {
  return page.evaluate(() => {
    const box = (selector: string): Box => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        midpoint: rect.left + rect.width / 2,
      };
    };
    return {
      bar: box(".top-bar"),
      stage: box(".stage"),
      strip: box(".tab-strip"),
      controls: box(".top-bar-controls"),
    };
  });
}

function expectNoBarMotion(report: MotionReport): void {
  expect(report.transitionEvents).toEqual([]);
  expect(report.animationEvents).toEqual([]);
  expect(report.webAnimations).toEqual([]);
  expect(report.scrollEvents).toBe(0);
}

function expectSameRelationship(first: BarMetrics, second: BarMetrics): void {
  for (const key of ["stage", "strip", "controls"] as const) {
    expect(Math.abs(first[key].left - second[key].left), `${key} left`).toBeLessThan(0.1);
    expect(Math.abs(first[key].right - second[key].right), `${key} right`).toBeLessThan(0.1);
    expect(Math.abs(first[key].width - second[key].width), `${key} width`).toBeLessThan(0.1);
  }
}

async function sampleWidthChange(page: Page, width: number): Promise<{
  first: BarMetrics;
  second: BarMetrics;
  barScrollEvents: number;
}> {
  return page.evaluate(async (nextWidth) => {
    const api = (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture;
    const bar = document.querySelector<HTMLElement>(".top-bar")!;
    let barScrollEvents = 0;
    const onScroll = () => { barScrollEvents += 1; };
    bar.addEventListener("scroll", onScroll);
    const read = (): BarMetrics => {
      const box = (selector: string): Box => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, midpoint: rect.left + rect.width / 2 };
      };
      return { bar: box(".top-bar"), stage: box(".stage"), strip: box(".tab-strip"), controls: box(".top-bar-controls") };
    };
    api.setWidth(nextWidth);
    const first = await new Promise<BarMetrics>((resolve) =>
      requestAnimationFrame(() => resolve(read()))
    );
    const second = await new Promise<BarMetrics>((resolve) => requestAnimationFrame(() => resolve(read())));
    bar.removeEventListener("scroll", onScroll);
    return { first, second, barScrollEvents };
  }, width);
}

async function sampleNoticeChange(page: Page, applies: boolean): Promise<{
  first: BarMetrics;
  second: BarMetrics;
  barScrollEvents: number;
}> {
  return page.evaluate(async (nextApplies) => {
    const api = (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture;
    const bar = document.querySelector<HTMLElement>(".top-bar")!;
    let barScrollEvents = 0;
    const onScroll = () => { barScrollEvents += 1; };
    bar.addEventListener("scroll", onScroll);
    const read = (): BarMetrics => {
      const box = (selector: string): Box => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, midpoint: rect.left + rect.width / 2 };
      };
      return { bar: box(".top-bar"), stage: box(".stage"), strip: box(".tab-strip"), controls: box(".top-bar-controls") };
    };
    await api.setNotice(nextApplies);
    const first = await new Promise<BarMetrics>((resolve) =>
      requestAnimationFrame(() => resolve(read()))
    );
    const second = await new Promise<BarMetrics>((resolve) => requestAnimationFrame(() => resolve(read())));
    bar.removeEventListener("scroll", onScroll);
    return { first, second, barScrollEvents };
  }, applies);
}

async function sampleLeadChange(
  page: Page,
  change: LeadMutation,
): Promise<{
  first: LeadMetrics;
  second: LeadMetrics;
  barScrollEvents: number;
  resizeCount: number;
}> {
  return page.evaluate(async (mutation) => {
    const api = (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture;
    const bar = document.querySelector<HTMLElement>(".top-bar")!;
    let barScrollEvents = 0;
    const onScroll = () => { barScrollEvents += 1; };
    bar.addEventListener("scroll", onScroll);
    const read = (): LeadMetrics => {
      const box = (selector: string): Box => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          midpoint: rect.left + rect.width / 2,
        };
      };
      const strip = document.querySelector<HTMLElement>(".tab-strip")!;
      return {
        bar: box(".top-bar"),
        stage: box(".stage"),
        lead: box(".top-bar-lead"),
        switcher: box(".channel-switcher"),
        strip: box(".tab-strip"),
        stripContentLeft: strip.getBoundingClientRect().left +
          Number.parseFloat(getComputedStyle(strip).paddingLeft),
        controls: box(".top-bar-controls"),
        overflow: strip.hasAttribute("data-overflow"),
      };
    };

    if (mutation.kind === "lead") await api.setLead(mutation.value);
    else if (mutation.kind === "channel") await api.setChannel(mutation.value);
    else if (mutation.kind === "width") api.setWidth(mutation.value);
    else await api.setNotice(mutation.value);

    const first = await new Promise<LeadMetrics>((resolve) =>
      requestAnimationFrame(() => resolve(read()))
    );
    const second = await new Promise<LeadMetrics>((resolve) =>
      requestAnimationFrame(() => resolve(read()))
    );
    bar.removeEventListener("scroll", onScroll);
    return { first, second, barScrollEvents, resizeCount: api.resizeCount };
  }, change);
}

test.describe("top-bar available band (^top-ac-band)", () => {
  test("centres while roomy, pins without overlap under pressure, and changes relationships immediately", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await setup(page);

    await pose(page, { width: 1_400, titles: LONG_TITLES, notice: false });
    const roomy = await metrics(page);
    await expectClearDragBands(page);
    expect(Math.abs(roomy.strip.midpoint - roomy.stage.midpoint)).toBeLessThanOrEqual(1);

    await pose(page, { width: 1_400, titles: LONG_TITLES, notice: true });
    const roomyWithNotice = await metrics(page);
    expect(Math.abs(roomyWithNotice.strip.midpoint - roomyWithNotice.stage.midpoint))
      .toBeLessThanOrEqual(1);

    await pose(page, { width: 520, titles: LONG_TITLES, notice: true });
    const pressured = await metrics(page);
    await expectClearDragBands(page);
    expect(pressured.strip.left).toBeGreaterThanOrEqual(pressured.stage.left);
    expect(pressured.strip.right).toBeLessThanOrEqual(pressured.controls.left + 0.1);
    expect(pressured.controls.right).toBeLessThanOrEqual(pressured.stage.right);
    expect(pressured.strip.width).toBeLessThan(roomyWithNotice.strip.width);

    await pose(page, { width: 900, titles: LONG_TITLES, notice: true });
    const widthObservation = await startMotionObservation(page, ".top-bar");
    const widthChange = await sampleWidthChange(page, 520);
    expectSameRelationship(widthChange.first, widthChange.second);
    expect(widthChange.barScrollEvents).toBe(0);
    expectNoBarMotion(await widthObservation.settle());

    await pose(page, { width: 520, titles: LONG_TITLES, notice: false });
    const beforeNotice = await metrics(page);
    const noticeObservation = await startMotionObservation(page, ".top-bar");
    const noticeChange = await sampleNoticeChange(page, true);
    expectSameRelationship(noticeChange.first, noticeChange.second);
    expect(noticeChange.barScrollEvents).toBe(0);
    expect(noticeChange.first.controls.width).toBeGreaterThan(beforeNotice.controls.width);
    expect(noticeChange.first.strip.width).toBeLessThan(beforeNotice.strip.width);
    expectNoBarMotion(await noticeObservation.settle());
  });
});

test.describe("top-bar controls continuity (^top-ac-controls-continuity)", () => {
  test("a channel replacement updates tabs without replacing any controls node", async ({ page }) => {
    await setup(page);
    await pose(page, { width: 700, titles: LONG_TITLES, notice: true });

    const result = await page.evaluate(async () => {
      const api = (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture;
      const controls = document.querySelector<HTMLElement>(".top-bar-controls")!;
      const refs = {
        controls,
        skill: controls.querySelector(".skill-trigger")!,
        skillPanel: controls.querySelector(".skill-popover")!,
        settings: controls.querySelector(".settings-trigger")!,
        settingsPanel: controls.querySelector(".settings-popover")!,
        bell: controls.querySelector(".update-bell")!,
        updatePanel: controls.querySelector(".update-popover")!,
      };
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((batch) => records.push(...batch));
      observer.observe(controls, { childList: true, subtree: true });
      const strip = document.querySelector<HTMLElement>(".tab-strip")!;
      let scrollStarted = false;
      let scrollEnded = false;
      strip.addEventListener("scroll", () => { scrollStarted = true; });
      strip.addEventListener("scrollend", () => { scrollEnded = true; });

      await api.setChannel(["New first page", "New second page", "New third page"]);
      let stableFrames = 0;
      for (let frame = 0; frame < 60 && stableFrames < 2; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!scrollStarted || scrollEnded) stableFrames += 1;
        else stableFrames = 0;
      }
      observer.disconnect();

      const removed = Object.fromEntries(Object.entries(refs).map(([key, node]) => [
        key,
        records.some((record) => [...record.removedNodes].some((removedNode) =>
          removedNode === node || (removedNode instanceof Element && removedNode.contains(node))
        )),
      ]));
      return {
        same: {
          controls: document.querySelector(".top-bar-controls") === refs.controls,
          skill: controls.querySelector(".skill-trigger") === refs.skill,
          skillPanel: controls.querySelector(".skill-popover") === refs.skillPanel,
          settings: controls.querySelector(".settings-trigger") === refs.settings,
          settingsPanel: controls.querySelector(".settings-popover") === refs.settingsPanel,
          bell: controls.querySelector(".update-bell") === refs.bell,
          updatePanel: controls.querySelector(".update-popover") === refs.updatePanel,
        },
        removed,
        labels: [...document.querySelectorAll(".tab-label")].map((node) => node.textContent?.trim()),
      };
    });

    expect(result.same).toEqual({
      controls: true,
      skill: true,
      skillPanel: true,
      settings: true,
      settingsPanel: true,
      bell: true,
      updatePanel: true,
    });
    expect(result.removed).toEqual({
      controls: false,
      skill: false,
      skillPanel: false,
      settings: false,
      settingsPanel: false,
      bell: false,
      updatePanel: false,
    });
    expect(result.labels).toEqual(["New first page", "New second page", "New third page"]);
  });
});

test.describe("top-bar lead floor (^top-ac-lead-floor)", () => {
  test("keeps the complete lead inside the bar while the strip yields under pressure", async ({ page }) => {
    await setup(page, `${FIXTURE}?collapsed=true&width=1100&channel=Short`);

    const read = () => page.evaluate(() => {
      const box = (selector: string): Box => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          midpoint: rect.left + rect.width / 2,
        };
      };
      return {
        bar: box(".top-bar"),
        lead: box(".top-bar-lead"),
        switcher: box(".channel-switcher"),
        strip: box(".tab-strip"),
        stripContentLeft: (() => {
          const strip = document.querySelector<HTMLElement>(".tab-strip")!;
          return strip.getBoundingClientRect().left +
            Number.parseFloat(getComputedStyle(strip).paddingLeft);
        })(),
        controls: box(".top-bar-controls"),
        overflow: document.querySelector(".tab-strip")!.hasAttribute("data-overflow"),
      };
    });
    const expectContainedAndOrdered = (value: Awaited<ReturnType<typeof read>>) => {
      expect(value.lead.left).toBeGreaterThanOrEqual(value.bar.left - 0.1);
      expect(value.lead.right).toBeLessThanOrEqual(value.bar.right + 0.1);
      expect(value.strip.left - value.lead.right).toBeGreaterThanOrEqual(LEFT_GAP_PX - 0.1);
      expect(value.controls.left - value.strip.right).toBeGreaterThanOrEqual(RIGHT_DRAG_GAP_PX - 0.1);
      expect(value.controls.right).toBeLessThanOrEqual(value.bar.right + 0.1);
    };
    const widths = (value: Awaited<ReturnType<typeof read>>) => ({
      lead: value.lead.width,
      switcher: value.switcher.width,
      controls: value.controls.width,
    });
    const expectNaturalWidths = (
      value: Awaited<ReturnType<typeof read>>,
      natural: ReturnType<typeof widths>,
    ) => {
      expect(value.lead.width).toBeCloseTo(natural.lead, 1);
      expect(value.switcher.width).toBeCloseTo(natural.switcher, 1);
      expect(value.controls.width).toBeCloseTo(natural.controls, 1);
    };

    const roomy = await read();
    expectContainedAndOrdered(roomy);
    await expectClearDragBands(page);

    const beforeLongNameResize = await page.evaluate(() =>
      (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture.resizeCount
    );
    const longNameObservation = await startMotionObservation(page, ".top-bar");
    const longNameChange = await sampleLeadChange(page, {
      kind: "lead",
      value: {
        isCollapsed: true,
        channelName: "A channel name long enough to reach the authored switcher width bound without clipping its controls",
        channelCount: 6,
      },
    });
    const longName = longNameChange.first;
    expectContainedAndOrdered(longName);
    expect(longName.switcher.width).toBeGreaterThan(roomy.switcher.width);
    expect(longName.switcher.width).toBeLessThanOrEqual(220.1);
    expect(longNameChange.second).toEqual(longNameChange.first);
    expect(longNameChange.barScrollEvents).toBe(0);
    expect(longNameChange.resizeCount).toBeGreaterThan(beforeLongNameResize);
    expectNoBarMotion(await longNameObservation.settle());

    const tabsObservation = await startMotionObservation(page, ".top-bar");
    const tabsChange = await sampleLeadChange(page, {
      kind: "channel",
      value: Array.from(
        { length: 18 },
        (_, index) => `Overflowing artifact ${index + 1}`,
      ),
    });
    const wideTabs = tabsChange.first;
    expectContainedAndOrdered(wideTabs);
    expect(tabsChange.second).toEqual(tabsChange.first);
    expect(tabsChange.barScrollEvents).toBe(0);
    expectNoBarMotion(await tabsObservation.settle());
    const naturalWithoutNotice = widths(wideTabs);

    const noticeObservation = await startMotionObservation(page, ".top-bar");
    const noticeChange = await sampleLeadChange(page, { kind: "notice", value: true });
    const roomyWithNotice = noticeChange.first;
    expectContainedAndOrdered(roomyWithNotice);
    expect(roomyWithNotice.controls.width).toBeGreaterThan(wideTabs.controls.width);
    expect(roomyWithNotice.lead.width).toBeCloseTo(wideTabs.lead.width, 1);
    expect(roomyWithNotice.switcher.width).toBeCloseTo(wideTabs.switcher.width, 1);
    expect(noticeChange.second).toEqual(noticeChange.first);
    expect(noticeChange.barScrollEvents).toBe(0);
    expectNoBarMotion(await noticeObservation.settle());
    const naturalWithNotice = widths(roomyWithNotice);

    const widthObservation = await startMotionObservation(page, ".top-bar");
    const widthChange = await sampleLeadChange(page, { kind: "width", value: 680 });
    const pressuredWithNotice = widthChange.first;
    expect(pressuredWithNotice.overflow).toBe(true);
    expect(pressuredWithNotice.strip.left - pressuredWithNotice.lead.right).toBeCloseTo(LEFT_GAP_PX, 1);
    expectContainedAndOrdered(pressuredWithNotice);
    expectNaturalWidths(pressuredWithNotice, naturalWithNotice);
    await expectClearDragBands(page);
    expect(pressuredWithNotice.strip.width).toBeLessThan(roomyWithNotice.strip.width);
    expect(widthChange.second).toEqual(widthChange.first);
    expect(widthChange.barScrollEvents).toBe(0);
    expectNoBarMotion(await widthObservation.settle());

    const clearNoticeObservation = await startMotionObservation(page, ".top-bar");
    const clearNoticeChange = await sampleLeadChange(page, { kind: "notice", value: false });
    const pressuredWithoutNotice = clearNoticeChange.first;
    expect(pressuredWithoutNotice.overflow).toBe(true);
    expectContainedAndOrdered(pressuredWithoutNotice);
    expectNaturalWidths(pressuredWithoutNotice, naturalWithoutNotice);
    expect(pressuredWithoutNotice.strip.width).toBeGreaterThan(pressuredWithNotice.strip.width);
    expect(clearNoticeChange.second).toEqual(clearNoticeChange.first);
    expect(clearNoticeChange.barScrollEvents).toBe(0);
    expectNoBarMotion(await clearNoticeObservation.settle());
  });
});

test.describe("channel switcher overflow (^top-ac-switcher-overflow)", () => {
  test("scrolls the switcher list while its create footer stays fixed and usable", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await setup(page, `${FIXTURE}?collapsed=true&width=600&channel=Focused`);
    await configureTestMotion(page);
    const resizeBefore = await page.evaluate(() =>
      (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture.resizeCount
    );
    await page.evaluate(async () => {
      await (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture.setLead({
        isCollapsed: true,
        channelName: "Focused",
        channelCount: 30,
      });
    });
    await page.locator(".channel-switcher").click();
    await expect(page.locator(".channel-switcher")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture.resizeCount
    )).toBeGreaterThan(resizeBefore);
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    ));

    const popover = page.locator(".channel-switcher-pop");
    const body = popover.locator(".channel-switcher-pop-body");
    const footer = popover.locator(".channel-switcher-pop-footer");
    await expect(popover).toBeVisible();
    await expect(popover.locator(".channel-list")).toHaveCSS(
      "padding-bottom",
      "12px",
    );
    await expect.poll(() => body.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))).toMatchObject({ clientHeight: expect.any(Number), scrollHeight: expect.any(Number) });
    const scrollRange = await body.evaluate((element) =>
      element.scrollHeight - element.clientHeight
    );
    expect(scrollRange).toBeGreaterThan(0);
    // Entering from above reaches the last row, even when it is off screen.
    await page.keyboard.press("ArrowUp");
    const lastOption = popover.getByRole("option").last();
    await expect(lastOption).toBeFocused();
    await expect(lastOption).toBeInViewport();
    await expect.poll(() => body.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await body.evaluate((element) => { element.scrollTop = 0; });
    const panelBox = await popover.boundingBox();
    const footerBefore = await footer.boundingBox();
    const bodyBox = await body.boundingBox();
    if (!panelBox || !footerBefore || !bodyBox) throw new Error("Expected switcher geometry");
    expect(footerBefore.y).toBeGreaterThanOrEqual(panelBox.y);
    expect(footerBefore.y + footerBefore.height).toBeLessThanOrEqual(
      panelBox.y + panelBox.height + 0.1,
    );

    await body.evaluate((element) => {
      const target = element as HTMLElement & { __scrollEvents?: number };
      target.__scrollEvents = 0;
      target.addEventListener("scroll", () => { target.__scrollEvents! += 1; });
    });
    await body.hover({ position: { x: bodyBox.width / 2, y: 20 } });
    await page.mouse.wheel(0, Math.max(200, scrollRange));
    await expect.poll(() => body.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await body.evaluate((element) =>
      (element as HTMLElement & { __scrollEvents?: number }).__scrollEvents ?? 0
    )).toBeGreaterThan(0);
    const heldScroll = await body.evaluate(async (element) => {
      let previous = element.scrollTop;
      let stableFrames = 0;
      for (let frame = 0; frame < 60 && stableFrames < 2; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = element.scrollTop;
        stableFrames = current > 0 && current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
      const established = element.scrollTop;
      const placementFrames: number[] = [];
      for (let frame = 0; frame < 6; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        placementFrames.push(element.scrollTop);
      }
      return { established, placementFrames };
    });
    expect(heldScroll.established).toBeGreaterThan(0);
    expect(heldScroll.placementFrames).toEqual(
      Array.from({ length: 6 }, () => heldScroll.established),
    );
    const footerAfter = await footer.boundingBox();
    expect(footerAfter).toEqual(footerBefore);
    await footer.getByRole("button", { name: "New channel" }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __topBarFixture: FixtureApi }).__topBarFixture.createCount
    )).toBe(1);
  });
});

test.describe("channel switcher selection (^top-ac-switcher-select)", () => {
  test("selects channels by pointer, Enter, and Space without expanding the sidebar", async ({
    page,
    baseURL,
  }) => {
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      await clearChannels(client);
      const channels = [
        await seedLiveChannel(client, product, "Switcher first"),
        await seedLiveChannel(client, product, "Switcher second"),
        await seedLiveChannel(client, product, "Switcher third"),
      ];
      const listOrder = [...channels].sort((left, right) =>
        right.id.localeCompare(left.id)
      );
      await client.display.patch({
        focusedChannelId: channels[0]!.id,
        pinnedChannelIds: [],
      });
      await openCollapsedProductApp(page, product, baseURL);

      const trigger = page.locator(".channel-switcher");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".app-sidebar")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expectDismissedSwitcher(page);

      await trigger.click();
      await page.locator(".skill-trigger").click();
      await expectDismissedSwitcher(page);
      await page.locator(".skill-trigger").click();

      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await switcherOption(page, channels[1]!.name).click();
      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(channels[1]!.id);
      await expectDismissedSwitcher(page);

      const selectedFrame = page.locator(
        `.stage .page[data-page-key="${channels[1]!.artifactID}"] iframe.artifact-content`,
      );
      await expect(selectedFrame).toHaveCount(1);
      await selectedFrame.evaluate((frame) => {
        (frame as HTMLIFrameElement & { __switcherIdentity?: string }).__switcherIdentity =
          "same-stage-frame";
      });
      await trigger.click();
      await switcherOption(page, channels[1]!.name).click();
      await expectDismissedSwitcher(page);
      expect(await selectedFrame.evaluate((frame) =>
        (frame as HTMLIFrameElement & { __switcherIdentity?: string }).__switcherIdentity
      )).toBe("same-stage-frame");
      expect((await client.display.get()).focusedChannelId).toBe(channels[1]!.id);

      // Explicit trigger toggling still dismisses an open switcher.
      await trigger.click();
      await trigger.click();
      await expectDismissedSwitcher(page);
      const focusedOptions = page.locator('.channel-switcher-pop .channel[role="option"]:focus');
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(trigger).toBeFocused();
      await expect(focusedOptions).toHaveCount(0);
      await page.keyboard.press("ArrowDown");
      await expect(focusedOptions).toHaveText(listOrder[0]!.name);
      await page.keyboard.press("Escape");
      await expectDismissedSwitcher(page);

      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(trigger).toBeFocused();
      await expect(focusedOptions).toHaveCount(0);
      await page.keyboard.press("ArrowUp");
      await expect(focusedOptions).toHaveText(listOrder[2]!.name);
      await page.keyboard.press("Escape");
      await expectDismissedSwitcher(page);

      const lastChannel = listOrder[2]!;
      const enterTarget = listOrder.find((channel) =>
        channel.id !== channels[1]!.id && channel.id !== lastChannel.id
      )!;
      expect(enterTarget.id).not.toBe(channels[1]!.id);
      const enterTargetIndex = listOrder.indexOf(enterTarget);
      await trigger.focus();
      await trigger.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(focusedOptions).toHaveCount(1);
      await expect(focusedOptions).toHaveText(listOrder[0]!.name);
      await page.keyboard.press("ArrowUp");
      await expect(focusedOptions).toHaveCount(1);
      await expect(focusedOptions).toHaveText(listOrder[0]!.name);
      for (let index = 0; index < enterTargetIndex; index += 1) {
        await page.keyboard.press("ArrowDown");
      }
      await expect(focusedOptions).toHaveText(enterTarget.name);
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(enterTarget.id);
      await expectDismissedSwitcher(page);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await switcherOption(page, listOrder[1]!.name).hover();
      await expect(focusedOptions).toHaveCount(1);
      await expect(focusedOptions).toHaveText(listOrder[1]!.name);
      await page.keyboard.press("ArrowDown");
      await expect(focusedOptions).toHaveCount(1);
      await expect(focusedOptions).toHaveText(lastChannel.name);
      await page.keyboard.press("ArrowDown");
      await expect(focusedOptions).toHaveCount(1);
      await expect(focusedOptions).toHaveText(lastChannel.name);
      await page.keyboard.press("Space");
      await expect.poll(async () => (await client.display.get()).focusedChannelId)
        .toBe(lastChannel.id);
      await expectDismissedSwitcher(page);
      await expect(trigger).toBeFocused();
    } finally {
      await product.dispose();
    }
  });
});

test.describe("channel switcher creation (^top-ac-switcher-create)", () => {
  test("creates into focused in-place rename and keeps the switcher open", async ({
    page,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const product = await launchProductServer();
    try {
      const client = new TelevisionClient(product.serverURL);
      await clearChannels(client);
      const initial = await seedLiveChannel(client, product, "Initial channel");
      await client.display.patch({ focusedChannelId: initial.id, pinnedChannelIds: [] });
      await openCollapsedProductApp(page, product, baseURL, { realMotion: true });
      const trigger = page.locator(".channel-switcher");
      const popover = page.locator(".channel-switcher-pop");
      await trigger.click();
      await expect(popover).toHaveAttribute("open", "");
      await popover.evaluate((element) => {
        const target = element as HTMLElement & { __closedDuringCreate?: boolean };
        target.__closedDuringCreate = false;
        new MutationObserver(() => {
          if (!target.hasAttribute("open")) target.__closedDuringCreate = true;
        }).observe(target, { attributes: true, attributeFilter: ["open"] });
      });

      const motion = await startMotionObservation(page, ".channel-switcher-pop");
      await popover.getByRole("button", { name: "New channel" }).click();
      const report = await motion.settle({ requireMotion: true });
      expect(report.webAnimations.some(({ kind, duration, finished }) =>
        kind === "web-animation" && duration > 0 && finished
      )).toBe(true);

      await expect.poll(async () => {
        const { channels } = await client.channels.list();
        return channels.find(({ id }) => id !== initial.id) ?? null;
      }).not.toBeNull();
      const createdChannel = (await client.channels.list()).channels
        .find(({ id }) => id !== initial.id);
      if (!createdChannel) throw new Error("Expected the created channel");
      const row = popover.locator(
        `.channel-group[data-channel-side="unpinned"] > .channel-row[data-channel-id="${createdChannel.id}"]`,
      );
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-channel-id", createdChannel.id);
      await expect(popover.locator(
        '.channel-group[data-channel-side="unpinned"] > .channel-row',
      ).first()).toHaveAttribute("data-channel-id", createdChannel.id);
      const rename = row.getByRole("textbox", { name: "Channel name" });
      await expect(rename).toBeFocused();
      await expect(rename).toHaveJSProperty("selectionStart", 0);
      await expect(rename).toHaveJSProperty("selectionEnd", "New channel".length);
      await expect(popover).toHaveAttribute("open", "");
      expect(await popover.evaluate((element) =>
        (element as HTMLElement & { __closedDuringCreate?: boolean }).__closedDuringCreate
      )).toBe(false);
      await row.evaluate((element) => {
        (element as HTMLElement & { __birthRow?: boolean }).__birthRow = true;
      });

      await rename.fill("Created in switcher");
      await rename.press("Enter");
      await expect(row.getByRole("option", { name: "Created in switcher", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      expect(await row.evaluate((element) =>
        (element as HTMLElement & { __birthRow?: boolean }).__birthRow
      )).toBe(true);
      await expect(popover).toHaveAttribute("open", "");
      await expect.poll(async () =>
        (await client.channels.get({ channelID: createdChannel.id })).channel.name
      ).toBe("Created in switcher");
      await popover.getByRole("button", { name: "New channel" }).click();
      const nextRename = popover.getByRole("textbox", { name: "Channel name" });
      await expect(nextRename).toBeFocused();
      await nextRename.fill("Abandoned name");
      await nextRename.press("Escape");
      await expect(popover).toHaveAttribute("open", "");
      await expect(popover.getByRole("option", { name: "New channel", exact: true }))
        .toBeVisible();
      expect((await client.channels.list()).channels.some(({ name }) => name === "Abandoned name"))
        .toBe(false);

    } finally {
      await product.dispose();
    }
  });
});
