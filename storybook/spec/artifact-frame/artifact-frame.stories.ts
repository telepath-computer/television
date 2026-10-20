import "../../../specs/ui/foundation/index.css";
import "../../../specs/ui/foundation/tokens/app.css";
import "../../../specs/ui/app/artifact-frame/artifact-frame.frame";
import "./styles.css";
import "./staging.css";
import { html, Html } from "../../lib/html.ts";
import iconFrame from "../../../specs/ui/foundation/icons/icon.frame";
import clock from "./clock.html?raw";

const icon = (name: string): Html =>
  new Html(iconFrame.render({ name }, { serializableShadowRoots: true }));

interface Args {
  src: string;
  title: string;
  transparent: boolean;
  hovered: boolean;
}

// Markup copied from specs/ui/app/artifact-frame/artifact-frame.frame,
// with no navigation history and the artifact menu closed. Importing that
// frame above supplies its styles; styles.css adds only the transparent state.
const artifactFrame = ({ src, title, transparent, hovered }: Args) => html`
  <div class="artifact-frame${transparent ? " artifact-frame-transparent" : ""}"${hovered ? html` data-hovered` : ""}>
    <div class="artifact-frame-clip">
      <iframe src="${src}" title="${title}"></iframe>
      <footer class="artifact-title-bar">
        ${icon("artifact")}
        <span class="artifact-title">${title}</span>
        <button class="artifact-menu-trigger" icon variant="ghost" size="sm" aria-label="${title} menu">${icon("expand")}</button>
        <tv-menu>
          <tv-menu-item>Make full-screen</tv-menu-item>
          <hr>
          <tv-menu-item intent="danger">Delete</tv-menu-item>
        </tv-menu>
      </footer>
    </div>
  </div>`;

export default {
  title: "Spec/Artifact frame",
  render: (args: Args) => artifactFrame(args),
  decorators: [
    // Staging stays outside the component markup used for conformance.
    (story: () => Html) => html`
      <div class="artifact-frame-preview">
        <div class="artifact-frame-preview-size">
          ${story()}
        </div>
      </div>`,
  ],
  parameters: { layout: "fullscreen" },
  args: {
    src: `data:text/html;charset=utf-8,${encodeURIComponent(clock)}`,
    title: "Clock",
    transparent: false,
    hovered: false,
  } satisfies Args,
};

export const Opaque = {};

export const TransparentAtRest = { args: { transparent: true } };

export const TransparentHovered = { args: { transparent: true, hovered: true } };
