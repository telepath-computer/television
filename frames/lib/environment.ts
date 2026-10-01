// Each frame owns its appearance and theme through its URL and parameter defaults.
// Embedded specimens can inherit their containing board when they declare neither.
const themeStyles = import.meta.glob<string>("/specs/ui/themes/*/styles.css", {
  query: "?inline",
  import: "default",
  eager: true,
});

const THEME_STYLE_ATTRIBUTE = "data-foundation-frame-theme";

type EnvironmentParams = Record<string, { default?: unknown }>;

// Only a frameset-frame embed inherits a board. Viewer sibling frames do not.
const containingBoard = (): Document | undefined => {
  try {
    const frame = window.frameElement;
    const host = (frame?.getRootNode() as ShadowRoot | undefined)?.host;
    return host?.localName === "frameset-frame" ? frame?.ownerDocument : undefined;
  } catch {
    return undefined;
  }
};

// Injected CSS resolves URLs against the document; production themes resolve
// them against the stylesheet. Preserve that base for wallpaper assets here.
const rebaseThemeUrls = (css: string, themeDir: string): string =>
  css.replace(
    /url\(\s*(['"]?)(?!data:|https?:|\/)([^'")]+)\1\s*\)/g,
    (_, quote, path) => `url(${quote}${themeDir}/${path}${quote})`,
  );

const previewTheme = (): string | undefined =>
  document.body.querySelector<HTMLElement>("[data-staging-theme]")?.dataset.stagingTheme;

/** Follow workshop appearance/theme controls without imposing app-only styles. */
export const documentEnvironment = (kind: "app" | "artifact"): void => {
  const root = document.documentElement;
  // A global import and an HMR-timestamped module may evaluate separately.
  // One owner per document keeps their listeners and styles together.
  if (root.hasAttribute("data-staging-environment")) return;
  root.setAttribute("data-staging-environment", "");
  root.setAttribute("data-television-document", kind);
  if (kind === "app") root.style.background = containingBoard() ? "transparent" : "#f5f5f5";

  const style = document.createElement("style");
  style.setAttribute(THEME_STYLE_ATTRIBUTE, "");
  document.head.append(style);

  let defaults: EnvironmentParams = {};
  const frameValue = (name: string): string | undefined => {
    const query = new URLSearchParams(location.search).get(name);
    if (query !== null) return query;
    const value = defaults[name]?.default;
    return typeof value === "string" ? value : undefined;
  };

  const apply = () => {
    const parent = containingBoard()?.documentElement;
    const appearance = frameValue("appearance") ?? parent?.dataset.theme ?? "light";
    const selectedTheme = frameValue("theme") ?? parent?.dataset.stagingSelectedTheme ?? "none";
    const fixedTheme = previewTheme();
    const theme = fixedTheme ?? selectedTheme;
    root.dataset.stagingSelectedTheme = theme;
    if (fixedTheme) root.dataset.stagingTheme = fixedTheme;
    else delete root.dataset.stagingTheme;
    root.setAttribute("data-theme", appearance === "dark" ? "dark" : "light");
    const path = theme == null || theme === "none" ? null : `/specs/ui/themes/${theme}/styles.css`;
    style.textContent = path === null
      ? ""
      : rebaseThemeUrls(themeStyles[path] ?? "", `/specs/ui/themes/${theme}`);
    document.dispatchEvent(new Event("television-theme-styles-changed"));
  };

  apply();
  window.addEventListener("frameset:rendered", apply);
  const parent = containingBoard();
  parent?.addEventListener("television-theme-styles-changed", apply);
  window.addEventListener("pagehide", () => {
    parent?.removeEventListener("television-theme-styles-changed", apply);
  });
  window.addEventListener("pageshow", () => {
    parent?.addEventListener("television-theme-styles-changed", apply);
    apply();
  });

  // Frameset exports the authored parameter declarations on the frame module.
  // Import asynchronously so environment setup cannot block frame rendering.
  const moduleUrl = document.querySelector<HTMLMetaElement>(
    'meta[name="frameset-frame-module"]',
  )?.content;
  if (moduleUrl) {
    void import(/* @vite-ignore */ moduleUrl).then((module) => {
      defaults = module.default.params;
      apply();
    }).catch((error: unknown) => {
      console.error("Could not read frame appearance defaults", error);
    });
  }
};
