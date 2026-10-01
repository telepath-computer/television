/* One of two sibling importers proving css module script caching: both
 * helpers import the same fixture stylesheet, and the test asserts they
 * hold the identical `CSSStyleSheet` instance. */
import sheet from "../fixtures/css-module-scripts/panel.css" with { type: "css" };

export const panelSheet = sheet;
