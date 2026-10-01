// Story staging (not spec content): renders the foundation token sheets under
// specs/ui/foundation/tokens/ as a visual gallery. Display
// chrome is self-contained here — no app styles — and all DOM is built
// through the isolated frame's document (see storybook/lib/frame.ts)
// so the gallery renders in a clean room the app stylesheet never touches.

import fontsCssSource from "../../../../specs/ui/foundation/tokens/fonts.css?inline";
import colorsCssSource from "../../../../specs/ui/foundation/tokens/colors.css?inline";
import textCssSource from "../../../../specs/ui/foundation/tokens/text.css?inline";
import spacingCssSource from "../../../../specs/ui/foundation/tokens/spacing.css?inline";
import hindUrl from "../../../../specs/ui/foundation/fonts/Hind-Variable.woff2?url";

// The fixed-color palette groups, rendered as chip grids.
export const COLOR_GROUPS = ["colors", "neutral"] as const;

const COLOR_GROUP_SET: ReadonlySet<string> = new Set(COLOR_GROUPS);

const STAGING_CSS = /*css*/ `
  .tokens-stage {
    min-height: 100vh;
    padding: 3rem;
    background: #ffffff;
    color: #1f1f1f;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  .tokens-name,
  .tokens-value,
  .tokens-pad-content,
  .tokens-color-name,
  .tokens-color-value,
  .tokens-tint-label,
  .tokens-tint-error-label,
  .tokens-type-resolved,
  .tokens-font-weight-label,
  .tokens-ungrouped-warning,
  .tokens-font-error {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .tokens-group {
    max-width: 44rem;
  }
  .tokens-group + .tokens-group {
    margin-top: 3rem;
  }
  .tokens-group-heading {
    margin: 0 0 1rem;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: currentColor;
    opacity: 0.6;
  }
  .tokens-row {
    display: grid;
    grid-template-columns: 9rem 5rem 1fr;
    column-gap: 1.5rem;
    align-items: center;
    padding: 0.3125rem 0;
  }
  .tokens-name,
  .tokens-value {
    font-size: 0.8125rem;
  }
  .tokens-value {
    color: #8a8a8a;
  }
  .tokens-pad {
    display: inline-block;
    justify-self: start;
    background: #dbe4f5;
    outline: 1px dashed #8a94a6;
  }
  .tokens-pad-content {
    display: block;
    padding: 0.125rem 0.5rem;
    background: #ffffff;
    outline: 1px solid #8a94a6;
    font-size: 0.6875rem;
    color: #5c6470;
    white-space: nowrap;
  }
  .tokens-corner {
    width: 4.5rem;
    height: 2.75rem;
    justify-self: start;
    background: #dbe4f5;
    border: 1px solid #8a94a6;
  }
  .tokens-swatch {
    height: 0.75rem;
    min-width: 0.75rem;
    justify-self: start;
    background: #d7dbe2;
    border: 1px solid #8a94a6;
    border-radius: 1px;
  }
  .tokens-color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.75rem;
  }
  .tokens-color-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1875rem;
    padding: 1.25rem 0.5rem;
    border: 1px solid rgb(0 0 0 / 0.15);
    border-radius: 2px;
  }
  .tokens-color-name {
    font-size: 0.6875rem;
    white-space: nowrap;
  }
  .tokens-color-value {
    font-size: 0.625rem;
    opacity: 0.75;
    white-space: nowrap;
  }
  .tokens-tint-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: 0.75rem;
  }
  .tokens-tint-chip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem 0.375rem;
    border-radius: 2px;
    overflow: hidden;
  }
  .tokens-tint-fill {
    position: absolute;
    inset: 0;
  }
  .tokens-tint-label {
    position: relative;
    font-size: 0.6875rem;
    white-space: nowrap;
  }
  .tokens-tint-chip-error {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 0.5rem;
    border: 1px solid #c0392b;
    background: #fdecea;
  }
  .tokens-tint-error-label {
    font-size: 0.6875rem;
    color: #c0392b;
    text-align: center;
  }
  .tokens-card {
    padding: 1.5rem 1.75rem;
    background: #ffffff;
    border-radius: 6px;
  }
  .tokens-card + .tokens-card {
    margin-top: 1rem;
  }
  .tokens-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.375rem 0.75rem;
    margin: 0 0 1.25rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid rgb(0 0 0 / 0.08);
  }
  .tokens-type-row {
    display: grid;
    grid-template-columns: 6rem 4rem 1fr;
    column-gap: 1.5rem;
    align-items: baseline;
    padding: 0.375rem 0;
  }
  .tokens-type-resolved {
    font-size: 0.75rem;
    color: #8a8a8a;
  }
  .tokens-type-line {
    font-family: var(--font-sans);
    font-weight: var(--font-weight-body);
    line-height: var(--leading-base);
  }
  .tokens-ungrouped-warning,
  .tokens-font-error {
    padding: 0.5rem 0.75rem;
    border: 1px solid #c0392b;
    background: #fdecea;
    color: #c0392b;
    font-size: 0.75rem;
  }
  .tokens-ungrouped-warning {
    margin: 0 0 1.5rem;
  }
  .tokens-font-error {
    margin: 0 0 1rem;
  }
  .tokens-footnote {
    margin: 1.25rem 0 0;
    font-size: 0.75rem;
    line-height: 1.5;
    color: currentColor;
    opacity: 0.6;
  }
  .tokens-footnote + .tokens-footnote {
    margin-top: 0.5rem;
  }
  .tokens-stage-grey {
    background: #ededef;
  }
  .tokens-font-line {
    margin: 0 0 1rem;
    font-size: 2rem;
    line-height: 1.2;
    font-weight: var(--font-weight-body);
  }
  .tokens-font-paragraph {
    margin: 0;
    font-size: var(--text-md);
    line-height: var(--leading-base);
    font-weight: var(--font-weight-body);
  }
  .tokens-font-weight-row {
    display: grid;
    grid-template-columns: 5rem 1fr;
    column-gap: 1.25rem;
    align-items: baseline;
    padding: 0.25rem 0;
  }
  .tokens-font-weight-label {
    font-size: 0.75rem;
    color: #8a8a8a;
  }
  .tokens-font-weight-line {
    font-family: var(--font-sans);
    font-size: 1.25rem;
    line-height: var(--leading-base);
  }
`;

// One style element per key per persistent document, but its CONTENTS are
// rewritten on every build: the isolated frame's head outlives story
// switches and HMR updates, so a probe-and-skip would pin the first-loaded
// CSS under later edits until a full reload — a gallery that lies about the
// spec.
function installStyle(doc: Document, key: string, cssText: string): void {
  let style = doc.querySelector<HTMLStyleElement>(`style[data-staging='${key}']`);
  if (!style) {
    style = doc.createElement("style");
    style.dataset.staging = key;
    doc.head.append(style);
  }
  style.textContent = cssText;
}

// The spec's global token styles, verbatim: fonts, spacing, colors, then text.
// The one staging concern is asset resolution — the spec's relative
// url(fonts/Hind-Variable.woff2) reference is rewritten to the Vite-served
// URL of the same committed asset (matched loosely because Vite's CSS
// pipeline may itself have resolved the path — dev serves it as /@fs/…,
// build as a hashed asset name — before we see it).
const GLOBAL_STYLES =
  fontsCssSource.replace(/url\([^)]*Hind-Variable[^)]*\)/, `url(${JSON.stringify(hindUrl)})`) +
  `\n${spacingCssSource}\n${colorsCssSource}\n${textCssSource}`;

// Grouped token values, read back from the sheet: group name → token name →
// value, in declaration order.
type TokenGroups = Record<string, Record<string, string>>;

// Group membership is derived from the token names the sheet declares, in
// matcher order: by prefix where a scale carries one, by explicit name set
// where it doesn't. A token matching nothing is collected as UNGROUPED and
// surfaced as a loud warning banner on every story — a declared token with
// no gallery representation would otherwise be invisible, and the gallery
// must show what the spec declares.
const GROUP_MATCHERS: ReadonlyArray<
  readonly [match: string | ReadonlySet<string>, group: string]
> = [
  ["space-", "spacing"],
  ["radius-", "radius"],
  ["neutral-", "neutral"],
  ["alpha-", "alpha"],
  ["tint-", "tint"],
  ["text-", "type"],
  ["leading-", "type"],
  ["font-", "fonts"],
  [new Set(["black", "white"]), "colors"],
];

function groupOf(name: string): string | null {
  for (const [match, group] of GROUP_MATCHERS) {
    if (typeof match === "string" ? name.startsWith(match) : match.has(name)) return group;
  }
  return null;
}

// The galleries' data source: enumerate the :root custom properties from
// the injected style element's CSSOM — the sheet the frame actually styles
// with — so what a story shows is exactly what the spec's CSS declares.
// Cross-realm CSSOM (the style element lives in the frame document), so
// rules are matched on selectorText rather than instanceof.
const UNGROUPED = "__ungrouped__";

function readTokenGroups(doc: Document): TokenGroups {
  const style = doc.querySelector<HTMLStyleElement>("style[data-staging='global-styles']");
  const groups: TokenGroups = {};
  const rules = style?.sheet?.cssRules;
  if (!rules) return groups;
  for (let r = 0; r < rules.length; r++) {
    const rule = rules[r] as CSSStyleRule;
    if (rule.selectorText !== ":root") continue;
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style.item(i);
      if (!prop.startsWith("--")) continue;
      const name = prop.slice(2);
      const group = groupOf(name) ?? UNGROUPED;
      (groups[group] ??= {})[name] = rule.style.getPropertyValue(prop).trim();
    }
  }
  return groups;
}

function el(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The shared display framing: a section is the tokens-group frame with its
// uppercase heading; a card is the white specimen wrapper.
function section(doc: Document, title: string, ...kids: ReadonlyArray<Node | string>): HTMLElement {
  const node = el(doc, "section", "tokens-group");
  node.append(el(doc, "h2", "tokens-group-heading", title), ...kids);
  return node;
}

function card(doc: Document, ...kids: ReadonlyArray<Node | string>): HTMLElement {
  const node = el(doc, "div", "tokens-card");
  node.append(...kids);
  return node;
}

// Colorimetry constants: the sRGB linearization curve and the WCAG
// relative-luminance channel weights, plus WCAG's contrast offset.
const OKLCH_L_TO_Y_EXP = 3;
const HEX_CHANNEL_MAX = 255;
const SRGB_LINEAR_CUTOFF = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_WEIGHT_R = 0.2126;
const LUMA_WEIGHT_G = 0.7152;
const LUMA_WEIGHT_B = 0.0722;
const WCAG_CONTRAST_OFFSET = 0.05;

// Gamma-encoded sRGB channels (0–1) of a #rrggbb value; null otherwise.
function hexChannels(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return null;
  const at = (i: number): number =>
    Number.parseInt(hex[1].slice(i * 2, i * 2 + 2), 16) / HEX_CHANNEL_MAX;
  return [at(0), at(1), at(2)];
}

function linearizeChannel(c: number): number {
  return c <= SRGB_LINEAR_CUTOFF
    ? c / SRGB_LINEAR_DIVISOR
    : ((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_SCALE) ** SRGB_GAMMA;
}

// WCAG relative luminance (0–1) of gamma-encoded sRGB channels.
function channelsLuminance([r, g, b]: readonly [number, number, number]): number {
  return (
    LUMA_WEIGHT_R * linearizeChannel(r) +
    LUMA_WEIGHT_G * linearizeChannel(g) +
    LUMA_WEIGHT_B * linearizeChannel(b)
  );
}

// Approximate relative luminance (0–1) of a token color: oklch(L% …) maps L
// through the cube (adequate for near-achromatic values); #rrggbb
// linearizes exactly. Unparseable values return null.
function colorLuminance(value: string): number | null {
  const oklch = /^oklch\(\s*([\d.]+)%/i.exec(value.trim());
  if (oklch) return (Number.parseFloat(oklch[1]) / 100) ** OKLCH_L_TO_Y_EXP;
  const channels = hexChannels(value);
  return channels === null ? null : channelsLuminance(channels);
}

// The single label chooser: whichever of pure black / pure white wins WCAG
// contrast against the given fill luminance. Computed, not thresholded —
// mid-scale steps sit close to the flip and a fixed cutoff lands sub-4.5:1
// on the losing side.
function labelForLuminance(y: number): string {
  const contrast = (a: number, b: number): number =>
    (Math.max(a, b) + WCAG_CONTRAST_OFFSET) / (Math.min(a, b) + WCAG_CONTRAST_OFFSET);
  return contrast(1, y) >= contrast(0, y) ? "#ffffff" : "#000000";
}

function labelColorFor(value: string): string {
  const y = colorLuminance(value);
  return y === null ? "#1f1f1f" : labelForLuminance(y);
}

// A color group's chips: each token is one chip filled with the token's
// value, name and value printed inside it in the winning label color.
function colorGrid(doc: Document, tokens: Record<string, string>): HTMLElement {
  const grid = el(doc, "div", "tokens-color-grid");
  for (const [name, value] of Object.entries(tokens)) {
    const chip = el(doc, "div", "tokens-color-chip");
    chip.style.background = value;
    chip.style.color = labelColorFor(value);
    chip.append(
      el(doc, "span", "tokens-color-name", name),
      el(doc, "span", "tokens-color-value", value),
    );
    grid.append(chip);
  }
  return grid;
}

// The percentage a tint token draws: resolve its var(--alpha-N) reference
// against the enumerated alpha group; null when unresolvable.
function alphaPercentFor(value: string, alpha: Record<string, string>): string | null {
  const match = /var\(--([a-z0-9-]+)\)/i.exec(value);
  if (!match) return null;
  return alpha[match[1]] ?? null;
}

// The backgrounds the Tint story can stage on, selected in the Controls
// panel. Each option recolors the WHOLE stage: the backdrop, and the text
// color that sits on it — which is the currentColor every tint expression
// resolves against.
export const TINT_BACKGROUNDS: Record<string, { bg: string; fg: string }> = {
  white: { bg: "#ffffff", fg: "#1f1f1f" },
  grey: { bg: "#808080", fg: "#ffffff" },
  black: { bg: "#161616", fg: "#f5f5f5" },
  blue: { bg: "#1e50c8", fg: "#ffffff" },
};

// Label color over a tint fill: the fill the viewer sees is currentColor
// at the token's strength composited over the ground, and the browser does
// that in gamma sRGB CHANNELS (color-mix in srgb toward transparent, then
// source-over) — so the math here blends each channel first and only then
// takes the composite's luminance. Blending luminances instead would land
// several mid-scale steps on the wrong side of the flip.
function tintLabelColor(context: { bg: string; fg: string }, strength: number): string {
  const bg = hexChannels(context.bg);
  const fg = hexChannels(context.fg);
  if (bg === null || fg === null) return "#1f1f1f";
  const t = strength / 100;
  const blend = (i: 0 | 1 | 2): number => fg[i] * t + bg[i] * (1 - t);
  return labelForLuminance(channelsLuminance([blend(0), blend(1), blend(2)]));
}

function tintErrorChip(doc: Document, message: string): HTMLElement {
  const chip = el(doc, "div", "tokens-tint-chip tokens-tint-chip-error");
  chip.append(el(doc, "span", "tokens-tint-error-label", message));
  return chip;
}

// One tint chip: a fill layer painting the token's own value expression
// verbatim over whatever background the stage carries. The chip sets no
// colors of its own — currentColor arrives from the stage's text color,
// which is the demonstration. A tint whose alpha reference doesn't resolve
// is broken spec data; a zero-strength-looking chip would hide that, so it
// renders as an explicit error chip instead.
function renderTintChip(
  doc: Document,
  name: string,
  value: string,
  alpha: Record<string, string>,
  context: { bg: string; fg: string },
): HTMLElement {
  const percent = alphaPercentFor(value, alpha);
  if (percent === null || !Number.isFinite(Number.parseFloat(percent))) {
    return tintErrorChip(doc, `${name}: unresolved alpha reference`);
  }
  const chip = el(doc, "div", "tokens-tint-chip");
  const fill = el(doc, "span", "tokens-tint-fill");
  fill.style.background = value;
  const text = el(doc, "span", "tokens-tint-label", `${name} · ${percent}`);
  text.style.color = tintLabelColor(context, Number.parseFloat(percent));
  chip.append(fill, text);
  return chip;
}

// Staging prose under the tint grid — display commentary, not spec content.
const TINT_FOOTNOTES = [
  "tint-* is the contextual-foreground fade: currentColor mixed toward " +
    "transparent at the scale's strengths, so the same token follows " +
    "whatever text color surrounds it. The background control recolors the " +
    "stage and its text color together; the chips' CSS never changes — " +
    "only currentColor does.",
  "alpha-* holds the same strengths as raw percentages with no appearance " +
    "of their own, for mixing a FIXED base at the use site: " +
    "color-mix(in srgb, var(--white) var(--alpha-200), transparent). Equal " +
    "strengths read stronger dark-on-light than light-on-dark, which is why " +
    "dark-context uses often step deeper into the scale.",
];

// The tint chips plus the pairing guard. Alpha has no story of its own —
// the tint grid IS its gallery representation — so the two scales' step
// suffixes are compared here: an --alpha-N with no --tint-N (or vice versa)
// would otherwise be invisible, and each unpaired token renders a loud
// error chip in the grid instead.
function tintGrid(
  doc: Document,
  tokens: Record<string, string>,
  alpha: Record<string, string>,
  context: { bg: string; fg: string },
): HTMLElement {
  const grid = el(doc, "div", "tokens-tint-grid");
  for (const [name, value] of Object.entries(tokens)) {
    grid.append(renderTintChip(doc, name, value, alpha, context));
  }
  const tintSteps = new Set(Object.keys(tokens).map((name) => name.slice("tint-".length)));
  const alphaSteps = new Set(Object.keys(alpha).map((name) => name.slice("alpha-".length)));
  for (const step of alphaSteps) {
    if (!tintSteps.has(step)) {
      grid.append(tintErrorChip(doc, `alpha-${step}: no paired tint-${step}`));
    }
  }
  for (const step of tintSteps) {
    if (!alphaSteps.has(step)) {
      grid.append(tintErrorChip(doc, `tint-${step}: no paired alpha-${step}`));
    }
  }
  return grid;
}

// Specimen copy — display staging, not spec content.
const FONT_PANGRAM = "Sphinx of black quartz, judge my vow.";
const FONT_PARAGRAPH =
  "Television stages artifacts on a shared channel: an agent publishes a " +
  "page and the whole room sees it at once. Type set in this family " +
  "carries every label, paragraph, and control in the interface, so " +
  "readability at small sizes and a steady rhythm across weights matter " +
  "more than personality. Numbers like 0123456789 and punctuation — " +
  "quotes, dashes, brackets — should sit quietly in running text.";

// The weights the specimen shows across Hind's variable 300–700 axis —
// there are no weight tokens (yet), so these numbers live here, not in the
// spec.
const FONT_SPECIMEN_WEIGHTS = [300, 400, 500, 600, 700] as const;

// The font tokens that are families and get specimen cards; other tokens
// in the fonts group (weights) belong to the values list.
const FONT_FAMILY_TOKENS: ReadonlySet<string> = new Set(["font-sans", "font-mono"]);

// The type-scale ladder steps, shown as sized sample lines; other tokens
// in the type group (authored knobs) belong to the values list.
const TYPE_LADDER: ReadonlySet<string> = new Set(["text-sm", "text-md", "text-lg", "text-xl"]);

// One specimen card per family token. All sample text styles through the
// REALIZED variables — the card sets font-family: var(--<token>), and the
// paragraph draws its size, leading, and weight from var(--text-md) /
// var(--leading-base) / var(--font-weight-body) — so the specimen exercises
// the spec's own vocabulary, not literal stacks.
function familyCard(doc: Document, name: string, value: string): HTMLElement {
  const head = el(doc, "div", "tokens-card-head");
  head.append(el(doc, "span", "tokens-name", name), el(doc, "span", "tokens-value", value));
  const node = card(
    doc,
    head,
    el(doc, "p", "tokens-font-line", FONT_PANGRAM),
    el(doc, "p", "tokens-font-paragraph", FONT_PARAGRAPH),
  );
  node.style.fontFamily = `var(--${name})`;
  return node;
}

// The weight run: the pangram at each specimen stop, with the spec's body
// weight marked on its row.
function weightsCard(doc: Document, fonts: Record<string, string>): HTMLElement {
  const node = card(doc);
  const bodyWeight = fonts["font-weight-body"];
  for (const weight of FONT_SPECIMEN_WEIGHTS) {
    const row = el(doc, "div", "tokens-font-weight-row");
    const line = el(doc, "span", "tokens-font-weight-line", FONT_PANGRAM);
    line.style.fontWeight = String(weight);
    const isBody = String(weight) === bodyWeight;
    row.append(
      el(doc, "span", "tokens-font-weight-label", isBody ? `${weight} · body` : String(weight)),
      line,
    );
    node.append(row);
  }
  return node;
}

// The type-scale ladder: each step sized through the realized variable —
// the browser evaluates the calc chain, and the resolved pixel size is read
// back and printed beside the name, so the story shows what the math lands
// on.
function scaleCard(doc: Document, type: Record<string, string>): HTMLElement {
  const node = card(doc);
  const resolved: Array<{ line: HTMLElement; out: HTMLElement }> = [];
  for (const name of Object.keys(type)) {
    if (!TYPE_LADDER.has(name)) continue;
    const row = el(doc, "div", "tokens-type-row");
    const out = el(doc, "span", "tokens-type-resolved", "…");
    const line = el(doc, "span", "tokens-type-line", FONT_PANGRAM);
    line.style.fontSize = `var(--${name})`;
    row.append(el(doc, "span", "tokens-name", name), out, line);
    node.append(row);
    resolved.push({ line, out });
  }
  // Resolved sizes are readable only after the card joins the document.
  queueMicrotask(() => {
    const view = doc.defaultView;
    if (!view) return;
    for (const { line, out } of resolved) {
      out.textContent = `→ ${view.getComputedStyle(line).fontSize}`;
    }
  });
  return node;
}

function tokenRow(doc: Document, name: string, value: string): HTMLElement {
  const row = el(doc, "div", "tokens-row");
  row.append(el(doc, "span", "tokens-name", name), el(doc, "span", "tokens-value", value));
  return row;
}

// The non-showcase tokens — the scale's authored knobs and the fonts
// group's weight — as a compact data list.
function valuesCard(
  doc: Document,
  type: Record<string, string>,
  fonts: Record<string, string>,
): HTMLElement {
  const entries = [
    ...Object.entries(type).filter(([name]) => !TYPE_LADDER.has(name)),
    ...Object.entries(fonts).filter(([name]) => !FONT_FAMILY_TOKENS.has(name)),
  ];
  return card(doc, ...entries.map(([name, value]) => tokenRow(doc, name, value)));
}

// The combined typography screen — families, weights, scale, values —
// drawing on both the fonts and type groups of the spec. Loading the spec's
// committed Hind asset into the frame is part of the screen, and the load
// is ASSERTED: with font-display swap, a 404'd or rejected asset silently
// renders the fallback stack and the specimens look legitimate — so the
// frame actively loads the face and plants a visible error banner if it
// doesn't arrive.
function renderTypeScreen(doc: Document, spec: TokenGroups): HTMLElement[] {
  const fonts = spec.fonts ?? {};
  const type = spec.type ?? {};
  const families = section(
    doc,
    "families",
    ...Object.entries(fonts)
      .filter(([name]) => FONT_FAMILY_TOKENS.has(name))
      .map(([name, value]) => familyCard(doc, name, value)),
  );
  void doc.fonts
    .load('16px "Hind"')
    .then((faces) => {
      if (faces.length > 0) return;
      throw new Error("no face matched");
    })
    .catch(() => {
      if (!families.isConnected) return; // build superseded meanwhile
      families.prepend(
        el(
          doc,
          "div",
          "tokens-font-error",
          "Hind failed to load — specimens are rendering the fallback stack.",
        ),
      );
    });
  return [
    families,
    section(doc, "weights", weightsCard(doc, fonts)),
    section(doc, "scale", scaleCard(doc, type)),
    section(doc, "values", valuesCard(doc, type, fonts)),
  ];
}

// One row: name, value, visual. Spacing shows the token as the padding of a
// tinted frame — the gap you see is the token; radius as a box's
// border-radius; unknown groups get a neutral swatch attempting the value
// as a width (an unparseable length leaves the min-width square).
function renderRow(doc: Document, group: string, name: string, value: string): HTMLElement {
  const row = tokenRow(doc, name, value);
  if (group === "spacing") {
    const frame = el(doc, "span", "tokens-pad");
    frame.style.padding = value;
    frame.append(el(doc, "span", "tokens-pad-content", "content"));
    row.append(frame);
  } else if (group === "radius") {
    const box = el(doc, "span", "tokens-corner");
    box.style.borderRadius = value;
    row.append(box);
  } else {
    const visual = el(doc, "span", "tokens-swatch");
    visual.style.width = value;
    row.append(visual);
  }
  return row;
}

// Takes the group names to render (explicit — there is no render-everything
// default). Styles go in first, then the galleries enumerate the :root
// custom properties back out of the CSSOM — so whichever groups a story
// shows, the alpha values the tint chips print are always readable from the
// sheet. Palette groups render as chip grids, "type" as the combined
// typography screen, the rest as name/value rows.
export function tokenGallery(
  doc: Document,
  groups: readonly string[],
  background?: string,
): HTMLElement {
  installStyle(doc, "foundation-tokens", STAGING_CSS);
  installStyle(doc, "global-styles", GLOBAL_STYLES);
  const spec = readTokenGroups(doc);
  const stage = el(doc, "div", "tokens-stage");
  const ungrouped = spec[UNGROUPED];
  if (ungrouped) {
    stage.append(
      el(
        doc,
        "div",
        "tokens-ungrouped-warning",
        `Declared tokens with no gallery group (add a prefix rule or hand list): ${Object.keys(ungrouped).join(", ")}`,
      ),
    );
  }
  // Specimen stories read best as white cards on a grey stage.
  if (groups.includes("type")) stage.classList.add("tokens-stage-grey");
  // The Tint story's background control recolors the whole stage — backdrop
  // plus the text color tints resolve against.
  const context = TINT_BACKGROUNDS[background ?? "white"] ?? TINT_BACKGROUNDS.white;
  if (background !== undefined) {
    stage.style.background = context.bg;
    stage.style.color = context.fg;
  }
  for (const group of groups) {
    if (group === "tint") {
      stage.append(
        section(
          doc,
          "tint",
          tintGrid(doc, spec[group] ?? {}, spec.alpha ?? {}, context),
          ...TINT_FOOTNOTES.map((text) => el(doc, "p", "tokens-footnote", text)),
        ),
      );
    } else if (group === "type") {
      stage.append(...renderTypeScreen(doc, spec));
    } else if (COLOR_GROUP_SET.has(group)) {
      stage.append(section(doc, group, colorGrid(doc, spec[group] ?? {})));
    } else {
      stage.append(
        section(
          doc,
          group,
          ...Object.entries(spec[group] ?? {}).map(([name, value]) =>
            renderRow(doc, group, name, value),
          ),
        ),
      );
    }
  }
  return stage;
}
