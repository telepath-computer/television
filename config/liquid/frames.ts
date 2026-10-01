import type { ParamDecl } from "./doc.ts";

export interface LiquidRendering {
  markup: string;
  styles: string[];
}

export type CompiledTemplate = ((data?: Record<string, unknown>) => LiquidRendering) & {
  params: ParamDecl[];
};

// A template's dependencies, resolved ahead of time (by the vite transform,
// or by hand) and keyed by the reference exactly as written in the template.
// The runtime never touches a filesystem: './x' means whatever was handed in
// under './x'.
export interface TemplateDeps {
  /** Repo-relative path, for error messages and argument registration. */
  name?: string;
  /** {% render 'ref' %} → the composed template's compiled function. */
  partials?: Record<string, CompiledTemplate>;
  /** {% import 'ref' as name %} → whatever the file resolves to. */
  imports?: Record<string, unknown>;
  /** {% import 'ref' as name, raw %} → the file's text. */
  raw?: Record<string, string>;
  /** {% attach_styles 'ref' %} → the stylesheet text. */
  styles?: Record<string, string>;
  /** {% import_map 'ref' as name %} → the manifest's names, each bound to what its file resolved to. */
  maps?: Record<string, Record<string, unknown>>;
}

interface Frame {
  deps: TemplateDeps;
  styles: string[];
}

// Rendering is synchronous, so a stack of frames handles nesting: each
// template render pushes its own frame; tags read the innermost one.
const frames: Frame[] = [];

export function pushFrame(deps: TemplateDeps): void {
  frames.push({ deps, styles: [] });
}

export function popFrame(): string[] {
  const frame = frames.pop();
  return frame ? [...new Set(frame.styles)] : [];
}

export function currentFrame(): Frame {
  const frame = frames.at(-1);
  if (!frame) throw new Error("liquid tag rendered outside a compiled template");
  return frame;
}
