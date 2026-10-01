// What `frames/ui.html` imports: the production foundation and global sheets,
// plus the one custom element used by the staged spec templates. These execute
// in the frame's document, keeping surface implementations out of its registry.
//
// A frame cannot import this itself. `frames/` is served verbatim, so a bare
// specifier written there is never resolved, and a `.ts` placed there comes
// back untransformed under a `video/mp2t` content type. Modules in this folder
// exist to be loaded by a frame from a stable URL — `/lib/imports/ui.ts` —
// which Vite serves transformed. The `/@fs/…` paths it compiles to are
// machine-specific and must never be committed.

import "../../../packages/web/src/foundation/index.css";
import "../../../packages/web/src/global.css";
import "../../../packages/web/src/elements/icon.ts";
