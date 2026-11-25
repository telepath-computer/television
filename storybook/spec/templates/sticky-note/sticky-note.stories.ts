// Each story is one state of the Sticky note page. Behaviour is specified in
// specs/ui/templates/sticky-note.mdx; the stylesheet is beside this file.

import "../../../../specs/ui/foundation/index.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Args {
  theme: "light" | "dark";
  text: string;
  readOnly: boolean;
  status: string | null;
  unreadable: boolean;
  loading: boolean;
}

const render = ({ theme, text, readOnly, status, unreadable, loading }: Args) => {
  document.documentElement.dataset.theme = theme;
  return html`
  <main class="sticky-note-page">
    <section class="sticky-note">
      ${loading ? "" : unreadable ? html`
      <div class="sticky-note-unreadable" role="alert">
        <span class="sticky-note-unreadable-icon">${icon({ name: "warning", size: "xl" })}</span>
        <h1 class="sticky-note-unreadable-title">This note can't be shown</h1>
        <p class="sticky-note-unreadable-text">Its saved data isn't in the form this page reads. Ask your agent to check it.</p>
      </div>` : html`
      <textarea class="sticky-note-text" aria-label="Note" spellcheck="false"${readOnly ? html` readonly` : html` placeholder="Click here and start typing."`}>${text}</textarea>`}
      <p class="sticky-note-status" role="status">${status ?? ""}</p>
    </section>
  </main>`;
};

type Play = { canvasElement: HTMLElement };
const caretAtEnd = ({ canvasElement }: Play) => {
  const text = canvasElement.querySelector<HTMLTextAreaElement>(".sticky-note-text");
  text?.focus();
  text?.setSelectionRange(text.value.length, text.value.length);
};

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

const viewports = {
  artifact: { name: "Artifact, starting size", styles: { width: "360px", height: "360px" }, type: "desktop" },
};

export default {
  title: "Spec/Templates/Sticky note",
  parameters: {
    layout: "fullscreen",
    viewport: { options: viewports },
    docs: { story: { inline: false, height: "360px" } },
  },
  globals: { viewport: { value: "artifact", isRotated: false } },
  render,
  args: { theme: "light", text: note, readOnly: false, status: null, unreadable: false, loading: false } satisfies Args,
};

export const WithText = { name: "With text" };

export const New = { args: { text: "" } };

export const Empty = { name: "Cleared, focused", args: { text: "" }, play: caretAtEnd };

export const Loading = { args: { loading: true } };

export const LoadingDisconnected = { name: "Loading, disconnected", args: { loading: true, status: "Reconnecting…" } };

// Reached by typing into the note; a pending and a completed save look alike.
export const Typing = { args: { text: "Buy milk\nCall the plumber\nBook Barcelona dinner for Friday" }, play: caretAtEnd };

export const LongText = { name: "Long text", args: { text: longNote } };

export const LongTextScrolled = {
  name: "Long text, scrolled",
  args: { text: longNote },
  play: async ({ canvasElement }: Play) => {
    await document.fonts.load('500 24px "Sticky Note Caveat"');
    const text = canvasElement.querySelector<HTMLTextAreaElement>(".sticky-note-text");
    if (text) text.scrollTop = 180;
  },
};

export const ReadOnly = { name: "Read-only", args: { readOnly: true } };

export const EmptyReadOnly = { name: "Empty, read-only", args: { text: "", readOnly: true } };

export const Disconnected = { args: { status: "Reconnecting…" }, play: caretAtEnd };

export const LongTextDisconnected = {
  name: "Long text, disconnected",
  args: { text: longNote, status: "Reconnecting…" },
  play: async ({ canvasElement }: Play) => {
    await document.fonts.load('500 24px "Sticky Note Caveat"');
    const text = canvasElement.querySelector<HTMLTextAreaElement>(".sticky-note-text");
    if (text) text.scrollTop = text.scrollHeight;
  },
};

// A rejected save has rolled back to the stored text.
export const SaveFailed = { name: "Save failed", args: { status: "Couldn't save that change." } };

export const Unreadable = { args: { unreadable: true } };

export const UnreadableDisconnected = { name: "Unreadable, disconnected", args: { unreadable: true, status: "Reconnecting…" } };

export const Dark = { args: { theme: "dark" } };
