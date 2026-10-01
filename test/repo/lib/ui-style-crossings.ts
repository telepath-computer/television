export interface AggregateStyleCopy {
  readonly specSource: string;
  readonly productionAsset: string;
}

export interface AggregateStyleCrossing {
  readonly kind: "aggregate";
  /** The authoritative aggregate: its imports fix the production aggregate's order. */
  readonly specSource: string;
  readonly productionModule: string;
  readonly stylesheet: string;
  readonly copies: readonly AggregateStyleCopy[];
}

export interface SiblingStyleCrossing {
  readonly kind: "sibling";
  readonly specSources: readonly string[];
  readonly productionModule: string;
  readonly stylesheet: string;
  readonly documentDelivery: boolean;
  readonly shadowRootSheet?: string;
}

export interface EmbeddedStyleCrossing {
  readonly kind: "embedded";
  readonly specSource: string;
  readonly document: string;
}

export interface LinkedDocumentStyleCrossing {
  readonly kind: "linked-document";
  readonly document: string;
  readonly href: string;
}

export interface BundledThemeStyleCrossing {
  readonly kind: "bundled-theme";
  readonly specSource: string;
  readonly packageStylesheet: string;
  readonly assets: readonly AggregateStyleCopy[];
}

export type ImplementationOwnedStyleCrossing = {
  readonly kind: "implementation-owned";
  readonly productionModule: string;
} & (
  | { readonly stylesheet: string; readonly adoptedSheet?: never; readonly linkElement?: never }
  | { readonly adoptedSheet: string; readonly stylesheet?: never; readonly linkElement?: never }
  | { readonly linkElement: string; readonly stylesheet?: never; readonly adoptedSheet?: never }
);

export type UIStyleCrossing =
  | AggregateStyleCrossing
  | SiblingStyleCrossing
  | EmbeddedStyleCrossing
  | LinkedDocumentStyleCrossing
  | BundledThemeStyleCrossing
  | ImplementationOwnedStyleCrossing;

export const UI_STYLE_CROSSINGS: readonly UIStyleCrossing[] = [
  {
    kind: "sibling",
    specSources: ["specs/ui/setup/setup.frame"],
    productionModule: "packages/desktop/src/setup.ts",
    stylesheet: "packages/desktop/src/setup.css",
    documentDelivery: true,
  },
  { kind: "implementation-owned", productionModule: "packages/desktop/src/connect-page.ts", stylesheet: "packages/web/src/foundation/index.css" },
  { kind: "implementation-owned", productionModule: "packages/desktop/src/connect-page.ts", stylesheet: "packages/web/src/foundation/app.css" },
  { kind: "implementation-owned", productionModule: "packages/desktop/src/connect-page.ts", stylesheet: "packages/web/src/global.css" },
  { kind: "implementation-owned", productionModule: "packages/desktop/src/connect-page.ts", stylesheet: "packages/desktop/src/connect-page.css" },
  { kind: "implementation-owned", productionModule: "packages/desktop/src/setup.ts", stylesheet: "packages/web/src/views/artifact-view.css" },
  { kind: "linked-document", document: "packages/desktop/src/connect.html", href: "connect-page.css" },
  { kind: "linked-document", document: "packages/desktop/src/connect.html", href: "clouds/theme.css" },
  {
    kind: "aggregate",
    specSource: "specs/ui/foundation/index.css",
    productionModule: "packages/web/src/main.ts",
    stylesheet: "packages/web/src/foundation/index.css",
    copies: [
      {
        specSource: "specs/ui/foundation/reset.css",
        productionAsset: "packages/web/src/foundation/reset.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/fonts.css",
        productionAsset: "packages/web/src/foundation/tokens/fonts.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/colors.css",
        productionAsset: "packages/web/src/foundation/colors.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/text.css",
        productionAsset: "packages/web/src/foundation/text.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/spacing.css",
        productionAsset: "packages/web/src/foundation/spacing.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/shadows.css",
        productionAsset: "packages/web/src/foundation/shadows.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/layers.css",
        productionAsset: "packages/web/src/foundation/layers.css",
      },
      {
        specSource: "specs/ui/foundation/tokens/app.css",
        productionAsset: "packages/web/src/foundation/app.css",
      },
      {
        specSource: "specs/ui/foundation/input/styles.css",
        productionAsset: "packages/web/src/foundation/input.css",
      },
      {
        specSource: "specs/ui/foundation/popover/styles.css",
        productionAsset: "packages/web/src/foundation/popover.css",
      },
      {
        specSource: "specs/ui/foundation/menu/styles.css",
        productionAsset: "packages/web/src/foundation/menu.css",
      },
      {
        specSource: "specs/ui/foundation/select/styles.css",
        productionAsset: "packages/web/src/foundation/select.css",
      },
      {
        specSource: "specs/ui/foundation/checkbox-list/styles.css",
        productionAsset: "packages/web/src/foundation/checkbox-list.css",
      },
      {
        specSource: "specs/ui/foundation/fonts/Hind-Variable.woff2",
        productionAsset: "packages/web/src/foundation/fonts/Hind-Variable.woff2",
      },
      {
        specSource: "specs/ui/foundation/prose.css",
        productionAsset: "packages/web/src/foundation/prose.css",
      },
      {
        specSource: "specs/ui/foundation/button/button.css",
        productionAsset: "packages/web/src/foundation/button.css",
      },
    ],
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/styles.css", "specs/ui/app/app.frame"],
    productionModule: "packages/web/src/views/television-app.ts",
    stylesheet: "packages/web/src/views/television-app.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/artifact-frame/artifact-frame.frame"],
    productionModule: "packages/web/src/views/artifact-view.ts",
    stylesheet: "packages/web/src/views/artifact-view.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/copy-button/copy-button.frame"],
    productionModule: "packages/web/src/views/copy-button.ts",
    stylesheet: "packages/web/src/views/copy-button.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/desktop-upgrade-gate/desktop-upgrade-gate.frame"],
    productionModule: "packages/web/src/views/desktop-upgrade-gate.ts",
    stylesheet: "packages/web/src/views/desktop-upgrade-gate.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: [
      "specs/ui/app/sidebar/sidebar.frame",
      "specs/ui/app/sidebar/channel-list.frame",
      "specs/ui/app/sidebar/channel.frame",
      "specs/ui/app/sidebar/channel-placeholder.frame",
    ],
    productionModule: "packages/web/src/views/channel-sidebar.ts",
    stylesheet: "packages/web/src/views/channel-sidebar.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: [
      "specs/ui/app/sidebar/sidebar.frame",
      "specs/ui/app/sidebar/channel-list.frame",
      "specs/ui/app/sidebar/channel.frame",
      "specs/ui/app/sidebar/channel-placeholder.frame",
    ],
    productionModule: "packages/web/src/views/channel-list.ts",
    stylesheet: "packages/web/src/views/channel-sidebar.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/skill-selector/skill-selector.frame"],
    productionModule: "packages/web/src/views/skill-selector.ts",
    stylesheet: "packages/web/src/views/skill-selector.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/settings/settings.frame"],
    productionModule: "packages/web/src/views/settings.ts",
    stylesheet: "packages/web/src/views/settings.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/stage/stage.frame"],
    productionModule: "packages/web/src/views/stage.ts",
    stylesheet: "packages/web/src/views/stage.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/system-modal/system-modal.frame"],
    productionModule: "packages/web/src/views/system-modal.ts",
    stylesheet: "packages/web/src/views/system-modal.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: [
      "specs/ui/app/tab-strip/tab-strip.frame",
      "specs/ui/app/tab-strip/tab.frame",
      "specs/ui/app/tab-strip/tab-placeholder.frame",
    ],
    productionModule: "packages/web/src/views/tab-strip.ts",
    stylesheet: "packages/web/src/views/tab-strip.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/top-bar/top-bar.frame"],
    productionModule: "packages/web/src/views/top-bar.ts",
    stylesheet: "packages/web/src/views/top-bar.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/update-notification/update-notification.frame"],
    productionModule: "packages/web/src/views/update-notification.ts",
    stylesheet: "packages/web/src/views/update-notification.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/menu/styles.css"],
    productionModule: "packages/web/src/elements/menu.ts",
    stylesheet: "packages/web/src/elements/menu.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/app/dialog/dialog.frame"],
    productionModule: "packages/web/src/views/dialog.ts",
    stylesheet: "packages/web/src/views/dialog.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/popover/styles.css"],
    productionModule: "packages/web/src/elements/popover.ts",
    stylesheet: "packages/web/src/elements/popover.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/select/styles.css"],
    productionModule: "packages/web/src/elements/select.ts",
    stylesheet: "packages/web/src/elements/select.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/icons/styles.css"],
    productionModule: "packages/web/src/elements/icon.ts",
    stylesheet: "packages/web/src/elements/icon.css",
    documentDelivery: false,
    shadowRootSheet: "iconSheet",
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/checkbox-list/styles.css"],
    productionModule: "packages/web/src/elements/checkbox-list.ts",
    stylesheet: "packages/web/src/elements/checkbox-list.css",
    documentDelivery: false,
  },

  // The Markdown document loads canonical before its layout and authoritative
  // editor-color sheets.
  {
    kind: "linked-document",
    document: "packages/view-markdown/src/index.html",
    href: "/canonical/v2/styles.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/view-markdown/src/main.ts",
    stylesheet: "packages/view-markdown/src/styles.css",
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/markdown-editor/styles.css"],
    productionModule: "packages/view-markdown/src/main.ts",
    stylesheet: "packages/view-markdown/src/colors.css",
    documentDelivery: true,
  },

  // Standalone error documents load canonical before their view-specific copy.
  {
    kind: "linked-document",
    document: "packages/web/src/views/artifact-missing/index.html",
    href: "/canonical/v2/styles.css",
  },
  {
    kind: "linked-document",
    document: "packages/web/src/views/url-unsupported/index.html",
    href: "/canonical/v2/styles.css",
  },
  {
    kind: "embedded",
    specSource: "specs/ui/app/artifact-frame/error-page/error-page.frame",
    document: "packages/web/src/views/artifact-missing/index.html",
  },
  {
    kind: "embedded",
    specSource: "specs/ui/app/artifact-frame/error-page/error-page.frame",
    document: "packages/web/src/views/url-unsupported/index.html",
  },

  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/main.ts",
    stylesheet: "packages/web/src/foundation/app.css",
  },

  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/swiss/styles.css",
    packageStylesheet: "packages/server/assets/themes/swiss/theme.css",
    assets: [{ specSource: "specs/ui/themes/swiss/styles.css", productionAsset: "packages/server/assets/themes/swiss/theme.css" }],
  },
  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/nord/styles.css",
    packageStylesheet: "packages/server/assets/themes/nord/theme.css",
    assets: [{ specSource: "specs/ui/themes/nord/styles.css", productionAsset: "packages/server/assets/themes/nord/theme.css" }],
  },
  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/tokyo-night/styles.css",
    packageStylesheet: "packages/server/assets/themes/tokyo-night/theme.css",
    assets: [
      { specSource: "specs/ui/themes/tokyo-night/styles.css", productionAsset: "packages/server/assets/themes/tokyo-night/theme.css" },
      { specSource: "specs/ui/themes/tokyo-night/wallpaper.webp", productionAsset: "packages/server/assets/themes/tokyo-night/wallpaper.webp" },
    ],
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/dialog.ts",
    stylesheet: "packages/web/src/views/dialog.host.css",
  },

  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/popover/styles.css"],
    productionModule: "packages/web/src/elements/menu.ts",
    stylesheet: "packages/web/src/elements/popover.css",
    documentDelivery: true,
  },
  {
    kind: "sibling",
    specSources: ["specs/ui/foundation/popover/styles.css"],
    productionModule: "packages/web/src/elements/select.ts",
    stylesheet: "packages/web/src/elements/popover.css",
    documentDelivery: true,
  },

  // These sheets are explicitly code-governed rather than spec crossings.
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/theme.ts",
    linkElement: "link",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/artifact-view.ts",
    stylesheet: "packages/web/src/views/artifact-view.host.css",
  },
  {
    // specs/ui/app/index.md ^ap-resize-band-exemption
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/television-app.ts",
    stylesheet: "packages/web/src/views/television-app.host.css",
  },
  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/aquarium/styles.css",
    packageStylesheet: "packages/server/assets/themes/aquarium/theme.css",
    assets: [{ specSource: "specs/ui/themes/aquarium/styles.css", productionAsset: "packages/server/assets/themes/aquarium/theme.css" }],
  },
  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/blueprint/styles.css",
    packageStylesheet: "packages/server/assets/themes/blueprint/theme.css",
    assets: [{ specSource: "specs/ui/themes/blueprint/styles.css", productionAsset: "packages/server/assets/themes/blueprint/theme.css" }],
  },
  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/crt-phosphor/styles.css",
    packageStylesheet: "packages/server/assets/themes/crt-phosphor/theme.css",
    assets: [{ specSource: "specs/ui/themes/crt-phosphor/styles.css", productionAsset: "packages/server/assets/themes/crt-phosphor/theme.css" }],
  },
  {
    kind: "bundled-theme",
    specSource: "specs/ui/themes/clouds/styles.css",
    packageStylesheet: "packages/server/assets/themes/clouds/theme.css",
    assets: [
      {
        specSource: "specs/ui/themes/clouds/styles.css",
        productionAsset: "packages/server/assets/themes/clouds/theme.css",
      },
      {
        specSource: "specs/ui/themes/clouds/wallpaper.webp",
        productionAsset: "packages/server/assets/themes/clouds/wallpaper.webp",
      },
      {
        specSource: "specs/ui/themes/clouds/wallpaper-dark.webp",
        productionAsset: "packages/server/assets/themes/clouds/wallpaper-dark.webp",
      },
    ],
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/main.ts",
    stylesheet: "packages/web/src/global.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/artifact-document-host.ts",
    stylesheet: "packages/web/src/views/artifact-document-host.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/channel-list.ts",
    stylesheet: "packages/web/src/views/channel-sidebar.drag.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/stage.ts",
    stylesheet: "packages/web/src/views/stage.host.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/system-modal.ts",
    stylesheet: "packages/web/src/views/system-modal.host.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/tab-strip.ts",
    stylesheet: "packages/web/src/views/tab-strip.drag.css",
  },
  {
    kind: "implementation-owned",
    productionModule: "packages/web/src/views/tab-strip.ts",
    stylesheet: "packages/web/src/views/tab-strip.host.css",
  },
];

export function expectedDocumentStyleRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const crossing of UI_STYLE_CROSSINGS) {
    switch (crossing.kind) {
      case "aggregate":
        routes.add(
          `document stylesheet: ${crossing.productionModule} -> ${crossing.stylesheet}`,
        );
        break;
      case "sibling":
        if (crossing.documentDelivery) {
          routes.add(
            `document stylesheet: ${crossing.productionModule} -> ${crossing.stylesheet}`,
          );
        }
        if (crossing.shadowRootSheet !== undefined) {
          routes.add(
            `shadow adopted stylesheet: ${crossing.productionModule}#${crossing.shadowRootSheet} -> ${crossing.stylesheet}`,
          );
        }
        break;
      case "embedded":
        routes.add(`embedded document style: ${crossing.document}#style[0]`);
        break;
      case "linked-document":
        routes.add(`document stylesheet link: ${crossing.document} -> ${crossing.href}`);
        break;
      case "bundled-theme":
        break;
      case "implementation-owned":
        if (crossing.stylesheet !== undefined) {
          routes.add(
            `document stylesheet: ${crossing.productionModule} -> ${crossing.stylesheet}`,
          );
        } else if (crossing.adoptedSheet !== undefined) {
          routes.add(`document adopted sheet: ${crossing.productionModule}#${crossing.adoptedSheet}`);
        } else {
          routes.add(`document linked stylesheet: ${crossing.productionModule}#${crossing.linkElement}`);
        }
        break;
    }
  }
  return routes;
}
