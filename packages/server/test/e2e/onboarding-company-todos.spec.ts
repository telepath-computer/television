import { expect, test, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureTestMotion } from "../../../web/test/e2e/helpers.ts";
import { compareChildKeys, generatePushKey } from "@telepath-computer/television-shared/resources";
import { loadOnboardingConfig } from "../../src/onboarding-content.ts";
import type { RunningServer } from "../resources/harness.ts";
import { MAPPED_HOST_LAUNCH, SdkTestContext, artifactPath, pageURL, serverPort, sleep } from "./resource-sdk-harness.ts";
import type { NetworkProxy } from "./network-proxy.ts";

// proofs/ui/onboarding-artifacts/index.md, Company To-dos as a live list:
// Company To-dos as an installed artifact of a really-running server. The real
// bake of the authored Productivity channel writes a disposable content tree,
// which the store installs through the real onboarding installer over
// temporary storage, so the artifact's own store and its starting tasks, with
// their dates moved to the installation day, come from the declared starting
// value. The browser's clock is fixed to the installation day, read from the
// installed store. Changes from outside go through the store's administrative
// routes, as `tv resource json --artifact` makes them, and share links through
// the share routes, as `tv share-artifact` makes them. The browser reaches the
// server at a mapped plain-HTTP host name, through the network proxy where a
// test names it; two tests hold or fail the page's request for the SDK with
// Playwright's request routing; the standard motion override is the only other
// mechanism replaced.

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const PRODUCTION_TREE = path.join(REPO_ROOT, "packages/server/assets/onboarding-channels");
const SKILLS_BUILD = path.join(REPO_ROOT, "packages/skills/scripts/build.mjs");
const BAKE = path.join(REPO_ROOT, "scripts/bake-onboarding.mjs");
const CANONICAL_DIR = fileURLToPath(new URL("../../dist/canonical", import.meta.url));
/** How long to wait for writes a test expects not to happen. */
const QUIET_MS = 500;

test.use({ launchOptions: MAPPED_HOST_LAUNCH });

const context = new SdkTestContext();
test.afterEach(() => context.cleanup());

let workRoot = "";
let contentRoot = "";

test.beforeAll(() => {
  test.setTimeout(180_000);
  workRoot = mkdtempSync(path.join(os.tmpdir(), "tv-onboarding-company-todos-"));
  contentRoot = path.join(workRoot, "onboarding-channels");
  const skillsDist = path.join(workRoot, "skills-dist");
  cpSync(PRODUCTION_TREE, contentRoot, { recursive: true });
  execFileSync(process.execPath, [SKILLS_BUILD], {
    cwd: REPO_ROOT,
    env: { ...process.env, TV_SKILLS_DIST_DIR: skillsDist },
    stdio: "pipe",
  });
  execFileSync(process.execPath, [BAKE, "productivity", "--root", contentRoot, "--skills-dist", skillsDist], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
});

test.afterAll(() => {
  if (workRoot) rmSync(workRoot, { recursive: true, force: true });
});

interface Task {
  title: string;
  note?: string;
  due?: string;
  project?: string;
  tags?: string[];
  done?: boolean;
}

interface Installed {
  server: RunningServer;
  artifactID: string;
  /** The installation day, where the starting tasks authored on the story day fall due. */
  installDay: string;
  /** The starting tasks as the installed store holds them, by key. */
  tasks: Record<string, Task>;
}

/** Starts a server over `home` that installs the baked onboarding tree, or finds it installed. */
function startInstalling(home?: string): Promise<RunningServer> {
  return context.start({ onboardingContentPath: contentRoot, canonicalDir: CANONICAL_DIR, ...(home === undefined ? {} : { home }) });
}

/** A server that installed the baked onboarding tree, with Company To-dos' artifact ID and its store as installed. */
async function installedTodos(): Promise<Installed> {
  const server = await startInstalling();
  const config = loadOnboardingConfig(contentRoot).config!;
  const artifacts = config.channels.find((channel) => channel.slug === "productivity")!.artifacts;
  const index = artifacts.findIndex((artifact) => artifact.slug === "company-todos");
  const declaration = artifacts[index]!.store!;
  const productivity = server.store.listChannels().find((channel) => channel.onboarding?.slug === "productivity")!;
  const artifactID = productivity.layout[index]!.artifactIds[0]!;
  const tasks = await storedTasks(server, artifactID);
  const authored = (declaration.value as unknown as { tasks: Record<string, Task> }).tasks;
  const onStoryDay = Object.keys(authored).find((key) => authored[key]!.due === declaration.shiftDatesFrom)!;
  return { server, artifactID, installDay: tasks[onStoryDay]!.due!, tasks };
}

async function storedTasks(server: RunningServer, artifactID: string): Promise<Record<string, Task>> {
  return ((await server.jsonGet({ artifactID })).body as { value: { tasks: Record<string, Task> } }).value.tasks;
}

/** The SDK's address, as the to-do store module imports it. */
const SDK_PATH = "/sdk/v1/resources.js";

/** Fixes the browser's clock at noon of a local day, keeping its timers running, so the page's "today" is that day. */
async function fixDay(page: Page, day: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${day}T12:00:00`));
}

/** Opens the document at its artifact address and returns once the given tasks' checkboxes have upgraded. */
async function openTodos(page: Page, url: string, titles: string[]): Promise<void> {
  await page.goto(url);
  await configureTestMotion(page);
  for (const title of titles) {
    await expect(page.getByRole("checkbox", { name: title, exact: true })).toHaveCount(1);
  }
}

function titlesOf(tasks: Record<string, Task>): string[] {
  return Object.values(tasks).map((task) => task.title);
}

function checkbox(page: Page, title: string) {
  return page.getByRole("checkbox", { name: title, exact: true });
}

async function checkedStates(page: Page, titles: string[]): Promise<boolean[]> {
  return Promise.all(titles.map((title) => checkbox(page, title).isChecked()));
}

async function enabledStates(page: Page, titles: string[]): Promise<boolean[]> {
  return Promise.all(titles.map((title) => checkbox(page, title).isEnabled()));
}

/** The sections the list shows, each with its heading and its tasks' titles in order. */
function sections(page: Page): Promise<Array<{ heading: string; titles: string[] }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll("tv-task-list > tv-task-section")].map((section) => ({
      heading: section.querySelector(":scope > header h2")?.textContent?.trim() ?? "",
      titles: [...section.querySelectorAll("tv-task tv-task-title")].map((title) => title.textContent?.trim() ?? ""),
    })),
  );
}

/** The page's one message, in the page header. */
function message(page: Page) {
  return page.locator("header > p.tv-error");
}

/** The error saying that the page cannot use its store, or could not save to it. */
function storeError(page: Page) {
  return message(page).filter({ hasText: "its store" });
}

/** The message saying the page is disconnected, which does not speak of the store as an error does. */
function disconnectedMessage(page: Page) {
  return message(page).filter({ hasText: /disconnected/i }).filter({ hasNotText: "its store" });
}

/** The message of a refusal the SDK gives this page for `operation` on its store, as the module would hear it. */
function sdkRefusal(page: Page, operation: "get" | "set"): Promise<string> {
  return page.evaluate(
    async ({ sdkPath, kind }) => {
      const sdk = await import(sdkPath);
      const root = sdk.ref(sdk.getStore());
      try {
        await (kind === "get" ? sdk.get(root) : sdk.set(sdk.child(root, "probe"), true));
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`the SDK did not refuse ${kind}`);
    },
    { sdkPath: SDK_PATH, kind: operation },
  );
}

/** Records the levels the page hears from a callback the test registers, so it can wait for a level change. */
async function recordAccess(page: Page): Promise<void> {
  await page.evaluate(async (sdkPath) => {
    const sdk = await import(sdkPath);
    const levels: unknown[] = [];
    (window as unknown as { accessLevels: unknown[] }).accessLevels = levels;
    sdk.onAccessChanged((level: unknown) => levels.push(level));
  }, SDK_PATH);
}

async function heardAccess(page: Page, access: string): Promise<void> {
  await page.waitForFunction(
    (level) => (window as unknown as { accessLevels: unknown[] }).accessLevels.at(-1) === level,
    access,
  );
}

/** Pushes a task from outside the page, as `tv resource json push --artifact` does, and returns its key. */
async function pushTask(server: RunningServer, artifactID: string, task: unknown): Promise<string> {
  const key = generatePushKey();
  const result = await server.jsonPush({ artifactID }, "tasks", key, task as never);
  expect(result.status).toBe(200);
  return key;
}

/** Shares the artifact at `access`, as `tv share-artifact` does, and returns its share ID. */
async function share(server: RunningServer, artifactID: string, access: "read" | "read-write"): Promise<string> {
  return server.sharedAt(artifactID, access);
}

/** A local day `days` after `day`, as YYYY-MM-DD. */
function dayAfter(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The sections the starting tasks fall into on the installation day, as the UI spec groups and orders them. */
function expectedSections(tasks: Record<string, Task>, today: string): Array<{ heading: string; titles: string[] }> {
  const bucket = (task: Task) => (task.due === undefined ? "Someday" : task.due < today ? "Earlier" : task.due === today ? "Today" : "Upcoming");
  const ordered = Object.entries(tasks).sort(([leftKey, left], [rightKey, right]) =>
    (left.due ?? "").localeCompare(right.due ?? "") || compareChildKeys(leftKey, rightKey));
  return ["Earlier", "Today", "Upcoming", "Someday"]
    .map((heading) => ({ heading, titles: ordered.filter(([, task]) => bucket(task) === heading).map(([, task]) => task.title) }))
    .filter((section) => section.titles.length > 0);
}

test.describe("Company To-dos as a live list", () => {
  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-render
  test("renders the installed starting tasks from the store in their sections under a header that directly precedes the list", async ({ page }) => {
    const { server, artifactID, installDay, tasks } = await installedTodos();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixDay(page, installDay);
    await openTodos(page, pageURL(serverPort(server), artifactPath(artifactID)), titlesOf(tasks));

    expect(await page.evaluate(() => document.querySelector("tv-task-list")?.previousElementSibling?.tagName)).toBe("HEADER");
    const dateLine = new Date(`${installDay}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    await expect(page.locator("header > p:not(.tv-error)")).toHaveText(dateLine);
    const expected = expectedSections(tasks, installDay);
    expect(expected.map((section) => section.heading)).toEqual(["Earlier", "Today", "Upcoming"]);
    expect(await sections(page)).toEqual(expected);

    for (const task of Object.values(tasks)) {
      const row = page.locator("tv-task").filter({ has: page.locator("tv-task-title", { hasText: task.title }) });
      await expect(row).toHaveCount(1);
      if (task.note !== undefined) await expect(row.locator("tv-task-note")).toHaveText(task.note);
      if (task.project !== undefined) await expect(row.locator("tv-task-meta-item")).toHaveText(task.project);
      await expect(row.locator("tv-task-meta-tag")).toHaveText(task.tags ?? []);
      await expect(row.locator("tv-task-meta-due")).toHaveAttribute("date", task.due!);
      await expect(row.locator("tv-task-meta-due")).toHaveAttribute("state", task.due! < installDay ? "overdue" : task.due === installDay ? "today" : "upcoming");
      await expect(checkbox(page, task.title)).not.toBeChecked();
    }
    await expect(message(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store
  test("shows no task until the store's first value, saves each toggle as the task's done, and shows the stored state after a reload", async ({ page }) => {
    const { server, artifactID, installDay, tasks } = await installedTodos();
    const titles = titlesOf(tasks);
    const [firstKey, secondKey] = Object.keys(tasks) as [string, string];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixDay(page, installDay);
    const url = pageURL(serverPort(server), artifactPath(artifactID));

    // While the SDK's download is held, the list shows no task.
    const held: { route: Route | null } = { route: null };
    await page.route(`**${SDK_PATH}`, (route) => {
      held.route = route;
    });
    await page.goto(url);
    await configureTestMotion(page);
    await expect.poll(() => held.route !== null).toBe(true);
    await sleep(QUIET_MS);
    await expect(page.locator("tv-task")).toHaveCount(0);
    await held.route!.continue();
    await page.unroute(`**${SDK_PATH}`);
    await expect(page.locator("tv-task")).toHaveCount(titles.length);
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => true));

    await checkbox(page, tasks[firstKey]!.title).click();
    await expect.poll(async () => (await storedTasks(server, artifactID))[firstKey]!.done).toBe(true);
    await checkbox(page, tasks[firstKey]!.title).click();
    await expect.poll(async () => (await storedTasks(server, artifactID))[firstKey]!.done).toBe(false);
    await checkbox(page, tasks[secondKey]!.title).click();
    await expect.poll(async () => (await storedTasks(server, artifactID))[secondKey]!.done).toBe(true);

    await openTodos(page, url, titles);
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => true));
    expect(await checkedStates(page, titles)).toEqual(titles.map((title) => title === tasks[secondKey]!.title));
    await expect(message(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-live
  test("shows tasks added, changed, completed and removed from outside without a reload", async ({ page }) => {
    const { server, artifactID, installDay, tasks } = await installedTodos();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixDay(page, installDay);
    await openTodos(page, pageURL(serverPort(server), artifactPath(artifactID)), titlesOf(tasks));
    const todayTitles = async () => (await sections(page)).find((section) => section.heading === "Today")?.titles ?? [];
    const headingOf = async (title: string) => (await sections(page)).find((section) => section.titles.includes(title))?.heading;

    // Added, due today, with its metadata.
    await pushTask(server, artifactID, { title: "Book the offsite venue", note: "Twelve people, two nights.", due: installDay, project: "Offsite", tags: ["travel"] });
    await expect.poll(todayTitles).toContain("Book the offsite venue");
    const added = page.locator("tv-task").filter({ has: page.locator("tv-task-title", { hasText: "Book the offsite venue" }) });
    await expect(added.locator("tv-task-note")).toHaveText("Twelve people, two nights.");
    await expect(added.locator("tv-task-meta-item")).toHaveText("Offsite");
    await expect(added.locator("tv-task-meta-tag")).toHaveText(["travel"]);

    // Completed where it stands.
    const [doneKey, movedKey, removedKey] = Object.keys(tasks) as [string, string, string];
    const doneHeading = await headingOf(tasks[doneKey]!.title);
    expect((await server.jsonSet({ artifactID }, `tasks/${doneKey}/done`, true)).status).toBe(200);
    await expect(checkbox(page, tasks[doneKey]!.title)).toBeChecked();
    expect(await headingOf(tasks[doneKey]!.title)).toBe(doneHeading);

    // A later due date moves a task to Upcoming; a new title changes its row.
    expect((await server.jsonSet({ artifactID }, `tasks/${movedKey}/due`, dayAfter(installDay, 3))).status).toBe(200);
    await expect.poll(() => headingOf(tasks[movedKey]!.title)).toBe("Upcoming");
    expect((await server.jsonSet({ artifactID }, `tasks/${movedKey}/title`, "Renamed by the agent")).status).toBe(200);
    await expect(checkbox(page, "Renamed by the agent")).toHaveCount(1);
    await expect(checkbox(page, tasks[movedKey]!.title)).toHaveCount(0);

    // Without a due date, or with one that is not a calendar date, a task is Someday.
    await pushTask(server, artifactID, { title: "Someday, maybe" });
    await pushTask(server, artifactID, { title: "Due on a bad date", due: "next week" });
    await expect.poll(async () => (await sections(page)).at(-1)).toEqual({ heading: "Someday", titles: expect.arrayContaining(["Someday, maybe", "Due on a bad date"]) });

    // An entry without a title shows nothing; a removed task's row goes.
    const rows = await page.locator("tv-task").count();
    await pushTask(server, artifactID, { note: "No title here." });
    expect((await server.jsonRemove({ artifactID }, `tasks/${removedKey}`)).status).toBe(200);
    await expect(checkbox(page, tasks[removedKey]!.title)).toHaveCount(0);
    await expect(page.locator("tv-task")).toHaveCount(rows - 1);

    // With no task, the placeholder; with one again, the task.
    expect((await server.jsonSet({ artifactID }, "tasks", {})).status).toBe(200);
    await expect(page.locator("tv-task")).toHaveCount(0);
    await expect(page.locator("tv-task-list > tv-task-placeholder")).toBeVisible();
    await pushTask(server, artifactID, { title: "Start again", due: installDay });
    await expect(checkbox(page, "Start again")).toHaveCount(1);
    await expect(page.locator("tv-task-list > tv-task-placeholder")).toHaveCount(0);
    await expect(message(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-lost
  test("when it cannot use its store, shows the error in the header, at load with no task and when its share link is revoked later with the list as it last showed", async ({ page }) => {
    const installed = await installedTodos();
    const { artifactID, installDay, tasks } = installed;
    const titles = titlesOf(tasks);
    const [firstKey] = Object.keys(tasks) as [string];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixDay(page, installDay);

    // A store whose content file holds bytes that are not JSON, found so by the restarted server.
    const record = installed.server.store.getArtifact(artifactID);
    if (record?.kind !== "path" || record.store === undefined) throw new Error("Company To-dos' record points to no store");
    const contentFile = path.join(installed.server.home, "resources", "json", record.store, "content.json");
    writeFileSync(contentFile, "{ not json");
    await installed.server.stop();
    const server = await startInstalling(installed.server.home);
    await page.goto(pageURL(serverPort(server), artifactPath(artifactID)));
    await configureTestMotion(page);
    await expect(storeError(page)).toBeVisible();
    await expect(storeError(page)).toContainText("cannot use its store");
    await expect(storeError(page)).toContainText(await sdkRefusal(page, "get"));
    expect(await page.evaluate(async (sdkPath) => {
      const sdk = await import(sdkPath);
      return sdk.get(sdk.ref(sdk.getStore())).then(() => null, (error: { code?: string }) => error.code);
    }, SDK_PATH)).toBe("unavailable");
    await expect(page.locator("tv-task")).toHaveCount(0);
    expect(readFileSync(contentFile, "utf8")).toBe("{ not json");

    // Lost while the page is open through its share link with its checkboxes
    // enabled: the list keeps what it last showed.
    const second = await installedTodos();
    await openTodos(page, pageURL(serverPort(second.server), artifactPath(await share(second.server, second.artifactID, "read-write"))), titles);
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => true));
    await expect(storeError(page)).toBeHidden();
    await checkbox(page, second.tasks[firstKey]!.title).click();
    await expect.poll(async () => (await storedTasks(second.server, second.artifactID))[firstKey]!.done).toBe(true);
    const shown = await checkedStates(page, titles);
    const before = await sections(page);
    expect((await second.server.unshare(second.artifactID)).status).toBe(200);
    await expect(storeError(page)).toBeVisible();
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => false));
    expect(await checkedStates(page, titles)).toEqual(shown);
    expect(await sections(page)).toEqual(before);
    await expect(storeError(page)).toContainText("cannot use its store");
    await expect(storeError(page)).toContainText(await sdkRefusal(page, "get"));
    expect(await page.evaluate(async (sdkPath) => {
      const sdk = await import(sdkPath);
      return sdk.get(sdk.ref(sdk.getStore())).then(() => null, (error: { code?: string }) => error.code);
    }, SDK_PATH)).toBe("no-store");
    expect(await enabledStates(page, titles)).toEqual(titles.map(() => false));
    expect(errors).toEqual([]);
  });

  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-no-sdk
  test("when the SDK fails to load, shows no task and the error", async ({ page }) => {
    const { server, artifactID, installDay, tasks } = await installedTodos();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixDay(page, installDay);
    await page.route(`**${SDK_PATH}`, (route) => route.abort());
    await page.goto(pageURL(serverPort(server), artifactPath(artifactID)));
    await configureTestMotion(page);
    await expect(storeError(page)).toBeVisible();
    await expect(storeError(page)).toContainText("cannot use its store");
    await expect(storeError(page)).toContainText("the resource SDK could not be loaded");
    await expect(page.locator("tv-task")).toHaveCount(0);
    await sleep(QUIET_MS);
    expect(await storedTasks(server, artifactID)).toEqual(tasks);
    expect(errors).toEqual([]);
  });

  /**
   * A server that installed the baked tree, with Company To-dos open through
   * the network proxy, at its own address or through its share link at
   * `read-write`, and its checkboxes enabled.
   */
  async function throughProxy(page: Page, address: "own" | "share link"): Promise<Installed & { proxy: NetworkProxy; titles: string[] }> {
    const installed = await installedTodos();
    const titles = titlesOf(installed.tasks);
    await fixDay(page, installed.installDay);
    const proxy = await context.proxy(installed.server);
    const id = address === "own" ? installed.artifactID : await share(installed.server, installed.artifactID, "read-write");
    await openTodos(page, pageURL(proxy.port, artifactPath(id)), titles);
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => true));
    return { ...installed, proxy, titles };
  }

  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-refused
  test("returns a refused save's checkbox to the stored state and shows the error, keeping every checkbox enabled, until a later toggle is saved", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { server, artifactID, proxy, tasks, titles } = await throughProxy(page, "share link");
    const [firstKey, secondKey] = Object.keys(tasks) as [string, string];
    await recordAccess(page);

    // Refused by the server after the page showed it.
    proxy.hold("to-server");
    proxy.hold("to-browser");
    await checkbox(page, tasks[firstKey]!.title).click();
    await expect(checkbox(page, tasks[firstKey]!.title)).toBeChecked();
    await share(server, artifactID, "read");
    proxy.release("to-browser");
    proxy.release("to-server");
    await expect(storeError(page)).toBeVisible();
    await expect(checkbox(page, tasks[firstKey]!.title)).not.toBeChecked();
    await heardAccess(page, "read");
    await expect(storeError(page)).toContainText(await sdkRefusal(page, "set"));
    expect(await enabledStates(page, titles)).toEqual(titles.map(() => true));
    expect(await storedTasks(server, artifactID)).toEqual(tasks);

    // Refused by the SDK before it is shown, now that the page knows its level is read.
    await checkbox(page, tasks[secondKey]!.title).click();
    await expect(checkbox(page, tasks[secondKey]!.title)).not.toBeChecked();
    await expect(storeError(page)).toContainText(await sdkRefusal(page, "set"));
    expect(await enabledStates(page, titles)).toEqual(titles.map(() => true));

    // Saved once the level is read-write again, and the error goes.
    await share(server, artifactID, "read-write");
    await heardAccess(page, "read-write");
    await checkbox(page, tasks[secondKey]!.title).click();
    await expect.poll(async () => (await storedTasks(server, artifactID))[secondKey]!.done).toBe(true);
    await expect(storeError(page)).toBeHidden();
    await expect(checkbox(page, tasks[secondKey]!.title)).toBeChecked();
    expect(errors).toEqual([]);
  });

  // spec: proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-disconnected
  test("while disconnected, says so in the header with every checkbox disabled and no error, and follows the store again when the connection returns", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { server, artifactID, proxy, tasks, titles } = await throughProxy(page, "own");
    const [firstKey, secondKey] = Object.keys(tasks) as [string, string];
    await expect(disconnectedMessage(page)).toBeHidden();

    // A save the connection loses before the server receives it.
    proxy.holdWrites();
    await checkbox(page, tasks[firstKey]!.title).click();
    await proxy.waitFor(() => proxy.heldWriteCount === 1);
    proxy.refuse(true);
    proxy.sever();
    proxy.releaseWrites();
    await expect(disconnectedMessage(page)).toBeVisible();
    await expect(checkbox(page, tasks[firstKey]!.title)).not.toBeChecked();
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => false));
    await expect(storeError(page)).toBeHidden();

    // Another client marks a second task done meanwhile.
    expect((await server.jsonSet({ artifactID }, `tasks/${secondKey}/done`, true)).status).toBe(200);
    proxy.refuse(false);
    await expect(message(page)).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => enabledStates(page, titles)).toEqual(titles.map(() => true));
    await expect(checkbox(page, tasks[secondKey]!.title)).toBeChecked();
    await expect(checkbox(page, tasks[firstKey]!.title)).not.toBeChecked();

    await checkbox(page, tasks[firstKey]!.title).click();
    await expect.poll(async () => (await storedTasks(server, artifactID))[firstKey]!.done).toBe(true);
    await expect(storeError(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
});
