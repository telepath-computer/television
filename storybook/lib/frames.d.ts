// A .frame import, compiled by frameset's Vite plugin: render(params) returns
// the frame's markup, and importing delivers its styles to the document.
declare module "*.frame" {
  const frame: {
    render(params?: Record<string, unknown>, options?: { serializableShadowRoots?: boolean }): string;
    readonly params: Record<string, unknown>;
    readonly imports: readonly string[];
    readonly adoptedStyles?: Readonly<Record<string, readonly string[]>>;
  };
  export default frame;
}
