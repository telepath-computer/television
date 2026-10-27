// Real production styles in artifact load order: the canonical foundation,
// whose header idiom and prose region style the page header, then task CSS.
import canonicalCSS from "../../../../../../canonical/styles/canonical/v2/index.css?inline";
import "./fixture.ts";
import taskCSS from "../../../src/task.css?inline";

for (const css of [canonicalCSS, taskCSS]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
}

const HEADERS: Record<string, string> = {
  title: "<h1>Chores</h1>",
  subtitle: "<h1>Chores</h1><p>Wednesday, July 8</p>",
  "hidden-message": '<h1>Chores</h1><p>Wednesday, July 8</p><p class="tv-error" hidden></p>',
  message: '<h1>Chores</h1><p>Wednesday, July 8</p><p class="tv-error">Disconnected from the server.</p>',
};
const id = new URLSearchParams(location.search).get("case") ?? "";
const header = HEADERS[id.replace(/^prose-/, "")];
if (header === undefined) throw new Error(`No header case named ${id}.`);
if (id.startsWith("prose-")) document.body.setAttribute("text-display", "prose");
document.body.insertAdjacentHTML(
  "beforeend",
  `<header>${header}</header><tv-task-list><tv-task-section><header><h2>Today</h2></header></tv-task-section></tv-task-list>`,
);
document.body.dataset.ready = "true";
