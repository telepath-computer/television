import { describe, expect, test } from "vitest";

import { liquidTemplates } from "../../config/liquid/plugin.ts";

// The plugin is the loader half of the vocabulary: it turns a .liquid file
// into a render function and a .yml file into data. What it must not do is
// claim a request that asked for something else.
const plugin = liquidTemplates();
const transform = (code: string, id: string) =>
  (plugin.transform as (this: unknown, code: string, id: string) => { code: string } | null).call(
    null,
    code,
    id,
  );

describe("yaml loading", () => {
  test("loads a .yml as data, wherever it sits", () => {
    // Not under specs/: a manifest or fixture is no less a YAML file for
    // living somewhere else, and the loader is what makes YAML importable
    // at all.
    const out = transform("greeting: hello\n", "/anywhere/data.yml");
    expect(out?.code).toBe('export default {"greeting":"hello"};');
  });

  test("steps aside when the request asked for the file's text", () => {
    // `?raw` is vite's way of saying "the bytes, uninterpreted". A loader that
    // parsed anyway would override an explicit instruction — which is exactly
    // what {% import './x.yml' as x, raw %} asks for.
    expect(transform("greeting: hello\n", "/specs/ui/x/data.yml?raw")).toBeNull();
  });

  test("steps aside for the other queries that ask for a different form", () => {
    expect(transform("greeting: hello\n", "/specs/ui/x/data.yml?url")).toBeNull();
    expect(transform("greeting: hello\n", "/specs/ui/x/data.yml?inline")).toBeNull();
  });

  test("still loads a .yml carrying vite's own dev-server queries", () => {
    // ?t= and ?v= are cache-busting, not a request for another form.
    const out = transform("greeting: hello\n", "/specs/ui/x/data.yml?t=1730000000");
    expect(out?.code).toBe('export default {"greeting":"hello"};');
  });

  test("leaves files it has no business with alone", () => {
    expect(transform("body { color: red }", "/specs/ui/x/styles.css")).toBeNull();
  });
});
