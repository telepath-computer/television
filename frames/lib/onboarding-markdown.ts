// The read-only artifact proxy uses marked with these options and this exact
// document stylesheet. Keep the preview on that pipeline, not a second renderer.
import { marked } from "marked";
import { MARKDOWN_DOC_CSS } from "../../packages/server/src/markdown-doc-style.ts";
import source from "../../specs/ui/onboarding-artifacts/research/draft-blog-post.md?raw";

const style = document.createElement("style");
style.setAttribute("data-onboarding-markdown", "");
style.textContent = MARKDOWN_DOC_CSS;
document.head.append(style);

export default marked.parse(source, { async: false });
