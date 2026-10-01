import React from "react";
import { addons, types, useGlobals, useStorybookApi } from "storybook/manager-api";
import { IconButton } from "storybook/internal/components";
addons.setConfig({
  panelPosition: "right",
  showPanel: false,
  // The addons panel exists only where a story declares it: stories tagged
  // "panel" (e.g. a background control) defer to normal panel behavior;
  // everything else has it forced closed. The plain showPanel default above
  // is only an initial value and does not survive layout state, hence the
  // customisation hook.
  layoutCustomisations: {
    showPanel(state, defaultValue) {
      const entry = state.storyId ? state.index?.[state.storyId] : undefined;
      const wantsPanel = entry && "tags" in entry && entry.tags?.includes("panel");
      return wantsPanel ? defaultValue : false;
    },
  },
  sidebar: {
    // Stories tagged "demo" (interactive stagings) get a colored label so
    // they stand out from the per-state spec renders.
    renderLabel: (item) =>
      item.type === "story" && "tags" in item && item.tags?.includes("demo")
        ? React.createElement(
            "span",
            {
              style: {
                display: "inline-block",
                padding: "0 4px",
                borderRadius: "3px",
                background: "color-mix(in srgb, currentColor 15%, transparent)",
              },
            },
            item.name,
          )
        : item.name,
  },
});

// Spec/Impl toggle — a toolbar tool shown only on stories that have an
// implementation counterpart (tagged "has-impl"). Flips the specMode global
// the stories branch on.
const SpecModeTool = () => {
  const [globals, updateGlobals] = useGlobals();
  const api = useStorybookApi();
  const story = api.getCurrentStoryData();
  const tags: string[] = story && "tags" in story && Array.isArray(story.tags) ? story.tags : [];
  if (!tags.includes("has-impl")) return null;
  const mode = globals.specMode === "impl" ? "impl" : "spec";
  return React.createElement(
    IconButton,
    {
      key: "tv-spec-mode",
      active: mode === "impl",
      title: mode === "impl" ? "Showing the implementation — click for the spec" : "Showing the spec — click for the implementation",
      onClick: () => updateGlobals({ specMode: mode === "impl" ? "spec" : "impl" }),
    },
    mode === "impl" ? "Impl" : "Spec",
  );
};

addons.register("tv/spec-mode", () => {
  addons.add("tv/spec-mode/tool", {
    type: types.TOOL,
    title: "Spec/Impl",
    match: ({ viewMode }) => viewMode === "story",
    render: SpecModeTool,
  });
});

// Nav orientation toggle — shown only on stories tagged "orient" (the
// grouped-nav design mock). Flips the `orient` global (top | left).
const OrientTool = () => {
  const [globals, updateGlobals] = useGlobals();
  const api = useStorybookApi();
  const story = api.getCurrentStoryData();
  const tags: string[] = story && "tags" in story && Array.isArray(story.tags) ? story.tags : [];
  if (!tags.includes("orient")) return null;
  const orient = globals.orient === "top" ? "top" : "left";
  return React.createElement(
    IconButton,
    {
      key: "tv-orient",
      title: `Nav on the ${orient} — click to move it ${orient === "top" ? "left" : "top"}`,
      onClick: () => updateGlobals({ orient: orient === "top" ? "left" : "top" }),
    },
    orient === "top" ? "Nav: top" : "Nav: left",
  );
};

addons.register("tv/orient", () => {
  addons.add("tv/orient/tool", {
    type: types.TOOL,
    title: "Nav orientation",
    match: ({ viewMode }) => viewMode === "story",
    render: OrientTool,
  });
});
