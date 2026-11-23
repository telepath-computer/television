/** Real browser acceptance for the copied Sticky note page and its shared JSON store. */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "../../../../test/helpers/playwright.ts";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

test.use({ launchOptions: TEST_HOST_LAUNCH, viewport: { width: 360, height: 360 }, actionTimeout: 15_000 });
test.setTimeout(180_000);

type Note = { text: string; [key: string]: JSONValue };
type Observation = { kind: string; value?: unknown; pending?: boolean; displayed?: string; access?: string | null };
const fixture = (): Note => ({ text: "Buy milk\nCall the plumber\nBook Barcelona dinner" });
const longText = Array.from({ length: 40 }, (_, index) => `Line ${index}: remember this before leaving.`).join("\n") + "\nLast line";
const note = (frame: Page | Frame): Locator => frame.getByRole("textbox", { name: "Note", exact: true });
const status = (frame: Page | Frame): Locator => frame.locator('[role="status"]');
let h: TemplateHarness;
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("Sticky note page error:", error));
  h = await TemplateHarness.start({ id: "sticky-note", name: "Sticky note" });
});
test.afterEach(async () => { await h?.cleanup(); });

async function open(page: Page, value: Note = fixture()): Promise<string> {
  const id = await h.createStored(value);
  await h.open(page, id);
  await expect(note(page)).toHaveValue(value.text);
  return id;
}
function writes(): Record<string, unknown>[] {
  return h.proxy.messages.filter(({ message }) => message.type === "write").map(({ message }) => message.write as Record<string, unknown>);
}
function connection(): number {
  return h.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
}
async function selection(field: Locator): Promise<{ start: number; end: number; scroll: number }> {
  return field.evaluate(element => {
    const input = element as HTMLTextAreaElement;
    return { start: input.selectionStart, end: input.selectionEnd, scroll: input.scrollTop };
  });
}
async function end(field: Locator): Promise<void> {
  await field.click();
  await field.press("ControlOrMeta+End");
}
async function observeStore(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const url = "/sdk/v1/resources.js";
    const sdk = await import(url) as typeof import("../../../shared/src/resources/sdk.ts");
    const observations: Observation[] = [];
    Object.assign(window, { stickyNoteObservations: observations });
    const displayed = (): string | undefined => document.querySelector<HTMLTextAreaElement>(".sticky-note-text")?.value;
    sdk.onValue(sdk.ref(sdk.getStore()), snapshot => observations.push({ kind: "value", value: snapshot.val(), pending: snapshot.metadata.hasPendingWrites, displayed: displayed() }));
    sdk.onAccessChanged(access => observations.push({ kind: "access", access, displayed: displayed() }));
    sdk.onConnectionStatusChanged(value => observations.push({ kind: "connection", value, displayed: displayed() }));
  });
}
async function observations(page: Page): Promise<Observation[]> {
  return page.evaluate(() => (window as unknown as { stickyNoteObservations: Observation[] }).stickyNoteObservations);
}
async function observed(page: Page, value: unknown): Promise<void> {
  await expect.poll(async () => (await observations(page)).some(event => event.kind === "value" && JSON.stringify(event.value) === JSON.stringify(value))).toBe(true);
}
async function observeStatus(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const known = new WeakSet<Node>();
    const order: boolean[] = [];
    Object.assign(window, { stickyNoteStatusOrder: order });
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('[role="status"]')) {
            order.push(node.textContent === ""); known.add(node);
          }
        }
        const region = record.target instanceof Element ? record.target.closest('[role="status"]') : record.target.parentElement?.closest('[role="status"]');
        if (region?.textContent) order.push(known.has(region));
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}
async function statusOrder(page: Page): Promise<void> {
  const order = await page.evaluate(() => (window as unknown as { stickyNoteStatusOrder: boolean[] }).stickyNoteStatusOrder);
  expect(order.length).toBeGreaterThan(1);
  expect(order.every(Boolean)).toBe(true);
}
async function disconnect(page: Page): Promise<void> {
  h.proxy.refuse(true); h.proxy.sever();
  await expect(status(page)).toHaveText("Reconnecting…");
}
async function waitPastPause(page: Page): Promise<void> {
  // The controlled-clock contracts prove the exact boundary. This waits beyond
  // it to expose a mistakenly surviving timer in a real browser.
  await page.waitForTimeout(500);
}

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-new
// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-delivery
// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-write-scope
// proofs/product/templates.md delegates the bundled journey to sticky-note-ui-ac-new.
test("new Sticky note from Toolbox persists its seed, display, edits and independent assets", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  const responses: { url: string; body: Buffer; ok: boolean }[] = [];
  const bodies: Promise<void>[] = [];
  page.on("response", response => {
    if (/canonical\/v2\/styles.css|sdk\/v1\/resources.js|\/styles.css$|Caveat-Medium.woff2$/.test(response.url())) {
      bodies.push(response.body().then(body => { responses.push({ url: response.url(), body, ok: response.ok() }); }));
    }
  });
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  const { artifactID: id, frame } = await h.create(page);
  await expect(note(frame)).toHaveValue("");
  await expect(note(frame)).not.toBeFocused();
  expect(await selection(note(frame))).toMatchObject({ start: 0, end: 0 });
  await expect(note(frame)).toHaveAttribute("placeholder", "Click here and start typing.");
  expect(await h.read(id)).toEqual({ text: "" });
  const layout = (await h.client.channels.get({ channelID: h.channelID })).channel.layout;
  expect(layout[0]).toMatchObject({ size: { width: 360, height: 360 }, geometry: { kind: "single", full_screen: false } });
  expect((await h.client.artifacts.get({ artifactID: id })).artifact).toMatchObject({ transparent: true });
  await expect(page.locator(`.page[data-page-key="${id}"] .artifact-view`)).toHaveClass(/artifact-frame-transparent/);
  expect(writes()).toEqual([]);
  expect(h.proxy.messages.filter(({ message }) => message.type === "subscribe").map(({ message }) => message.path)).toContain("");
  await frame.evaluate(() => document.fonts.load('500 24px "Sticky Note Caveat"'));
  expect(await note(frame).evaluate(element => ({ font: getComputedStyle(element).fontFamily, weight: getComputedStyle(element).fontWeight }))).toEqual({ font: '"Sticky Note Caveat", cursive', weight: "500" });
  const links = await frame.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  expect(links[0]).toContain("/canonical/v2/styles.css"); expect(links[1]).toContain(`/artifact/${id}/styles.css`);
  await frame.locator("body").click({ position: { x: 18, y: 180 } });
  await page.keyboard.press("Tab"); await expect(note(frame)).toBeFocused();
  await note(frame).pressSequentially("Remember the milk");
  expect(await note(frame).evaluate(element => element.matches(":placeholder-shown"))).toBe(false);
  await expect.poll(() => h.read(id, "text")).toBe("Remember the milk");
  await expect(note(frame)).toBeFocused(); await expect(status(frame)).toHaveText("");
  await page.reload();
  const reloaded = await h.frame(page, id);
  await expect(note(reloaded)).toHaveValue("Remember the milk");
  await note(reloaded).click();
  h.proxy.holdWrites();
  const blurObserver = await reloaded.evaluateHandle(async () => {
    const url = "/sdk/v1/resources.js";
    const sdk = await import(url) as typeof import("../../../shared/src/resources/sdk.ts");
    const field = document.querySelector<HTMLTextAreaElement>(".sticky-note-text")!;
    const state = { text: "", pending: false, blur: null as { unsent: boolean; events: string[] } | null };
    let duringBlur = false;
    let confirmReady = (): void => {};
    const ready = new Promise<void>(resolve => { confirmReady = resolve; });
    // Reuse the page's root subscription. Optimistic events require its initial
    // confirmed value, so the observer must receive that value before input.
    const unsubscribe = sdk.onValue(sdk.ref(sdk.getStore()), snapshot => {
      state.text = (snapshot.val() as Note).text;
      state.pending = snapshot.metadata.hasPendingWrites;
      if (duringBlur && state.pending) state.blur!.events.push("write");
      if (!state.pending) confirmReady();
    });
    await ready;
    // Capture runs before the production handler; the later listener runs after
    // it. A real debounce timer cannot run between these synchronous listeners.
    const beforeBlur = (): void => {
      state.blur = { unsent: state.text !== field.value, events: ["blur"] };
      duringBlur = true;
    };
    const afterBlur = (): void => {
      state.blur!.events.push("after blur");
      duringBlur = false;
    };
    field.addEventListener("blur", beforeBlur, { capture: true });
    field.addEventListener("blur", afterBlur);
    return { state, dispose() {
      unsubscribe();
      field.removeEventListener("blur", beforeBlur, { capture: true });
      field.removeEventListener("blur", afterBlur);
    } };
  });

  // Exercise setup recovery once deliberately: let the debounce save before Tab.
  let draft = "Saved before leaving";
  await note(reloaded).fill(draft);
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  for (;;) {
    await note(reloaded).press("Tab");
    const blur = await blurObserver.evaluate(observer => observer.state.blur);
    expect(blur, "Tab must dispatch native blur").not.toBeNull();
    if (blur!.unsent) {
      expect(blur!.events, "native blur must start the save during its dispatch").toEqual(["blur", "write", "after blur"]);
      break;
    }
    // Scheduling can let the debounce win between fill and Tab. Confirm that
    // write, then type a different draft. A failed blur assertion is never retried.
    await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
    h.proxy.releaseWrites();
    await expect.poll(() => blurObserver.evaluate(observer => observer.state.pending)).toBe(false);
    h.proxy.holdWrites();
    draft = draft === "Saved by leaving" ? "Saved by leaving again" : "Saved by leaving";
    await note(reloaded).fill(draft);
  }
  await blurObserver.evaluate(observer => observer.dispose());
  await blurObserver.dispose();
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await expect(status(reloaded)).toHaveText("");
  h.proxy.releaseWrites(); await expect.poll(() => h.read(id, "text")).toBe(draft);
  await note(reloaded).fill(""); await note(reloaded).press("Tab");
  await expect.poll(() => h.read(id)).toEqual({ text: "" });
  expect(await note(reloaded).evaluate(element => element.matches(":placeholder-shown"))).toBe(true);
  expect(writes().every(write => write.kind === "set" && write.path === "text")).toBe(true);
  expect(writes().at(-1)).toEqual({ kind: "set", path: "text", value: { value: "" } });
  await expect(status(reloaded)).toHaveText("");
  await Promise.all(bodies);
  expect(responses.every(response => response.ok)).toBe(true);
  for (const name of ["styles.css", "Caveat-Medium.woff2"]) {
    expect(responses.find(response => response.url.endsWith(`/artifact/${id}/${name}`))?.body)
      .toEqual(readFileSync(path.resolve(import.meta.dirname, `../../../server/assets/templates/sticky-note/${name}`)));
  }
  expect(responses.some(response => response.url.includes("/sdk/v1/resources.js"))).toBe(true);
  expect(requests.filter(url => /font|woff/i.test(url)).every(url => new URL(url).hostname === "tv-sdk.test")).toBe(true);
  expect(requests.some(url => /storybook|\/specs\//.test(url))).toBe(false);
  const artifact = (await h.client.artifacts.get({ artifactID: id })).artifact;
  expect(artifact).toHaveProperty("path");
  const directory = (artifact as unknown as { path: string }).path;
  expect(readFileSync(path.join(directory, "THIRD-PARTY-NOTICES.txt"), "utf8")).toContain("Caveat");
  renameSync(path.join(h.home, "templates/sticky-note"), path.join(h.home, "sticky-note-outside-discovery"));
  await page.reload(); const independent = await h.frame(page, id);
  await expect(note(independent)).toHaveValue("");
  await note(independent).fill("Independent copy");
  await expect.poll(() => h.read(id, "text")).toBe("Independent copy");
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-editing
// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-write-scope
test("real editing preserves line breaks, spaces, copying and native undo", async ({ page }) => {
  const id = await open(page, { text: "Start", extra: { preserved: true } });
  await expect(note(page)).toHaveAttribute("spellcheck", "false");
  await end(note(page)); await note(page).press("Enter"); await note(page).pressSequentially("Second");
  await note(page).press("Shift+Enter"); await note(page).pressSequentially("Third");
  await expect(note(page)).toHaveValue("Start\nSecond\nThird");
  await h.clipboard(page, "  pasted  \n\n tail ");
  await end(note(page)); await note(page).press("ControlOrMeta+V");
  const plain = "Start\nSecond\nThird  pasted  \n\n tail ";
  await expect.poll(() => h.read(id, "text")).toBe(plain);
  await h.clipboard(page, "plain representation", "<b>Rich representation</b>");
  await end(note(page)); await note(page).press("ControlOrMeta+V");
  await expect.poll(() => h.read(id, "text")).toBe(plain + "plain representation");
  await note(page).press("ControlOrMeta+Home");
  for (let i = 0; i < 5; i++) await note(page).press("Shift+ArrowRight");
  await note(page).press("ControlOrMeta+C"); expect(await h.readClipboard(page)).toBe("Start");
  await end(note(page)); await note(page).pressSequentially(" undo this");
  await expect.poll(() => h.read(id, "text")).toBe(plain + "plain representation undo this");
  await note(page).press("ControlOrMeta+Z");
  await expect.poll(() => h.read(id, "text")).toBe(plain + "plain representation");
  expect(await h.read(id, "extra")).toEqual({ preserved: true });
  expect(writes().every(write => write.kind === "set" && write.path === "text")).toBe(true);
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-live
// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-write-scope
test("agent commands and two viewers preserve active typing and follow the latest stored write", async ({ page, context }) => {
  const id = await open(page);
  await observeStore(page);
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "/text", JSON.stringify("Agent replacement")]);
  await expect(note(page)).toHaveValue("Agent replacement");
  h.product.runCLI(["resource", "json", "set", "--artifact", id, "/text", '""']);
  await expect(note(page)).toHaveValue(""); expect(writes()).toEqual([]);
  const second = await context.newPage(); await h.open(second, id);
  await note(second).fill("Other viewer"); await expect(note(page)).toHaveValue("Other viewer");
  await page.bringToFront(); await h.set(id, { text: longText }); await expect(note(page)).toHaveValue(longText);
  await end(note(page)); await note(page).pressSequentially(" local"); await note(page).press("Shift+ArrowLeft");
  const before = await selection(note(page));
  await h.set(id, { text: "Suppressed remote" }); await observed(page, { text: "Suppressed remote" });
  await expect(note(page)).toHaveValue(longText + " local"); expect(await selection(note(page))).toEqual(before);
  await note(page).press("Tab"); await expect.poll(() => h.read(id, "text")).toBe(longText + " local");
  await expect(note(second)).toHaveValue(longText + " local");
  await h.set(id, { text: "Remote after local send" }); await expect(note(page)).toHaveValue("Remote after local send");
  await end(note(page)); await note(page).press("Shift+ArrowLeft"); const unchanged = await selection(note(page));
  await h.set(id, { text: "Remote after local send", delivered: true }); await observed(page, { text: "Remote after local send", delivered: true });
  expect(await selection(note(page))).toEqual(unchanged);
  h.proxy.holdWrites(); await note(page).fill("First writer complete string"); await note(page).press("Tab");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await second.bringToFront(); await note(second).fill("Second writer complete string"); await note(second).press("Tab");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 2);
  h.proxy.releaseWrites();
  await expect.poll(() => h.read(id, "text")).toBe("Second writer complete string");
  await expect(note(page)).toHaveValue("Second writer complete string"); await expect(note(second)).toHaveValue("Second writer complete string");
  expect(await h.read(id, "delivered")).toBe(true);
  await second.close();
});

// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-confirmation
test("an older save confirmation leaves newer typing pending", async ({ page }) => {
  const id = await open(page); await observeStore(page);
  const socket = connection(); h.proxy.holdServerMessages(socket, message => message.type === "applied");
  await note(page).fill("First saved string"); await note(page).press("Tab");
  await expect.poll(() => h.read(id, "text")).toBe("First saved string");
  await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(socket) === 1);
  await note(page).fill("Newer pending string"); await note(page).press("Shift+ArrowLeft");
  const before = await selection(note(page));
  h.proxy.releaseServerMessages(socket);
  await expect.poll(async () => (await observations(page)).some(event => event.kind === "value" && event.pending === false && (event.value as Note | undefined)?.text === "First saved string")).toBe(true);
  await expect(note(page)).toHaveValue("Newer pending string"); expect(await selection(note(page))).toEqual(before);
  await note(page).press("Tab"); await expect.poll(() => h.read(id, "text")).toBe("Newer pending string");
  expect(writes()).toEqual([
    { kind: "set", path: "text", value: { value: "First saved string" } },
    { kind: "set", path: "text", value: { value: "Newer pending string" } },
  ]);
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-access
test("real share access changes discard drafts and retain the latest saved read-only text", async ({ page }) => {
  const id = await h.createStored(fixture()); const share = await h.client.resources.share({ artifactID: id, access: "read" });
  await h.open(page, id, share.shareID); await observeStore(page);
  await expect(note(page)).toHaveValue(fixture().text); await expect(note(page)).toHaveAttribute("readonly", "");
  await note(page).click(); await note(page).press("ControlOrMeta+A");
  expect(await selection(note(page))).toMatchObject({ start: 0, end: fixture().text.length });
  await note(page).press("ControlOrMeta+C"); expect(await h.readClipboard(page)).toBe(fixture().text);
  await note(page).pressSequentially("ignored"); await note(page).press("Tab"); await waitPastPause(page); expect(writes()).toEqual([]);
  await h.set(id, { text: "" }); await expect(note(page)).toHaveValue(""); await expect(note(page)).not.toHaveAttribute("placeholder");
  await h.set(id, { text: "Agent saved" }); await expect(note(page)).toHaveValue("Agent saved");
  await h.client.resources.share({ artifactID: id, access: "read-write" }); await expect(note(page)).toBeEditable();
  await note(page).fill("Shared edit"); await note(page).press("Tab"); await expect.poll(() => h.read(id, "text")).toBe("Shared edit");
  await note(page).fill("Draft to discard");
  await h.set(id, { text: "Latest saved" }); await observed(page, { text: "Latest saved" });
  await h.client.resources.share({ artifactID: id, access: "read" });
  await expect(note(page)).toHaveAttribute("readonly", ""); await expect(note(page)).toHaveValue("Latest saved");
  const count = writes().length;
  await note(page).pressSequentially("ignored"); await note(page).press("Tab"); await waitPastPause(page);
  expect(writes()).toHaveLength(count); expect(await h.read(id, "text")).toBe("Latest saved");
  await h.client.resources.share({ artifactID: id, access: "read-write" }); await expect(note(page)).toBeEditable();
  await waitPastPause(page); expect(writes()).toHaveLength(count);
  await note(page).fill("Fresh allowed edit"); await note(page).press("Tab"); await expect.poll(() => h.read(id, "text")).toBe("Fresh allowed edit");
  await h.client.resources.unshare({ artifactID: id });
  await expect.poll(async () => (await observations(page)).filter(event => event.kind === "access").at(-1)?.access).toBe(null);
  await expect(note(page)).toHaveAttribute("readonly", ""); await expect(note(page)).toHaveValue("Fresh allowed edit");
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-loading
test("first load waits for readable data and access and announces disconnection before recovering", async ({ page }) => {
  const id = await h.createStored(); await observeStatus(page); h.proxy.hold("to-browser");
  await h.open(page, id); await expect(page.locator(".sticky-note-page")).toBeVisible();
  await expect(note(page)).toHaveCount(0); await expect(page.locator(".sticky-note-page")).toHaveText("");
  await h.proxy.waitFor(() => h.proxy.openWebSockets > 0); await disconnect(page);
  await expect(note(page)).toHaveCount(0); await statusOrder(page);
  h.proxy.release("to-browser"); h.proxy.refuse(false);
  await expect(note(page)).toBeEditable(); await expect(note(page)).toHaveValue(""); await expect(status(page)).toHaveText("");
  await note(page).fill("Loaded and writable"); await expect.poll(() => h.read(id, "text")).toBe("Loaded and writable");
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-offline
// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-reconnect
test("offline typing survives rollback and saves after reconnect checks", async ({ page }) => {
  const id = await open(page); await observeStore(page);
  h.proxy.holdWrites(); await note(page).fill("In flight"); await note(page).press("Tab");
  await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1); await disconnect(page); h.proxy.releaseWrites();
  await expect(note(page)).toHaveValue("In flight"); await expect(note(page)).toBeEditable();
  const before = writes().length;
  await note(page).fill("Offline first"); await note(page).fill("Offline latest"); await waitPastPause(page);
  expect(writes()).toHaveLength(before);
  await h.set(id, { text: "Changed while offline" });
  const firstMessage = h.proxy.messages.length;
  h.proxy.refuse(false);
  await expect.poll(() => h.read(id, "text")).toBe("Offline latest"); await expect(note(page)).toHaveValue("Offline latest");
  const messages = h.proxy.messages.slice(firstMessage).map(entry => entry.message);
  const readIndex = messages.findIndex(message => message.type === "get" && message.path === "");
  const writeIndex = messages.findIndex(message => message.type === "write");
  expect(readIndex).toBeGreaterThanOrEqual(0); expect(writeIndex).toBeGreaterThan(readIndex);
  const events = await observations(page);
  const freshValues = events.filter(event => event.kind === "value" && (event.value as Note | undefined)?.text === "Changed while offline");
  expect(freshValues.length).toBeGreaterThan(0);
  expect(freshValues.every(event => event.displayed === "Offline latest")).toBe(true);
  expect(events.some(event => event.kind === "access" && event.access === "read-write")).toBe(true);
  await expect(status(page)).toHaveText("");
  // Hold the fresh read until native typing restarts the pause on the new connection.
  await disconnect(page); await note(page).fill("Earlier offline draft"); await waitPastPause(page);
  h.proxy.hold("to-browser"); h.proxy.refuse(false); await h.proxy.waitFor(() => h.proxy.openWebSockets > 0);
  await note(page).fill("Still typing on reconnect");
  const count = writes().length; h.proxy.release("to-browser");
  await expect(note(page)).toHaveValue("Still typing on reconnect");
  expect(writes()).toHaveLength(count);
  await expect.poll(() => h.read(id, "text")).toBe("Still typing on reconnect");
});

// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-reconnect
for (const lost of ["access", "data"] as const) {
  test(`reconnect discards a draft when ${lost === "access" ? "access" : "readable data"} is lost`, async ({ page }) => {
    const id = await h.createStored(fixture()); const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
    await h.open(page, id, share.shareID); await expect(note(page)).toHaveValue(fixture().text);
    await disconnect(page); await note(page).fill("Discard on reconnect"); await waitPastPause(page);
    if (lost === "access") await h.client.resources.share({ artifactID: id, access: "read" });
    else await h.set(id, { text: 4 });
    const count = writes().length; h.proxy.refuse(false);
    if (lost === "access") { await expect(note(page)).toHaveAttribute("readonly", ""); await expect(note(page)).toHaveValue(fixture().text); }
    else await expect(page.getByRole("alert")).toContainText("This note can't be shown");
    await waitPastPause(page); expect(writes()).toHaveLength(count);
    await h.set(id, { text: "Restored data" }); await h.client.resources.share({ artifactID: id, access: "read-write" });
    await expect(note(page)).toHaveValue("Restored data"); await expect(note(page)).toBeEditable();
    await waitPastPause(page); expect(writes()).toHaveLength(count);
    await note(page).fill("Fresh edit"); await expect.poll(() => h.read(id, "text")).toBe("Fresh edit");
  });
}

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-offline
test("read-only disconnection stays read-only and reconnect without a draft shows current text", async ({ page }) => {
  const id = await open(page); await disconnect(page); await h.set(id, { text: "Remote without a draft" }); h.proxy.refuse(false);
  await expect(note(page)).toHaveValue("Remote without a draft"); await expect(status(page)).toHaveText("");
  const share = await h.client.resources.share({ artifactID: id, access: "read" }); await h.open(page, id, share.shareID);
  await expect(note(page)).toHaveAttribute("readonly", ""); await disconnect(page); const before = writes().length;
  await note(page).click(); await note(page).pressSequentially("ignored"); await note(page).press("Tab"); await waitPastPause(page);
  expect(writes()).toHaveLength(before); await expect(note(page)).toHaveAttribute("readonly", "");
  await h.set(id, { text: "Remote read-only" }); h.proxy.refuse(false); await expect(note(page)).toHaveValue("Remote read-only");
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-draft-lifetime
test("reloading or closing an offline note loses its unsent draft", async ({ page, context }) => {
  const id = await open(page); const saved = fixture().text;
  await disconnect(page); await note(page).fill("Lost by reload"); await waitPastPause(page); expect(writes()).toEqual([]);
  await page.reload(); h.proxy.refuse(false); await expect(note(page)).toHaveValue(saved); await waitPastPause(page); expect(writes()).toEqual([]);
  await disconnect(page); await note(page).fill("Lost by closing"); await waitPastPause(page); await page.close();
  const replacement = await context.newPage(); await h.open(replacement, id); h.proxy.refuse(false);
  await expect(note(replacement)).toHaveValue(saved); await waitPastPause(replacement); expect(writes()).toEqual([]); expect(await h.read(id, "text")).toBe(saved);
  await replacement.close();
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-save-failure
// Selective buffering changes notification order while real authorization and rollback still run.
test("a genuinely refused save discards newer typing and announces rollback with reconnect priority", async ({ page }) => {
  const id = await h.createStored(fixture()); const share = await h.client.resources.share({ artifactID: id, access: "read-write" });
  await observeStatus(page); await h.open(page, id, share.shareID); await expect(note(page)).toHaveValue(fixture().text);
  for (const disconnectWhileVisible of [false, true]) {
    const socket = connection(); h.proxy.holdWrites(); h.proxy.holdServerMessages(socket, message => message.type === "access");
    await note(page).fill("Rejected save"); await note(page).press("Tab"); await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
    await h.client.resources.share({ artifactID: id, access: "read" }); await h.proxy.waitFor(() => h.proxy.heldServerMessageCount(socket) > 0);
    await note(page).fill("Newer rejected typing"); h.proxy.releaseWrites();
    await expect(note(page)).toHaveValue(fixture().text); await expect(note(page)).toBeFocused();
    await expect(status(page)).toHaveText("Couldn't save that change."); await statusOrder(page);
    if (disconnectWhileVisible) { await disconnect(page); await expect(status(page)).toHaveText("Reconnecting…"); }
    else await expect(status(page)).toHaveText("", { timeout: 15_000 });
    h.proxy.releaseServerMessages(socket); await h.client.resources.share({ artifactID: id, access: "read-write" }); h.proxy.refuse(false);
    await expect(note(page)).toBeEditable(); await expect(status(page)).toHaveText("");
    const count = writes().length; await waitPastPause(page); expect(writes()).toHaveLength(count); expect(await h.read(id, "text")).toBe(fixture().text);
  }
  await note(page).fill("Allowed fresh edit"); await expect.poll(() => h.read(id, "text")).toBe("Allowed fresh edit");
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-invalid
// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-invalid-guard
test("unreadable data discards pending typing and recovers without reopening", async ({ page }) => {
  const id = await open(page);
  for (const missing of [false, true]) {
    await note(page).fill("Unsent before invalidation");
    if (missing) await h.remove(id); else await h.set(id, { text: 5 });
    const alert = page.getByRole("alert"); await expect(alert).toContainText("This note can't be shown");
    await expect(alert).toContainText("Its saved data isn't in the form this page reads. Ask your agent to check it.");
    await expect(note(page)).toHaveCount(0); const count = writes().length;
    await page.keyboard.type("ignored"); await page.keyboard.press("Tab"); await waitPastPause(page);
    expect(writes()).toHaveLength(count); expect(await h.read(id)).toEqual(missing ? undefined : { text: 5 });
    await page.reload(); await expect(alert).toBeVisible(); await expect(note(page)).toHaveCount(0);
    await disconnect(page); await expect(alert).toBeVisible(); h.proxy.refuse(false);
    await h.set(id, fixture()); await expect(note(page)).toHaveValue(fixture().text); await waitPastPause(page); expect(writes()).toHaveLength(count);
    await note(page).fill("Fresh after repair"); await expect.poll(() => h.read(id, "text")).toBe("Fresh after repair");
  }
});

// proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-invalid-guard
test("invalid subscriptions prevent new writes while an already-sent write remains last-write-wins", async ({ page }) => {
  const id = await open(page);
  h.proxy.holdWrites(); await note(page).fill("Already sent"); await note(page).press("Tab"); await h.proxy.waitFor(() => h.proxy.heldWriteCount === 1);
  await h.set(id, { text: 5, untouched: true }); expect(await h.read(id)).toEqual({ text: 5, untouched: true });
  h.proxy.releaseWrites(); await expect.poll(() => h.read(id)).toEqual({ text: "Already sent", untouched: true });
  await expect(note(page)).toHaveValue("Already sent"); expect(writes()).toHaveLength(1);
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-unavailable
test("damaged saved bytes show the alert and recover after repair and restart", async ({ page }) => {
  const id = await open(page); const file = h.contentFile(id); const original = readFileSync(file);
  await h.restart(() => writeFileSync(file, "{damaged json"));
  await expect(page.getByRole("alert")).toContainText("This note can't be shown"); await expect(note(page)).toHaveCount(0);
  await waitPastPause(page); expect(readFileSync(file, "utf8")).toBe("{damaged json");
  await h.restart(() => writeFileSync(file, original));
  await expect(note(page)).toHaveValue(fixture().text, { timeout: 20_000 }); await expect(page.getByRole("alert")).toHaveCount(0);
  await note(page).fill("Recovered"); await expect.poll(() => h.read(id, "text")).toBe("Recovered");
});

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-layout
test("long text scrolls and copies within the note in editable and read-only views", async ({ page }) => {
  const id = await open(page, { text: longText }); await page.evaluate(() => document.fonts.ready);
  const share = await h.client.resources.share({ artifactID: id, access: "read" });
  for (const mode of ["editable", "read-only", "offline"] as const) {
    await h.open(page, id, mode === "read-only" ? share.shareID : undefined); await expect(note(page)).toHaveValue(longText);
    await page.evaluate(() => document.fonts.ready);
    await h.clipboard(page, `Before copying ${mode}`);
    if (mode === "offline") await disconnect(page);
    const paper = await page.locator(".sticky-note").boundingBox(); const strip = await status(page).boundingBox();
    await note(page).hover(); await page.mouse.wheel(0, 10_000);
    await expect.poll(() => note(page).evaluate(element => {
      const field = element as HTMLTextAreaElement;
      return field.scrollTop >= field.scrollHeight - field.clientHeight - 1;
    })).toBe(true);
    expect(await page.locator(".sticky-note").boundingBox()).toEqual(paper); expect(await status(page).boundingBox()).toEqual(strip);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
    const lastLine = await note(page).evaluate(element => {
      const field = element as HTMLTextAreaElement;
      const style = getComputedStyle(field);
      const bounds = field.getBoundingClientRect();
      // Convert the last line's point through the paper's real rotation.
      const transform = new DOMMatrix(getComputedStyle(field.parentElement!).transform);
      const local = new DOMPoint(parseFloat(style.paddingLeft) + 30 - field.clientWidth / 2,
        field.clientHeight / 2 - parseFloat(style.paddingBottom) - parseFloat(style.lineHeight) / 2);
      const rotated = transform.transformPoint(local);
      return { x: bounds.x + bounds.width / 2 + rotated.x, y: bounds.y + bounds.height / 2 + rotated.y };
    });
    await page.mouse.click(lastLine.x, lastLine.y, { clickCount: 3 });
    expect(await note(page).evaluate(element => {
      const field = element as HTMLTextAreaElement;
      return field.value.slice(field.selectionStart, field.selectionEnd);
    })).toBe("Last line");
    await note(page).press("ControlOrMeta+C"); expect(await h.readClipboard(page)).toBe("Last line");
    if (mode === "read-only") await expect(note(page)).toHaveAttribute("readonly", "");
    if (mode === "offline") await expect(status(page)).toHaveText("Reconnecting…");
  }
  expect(await h.read(id, "text")).toBe(longText); expect(writes()).toEqual([]);
});
