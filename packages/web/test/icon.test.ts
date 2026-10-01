// @vitest-environment jsdom
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import "../src/elements/icon.ts";

const manifestPath = path.resolve(
  import.meta.dirname,
  "../../../specs/ui/foundation/icons/icons.yml",
);
const require = createRequire(import.meta.url);

// A manifest source is a package specifier, or a path relative to the
// manifest itself for a drawing of our own.
const resolveSource = (source: string) =>
  source.startsWith(".")
    ? path.resolve(path.dirname(manifestPath), source)
    : require.resolve(source);

afterEach(() => document.body.replaceChildren());

async function readManifest(): Promise<Map<string, string>> {
  const source = await readFile(manifestPath, "utf8");
  return new Map(
    source
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const match = /^(?<name>[^:]+):\s+"(?<source>[^"]+)"$/.exec(line);
        if (!match?.groups) throw new Error(`Unexpected icon manifest row: ${line}`);
        return [match.groups.name, match.groups.source];
      }),
  );
}

describe("tv-icon", () => {
  it("renders every manifest name's exact installed SVG into its shadow root", async () => {
    const manifest = await readManifest();
    expect(manifest.size).toBeGreaterThan(0);
    let sharedSheet: CSSStyleSheet | undefined;

    for (const [name, sourcePath] of manifest) {
      const installedSource = await readFile(resolveSource(sourcePath), "utf8");
      const expected = document.createElement("template");
      expected.innerHTML = installedSource;

      const element = document.createElement("tv-icon");
      element.setAttribute("name", name);
      document.body.append(element);

      const root = element.shadowRoot;
      expect(root?.mode, name).toBe("open");
      expect(element.childNodes, name).toHaveLength(0);
      expect(root?.innerHTML, name).toBe(expected.innerHTML);
      expect(root?.adoptedStyleSheets, name).toHaveLength(1);
      sharedSheet ??= root?.adoptedStyleSheets[0];
      expect(root?.adoptedStyleSheets[0], name).toBe(sharedSheet);
      element.remove();
    }
  });

  it("preserves an existing open root when the element upgrades its contents", () => {
    const element = document.createElement("tv-icon");
    const root = element.attachShadow({ mode: "open" });
    root.innerHTML = "<style>:host { visibility: hidden; }</style><span>stale</span>";
    element.setAttribute("name", "check");

    document.body.append(element);

    expect(element.shadowRoot).toBe(root);
    expect(element.childNodes).toHaveLength(0);
    expect(root.querySelector("style")).toBeNull();
    expect(root.querySelector("svg")).not.toBeNull();
    expect(root.adoptedStyleSheets).toHaveLength(1);
  });
});
