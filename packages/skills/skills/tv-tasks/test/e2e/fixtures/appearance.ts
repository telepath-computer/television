// Real production styles in artifact load order. The test enables task CSS
// after observing the canonical/theme baseline to detect palette clobbering.
import canonicalCSS from "../../../../../../canonical/styles/canonical/v2/index.css?inline";
import nordCSS from "../../../../../../server/assets/themes/nord/theme.css?inline";
import { installAppearanceResolver } from "../../../../../../artifact/src/browser/appearance-resolver.ts";
import "./fixture.ts";
import taskCSS from "../../../src/task.css?inline";

const overrideCSS = `
  :root {
    --color-surface: var(--purple-50);
    --color-surface-muted: var(--purple-100);
    --color-text: var(--purple-950);
    --color-text-muted: var(--cyan-800);
    --color-primary: var(--yellow-200);
    --color-primary-text: var(--neutral-950);
    --color-alert: var(--orange-600);
    --color-danger: var(--red-700);
    --color-border: var(--purple-300);
  }
  [data-theme="dark"] {
    --color-surface: var(--purple-950);
    --color-surface-muted: var(--purple-900);
    --color-text: var(--purple-50);
    --color-text-muted: var(--cyan-300);
    --color-primary: var(--blue-800);
    --color-primary-text: var(--neutral-50);
    --color-alert: var(--orange-300);
    --color-danger: var(--red-300);
    --color-border: var(--purple-700);
  }
`;

installAppearanceResolver("system");
const theme = new URLSearchParams(location.search).get("theme");
for (const [id, css] of [
  ["canonical", canonicalCSS],
  ["theme", theme === "nord" ? nordCSS : theme === "overrides" ? overrideCSS : ""],
  ["tasks", taskCSS],
]) {
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  if (id === "tasks") style.media = "not all";
  document.head.append(style);
}

const now = new Date();
const pad = (value: number) => String(value).padStart(2, "0");
document.querySelector("#today tv-task-meta-due")!.setAttribute(
  "date", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
);
document.body.dataset.ready = "true";
