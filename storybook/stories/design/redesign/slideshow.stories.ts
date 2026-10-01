import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { slideshow } from "./slideshow.ts";
import { beforeSlide, tensionSlide, screenSlide, groupingSlide, channelsSlide, growSlide } from "./channels.ts";

// Design workshop (not a spec): the whole deck is this one story. Swipe /
// arrow-keys / dots to move. Each slide is arbitrary content — a string, a lit
// template, an isolated wireframe (frameSlide), or a live prototype
// (storyFrame). Add slides by pushing to the array below.

const meta: Meta = {
  title: "Design/Slides/Channels",
  parameters: { frame: false, layout: "fullscreen" },
};

export default meta;

export const Channels: StoryObj = {
  render: () =>
    slideshow([
      // 1) Before — the model up to now (screens as top tabs, artifacts stacked)
      beforeSlide(),
      // 2) Tension — one endless scroll → the groupings you actually reach for
      tensionSlide(),
      // 3) Before & after — this becomes this
      screenSlide(),
      // 4) We need a larger grouping too — simple task vs complex task
      groupingSlide(),
      // 5) Introducing: Channels
      channelsSlide(),
      // 6) Channels have capacity to grow
      growSlide(),
    ]),
};
