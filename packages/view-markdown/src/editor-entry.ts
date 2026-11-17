import "./editor.css";
import "./colors.css";
import { mountMarkdownEditor } from "./editor.ts";

Object.assign(window, {
  TelevisionMarkdownEditor: { mount: mountMarkdownEditor },
});
