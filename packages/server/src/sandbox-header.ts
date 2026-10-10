import type { Response } from "express";

// The sandbox header (specs/arch/artifact-frame/isolation.md#^iso-sandbox-header).
// The browser runs a document that carries it with an opaque origin wherever
// it loads, so it never includes `allow-same-origin`, which would give an
// artifact the app's origin back, or a top-navigation token.
const SANDBOX_POLICY =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";

/** Sandbox whatever this response turns out to be: every response from the artifact proxy and the active-theme route carries the header. */
export function applySandboxHeader(res: Response): void {
  res.setHeader("Content-Security-Policy", SANDBOX_POLICY);
}
