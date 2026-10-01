import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/packages/web/test/e2e/fixtures/checkbox-list.html";

interface RecorderEntry {
  attributeName?: string | null;
  targetId: string;
  type: string;
}

interface CheckboxListState {
  list: {
    attributes: string[];
    directChildIds: string[];
    directChildNames: string[];
    shadowRoot: boolean;
  };
  items: Array<{
    attributes: string[];
    checked: boolean;
    generatedControlCount: number;
    id: string;
    shadowRoot: boolean;
    strongText: string | null;
    text: string;
  }>;
}

interface CheckboxListSnapshot {
  clicks: string[];
  events: RecorderEntry[];
  mutations: RecorderEntry[];
  state: CheckboxListState;
}

declare global {
  interface Window {
    __checkboxListFixture: {
      controls: {
        events: RecorderEntry[];
        mutations: RecorderEntry[];
      };
      settle(): Promise<void>;
      snapshot(): CheckboxListSnapshot;
    };
    __fixtureReady?: boolean;
  }
}

async function snapshot(page: Page): Promise<CheckboxListSnapshot> {
  return page.evaluate(() => window.__checkboxListFixture.snapshot());
}

const AUTHORED_STATE: CheckboxListState = {
  list: {
    attributes: ["id"],
    directChildIds: ["open", "done"],
    directChildNames: ["checkbox-item", "checkbox-item"],
    shadowRoot: false,
  },
  items: [
    {
      attributes: ["id"],
      checked: false,
      generatedControlCount: 0,
      id: "open",
      shadowRoot: false,
      strongText: null,
      text: "Open incident follow-up",
    },
    {
      attributes: ["checked", "id"],
      checked: true,
      generatedControlCount: 0,
      id: "done",
      shadowRoot: false,
      strongText: "before Friday's review",
      text: "Close the retry-storm action item before Friday's review.",
    },
  ],
};

test("preserves authored static rows under real presses (^cbx-ac-static)", async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true);

  const controls = await page.evaluate(() => window.__checkboxListFixture.controls);
  expect(controls.events).toEqual([
    { targetId: "open", type: "input" },
    { targetId: "open", type: "change" },
  ]);
  expect(controls.mutations).toEqual([
    { attributeName: "data-recorder-positive-control", targetId: "checklist", type: "attributes" },
    { attributeName: "data-recorder-positive-control", targetId: "checklist", type: "attributes" },
  ]);

  const initial = await snapshot(page);
  expect(initial.state).toEqual(AUTHORED_STATE);
  expect(initial.clicks).toEqual([]);
  expect(initial.events).toEqual([]);
  expect(initial.mutations).toEqual([]);

  await page.locator("#open").click();
  await expect.poll(async () => (await snapshot(page)).clicks).toEqual(["open"]);

  await page.locator("#done").click();
  await expect.poll(async () => (await snapshot(page)).clicks).toEqual(["open", "done"]);

  await page.evaluate(() => window.__checkboxListFixture.settle());
  const afterPresses = await snapshot(page);
  expect(afterPresses.state).toEqual(AUTHORED_STATE);
  expect(afterPresses.events).toEqual([]);
  expect(afterPresses.mutations).toEqual([]);
});
