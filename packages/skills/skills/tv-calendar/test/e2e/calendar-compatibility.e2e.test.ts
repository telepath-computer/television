import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

type CalendarWeekHarness = HTMLElement & {
  days: number | undefined;
  startDate: string | undefined;
  startHour: number | undefined;
  changed(): void;
};

test("preserves attribute coercion and reactive lifecycle compatibility", async ({ page }) => {
  const result = await page.evaluate(async () => {
    type CalendarWeekHarness = HTMLElement & {
      days: number | undefined;
      startDate: string | undefined;
      startHour: number | undefined;
    };
    type LifecycleRecord = {
      type: string;
      bubbles: boolean;
      hasDetail: boolean;
      detailIsUndefined: boolean;
    };

    const week = document.createElement("calendar-week") as CalendarWeekHarness;
    week.setAttribute("days", "");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("start-hour", "not-a-number");

    const coercionBeforeConnect = {
      emptyNumber: week.days,
      invalidNumberIsNaN: Number.isNaN(week.startHour),
      kebabCaseProperty: week.startDate,
    };

    const lifecycle: Record<string, LifecycleRecord[]> = {};
    const bubbled: string[] = [];
    const container = document.createElement("div");
    for (const type of ["reactive:connect", "reactive:disconnect"] as const) {
      container.addEventListener(type, () => bubbled.push(type));
    }
    document.body.append(container);

    const elements = [
      week,
      document.createElement("calendar-event"),
      document.createElement("calendar-time-axis"),
    ];
    for (const element of elements) {
      const records: LifecycleRecord[] = [];
      lifecycle[element.localName] = records;
      for (const type of ["reactive:connect", "reactive:disconnect"] as const) {
        element.addEventListener(type, (event) => {
          records.push({
            type: event.type,
            bubbles: event.bubbles,
            hasDetail: "detail" in event,
            detailIsUndefined: (event as Event & { detail?: unknown }).detail === undefined,
          });
        });
      }
      container.append(element);
    }

    const lifecycleCountAfterConnect = Object.values(lifecycle).map((records) => records.length);
    await window.flushReactiveMicrotasks();
    const invalidStartHourFallback = week.style.getPropertyValue("--start-hour").trim();

    week.removeAttribute("days");
    week.removeAttribute("start-date");
    week.removeAttribute("start-hour");
    const coercionAfterRemoval = {
      days: week.days,
      startDate: week.startDate,
      startHour: week.startHour,
    };

    for (const element of elements) element.remove();
    const lifecycleCountAfterDisconnect = Object.values(lifecycle).map(
      (records) => records.length,
    );

    return {
      bubbled,
      coercionAfterRemoval,
      coercionBeforeConnect,
      invalidStartHourFallback,
      lifecycle,
      lifecycleCountAfterConnect,
      lifecycleCountAfterDisconnect,
    };
  });

  expect(result.coercionBeforeConnect).toEqual({
    emptyNumber: 0,
    invalidNumberIsNaN: true,
    kebabCaseProperty: "2026-05-04",
  });
  expect(result.invalidStartHourFallback).toBe("8");
  expect(result.coercionAfterRemoval).toEqual({
    days: undefined,
    startDate: undefined,
    startHour: undefined,
  });
  expect(result.lifecycleCountAfterConnect).toEqual([1, 1, 1]);
  expect(result.lifecycleCountAfterDisconnect).toEqual([2, 2, 2]);
  expect(result.bubbled).toEqual([]);
  expect(result.lifecycle).toEqual({
    "calendar-week": [
      {
        type: "reactive:connect",
        bubbles: false,
        hasDetail: false,
        detailIsUndefined: true,
      },
      {
        type: "reactive:disconnect",
        bubbles: false,
        hasDetail: false,
        detailIsUndefined: true,
      },
    ],
    "calendar-event": [
      {
        type: "reactive:connect",
        bubbles: false,
        hasDetail: false,
        detailIsUndefined: true,
      },
      {
        type: "reactive:disconnect",
        bubbles: false,
        hasDetail: false,
        detailIsUndefined: true,
      },
    ],
    "calendar-time-axis": [
      {
        type: "reactive:connect",
        bubbles: false,
        hasDetail: false,
        detailIsUndefined: true,
      },
      {
        type: "reactive:disconnect",
        bubbles: false,
        hasDetail: false,
        detailIsUndefined: true,
      },
    ],
  });
});

test("preserves pre-upgrade properties and first-connection default reflection", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const CalendarWeek = customElements.get("calendar-week") as {
      new (): CalendarWeekHarness;
    };
    let preUpgradeRenderCount = 0;
    class PreUpgradeCalendarWeek extends CalendarWeek {
      override changed(): void {
        preUpgradeRenderCount += 1;
        super.changed();
      }
    }

    const preUpgrade = document.createElement(
      "calendar-week-pre-upgrade",
    ) as CalendarWeekHarness;
    preUpgrade.setAttribute("days", "2");
    preUpgrade.setAttribute("start-date", "2026-05-04");
    preUpgrade.setAttribute("start-hour", "7");
    preUpgrade.days = 4;
    preUpgrade.startDate = "2026-06-01";
    preUpgrade.startHour = 9;
    document.body.append(preUpgrade);

    customElements.define("calendar-week-pre-upgrade", PreUpgradeCalendarWeek);

    const defaults = document.createElement("calendar-week") as CalendarWeekHarness;
    document.body.append(defaults);
    const defaultAttributesBeforeFlush = {
      days: defaults.getAttribute("days"),
      startDate: defaults.getAttribute("start-date"),
      startHour: defaults.getAttribute("start-hour"),
    };

    await window.flushReactiveMicrotasks();

    return {
      defaultAttributesAfterFlush: {
        days: defaults.getAttribute("days"),
        startDate: defaults.getAttribute("start-date"),
        startHour: defaults.getAttribute("start-hour"),
      },
      defaultAttributesBeforeFlush,
      defaultProperties: {
        days: defaults.days,
        startDate: defaults.startDate,
        startHour: defaults.startHour,
      },
      preUpgradeAttributes: {
        days: preUpgrade.getAttribute("days"),
        startDate: preUpgrade.getAttribute("start-date"),
        startHour: preUpgrade.getAttribute("start-hour"),
      },
      preUpgradeOwnProperties: {
        days: Object.hasOwn(preUpgrade, "days"),
        startDate: Object.hasOwn(preUpgrade, "startDate"),
        startHour: Object.hasOwn(preUpgrade, "startHour"),
      },
      preUpgradeProperties: {
        days: preUpgrade.days,
        startDate: preUpgrade.startDate,
        startHour: preUpgrade.startHour,
      },
      preUpgradeRenderCount,
    };
  });

  expect(result).toEqual({
    defaultAttributesAfterFlush: {
      days: "0",
      startDate: "",
      startHour: null,
    },
    defaultAttributesBeforeFlush: {
      days: null,
      startDate: null,
      startHour: null,
    },
    defaultProperties: {
      days: 0,
      startDate: "",
      startHour: undefined,
    },
    preUpgradeAttributes: {
      days: "4",
      startDate: "2026-06-01",
      startHour: "9",
    },
    preUpgradeOwnProperties: {
      days: false,
      startDate: false,
      startHour: false,
    },
    preUpgradeProperties: {
      days: 4,
      startDate: "2026-06-01",
      startHour: 9,
    },
    preUpgradeRenderCount: 1,
  });
});

test("batches connected updates and flushes only changed detached state on reconnect", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const CalendarWeek = customElements.get("calendar-week") as {
      prototype: CalendarWeekHarness;
    };
    const originalChanged = CalendarWeek.prototype.changed;
    let renderCount = 0;
    CalendarWeek.prototype.changed = function changed(): void {
      renderCount += 1;
      originalChanged.call(this);
    };

    try {
      const week = document.createElement("calendar-week") as CalendarWeekHarness;
      week.setAttribute("days", "1");
      week.setAttribute("start-date", "2026-05-04");
      document.body.append(week);
      await window.flushReactiveMicrotasks();
      const afterFirstConnection = renderCount;

      week.days = 2;
      week.startDate = "2026-05-11";
      await window.flushReactiveMicrotasks();
      const afterConnectedBatch = renderCount;

      week.remove();
      document.body.append(week);
      await window.flushReactiveMicrotasks();
      const afterUnchangedReconnect = renderCount;

      week.remove();
      week.days = 3;
      week.startDate = "2026-05-18";
      await window.flushReactiveMicrotasks();
      const whileDetached = renderCount;
      const detachedAttributes = {
        days: week.getAttribute("days"),
        startDate: week.getAttribute("start-date"),
      };

      document.body.append(week);
      await window.flushReactiveMicrotasks();

      return {
        connectedBatchRenders: afterConnectedBatch - afterFirstConnection,
        detachedAttributes,
        detachedRenders: whileDetached - afterUnchangedReconnect,
        firstConnectionRenders: afterFirstConnection,
        reconnectWithChangesRenders: renderCount - whileDetached,
        unchangedReconnectRenders: afterUnchangedReconnect - afterConnectedBatch,
      };
    } finally {
      CalendarWeek.prototype.changed = originalChanged;
    }
  });

  expect(result).toEqual({
    connectedBatchRenders: 1,
    detachedAttributes: {
      days: "3",
      startDate: "2026-05-18",
    },
    detachedRenders: 0,
    firstConnectionRenders: 1,
    reconnectWithChangesRenders: 1,
    unchangedReconnectRenders: 0,
  });
});
