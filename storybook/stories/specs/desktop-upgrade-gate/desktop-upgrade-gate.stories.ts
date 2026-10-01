import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { renderMarkdown } from "../../../../packages/web/src/markdown.ts";
import gateContent from "../../../../specs/ui/app/desktop-upgrade-gate/content.yml";
import { stage } from "./staging.ts";
import { impl } from "./impl.ts";
import template from "../../../../specs/ui/app/desktop-upgrade-gate/template.liquid";
import { CHANNEL_MD, LONG_MD } from "./samples.ts";

const meta: Meta = {
  title: "Specs/Desktop upgrade gate",
  parameters: { frame: false, layout: "fullscreen" },
  // Every state story here branches on the Spec/Impl toggle. Spec renders
  // stage in an isolated child document (foundation and tv-icon only, no
  // impls — see staging.ts), so the impl registered here can never hijack them.
  tags: ["has-impl"],
};

export default meta;

type Ctx = { globals: { specMode?: string } };

export const Fallback: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? impl()
      : stage(template({ body: renderMarkdown(gateContent.fallback_instructions as string) })),
};

export const ChannelInstructions: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? impl({ upgradeMarkdown: CHANNEL_MD })
      : stage(template({ body: renderMarkdown(CHANNEL_MD) })),
};

export const LongInstructions: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? impl({ upgradeMarkdown: LONG_MD })
      : stage(template({ body: renderMarkdown(LONG_MD) })),
};

// The app has downloaded an update: the gate's own message and the restart
// button, whatever the channel provides.
export const DownloadedUpdate: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? impl({ upgradeMarkdown: CHANNEL_MD, restart: "ready" })
      : stage(
          template({ body: renderMarkdown(gateContent.downloaded_update_instructions as string), restart: "ready" }),
        ),
};

export const Restarting: StoryObj = {
  render: (_args, { globals }: Ctx) =>
    globals.specMode === "impl"
      ? impl({ restart: "restarting" })
      : stage(
          template({
            body: renderMarkdown(gateContent.downloaded_update_instructions as string),
            restart: "restarting",
          }),
        ),
};
