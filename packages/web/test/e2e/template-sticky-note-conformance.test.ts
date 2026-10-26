// Each exported spec story is compared with an independently copied note reached through real services and input.
import type { Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "@playwright/test";
import { artifactURL, client, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";

const run = useConformance();

const note = "Buy milk\nCall the plumber\nBook Barcelona dinner";
const longNote = [
  "Before the trip",
  "",
  "Book the airport transfer and confirm the pickup time the night before.",
  "Passports and tickets",
  "Ask the neighbours to water the tomatoes and take in any parcels.",
  "",
  "Booking reference:",
  "BARCELONA012345678901234567890123456789",
  "",
  "Leave a spare key with Sam.",
  "Turn off the lights.",
].join("\n");

/** Stored values and real actions that reach one story's rendered state. */
interface State {
  data?: JSONValue;
  share?: "read" | "read-write";
  dark?: boolean;
  loading?: boolean;
  ready?: (page: Page, id: string) => Promise<void>;
}

async function fontLoaded(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fonts = await document.fonts.load('500 24px "Sticky Note Caveat"');
    if (fonts.length === 0) throw new Error("The bundled Caveat font did not load");
    await document.fonts.ready;
  });
}

async function disconnect(page: Page): Promise<void> {
  run.proxy.refuse(true);
  run.proxy.sever();
  await page.getByRole("status").filter({ hasText: "Reconnecting…" }).waitFor();
}

async function caretAtEnd(page: Page): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note", exact: true });
  await field.click();
  await field.press("ControlOrMeta+End");
  await page.locator(".sticky-note-text:focus").waitFor();
}

async function scrollText(page: Page, position: number | "bottom"): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note", exact: true });
  await fontLoaded(page);
  await field.hover();
  await page.mouse.wheel(0, position === "bottom" ? 10_000 : position);
  await expect.poll(() => field.evaluate((element, requested) => {
    const text = element as HTMLTextAreaElement;
    return requested === "bottom" ? text.scrollTop === text.scrollHeight - text.clientHeight : text.scrollTop === requested;
  }, position)).toBe(true);
}

const states: Record<string, State> = {
  "new": {},
  "with-text": { data: { text: note } },
  "empty": {
    data: { text: note },
    ready: async page => {
      await caretAtEnd(page);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await expect.poll(() => page.getByRole("textbox", { name: "Note", exact: true }).inputValue()).toBe("");
    },
  },
  "loading": { loading: true },
  "loading-disconnected": { loading: true, ready: disconnect },
  "typing": {
    data: { text: note },
    ready: async page => {
      await caretAtEnd(page);
      await page.keyboard.type(" for Friday");
    },
  },
  "long-text": { data: { text: longNote } },
  "long-text-scrolled": { data: { text: longNote }, ready: page => scrollText(page, 180) },
  "read-only": { data: { text: note }, share: "read" },
  "empty-read-only": { share: "read" },
  "disconnected": {
    data: { text: note },
    ready: async page => { await caretAtEnd(page); await disconnect(page); },
  },
  "long-text-disconnected": {
    data: { text: longNote },
    ready: async page => { await disconnect(page); await scrollText(page, "bottom"); },
  },
  "save-failed": {
    data: { text: note },
    share: "read-write",
    ready: async (page, id) => {
      const connection = run.proxy.messages.find(({ message }) => message.type === "subscribe")!.connection;
      // Keep the page unaware of the downgrade until the server rejects its real save.
      run.proxy.holdWrites();
      run.proxy.holdServerMessages(connection, message => message.type === "access");
      await caretAtEnd(page);
      await page.keyboard.type(" refused");
      await run.proxy.waitFor(() => run.proxy.heldWriteCount === 1);
      await client.resources.share({ artifactID: id, access: "read" });
      await run.proxy.waitFor(() => run.proxy.heldServerMessageCount(connection) > 0);
      run.proxy.releaseWrites();
      await page.getByRole("status").filter({ hasText: "Couldn't save that change." }).waitFor();
      await expect.poll(() => page.getByRole("textbox", { name: "Note", exact: true }).inputValue()).toBe(note);
      await page.mouse.click(1, 1);
    },
  },
  "unreadable": { data: { text: null } },
  "unreadable-disconnected": { data: { text: null }, ready: disconnect },
  "dark": { data: { text: note }, dark: true },
};

const stories = specStories("./spec/templates/sticky-note/sticky-note.stories.ts");
if (stories.length === 0) throw new Error("The worktree Storybook build contains no Sticky note stories");

// proofs/ui/templates/sticky-note.md#^sticky-note-ui-ac-conformance
for (const storyID of stories) {
  test(`Sticky note conforms: ${storyID}`, async () => {
    const state = states[storyID.replace("spec-templates-sticky-note--", "")];
    expect(state, `No production state for the Sticky note story ${storyID}`).toBeDefined();
    const { data, share, dark, loading, ready } = state!;
    const artifactID = await createArtifact("sticky-note", data);
    const shareID = share && (await client.resources.share({ artifactID, access: share })).shareID;
    if (loading) run.proxy.hold("to-browser");

    const reference = storybook.page(storyID);
    if (typeof reference === "string") throw new Error("Storybook must supply its completed-play readiness hook");
    await conform({
      ...reference,
      ready: async page => { await reference.ready?.(page); await fontLoaded(page); },
    }, {
      url: artifactURL(run.proxy, shareID ?? artifactID),
      setup: page => page.emulateMedia({ colorScheme: dark ? "dark" : "light" }),
      ready: async page => {
        if (loading) await run.proxy.waitFor(() => run.proxy.openWebSockets > 0);
        else await page.locator(".sticky-note-text, .sticky-note-unreadable").waitFor();
        await fontLoaded(page);
        await ready?.(page, artifactID);
        await page.mouse.move(0, 0);
      },
    }, { browser: run.browser, root: ".sticky-note-page", width: 360, height: 360 });
  });
}
