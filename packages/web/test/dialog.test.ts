// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit-html";
import { dialogTemplate } from "../src/views/dialog.ts";

afterEach(() => document.body.replaceChildren());

describe("dialogTemplate (^dg-ac-markup-smoke)", () => {
  it.each([
    {
      name: "plain panel",
      content: html`<p data-supplied="plain">Plain contents</p>`,
      supplied: "plain",
    },
    {
      name: "alert panel",
      content: html`
        <section class="dialog-alert" data-supplied="alert" role="alertdialog">
          <h2>Delete artifact?</h2>
          <p>The file remains on disk.</p>
          <div class="dialog-actions">
            <button type="button" autofocus>Cancel</button>
            <button type="button" intent="danger">Delete</button>
          </div>
        </section>
      `,
      supplied: "alert",
    },
  ])("renders the $name once", ({ content, supplied }) => {
    const host = document.createElement("main");
    document.body.append(host);

    render(dialogTemplate(content), host);

    const dialogs = host.querySelectorAll("dialog[open]");
    const overlays = host.querySelectorAll(".dialog-overlay");
    const suppliedContents = host.querySelectorAll(`[data-supplied="${supplied}"]`);

    expect(dialogs).toHaveLength(1);
    expect(overlays).toHaveLength(1);
    expect(suppliedContents).toHaveLength(1);
    expect(overlays[0]?.children).toHaveLength(1);
    expect(overlays[0]?.firstElementChild).toBe(dialogs[0]);
  });
});
