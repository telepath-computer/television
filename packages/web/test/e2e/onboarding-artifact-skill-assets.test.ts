import { type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer, type Server as HTTPServer } from "node:http";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { configureTestMotion } from "./helpers.ts";

// proofs/ui/onboarding-artifacts/index.md#^oa-ac-skill-assets
// proofs/ui/onboarding-artifacts/index.md#^oa-ac-relative-dates
//
// One focused fixture crosses the authored Productivity documents through the
// real bake into really built tv-tasks, tv-calendar, and canonical assets. The
// server below sends those disposable bytes as files; it does not install them
// through Television or transform their content. Generic skill behavior,
// product installation, frame behavior, and motion stay with their owners.

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const PRODUCTION_ASSETS = path.join(REPO_ROOT, "packages/server/assets/onboarding-channels");
const DESIGN_ROOT = path.join(REPO_ROOT, "specs/ui/onboarding-artifacts");
const SKILLS_BUILD = path.join(REPO_ROOT, "packages/skills/scripts/build.mjs");
const CANONICAL_BUILD = path.join(
  REPO_ROOT,
  "packages/canonical/scripts/build-canonical.mjs",
);
const BAKE = path.join(REPO_ROOT, "scripts/bake-onboarding.mjs");
const CANONICAL_WRAPPER = `@import url("/canonical/v2/base.css");
@import url("/theme/theme.css");
`;

interface ServedRequest {
  readonly pathname: string;
  readonly status: number;
}

interface ArtifactFixture {
  readonly url: string;
  readonly requests: ServedRequest[];
  close(): Promise<void>;
}

let workRoot = "";
let fixture: ArtifactFixture | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  workRoot = mkdtempSync(path.join(os.tmpdir(), "tv-onboarding-skill-assets-"));
  const contentRoot = path.join(workRoot, "onboarding-channels");
  const skillsDist = path.join(workRoot, "skills-dist");
  const canonicalOutputRoot = path.join(workRoot, "canonical");
  const canonicalRoot = path.join(canonicalOutputRoot, "v2");
  cpSync(PRODUCTION_ASSETS, contentRoot, { recursive: true });

  execFileSync(process.execPath, [SKILLS_BUILD], {
    cwd: REPO_ROOT,
    env: { ...process.env, TV_SKILLS_DIST_DIR: skillsDist },
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { buildCanonicalVersions } from ${JSON.stringify(pathToFileURL(CANONICAL_BUILD).href)}; await buildCanonicalVersions({ outDir: process.argv[1] });`,
      canonicalOutputRoot,
    ],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );
  execFileSync(
    process.execPath,
    [BAKE, "productivity", "--root", contentRoot, "--skills-dist", skillsDist],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );

  fixture = await startArtifactFixture(contentRoot, canonicalRoot);
});

test.afterAll(async () => {
  await fixture?.close();
  if (workRoot) rmSync(workRoot, { recursive: true, force: true });
});

test.use({ locale: "en-US", timezoneId: "Australia/Sydney" });

test("authored task and calendar documents show their story dates relative to the viewer's local day", async ({
  page,
}) => {
  test.setTimeout(60_000);
  if (!fixture) throw new Error("Onboarding skill-asset fixture did not start");
  await page.clock.setFixedTime(new Date("2026-10-02T08:00:00+10:00"));

  // Parse the authored HTML in an inert document, independent of the bake
  // output. The design frames have no parameters, imports, or data bindings.
  const readBody = (slug: string): string => readFileSync(
    path.join(DESIGN_ROOT, "productivity", `${slug}.frame`), "utf8",
  ).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const { authoredTasks, authoredDueDates, authoredEvents } = await page.evaluate(({ tasks, calendar }) => {
    const parser = new DOMParser();
    const taskDocument = parser.parseFromString(tasks, "text/html");
    const calendarDocument = parser.parseFromString(calendar, "text/html");
    return {
      authoredTasks: [...taskDocument.querySelectorAll("tv-task:has(tv-task-checkbox)")].map((task) => ({
        title: task.querySelector("tv-task-title")!.textContent!.trim(),
      })),
      authoredDueDates: [...taskDocument.querySelectorAll("tv-task-meta-due")].map((due) => due.getAttribute("date")),
      authoredEvents: [...calendarDocument.querySelectorAll("calendar-event")].map((event) => ({
        title: event.getAttribute("title"),
        start: event.getAttribute("start"),
        end: event.getAttribute("end"),
      })),
    };
  }, { tasks: readBody("company-todos"), calendar: readBody("todays-calendar") });
  expect(authoredTasks.length).toBeGreaterThan(0);
  expect(authoredEvents.length).toBeGreaterThan(0);
  expect(authoredDueDates).toEqual([
    "2026-07-04", "2026-07-08", "2026-07-08", "2026-07-08", "2026-07-10", "2026-07-14",
  ]);
  expect(authoredEvents.every(({ start, end }) =>
    start?.startsWith("2026-07-08T") && end?.startsWith("2026-07-08T"))).toBe(true);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedModules: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.endsWith(".js")) failedModules.push(request.url());
  });

  await page.goto(`${fixture.url}/productivity/company-todos/`);
  await configureTestMotion(page);
  const taskReport = await waitForAuthoredUpgrade(page, {
    kind: "tasks",
    definitions: ["tv-task-checkbox", "tv-task-meta-due", "tv-icon"],
    expectedGeneratedCount: authoredTasks.length + authoredDueDates.length,
  }) as {
    generatedCount: number;
    heading: string | null;
    tasks: Array<{ title: string; inputName: string | null }>;
    dueDates: Array<{ date: string | null; label: string | null }>;
  };

  expect(taskReport.tasks).toEqual(
    authoredTasks.map(({ title }) => ({ title, inputName: title })),
  );
  expect(taskReport.heading).toBe("Friday, October 2");
  expect(taskReport.dueDates).toEqual([
    { date: "2026-09-28", label: "Sep 28" },
    { date: "2026-10-02", label: "Today" },
    { date: "2026-10-02", label: "Today" },
    { date: "2026-10-02", label: "Today" },
    { date: "2026-10-04", label: "Oct 4" },
    { date: "2026-10-08", label: "Oct 8" },
  ]);
  expect(taskReport.dueDates.every(({ label }) => label !== null && label !== "Invalid date")).toBe(true);

  await page.goto(`${fixture.url}/productivity/todays-calendar/`);
  await configureTestMotion(page);
  const calendarReport = await waitForAuthoredUpgrade(page, {
    kind: "calendar",
    definitions: ["calendar-week", "calendar-event"],
    expectedGeneratedCount: authoredEvents.length,
  }) as {
    generatedCount: number;
    startDate: string | null;
    header: { weekday: string | null; date: string | null };
    events: Array<{
      title: string | null;
      renderedTitle: string | null;
      start: string | null;
      end: string | null;
    }>;
  };

  expect(calendarReport.startDate).toBe("2026-10-02");
  expect(calendarReport.header).toEqual({ weekday: "Fri", date: "2" });
  expect(calendarReport.events).toEqual(
    authoredEvents.map(({ title, start, end }) => ({
      title,
      renderedTitle: title,
      start: start?.replace("2026-07-08", "2026-10-02"),
      end: end?.replace("2026-07-08", "2026-10-02"),
    })),
  );

  const moduleRequests = fixture.requests.filter(({ pathname }) => pathname.endsWith(".js"));
  expect(moduleRequests).toEqual(expect.arrayContaining([
    { pathname: "/canonical/v2/components.js", status: 200 },
    { pathname: "/productivity/company-todos/onboarding-relative-dates.js", status: 200 },
    { pathname: "/productivity/company-todos/task.js", status: 200 },
    { pathname: "/productivity/todays-calendar/onboarding-relative-dates.js", status: 200 },
    { pathname: "/productivity/todays-calendar/calendar.js", status: 200 },
  ]));
  expect(moduleRequests.every(({ status }) => status === 200)).toBe(true);
  expect(fixture.requests).toEqual(expect.arrayContaining([
    { pathname: "/canonical/v2/styles.css", status: 200 },
    { pathname: "/canonical/v2/base.css", status: 200 },
    { pathname: "/theme/theme.css", status: 200 },
  ]));
  expect(failedModules).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

async function waitForAuthoredUpgrade(
  page: Page,
  input: {
    kind: "tasks" | "calendar";
    definitions: string[];
    expectedGeneratedCount: number;
  },
): Promise<unknown> {
  return page.evaluate(async ({ kind, definitions, expectedGeneratedCount }) => {
    await Promise.all(definitions.map((name) => customElements.whenDefined(name)));
    const readReport = (): { generatedCount: number; [key: string]: unknown } => {
      if (kind === "tasks") {
        const tasks = [...document.querySelectorAll("tv-task")].map((task) => {
          const title = task.querySelector("tv-task-title")?.textContent?.trim() ?? "";
          const input = task.querySelector("tv-task-checkbox")?.shadowRoot?.querySelector("input");
          return { title, inputName: input?.getAttribute("aria-label") ?? null };
        });
        const dueDates = [...document.querySelectorAll("tv-task-meta-due")].map((due) => ({
          date: due.getAttribute("date"),
          label: due.shadowRoot?.querySelector(".label")?.textContent ?? null,
        }));
        return {
          generatedCount: tasks.filter(({ inputName }) => inputName !== null).length +
            dueDates.filter(({ label }) => label !== null).length,
          heading: document.querySelector("header p")?.textContent ?? null,
          tasks,
          dueDates,
        };
      }
      const day = document.querySelector("calendar-headers > calendar-day");
      const events = [...document.querySelectorAll("calendar-event")].map((event) => ({
        title: event.getAttribute("title"),
        renderedTitle: event.querySelector(":scope > .event-block h3")?.textContent ?? null,
        start: event.getAttribute("start"),
        end: event.getAttribute("end"),
      }));
      return {
        generatedCount: events.filter(({ renderedTitle }) => renderedTitle !== null).length,
        startDate: document.querySelector("calendar-week")?.getAttribute("start-date") ?? null,
        header: {
          weekday: day?.querySelector(".weekday")?.textContent ?? null,
          date: day?.querySelector(".date-num")?.textContent ?? null,
        },
        events,
      };
    };
    const roots = [document, ...[...document.querySelectorAll("*")]
      .map((element) => element.shadowRoot)
      .filter((root): root is ShadowRoot => root !== null)];

    return new Promise((resolve, reject) => {
      let frameCount = 0;
      let stableFrames = 0;
      let previousSignature = "";
      let scheduled = false;
      const observers = roots.map((root) => {
        const observer = new MutationObserver(schedule);
        observer.observe(root, { attributes: true, childList: true, subtree: true });
        return observer;
      });

      function cleanup(): void {
        for (const observer of observers) observer.disconnect();
      }

      function schedule(): void {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(check);
      }

      function check(): void {
        scheduled = false;
        frameCount += 1;
        const report = readReport();
        const signature = JSON.stringify(report);
        if (report.generatedCount === expectedGeneratedCount && signature === previousSignature) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previousSignature = signature;
        if (stableFrames >= 2) {
          cleanup();
          resolve(report);
          return;
        }
        if (frameCount >= 600) {
          cleanup();
          reject(new Error(
            `Authored custom elements did not stabilize: expected ${expectedGeneratedCount}, observed ${report.generatedCount}`,
          ));
          return;
        }
        schedule();
      }

      schedule();
    });
  }, input);
}

async function startArtifactFixture(
  contentRoot: string,
  canonicalRoot: string,
): Promise<ArtifactFixture> {
  const requests: ServedRequest[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const generatedStylesheet = pathname === "/canonical/v2/styles.css"
      ? CANONICAL_WRAPPER
      : pathname === "/theme/theme.css"
        ? ""
        : null;
    if (generatedStylesheet !== null) {
      requests.push({ pathname, status: 200 });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/css; charset=utf-8",
      });
      response.end(generatedStylesheet);
      return;
    }
    const source = pathname === "/canonical/v2/base.css"
      ? resolveFixturePath(canonicalRoot, "styles.css")
      : pathname.startsWith("/canonical/v2/")
        ? resolveFixturePath(canonicalRoot, pathname.slice("/canonical/v2/".length))
        : resolveFixturePath(contentRoot, pathname.slice(1));
    if (!source) {
      requests.push({ pathname, status: 404 });
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    requests.push({ pathname, status: 200 });
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentType(source),
    });
    createReadStream(source).pipe(response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}

function resolveFixturePath(root: string, relative: string): string | null {
  const candidate = path.resolve(root, decodeURIComponent(relative));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  if (!existsSync(candidate)) return null;
  const resolved = statSync(candidate).isDirectory() ? path.join(candidate, "index.html") : candidate;
  return existsSync(resolved) && statSync(resolved).isFile() ? resolved : null;
}

function contentType(file: string): string {
  switch (path.extname(file)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function closeServer(server: HTTPServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
