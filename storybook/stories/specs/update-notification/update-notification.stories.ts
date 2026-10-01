import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { renderMarkdown } from "../../../../packages/web/src/markdown.ts";
import { demo, stage, stageElement } from "./staging.ts";
import { impl } from "./impl.ts";
import template from "../../../../specs/ui/app/update-notification/template.liquid";
import content from "../../../../specs/ui/app/update-notification/content.yml";
import { DOWNLOADED_VERSION, LONG_MD, NO_PROMPT_MD, SAMPLE_MD, SAMPLE_PROMPT } from "./samples.ts";

const meta: Meta = {
  title: "Specs/Update notification",
  parameters: { frame: false, layout: "fullscreen" },
  // Every state story here branches on the Spec/Impl toggle. Spec renders
  // stage in an isolated child document (foundation and tv-icon only, no
  // impls — see staging.ts), so the impl registered here can never hijack them.
  tags: ["has-impl"],
};

export default meta;

type Ctx = { globals: { specMode?: string } };

// Interactive staging of the spec template on the spec side; the real
// shipped toast, also interactive, on the impl side.
export const Demo: StoryObj = {
  tags: ["demo"],
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ markdown: SAMPLE_MD, prompt: SAMPLE_PROMPT }))
      : demo({ body: renderMarkdown(SAMPLE_MD), promptText: SAMPLE_PROMPT }),
};

export const BellOnly: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ markdown: SAMPLE_MD, prompt: SAMPLE_PROMPT, dismissed: true }))
      : stage(template({ open: false })),
};

export const Presented: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ markdown: SAMPLE_MD, prompt: SAMPLE_PROMPT }))
      : stage(template({ open: true, body: renderMarkdown(SAMPLE_MD), prompt: true })),
};

export const NoPrompt: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ markdown: NO_PROMPT_MD }))
      : stage(template({ open: true, body: renderMarkdown(NO_PROMPT_MD) })),
};

export const Copied: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ markdown: SAMPLE_MD, prompt: SAMPLE_PROMPT, copied: true }))
      : stage(template({ open: true, body: renderMarkdown(SAMPLE_MD), prompt: true, copied: true })),
};

export const LongNotice: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ markdown: LONG_MD, prompt: SAMPLE_PROMPT }))
      : stage(template({ open: true, body: renderMarkdown(LONG_MD), prompt: true })),
};

// The desktop self-update notice: the authored body with the downloaded version in
// place, and the restart button instead of a copy button.
const DESKTOP_UPDATE_BODY = renderMarkdown(
  (content.desktop_self_update_notice as string).replace("{version}", DOWNLOADED_VERSION),
);

export const DesktopSelfUpdateNotice: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ desktopUpdate: "ready" }))
      : stage(template({ open: true, body: DESKTOP_UPDATE_BODY, restart: "ready" })),
};

export const DesktopSelfUpdateNoticeRestarting: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? stageElement(impl({ desktopUpdate: "restarting" }))
      : stage(template({ open: true, body: DESKTOP_UPDATE_BODY, restart: "restarting" })),
};
