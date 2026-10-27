/*! codemirror-markdown-tables 1.0.0, Copyright (c) 2026 Chris Kant. MIT; see LICENSE. */
import { SourceTable } from "../../source-table.ts";
import { EditorView as pt, keymap as ps, drawSelection as vs, runScopeHandlers as bs, WidgetType as gs, getTooltip as ws, Decoration as Cs, ViewPlugin as xs, showTooltip as Ss } from "@codemirror/view";
import { G as _s, D as gr, A as pn, S as wr } from "@mobily/ts-belt";
import { redo as ys, undo as Es, undoDepth as Rs, redoDepth as As, invertedEffects as Ts } from "@codemirror/commands";
import { EditorSelection as Fn, Text as at, Facet as ks, Annotation as zs, Prec as Ls, RangeSetBuilder as Os, StateField as Cr, Transaction as Ds, StateEffect as Is, ChangeSet as xr, EditorState as Qe } from "@codemirror/state";
import { DocInput as Ko, highlightingFor as Ps, syntaxHighlighting as Ms, syntaxTree as Hs, syntaxTreeAvailable as Bs } from "@codemirror/language";
import { NodeProp as Ns } from "@lezer/common";
import { markdown as Yo } from "@codemirror/lang-markdown";
import { Table as Fs } from "@lezer/markdown";
import { clsx as $s } from "clsx";
import { getStyleTags as Us, tags as Vs } from "@lezer/highlight";
import { computePosition as qs, autoPlacement as Ws, shift as js } from "@floating-ui/dom";
import { pickedCompletion as Ks } from "@codemirror/autocomplete";
const { isNotNullable: Ys, isNullable: Xs, isString: Gs } = _s, b = Ys, _ = Xs;
function Sr(e) {
  return gr.filter(e, (t) => b(t));
}
function Js(e, t) {
  const n = new Array();
  for (const [o, i] of Object.entries(e))
    n.push(t(o, i));
  return n;
}
function _r(e, t) {
  return gr.selectKeys(e, t);
}
const Zs = [
  "--tbl-style-font-family",
  "--tbl-style-font-size",
  "--tbl-style-menu-font-family",
  "--tbl-style-menu-font-size",
  "--tbl-style-default-header-alignment"
];
class Pe {
  /**
   * Basic style with sensible defaults.
   */
  static default = Pe.of({
    "--tbl-style-font-family": "system-ui",
    "--tbl-style-font-size": "inherit",
    "--tbl-style-menu-font-family": "system-ui",
    "--tbl-style-menu-font-size": "inherit",
    "--tbl-style-default-header-alignment": "left"
  });
  /**
   * Properties that define font and other CSS styles.
   */
  props;
  /**
   * Returns a copy of this {@link TableStyle} with the given {@link props} applied.
   *
   * @param props - The optional property changes to apply to the copy.
   * If specified, props override properties in the original {@link TableStyle}.
   * Properties that are set to `undefined` or omitted use the original values.
   *
   * @example
   * ```typescript
   * const customStyle = TableStyle.default.with({
   *   "--tbl-style-font-family": '"Comic Sans", sans-serif',
   *   "--tbl-style-font-size": "16px",
   * })
   * ```
   */
  with(t) {
    return _(t) ? Pe.of({ ...this.props }) : Pe.of({
      ...this.props,
      ...Sr(_r(t, Zs))
    });
  }
  static of(t) {
    return new Pe(t);
  }
  constructor(t) {
    this.props = t;
  }
}
const Qs = [
  "--tbl-theme-row-background",
  "--tbl-theme-header-row-background",
  "--tbl-theme-even-row-background",
  "--tbl-theme-odd-row-background",
  "--tbl-theme-border-color",
  "--tbl-theme-border-hover-color",
  "--tbl-theme-border-active-color",
  "--tbl-theme-outline-color",
  "--tbl-theme-text-color",
  "--tbl-theme-menu-border-color",
  "--tbl-theme-menu-background",
  "--tbl-theme-menu-hover-background",
  "--tbl-theme-menu-text-color",
  "--tbl-theme-menu-hover-text-color",
  "--tbl-theme-select-all-focus-overlay",
  "--tbl-theme-select-all-blur-overlay"
];
class At {
  /**
   * Basic light theme that works well with the CodeMirror default theme.
   */
  static light = At.of({
    "--tbl-theme-row-background": "#ffffff",
    "--tbl-theme-header-row-background": "var(--tbl-theme-row-background)",
    "--tbl-theme-even-row-background": "var(--tbl-theme-row-background)",
    "--tbl-theme-odd-row-background": "var(--tbl-theme-row-background)",
    "--tbl-theme-border-color": "#dcdcdc",
    "--tbl-theme-border-hover-color": "color-mix(in srgb, var(--tbl-theme-border-color), #000000 10%)",
    "--tbl-theme-border-active-color": "color-mix(in srgb, var(--tbl-theme-border-color), #000000 20%)",
    "--tbl-theme-outline-color": "#2483e2",
    "--tbl-theme-text-color": "inherit",
    "--tbl-theme-menu-border-color": "var(--tbl-theme-border-color)",
    "--tbl-theme-menu-background": "var(--tbl-theme-header-row-background)",
    "--tbl-theme-menu-hover-background": "var(--tbl-theme-outline-color)",
    "--tbl-theme-menu-text-color": "#000000",
    "--tbl-theme-menu-hover-text-color": "#ffffff",
    "--tbl-theme-select-all-focus-overlay": "rgb(20 2 167 / 17%)",
    "--tbl-theme-select-all-blur-overlay": "rgb(2 2 2 / 15%)"
  });
  /**
   * Basic dark theme.
   */
  static dark = At.of({
    "--tbl-theme-row-background": "#1d2024",
    "--tbl-theme-header-row-background": "var(--tbl-theme-row-background)",
    "--tbl-theme-even-row-background": "var(--tbl-theme-row-background)",
    "--tbl-theme-odd-row-background": "var(--tbl-theme-row-background)",
    "--tbl-theme-border-color": "#464646",
    "--tbl-theme-border-hover-color": "color-mix(in srgb, var(--tbl-theme-border-color), #708499 25%)",
    "--tbl-theme-border-active-color": "color-mix(in srgb, var(--tbl-theme-border-color), #708499 65%)",
    "--tbl-theme-outline-color": "#2483e2",
    "--tbl-theme-text-color": "inherit",
    "--tbl-theme-menu-border-color": "var(--tbl-theme-border-color)",
    "--tbl-theme-menu-background": "color-mix(in srgb, var(--tbl-theme-header-row-background), #ffffff 5%)",
    "--tbl-theme-menu-hover-background": "var(--tbl-theme-outline-color)",
    "--tbl-theme-menu-text-color": "color-mix(in srgb, var(--tbl-theme-header-row-background), #ffffff 90%)",
    "--tbl-theme-menu-hover-text-color": "var(--tbl-theme-menu-text-color)",
    "--tbl-theme-select-all-focus-overlay": "rgb(252 246 239 / 35%)",
    "--tbl-theme-select-all-blur-overlay": "rgb(246 232 214 / 18%)"
  });
  // noinspection JSUnusedGlobalSymbols -- Exported by package
  /**
   * Theme based on table colors in GitHub's light theme.
   */
  static githubLight = At.light.with({
    "--tbl-theme-header-row-background": "#ffffff",
    "--tbl-theme-even-row-background": "#ffffff",
    "--tbl-theme-odd-row-background": "#f6f8fa",
    "--tbl-theme-border-color": "#d1d9e0",
    "--tbl-theme-menu-text-color": "color-mix(in srgb, var(--tbl-theme-header-row-background), #000000 90%)"
  });
  // noinspection JSUnusedGlobalSymbols -- Exported by package
  /**
   * Theme based on table colors in GitHub's dark theme.
   */
  static githubDark = At.dark.with({
    "--tbl-theme-header-row-background": "#0d1117",
    "--tbl-theme-even-row-background": "#0d1117",
    "--tbl-theme-odd-row-background": "#151b23",
    "--tbl-theme-border-color": "#3d444d",
    "--tbl-theme-select-all-focus-overlay": "rgb(254 248 238 / 39%)",
    "--tbl-theme-select-all-blur-overlay": "rgb(252 239 219 / 23%)"
  });
  // noinspection JSUnusedGlobalSymbols -- Exported by package
  /**
   * Theme based on table colors in GitHub's soft dark theme.
   */
  static githubSoftDark = At.dark.with({
    "--tbl-theme-header-row-background": "#212830",
    "--tbl-theme-even-row-background": "#212830",
    "--tbl-theme-odd-row-background": "#262c36",
    "--tbl-theme-border-color": "#3d444d",
    "--tbl-theme-select-all-focus-overlay": "rgb(251 237 222 / 34%)",
    "--tbl-theme-select-all-blur-overlay": "rgb(252 215 173 / 16%)"
  });
  /**
   * Dark theme that works well with
   * [`@codemirror/theme-one-dark`](https://github.com/codemirror/theme-one-dark).
   */
  static oneDark = At.dark.with({
    "--tbl-theme-row-background": "#282c34",
    "--tbl-theme-border-color": "#3b4048",
    "--tbl-theme-outline-color": "#568af2",
    "--tbl-theme-menu-background": "#21252b",
    "--tbl-theme-menu-hover-background": "#2c313a",
    "--tbl-theme-menu-text-color": "#abb2bf",
    "--tbl-theme-select-all-focus-overlay": "rgb(187 204 245 / 15%)",
    "--tbl-theme-select-all-blur-overlay": "rgb(187 204 245 / 15%)"
  });
  /**
   * Properties that define the CSS color scheme.
   */
  props;
  /**
   * Returns a copy of this {@link TableTheme} with the given {@link props} applied.
   *
   * @param props - The optional property changes to apply to the copy.
   * If specified, props override properties in the original {@link TableTheme}.
   * Properties that are set to `undefined` or omitted use the original values.
   *
   * @example
   * ```typescript
   * const customDarkTheme = TableTheme.dark.with({
   *   "--tbl-theme-header-row-background": "gray",
   *   "--tbl-theme-outline-color": "green",
   * })
   * ```
   */
  with(t) {
    return _(t) ? At.of({ ...this.props }) : At.of({
      ...this.props,
      ...Sr(_r(t, Qs))
    });
  }
  static of(t) {
    return new At(t);
  }
  constructor(t) {
    this.props = t;
  }
}
function yr(e) {
  return {
    theme: e?.theme ?? { light: At.light, dark: At.dark },
    style: e?.style ?? Pe.default,
    selectionType: e?.selectionType ?? "codemirror",
    handlePosition: e?.handlePosition ?? "outside",
    lineWrapping: e?.lineWrapping ?? "wrap",
    markdownConfig: {
      extensions: e?.markdownConfig?.extensions ?? void 0,
      completeHTMLTags: e?.markdownConfig?.completeHTMLTags ?? void 0,
      pasteURLAsLink: e?.markdownConfig?.pasteURLAsLink ?? void 0,
      htmlTagLanguage: e?.markdownConfig?.htmlTagLanguage ?? void 0
    },
    extensions: e?.extensions ?? [],
    globalKeyBindings: e?.globalKeyBindings ?? []
  };
}
function Er(e) {
  return e.ranges.length === 1;
}
function $n(e) {
  return Er(e) && e.main.empty;
}
function ta({
  pos: e,
  assoc: t,
  bidiLevel: n,
  goalColumn: o
}) {
  return Fn.create([
    Fn.cursor(e, t, n, o)
  ]);
}
function $(e, { start: t, endExclusive: n }) {
}
function we({ start: e, endExclusive: t }, { within: n } = {}) {
}
function vn(e) {
  we(
    { start: e.span.from, endExclusive: e.span.to },
    { within: { endExclusive: e.doc.length } }
  );
  const t = ea(e), n = na(e), o = [];
  return b(t) && o.push({ from: t.at, insert: t.insert }), b(n) && o.push({ from: n.at, insert: n.insert }), { before: t, after: n, changes: o };
}
function ea({
  doc: e,
  span: { from: t },
  lineBreak: n
}) {
  let o;
  if (t === 0)
    o = 1;
  else if (t === 1)
    o = e.sliceString(t - 1, t) === n ? 0 : 2;
  else {
    const r = e.sliceString(t - 1, t), l = e.sliceString(t - 2, t - 1);
    r === n ? o = l === n ? 0 : 1 : o = 2;
  }
  return o === 0 ? void 0 : { at: t === 0 ? 0 : t - 1, insert: n.repeat(o), count: o };
}
function na({
  doc: e,
  span: { to: t },
  lineBreak: n
}) {
  let o;
  if (t === e.length)
    o = 1;
  else if (t === e.length - 1)
    o = e.sliceString(t, t + 1) === n ? 0 : 2;
  else {
    const r = e.sliceString(t, t + 1), l = e.sliceString(t + 1, t + 2);
    r === n ? o = l === n ? 0 : 1 : o = 2;
  }
  return o === 0 ? void 0 : { at: t === e.length ? e.length : t + 1, insert: n.repeat(o), count: o };
}
const oa = [
  "ATXHeading",
  "Blockquote",
  "BulletList",
  "FencedCode",
  "HTMLBlock",
  "HorizontalRule",
  "IndentedCode",
  "LinkReference",
  "OrderedList",
  "SetextHeading"
], ia = { remove: oa }, Rr = [ia];
function ra() {
  return Yo({
    extensions: Rr,
    completeHTMLTags: !1,
    addKeymap: !1
  }).language.parser;
}
function la() {
  return Yo({ extensions: Fs, completeHTMLTags: !1, addKeymap: !1 }).language.parser;
}
function se({ start: e, endExclusive: t }) {
  return Iterator.from(
    e <= t ? {
      *[Symbol.iterator]() {
        for (let n = e; n < t; n++)
          yield n;
      }
    } : {
      *[Symbol.iterator]() {
        for (let n = e; n > t; n--)
          yield n;
      }
    }
  );
}
function Un(e, t) {
  const n = new Array(e);
  for (let o = 0; o < e; o++)
    n[o] = t(o);
  return n;
}
function Me(e, t) {
  for (let n = 0; n < e; n++)
    t(n);
}
function De(e, t) {
  return se(e).map((n) => t(n)).toArray();
}
function Vt(e, t) {
  return se(e).forEach((n) => t(n));
}
const Vn = at.of(["", ""]);
function sa(e, {
  text: t,
  at: n,
  prependNewline: o = !1,
  appendNewline: i = !1
}) {
  return fa({
    needle: eo(t, { prependNewline: o, appendNewline: i }),
    haystack: e,
    at: n
  });
}
function aa(e, {
  text: t,
  prependNewline: n = !1,
  appendNewline: o = !1
}) {
  return e.append(eo(t, { prependNewline: n, appendNewline: o }));
}
function ca(e, {
  location: t,
  removeLeadingNewline: n = !1,
  removeTrailingNewline: o = !1
}) {
  const i = n ? t.from - 1 : t.from, r = o ? t.to + 1 : t.to;
  return i === r ? e : e.replace(i, r, at.empty);
}
function ha(e, {
  span: { from: t, to: n },
  text: o,
  prependNewline: i = !1,
  appendNewline: r = !1
}) {
  return e.replace(t, n, eo(o, { prependNewline: i, appendNewline: r }));
}
function dt(e) {
  return at.of([e]);
}
function ua(e) {
  return e.eq(at.empty);
}
function da(e, t) {
  const n = e.lines;
  if (n === 1) {
    t(e, 1);
    return;
  }
  Me(n, (o) => {
    const i = e.line(o + 1);
    t(e.slice(i.from, i.to), o + 1);
  });
}
function Co(e, { from: t, to: n }) {
  return e.slice(t, n);
}
function xo(e, t) {
  if (t === 0) return at.empty;
  if (t === 1) return e;
  let n = e;
  return Me(t - 1, () => {
    n = n.append(e);
  }), n;
}
function fa({
  needle: e,
  haystack: t,
  at: n
}) {
  return t.slice(0, n).append(e).append(t.slice(n));
}
function eo(e, {
  prependNewline: t = !1,
  appendNewline: n = !1
}) {
  let o = e;
  return t && (o = Vn.append(o)), n && (o = o.append(Vn)), o;
}
function ma(e) {
  return e.name === "Document";
}
function qn(e) {
  return e.firstChild(), e;
}
function pa(e) {
  return e.nextSibling(), e;
}
function va(e, t) {
  const n = [];
  for (; e.nextSibling(); )
    n.push(t(e));
  return n;
}
function ba(e, t) {
  const n = e.cursor();
  for (let o = n.next(!0); o; o = n.next(ma(n)))
    t(n);
}
function Ar(e) {
  return e.name === "Table";
}
function ga(e) {
  return e.name === "TableDelimiter";
}
function wa(e) {
  return e[0];
}
function Ca(e) {
  return e[e.length - 1];
}
function xa(e, t) {
  for (const n of e)
    t(n);
  return e;
}
function Li(e, t) {
  const n = [];
  for (const o of e) {
    const i = [];
    for (const r of o)
      i.push(t(r));
    n.push(i);
  }
  return n;
}
function Sa(e, t) {
  return e.length < t.min ? e.toSpliced(
    e.length,
    0,
    ...pn.repeat(t.min - e.length, t.fillWith)
  ) : e.length > t.max ? e.toSpliced(t.max, e.length - t.max) : [...e];
}
function Oi(e, { start: t, endExclusive: n } = { start: 0, endExclusive: e.length }) {
  we(
    { start: t, endExclusive: n },
    { within: { endExclusive: e.length } }
  );
  let o = 0;
  for (let i = t; i < n; i++)
    o += e[i];
  return o;
}
function So(e, { start: t, endExclusive: n } = { start: 0, endExclusive: e.length }) {
  return we(
    { start: t, endExclusive: n },
    { within: { endExclusive: e.length } }
  ), e.slice(t, n);
}
function _a(e) {
  if (e.length === 0) return [];
  const t = new Array(e.length);
  t[0] = e[0];
  for (let n = 1; n < e.length; n++)
    t[n] = t[n - 1] + e[n];
  return t;
}
function _o(e) {
  return e.length === 0 ? void 0 : e;
}
function ya(e, t) {
  let n = e[0];
  for (let o = 1; o < e.length; o++)
    t(e[o], n) < 0 && (n = e[o]);
  return n;
}
function He(e, { count: t }) {
  return pn.repeat(t, e);
}
function Di(e, { rows: t, cols: n }) {
  const o = [];
  for (let i = 0; i < t; i++)
    o.push(pn.repeat(n, e));
  return o;
}
function Tn(e, t) {
  if (t === 0) return [];
  if (t === 1) return [...e];
  const n = new Array(t * e.length);
  for (let o = 0; o < t; o++) {
    const i = o * e.length;
    for (let r = 0; r < e.length; r++)
      n[i + r] = e[r];
  }
  return n;
}
function Ea(e) {
  return e.filter((t) => b(t));
}
function no(e) {
  return e.length === 0;
}
function Ra(e) {
  return pn.tailOrEmpty(e);
}
function Ii(e) {
  return { start: 0, endExclusive: e.length };
}
function Ie(e, { fromIndex: t, toIndex: n }) {
  if ($(t, Ii(e)), $(n, Ii(e)), t === n) return;
  const o = e[t];
  if (t < n)
    for (let i = t; i < n; i++)
      e[i] = e[i + 1];
  else
    for (let i = t; i > n; i--)
      e[i] = e[i - 1];
  e[n] = o;
}
function ie(e, t, n) {
  return _(e) || _(t) ? e === t : pn.eq(e, t, n);
}
function Aa(e, t, n) {
  return e.some((o) => n(o, t));
}
function ft(e, { min: t, max: n }) {
  return b(t) && b(n), b(t) && e <= t ? t : b(n) && e >= n ? n : e;
}
const ko = Math.abs, Ta = Math.ceil, Pi = Math.floor, Xo = Math.max, Wn = Math.min, ka = Math.round, za = Math.trunc, Mi = globalThis.parseInt;
wr.isEmpty;
const Tr = wr.repeat;
function La(e) {
  return e === "" ? void 0 : e;
}
const Oa = new RegExp(new RegExp("(?<!\\\\)(\\\\\\\\)*\\|", "g")), Da = [
  new RegExp(/^(\s|<br>)+/g),
  new RegExp(new RegExp("(?<=^\\u0000)(\\s|<br>)+", "g")),
  new RegExp(new RegExp("(?<=^\\u0000\\u0000)(\\s|<br>)+", "g"))
], Ia = [
  new RegExp(/(\s|<br>)+$/g),
  new RegExp(/(\s|<br>)+(?=\u0000$)/g),
  new RegExp(/(\s|<br>)+(?=\u0000\u0000$)/g)
], Pa = new RegExp(/\r\n|\n|\r/g);
function Go(e, t) {
  return dt(Ma(e.toString(), t));
}
function jn(e) {
  return at.of(Ha(e.toString()).split(`
`));
}
function Ma(e, { trim: t }) {
  return (t ? Ba(e) : e).replaceAll(Pa, "<br>").replaceAll(Oa, "\\$&");
}
function Ha(e) {
  return e.replaceAll("<br>", `
`).replaceAll("\\|", "|");
}
function Ba(e) {
  let t = e;
  for (const n of Da)
    t = t.replaceAll(n, "");
  for (const n of Ia)
    t = t.replaceAll(n, "");
  return t;
}
const Kn = "|", kr = " ", zr = " ", Na = 1, Fa = 1, $a = /* @__PURE__ */ new Map([
  ["none", 1],
  ["left", 2],
  ["center", 3],
  ["right", 2]
]), Ua = /* @__PURE__ */ new Map([
  ["none", ""],
  ["left", ":"],
  ["center", ":"],
  ["right", ""]
]), Va = /* @__PURE__ */ new Map([
  ["none", ""],
  ["left", ""],
  ["center", ":"],
  ["right", ":"]
]);
function Lr(e, t) {
  t.length;
  const n = Li(
    e,
    (w) => Go(w, { trim: !0 })
  ).map((w) => w.map((p) => p.toString())), o = wa(n), i = Ra(n), r = n.length, l = o.length, a = Un(
    l,
    (w) => Un(r, (p) => n[p][w])
  ).map((w, p) => Ga(w, t[p])), c = Hi(o, a), h = qa(t, a), d = i.map((w) => Hi(w, a)), u = at.of([c, h, ...d]), m = a.map((w) => Na + w + Fa), v = Li(n, (w) => w.length);
  return { text: u, colSizes: m, alignments: [...t], contentSizes: v };
}
function Hi(e, t) {
  const n = [Kn];
  return e.forEach((o, i) => {
    n.push(kr, o, Wa(t[i] - o.length), zr, Kn);
  }), n.join("");
}
function qa(e, t) {
  const n = [Kn];
  return e.forEach((o, i) => {
    const r = Ya(o), l = Xa(o), s = ja(t[i] - r.length - l.length);
    n.push(kr, r, s, l, zr, Kn);
  }), n.join("");
}
function Wa(e) {
  return Tr(" ", e);
}
function ja(e) {
  return Tr("-", e);
}
function Ka(e) {
  return $a.get(e);
}
function Ya(e) {
  return Ua.get(e);
}
function Xa(e) {
  return Va.get(e);
}
function Ga(e, t) {
  return Xo(Ka(t), ...e.map((n) => n.length));
}
const Or = la();
function zo(e) {
  const t = Or.parse(new Ko(e));
  if (!Pr(t)) throw new Error("Text is not a table");
  return Ir(e, t);
}
function Dr(e) {
  const t = Or.parse(new Ko(e));
  if (Pr(t))
    return Ir(e, t);
}
function Ir(e, t) {
  const n = t.cursor(), o = qn(n), i = qn(o), r = Bi(i).map(
    (v) => Co(e, v)
  ), l = r.length, s = pa(i), a = Ja(Co(e, s)), c = va(
    s,
    (v) => Sa(
      Bi(v).map((w) => Co(e, w)),
      { min: l, max: l, fillWith: at.empty }
    )
  ), h = [r, ...c], { text: d, colSizes: u, contentSizes: m } = Lr(h, a);
  return { text: d, colSizes: u, alignments: a, contentSizes: m };
}
function Bi(e) {
  const t = e;
  e.firstChild();
  const n = t, o = [];
  let i;
  do {
    const { from: r, to: l } = n;
    if (ga(n)) {
      i === "delimiter" && o.push({ from: r, to: r }), i = "delimiter";
      continue;
    }
    i = "cell", o.push({ from: r, to: l });
  } while (n.nextSibling());
  return n.parent(), o;
}
function Ja(e) {
  const t = e.toString().split("|"), n = [];
  for (const o of t) {
    if (!o.includes("-")) continue;
    const i = o.includes(":-"), r = o.includes("-:");
    i ? r ? n.push("center") : n.push("left") : r ? n.push("right") : n.push("none");
  }
  return n;
}
function Pr(e) {
  const t = e.cursor(), n = qn(t);
  return Ar(n) && !n.nextSibling();
}
const Za = (e, { selection: t, doc: n, lineBreak: o }) => {
  if (!Er(t)) return e;
  const i = Dr(at.of(e.split(/\r\n|\n|\r/)));
  if (_(i)) return e;
  const { from: r, to: l } = t.main, { before: s, after: a } = vn({ doc: n, lineBreak: o, span: { from: r, to: l } });
  return `${s?.insert ?? ""}${i.text.toString()}${a?.insert ?? ""}`;
}, Qa = {
  combine: (e) => no(e) ? yr() : Ca(e)
}, Lo = ks.define(Qa);
function oo(e) {
  return !e.matchMedia("(any-hover: none)").matches;
}
function tc(e) {
  return /Mac|iPod|iPhone|iPad/.test(e.navigator.platform) ? "metaKey" : "ctrlKey";
}
function Mr(e, t) {
  return e?.from === t?.from && e?.to === t?.to;
}
function Ni({ needle: e, haystack: t }) {
  const n = e.from <= e.to ? e : { from: e.to, to: e.from }, o = t.from <= t.to ? t : { from: t.to, to: t.from };
  return n.from >= o.from && n.to <= o.to;
}
const ec = 1, nc = 2, Hr = 4, oc = 8, ic = 16, rc = 1, lc = 2, sc = 4, ac = 8, cc = 16, hc = 1, uc = 2, st = /* @__PURE__ */ Symbol(), Br = "http://www.w3.org/1999/xhtml", Oo = !1;
var Jo = Array.isArray, dc = Array.prototype.indexOf, Ue = Array.prototype.includes, io = Array.from, fc = Object.defineProperty, Ne = Object.getOwnPropertyDescriptor, mc = Object.getOwnPropertyDescriptors, Nr = Object.prototype, pc = Array.prototype, Zo = Object.getPrototypeOf, Fi = Object.isExtensible;
const Fr = () => {
};
function vc(e) {
  for (var t = 0; t < e.length; t++)
    e[t]();
}
function $r() {
  var e, t, n = new Promise((o, i) => {
    e = o, t = i;
  });
  return { promise: n, resolve: e, reject: t };
}
const ct = 2, cn = 4, bn = 8, Ur = 1 << 24, te = 16, $t = 32, fe = 64, Do = 128, zt = 512, ot = 1024, ht = 2048, Ft = 4096, Et = 8192, Gt = 16384, gn = 32768, Ee = 65536, $i = 1 << 17, Vr = 1 << 18, Le = 1 << 19, qr = 1 << 20, Xt = 1 << 25, Re = 65536, Io = 1 << 21, Qo = 1 << 22, ae = 1 << 23, sn = /* @__PURE__ */ Symbol("$state"), bc = /* @__PURE__ */ Symbol("legacy props"), gc = /* @__PURE__ */ Symbol(""), Ce = new class extends Error {
  name = "StaleReactionError";
  message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}();
function Wr(e) {
  throw new Error("https://svelte.dev/e/lifecycle_outside_component");
}
function wc() {
  throw new Error("https://svelte.dev/e/async_derived_orphan");
}
function Cc(e, t, n) {
  throw new Error("https://svelte.dev/e/each_key_duplicate");
}
function xc(e) {
  throw new Error("https://svelte.dev/e/effect_in_teardown");
}
function Sc() {
  throw new Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function _c(e) {
  throw new Error("https://svelte.dev/e/effect_orphan");
}
function yc() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function Ec(e) {
  throw new Error("https://svelte.dev/e/props_invalid_value");
}
function Rc() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function Ac() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function Tc() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
function kc() {
  throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
function zc() {
  console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
function jr(e) {
  return e === this.v;
}
function Lc(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function Kr(e) {
  return !Lc(e, this.v);
}
let Ye = !1, Oc = !1;
function Dc() {
  Ye = !0;
}
const Ic = [];
function yo(e, t = !1, n = !1) {
  return Hn(e, /* @__PURE__ */ new Map(), "", Ic, null, n);
}
function Hn(e, t, n, o, i = null, r = !1) {
  if (typeof e == "object" && e !== null) {
    var l = t.get(e);
    if (l !== void 0) return l;
    if (e instanceof Map) return (
      /** @type {Snapshot<T>} */
      new Map(e)
    );
    if (e instanceof Set) return (
      /** @type {Snapshot<T>} */
      new Set(e)
    );
    if (Jo(e)) {
      var s = (
        /** @type {Snapshot<any>} */
        Array(e.length)
      );
      t.set(e, s), i !== null && t.set(i, s);
      for (var a = 0; a < e.length; a += 1) {
        var c = e[a];
        a in e && (s[a] = Hn(c, t, n, o, null, r));
      }
      return s;
    }
    if (Zo(e) === Nr) {
      s = {}, t.set(e, s), i !== null && t.set(i, s);
      for (var h in e)
        s[h] = Hn(
          // @ts-expect-error
          e[h],
          t,
          n,
          o,
          null,
          r
        );
      return s;
    }
    if (e instanceof Date)
      return (
        /** @type {Snapshot<T>} */
        structuredClone(e)
      );
    if (typeof /** @type {T & { toJSON?: any } } */
    e.toJSON == "function" && !r)
      return Hn(
        /** @type {T & { toJSON(): any } } */
        e.toJSON(),
        t,
        n,
        o,
        // Associate the instance with the toJSON clone
        e
      );
  }
  if (e instanceof EventTarget)
    return (
      /** @type {Snapshot<T>} */
      e
    );
  try {
    return (
      /** @type {Snapshot<T>} */
      structuredClone(e)
    );
  } catch {
    return (
      /** @type {Snapshot<T>} */
      e
    );
  }
}
let X = null;
function Ve(e) {
  X = e;
}
function Pc() {
  return Mc();
}
function me(e, t = !1, n) {
  X = {
    p: X,
    i: !1,
    c: null,
    e: null,
    s: e,
    x: null,
    l: Ye && !t ? { s: null, u: null, $: [] } : null
  };
}
function pe(e) {
  var t = (
    /** @type {ComponentContext} */
    X
  ), n = t.e;
  if (n !== null) {
    t.e = null;
    for (var o of n)
      ul(o);
  }
  return t.i = !0, X = t.p, /** @type {T} */
  {};
}
function wn() {
  return !Ye || X !== null && X.l === null;
}
function Mc(e) {
  return X === null && Wr(), X.c ??= new Map(Hc(X) || void 0);
}
function Hc(e) {
  let t = e.p;
  for (; t !== null; ) {
    const n = t.c;
    if (n !== null)
      return n;
    t = t.p;
  }
  return null;
}
let Be = [];
function Bc() {
  var e = Be;
  Be = [], vc(e);
}
function Jt(e) {
  if (Be.length === 0) {
    var t = Be;
    queueMicrotask(() => {
      t === Be && Bc();
    });
  }
  Be.push(e);
}
function Yr(e) {
  var t = I;
  if (t === null)
    return L.f |= ae, e;
  if ((t.f & gn) === 0 && (t.f & cn) === 0)
    throw e;
  qe(e, t);
}
function qe(e, t) {
  for (; t !== null; ) {
    if ((t.f & Do) !== 0) {
      if ((t.f & gn) === 0)
        throw e;
      try {
        t.b.error(e);
        return;
      } catch (n) {
        e = n;
      }
    }
    t = t.parent;
  }
  throw e;
}
const Nc = -7169;
function Q(e, t) {
  e.f = e.f & Nc | t;
}
function ti(e) {
  (e.f & zt) !== 0 || e.deps === null ? Q(e, ot) : Q(e, Ft);
}
function Xr(e) {
  if (e !== null)
    for (const t of e)
      (t.f & ct) === 0 || (t.f & Re) === 0 || (t.f ^= Re, Xr(
        /** @type {Derived} */
        t.deps
      ));
}
function Gr(e, t, n) {
  (e.f & ht) !== 0 ? t.add(e) : (e.f & Ft) !== 0 && n.add(e), Xr(e.deps), Q(e, ot);
}
const kn = /* @__PURE__ */ new Set();
let Y = null, Ht = null, kt = [], ei = null, Po = !1;
class Zt {
  committed = !1;
  /**
   * The current values of any sources that are updated in this batch
   * They keys of this map are identical to `this.#previous`
   * @type {Map<Source, any>}
   */
  current = /* @__PURE__ */ new Map();
  /**
   * The values of any sources that are updated in this batch _before_ those updates took place.
   * They keys of this map are identical to `this.#current`
   * @type {Map<Source, any>}
   */
  previous = /* @__PURE__ */ new Map();
  /**
   * When the batch is committed (and the DOM is updated), we need to remove old branches
   * and append new ones by calling the functions added inside (if/each/key/etc) blocks
   * @type {Set<() => void>}
   */
  #t = /* @__PURE__ */ new Set();
  /**
   * If a fork is discarded, we need to destroy any effects that are no longer needed
   * @type {Set<(batch: Batch) => void>}
   */
  #n = /* @__PURE__ */ new Set();
  /**
   * The number of async effects that are currently in flight
   */
  #e = 0;
  /**
   * The number of async effects that are currently in flight, _not_ inside a pending boundary
   */
  #o = 0;
  /**
   * A deferred that resolves when the batch is committed, used with `settled()`
   * TODO replace with Promise.withResolvers once supported widely enough
   * @type {{ promise: Promise<void>, resolve: (value?: any) => void, reject: (reason: unknown) => void } | null}
   */
  #i = null;
  /**
   * Deferred effects (which run after async work has completed) that are DIRTY
   * @type {Set<Effect>}
   */
  #s = /* @__PURE__ */ new Set();
  /**
   * Deferred effects that are MAYBE_DIRTY
   * @type {Set<Effect>}
   */
  #r = /* @__PURE__ */ new Set();
  /**
   * A map of branches that still exist, but will be destroyed when this batch
   * is committed — we skip over these during `process`.
   * The value contains child effects that were dirty/maybe_dirty before being reset,
   * so they can be rescheduled if the branch survives.
   * @type {Map<Effect, { d: Effect[], m: Effect[] }>}
   */
  #l = /* @__PURE__ */ new Map();
  is_fork = !1;
  #a = !1;
  is_deferred() {
    return this.is_fork || this.#o > 0;
  }
  /**
   * Add an effect to the #skipped_branches map and reset its children
   * @param {Effect} effect
   */
  skip_effect(t) {
    this.#l.has(t) || this.#l.set(t, { d: [], m: [] });
  }
  /**
   * Remove an effect from the #skipped_branches map and reschedule
   * any tracked dirty/maybe_dirty child effects
   * @param {Effect} effect
   */
  unskip_effect(t) {
    var n = this.#l.get(t);
    if (n) {
      this.#l.delete(t);
      for (var o of n.d)
        Q(o, ht), Bt(o);
      for (o of n.m)
        Q(o, Ft), Bt(o);
    }
  }
  /**
   *
   * @param {Effect[]} root_effects
   */
  process(t) {
    kt = [], this.apply();
    var n = [], o = [];
    for (const i of t)
      this.#h(i, n, o);
    if (this.is_deferred()) {
      this.#c(o), this.#c(n);
      for (const [i, r] of this.#l)
        Qr(i, r);
    } else {
      for (const i of this.#t) i();
      this.#t.clear(), this.#e === 0 && this.#d(), Y = null, Ui(o), Ui(n), this.#i?.resolve();
    }
    Ht = null;
  }
  /**
   * Traverse the effect tree, executing effects or stashing
   * them for later execution as appropriate
   * @param {Effect} root
   * @param {Effect[]} effects
   * @param {Effect[]} render_effects
   */
  #h(t, n, o) {
    t.f ^= ot;
    for (var i = t.first, r = null; i !== null; ) {
      var l = i.f, s = (l & ($t | fe)) !== 0, a = s && (l & ot) !== 0, c = a || (l & Et) !== 0 || this.#l.has(i);
      if (!c && i.fn !== null) {
        s ? i.f ^= ot : r !== null && (l & (cn | bn | Ur)) !== 0 ? r.b.defer_effect(i) : (l & cn) !== 0 ? n.push(i) : xn(i) && ((l & te) !== 0 && this.#r.add(i), je(i));
        var h = i.first;
        if (h !== null) {
          i = h;
          continue;
        }
      }
      for (; i !== null; ) {
        i === r && (r = null);
        var d = i.next;
        if (d !== null) {
          i = d;
          break;
        }
        i = i.parent;
      }
    }
  }
  /**
   * @param {Effect[]} effects
   */
  #c(t) {
    for (var n = 0; n < t.length; n += 1)
      Gr(t[n], this.#s, this.#r);
  }
  /**
   * Associate a change to a given source with the current
   * batch, noting its previous and current values
   * @param {Source} source
   * @param {any} value
   */
  capture(t, n) {
    n !== st && !this.previous.has(t) && this.previous.set(t, n), (t.f & ae) === 0 && (this.current.set(t, t.v), Ht?.set(t, t.v));
  }
  activate() {
    Y = this, this.apply();
  }
  deactivate() {
    Y === this && (Y = null, Ht = null);
  }
  flush() {
    if (this.activate(), kt.length > 0) {
      if (Fc(), Y !== null && Y !== this)
        return;
    } else this.#e === 0 && this.process([]);
    this.deactivate();
  }
  discard() {
    for (const t of this.#n) t(this);
    this.#n.clear();
  }
  #d() {
    if (kn.size > 1) {
      this.previous.clear();
      var t = Ht, n = !0;
      for (const i of kn) {
        if (i === this) {
          n = !1;
          continue;
        }
        const r = [];
        for (const [s, a] of this.current) {
          if (i.current.has(s))
            if (n && a !== i.current.get(s))
              i.current.set(s, a);
            else
              continue;
          r.push(s);
        }
        if (r.length === 0)
          continue;
        const l = [...i.current.keys()].filter((s) => !this.current.has(s));
        if (l.length > 0) {
          var o = kt;
          kt = [];
          const s = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Map();
          for (const c of r)
            Jr(c, l, s, a);
          if (kt.length > 0) {
            Y = i, i.apply();
            for (const c of kt)
              i.#h(c, [], []);
            i.deactivate();
          }
          kt = o;
        }
      }
      Y = null, Ht = t;
    }
    this.committed = !0, kn.delete(this);
  }
  /**
   *
   * @param {boolean} blocking
   */
  increment(t) {
    this.#e += 1, t && (this.#o += 1);
  }
  /**
   *
   * @param {boolean} blocking
   */
  decrement(t) {
    this.#e -= 1, t && (this.#o -= 1), !this.#a && (this.#a = !0, Jt(() => {
      this.#a = !1, this.is_deferred() ? kt.length > 0 && this.flush() : this.revive();
    }));
  }
  revive() {
    for (const t of this.#s)
      this.#r.delete(t), Q(t, ht), Bt(t);
    for (const t of this.#r)
      Q(t, Ft), Bt(t);
    this.flush();
  }
  /** @param {() => void} fn */
  oncommit(t) {
    this.#t.add(t);
  }
  /** @param {(batch: Batch) => void} fn */
  ondiscard(t) {
    this.#n.add(t);
  }
  settled() {
    return (this.#i ??= $r()).promise;
  }
  static ensure() {
    if (Y === null) {
      const t = Y = new Zt();
      kn.add(Y), Jt(() => {
        Y === t && t.flush();
      });
    }
    return Y;
  }
  apply() {
  }
}
function Fc() {
  Po = !0;
  var e = null;
  try {
    for (var t = 0; kt.length > 0; ) {
      var n = Zt.ensure();
      if (t++ > 1e3) {
        var o, i;
        $c();
      }
      n.process(kt), ce.clear();
    }
  } finally {
    kt = [], Po = !1, ei = null;
  }
}
function $c() {
  try {
    yc();
  } catch (e) {
    qe(e, ei);
  }
}
let Yt = null;
function Ui(e) {
  var t = e.length;
  if (t !== 0) {
    for (var n = 0; n < t; ) {
      var o = e[n++];
      if ((o.f & (Gt | Et)) === 0 && xn(o) && (Yt = /* @__PURE__ */ new Set(), je(o), o.deps === null && o.first === null && o.nodes === null && o.teardown === null && o.ac === null && pl(o), Yt?.size > 0)) {
        ce.clear();
        for (const i of Yt) {
          if ((i.f & (Gt | Et)) !== 0) continue;
          const r = [i];
          let l = i.parent;
          for (; l !== null; )
            Yt.has(l) && (Yt.delete(l), r.push(l)), l = l.parent;
          for (let s = r.length - 1; s >= 0; s--) {
            const a = r[s];
            (a.f & (Gt | Et)) === 0 && je(a);
          }
        }
        Yt.clear();
      }
    }
    Yt = null;
  }
}
function Jr(e, t, n, o) {
  if (!n.has(e) && (n.add(e), e.reactions !== null))
    for (const i of e.reactions) {
      const r = i.f;
      (r & ct) !== 0 ? Jr(
        /** @type {Derived} */
        i,
        t,
        n,
        o
      ) : (r & (Qo | te)) !== 0 && (r & ht) === 0 && Zr(i, t, o) && (Q(i, ht), Bt(
        /** @type {Effect} */
        i
      ));
    }
}
function Zr(e, t, n) {
  const o = n.get(e);
  if (o !== void 0) return o;
  if (e.deps !== null)
    for (const i of e.deps) {
      if (Ue.call(t, i))
        return !0;
      if ((i.f & ct) !== 0 && Zr(
        /** @type {Derived} */
        i,
        t,
        n
      ))
        return n.set(
          /** @type {Derived} */
          i,
          !0
        ), !0;
    }
  return n.set(e, !1), !1;
}
function Bt(e) {
  for (var t = ei = e; t.parent !== null; ) {
    t = t.parent;
    var n = t.f;
    if (Po && t === I && (n & te) !== 0 && (n & Vr) === 0)
      return;
    if ((n & (fe | $t)) !== 0) {
      if ((n & ot) === 0) return;
      t.f ^= ot;
    }
  }
  kt.push(t);
}
function Qr(e, t) {
  if (!((e.f & $t) !== 0 && (e.f & ot) !== 0)) {
    (e.f & ht) !== 0 ? t.d.push(e) : (e.f & Ft) !== 0 && t.m.push(e), Q(e, ot);
    for (var n = e.first; n !== null; )
      Qr(n, t), n = n.next;
  }
}
function tl(e) {
  let t = 0, n = Ae(0), o;
  return () => {
    ri() && (f(n), dl(() => (t === 0 && (o = Sn(() => e(() => an(n)))), t += 1, () => {
      Jt(() => {
        t -= 1, t === 0 && (o?.(), o = void 0, an(n));
      });
    })));
  };
}
var Uc = Ee | Le;
function Vc(e, t, n) {
  new qc(e, t, n);
}
class qc {
  /** @type {Boundary | null} */
  parent;
  is_pending = !1;
  /** @type {TemplateNode} */
  #t;
  /** @type {TemplateNode | null} */
  #n = null;
  /** @type {BoundaryProps} */
  #e;
  /** @type {((anchor: Node) => void)} */
  #o;
  /** @type {Effect} */
  #i;
  /** @type {Effect | null} */
  #s = null;
  /** @type {Effect | null} */
  #r = null;
  /** @type {Effect | null} */
  #l = null;
  /** @type {DocumentFragment | null} */
  #a = null;
  #h = 0;
  #c = 0;
  #d = !1;
  /** @type {Set<Effect>} */
  #f = /* @__PURE__ */ new Set();
  /** @type {Set<Effect>} */
  #m = /* @__PURE__ */ new Set();
  /**
   * A source containing the number of pending async deriveds/expressions.
   * Only created if `$effect.pending()` is used inside the boundary,
   * otherwise updating the source results in needless `Batch.ensure()`
   * calls followed by no-op flushes
   * @type {Source<number> | null}
   */
  #u = null;
  #g = tl(() => (this.#u = Ae(this.#h), () => {
    this.#u = null;
  }));
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   */
  constructor(t, n, o) {
    this.#t = t, this.#e = n, this.#o = (i) => {
      var r = (
        /** @type {Effect} */
        I
      );
      r.b = this, r.f |= Do, o(i);
    }, this.parent = /** @type {Effect} */
    I.b, this.#i = so(() => {
      this.#v();
    }, Uc);
  }
  #w() {
    try {
      this.#s = Mt(() => this.#o(this.#t));
    } catch (t) {
      this.error(t);
    }
  }
  #C() {
    const t = this.#e.pending;
    t && (this.is_pending = !0, this.#r = Mt(() => t(this.#t)), Jt(() => {
      var n = this.#a = document.createDocumentFragment(), o = Qt();
      n.append(o), this.#s = this.#p(() => (Zt.ensure(), Mt(() => this.#o(o)))), this.#c === 0 && (this.#t.before(n), this.#a = null, Se(
        /** @type {Effect} */
        this.#r,
        () => {
          this.#r = null;
        }
      ), this.is_pending = !1);
    }));
  }
  #v() {
    try {
      if (this.is_pending = this.has_pending_snippet(), this.#c = 0, this.#h = 0, this.#s = Mt(() => {
        this.#o(this.#t);
      }), this.#c > 0) {
        var t = this.#a = document.createDocumentFragment();
        gl(this.#s, t);
        const n = (
          /** @type {(anchor: Node) => void} */
          this.#e.pending
        );
        this.#r = Mt(() => n(this.#t));
      } else
        this.is_pending = !1;
    } catch (n) {
      this.error(n);
    }
  }
  /**
   * Defer an effect inside a pending boundary until the boundary resolves
   * @param {Effect} effect
   */
  defer_effect(t) {
    Gr(t, this.#f, this.#m);
  }
  /**
   * Returns `false` if the effect exists inside a boundary whose pending snippet is shown
   * @returns {boolean}
   */
  is_rendered() {
    return !this.is_pending && (!this.parent || this.parent.is_rendered());
  }
  has_pending_snippet() {
    return !!this.#e.pending;
  }
  /**
   * @template T
   * @param {() => T} fn
   */
  #p(t) {
    var n = I, o = L, i = X;
    Wt(this.#i), Dt(this.#i), Ve(this.#i.ctx);
    try {
      return t();
    } catch (r) {
      return Yr(r), null;
    } finally {
      Wt(n), Dt(o), Ve(i);
    }
  }
  /**
   * Updates the pending count associated with the currently visible pending snippet,
   * if any, such that we can replace the snippet with content once work is done
   * @param {1 | -1} d
   */
  #b(t) {
    if (!this.has_pending_snippet()) {
      this.parent && this.parent.#b(t);
      return;
    }
    if (this.#c += t, this.#c === 0) {
      this.is_pending = !1;
      for (const n of this.#f)
        Q(n, ht), Bt(n);
      for (const n of this.#m)
        Q(n, Ft), Bt(n);
      this.#f.clear(), this.#m.clear(), this.#r && Se(this.#r, () => {
        this.#r = null;
      }), this.#a && (this.#t.before(this.#a), this.#a = null);
    }
  }
  /**
   * Update the source that powers `$effect.pending()` inside this boundary,
   * and controls when the current `pending` snippet (if any) is removed.
   * Do not call from inside the class
   * @param {1 | -1} d
   */
  update_pending_count(t) {
    this.#b(t), this.#h += t, !(!this.#u || this.#d) && (this.#d = !0, Jt(() => {
      this.#d = !1, this.#u && We(this.#u, this.#h);
    }));
  }
  get_effect_pending() {
    return this.#g(), f(
      /** @type {Source<number>} */
      this.#u
    );
  }
  /** @param {unknown} error */
  error(t) {
    var n = this.#e.onerror;
    let o = this.#e.failed;
    if (!n && !o)
      throw t;
    this.#s && (vt(this.#s), this.#s = null), this.#r && (vt(this.#r), this.#r = null), this.#l && (vt(this.#l), this.#l = null);
    var i = !1, r = !1;
    const l = () => {
      if (i) {
        zc();
        return;
      }
      i = !0, r && kc(), this.#l !== null && Se(this.#l, () => {
        this.#l = null;
      }), this.#p(() => {
        Zt.ensure(), this.#v();
      });
    };
    Jt(() => {
      try {
        r = !0, n?.(t, l), r = !1;
      } catch (s) {
        qe(s, this.#i && this.#i.parent);
      }
      o && (this.#l = this.#p(() => {
        Zt.ensure();
        try {
          return Mt(() => {
            var s = (
              /** @type {Effect} */
              I
            );
            s.b = this, s.f |= Do, o(
              this.#t,
              () => t,
              () => l
            );
          });
        } catch (s) {
          return qe(
            s,
            /** @type {Effect} */
            this.#i.parent
          ), null;
        }
      }));
    });
  }
}
function Wc(e, t, n, o) {
  const i = wn() ? ro : ni;
  var r = e.filter((u) => !u.settled);
  if (n.length === 0 && r.length === 0) {
    o(t.map(i));
    return;
  }
  var l = Y, s = (
    /** @type {Effect} */
    I
  ), a = jc(), c = r.length === 1 ? r[0].promise : r.length > 1 ? Promise.all(r.map((u) => u.promise)) : null;
  function h(u) {
    a();
    try {
      o(u);
    } catch (m) {
      (s.f & Gt) === 0 && qe(m, s);
    }
    l?.deactivate(), Mo();
  }
  if (n.length === 0) {
    c.then(() => h(t.map(i)));
    return;
  }
  function d() {
    a(), Promise.all(n.map((u) => /* @__PURE__ */ Kc(u))).then((u) => h([...t.map(i), ...u])).catch((u) => qe(u, s));
  }
  c ? c.then(d) : d();
}
function jc() {
  var e = I, t = L, n = X, o = Y;
  return function(r = !0) {
    Wt(e), Dt(t), Ve(n), r && o?.activate();
  };
}
function Mo() {
  Wt(null), Dt(null), Ve(null);
}
// @__NO_SIDE_EFFECTS__
function ro(e) {
  var t = ct | ht, n = L !== null && (L.f & ct) !== 0 ? (
    /** @type {Derived} */
    L
  ) : null;
  return I !== null && (I.f |= Le), {
    ctx: X,
    deps: null,
    effects: null,
    equals: jr,
    f: t,
    fn: e,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      st
    ),
    wv: 0,
    parent: n ?? I,
    ac: null
  };
}
// @__NO_SIDE_EFFECTS__
function Kc(e, t, n) {
  let o = (
    /** @type {Effect | null} */
    I
  );
  o === null && wc();
  var i = (
    /** @type {Boundary} */
    o.b
  ), r = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  ), l = Ae(
    /** @type {V} */
    st
  ), s = !L, a = /* @__PURE__ */ new Map();
  return sh(() => {
    var c = $r();
    r = c.promise;
    try {
      Promise.resolve(e()).then(c.resolve, c.reject).then(() => {
        h === Y && h.committed && h.deactivate(), Mo();
      });
    } catch (m) {
      c.reject(m), Mo();
    }
    var h = (
      /** @type {Batch} */
      Y
    );
    if (s) {
      var d = i.is_rendered();
      i.update_pending_count(1), h.increment(d), a.get(h)?.reject(Ce), a.delete(h), a.set(h, c);
    }
    const u = (m, v = void 0) => {
      if (h.activate(), v)
        v !== Ce && (l.f |= ae, We(l, v));
      else {
        (l.f & ae) !== 0 && (l.f ^= ae), We(l, m);
        for (const [w, p] of a) {
          if (a.delete(w), w === h) break;
          p.reject(Ce);
        }
      }
      s && (i.update_pending_count(-1), h.decrement(d));
    };
    c.promise.then(u, (m) => u(null, m || "unknown"));
  }), hl(() => {
    for (const c of a.values())
      c.reject(Ce);
  }), new Promise((c) => {
    function h(d) {
      function u() {
        d === r ? c(l) : h(r);
      }
      d.then(u, u);
    }
    h(r);
  });
}
// @__NO_SIDE_EFFECTS__
function A(e) {
  const t = /* @__PURE__ */ ro(e);
  return wl(t), t;
}
// @__NO_SIDE_EFFECTS__
function ni(e) {
  const t = /* @__PURE__ */ ro(e);
  return t.equals = Kr, t;
}
function Yc(e) {
  var t = e.effects;
  if (t !== null) {
    e.effects = null;
    for (var n = 0; n < t.length; n += 1)
      vt(
        /** @type {Effect} */
        t[n]
      );
  }
}
function Xc(e) {
  for (var t = e.parent; t !== null; ) {
    if ((t.f & ct) === 0)
      return (t.f & Gt) === 0 ? (
        /** @type {Effect} */
        t
      ) : null;
    t = t.parent;
  }
  return null;
}
function oi(e) {
  var t, n = I;
  Wt(Xc(e));
  try {
    e.f &= ~Re, Yc(e), t = _l(e);
  } finally {
    Wt(n);
  }
  return t;
}
function el(e) {
  var t = oi(e);
  if (!e.equals(t) && (e.wv = xl(), (!Y?.is_fork || e.deps === null) && (e.v = t, e.deps === null))) {
    Q(e, ot);
    return;
  }
  ue || (Ht !== null ? (ri() || Y?.is_fork) && Ht.set(e, t) : ti(e));
}
function Gc(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      (t.teardown || t.ac) && (t.teardown?.(), t.ac?.abort(Ce), t.teardown = Fr, t.ac = null, hn(t, 0), li(t));
}
function nl(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      t.teardown && je(t);
}
let Ho = /* @__PURE__ */ new Set();
const ce = /* @__PURE__ */ new Map();
let ol = !1;
function Ae(e, t) {
  var n = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v: e,
    reactions: null,
    equals: jr,
    rv: 0,
    wv: 0
  };
  return n;
}
// @__NO_SIDE_EFFECTS__
function M(e, t) {
  const n = Ae(e);
  return wl(n), n;
}
// @__NO_SIDE_EFFECTS__
function Jc(e, t = !1, n = !0) {
  const o = Ae(e);
  return t || (o.equals = Kr), Ye && n && X !== null && X.l !== null && (X.l.s ??= []).push(o), o;
}
function y(e, t, n = !1) {
  L !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!Nt || (L.f & $i) !== 0) && wn() && (L.f & (ct | te | Qo | $i)) !== 0 && (Ot === null || !Ue.call(Ot, e)) && Tc();
  let o = n ? gt(t) : t;
  return We(e, o);
}
function We(e, t) {
  if (!e.equals(t)) {
    var n = e.v;
    ue ? ce.set(e, t) : ce.set(e, n), e.v = t;
    var o = Zt.ensure();
    if (o.capture(e, n), (e.f & ct) !== 0) {
      const i = (
        /** @type {Derived} */
        e
      );
      (e.f & ht) !== 0 && oi(i), ti(i);
    }
    e.wv = xl(), il(e, ht), wn() && I !== null && (I.f & ot) !== 0 && (I.f & ($t | fe)) === 0 && (Tt === null ? ch([e]) : Tt.push(e)), !o.is_fork && Ho.size > 0 && !ol && Zc();
  }
  return t;
}
function Zc() {
  ol = !1;
  for (const e of Ho)
    (e.f & ot) !== 0 && Q(e, Ft), xn(e) && je(e);
  Ho.clear();
}
function an(e) {
  y(e, e.v + 1);
}
function il(e, t) {
  var n = e.reactions;
  if (n !== null)
    for (var o = wn(), i = n.length, r = 0; r < i; r++) {
      var l = n[r], s = l.f;
      if (!(!o && l === I)) {
        var a = (s & ht) === 0;
        if (a && Q(l, t), (s & ct) !== 0) {
          var c = (
            /** @type {Derived} */
            l
          );
          Ht?.delete(c), (s & Re) === 0 && (s & zt && (l.f |= Re), il(c, Ft));
        } else a && ((s & te) !== 0 && Yt !== null && Yt.add(
          /** @type {Effect} */
          l
        ), Bt(
          /** @type {Effect} */
          l
        ));
      }
    }
}
function gt(e) {
  if (typeof e != "object" || e === null || sn in e)
    return e;
  const t = Zo(e);
  if (t !== Nr && t !== pc)
    return e;
  var n = /* @__PURE__ */ new Map(), o = Jo(e), i = /* @__PURE__ */ M(0), r = _e, l = (s) => {
    if (_e === r)
      return s();
    var a = L, c = _e;
    Dt(null), Wi(r);
    var h = s();
    return Dt(a), Wi(c), h;
  };
  return o && n.set("length", /* @__PURE__ */ M(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(s, a, c) {
        (!("value" in c) || c.configurable === !1 || c.enumerable === !1 || c.writable === !1) && Rc();
        var h = n.get(a);
        return h === void 0 ? l(() => {
          var d = /* @__PURE__ */ M(c.value);
          return n.set(a, d), d;
        }) : y(h, c.value, !0), !0;
      },
      deleteProperty(s, a) {
        var c = n.get(a);
        if (c === void 0) {
          if (a in s) {
            const h = l(() => /* @__PURE__ */ M(st));
            n.set(a, h), an(i);
          }
        } else
          y(c, st), an(i);
        return !0;
      },
      get(s, a, c) {
        if (a === sn)
          return e;
        var h = n.get(a), d = a in s;
        if (h === void 0 && (!d || Ne(s, a)?.writable) && (h = l(() => {
          var m = gt(d ? s[a] : st), v = /* @__PURE__ */ M(m);
          return v;
        }), n.set(a, h)), h !== void 0) {
          var u = f(h);
          return u === st ? void 0 : u;
        }
        return Reflect.get(s, a, c);
      },
      getOwnPropertyDescriptor(s, a) {
        var c = Reflect.getOwnPropertyDescriptor(s, a);
        if (c && "value" in c) {
          var h = n.get(a);
          h && (c.value = f(h));
        } else if (c === void 0) {
          var d = n.get(a), u = d?.v;
          if (d !== void 0 && u !== st)
            return {
              enumerable: !0,
              configurable: !0,
              value: u,
              writable: !0
            };
        }
        return c;
      },
      has(s, a) {
        if (a === sn)
          return !0;
        var c = n.get(a), h = c !== void 0 && c.v !== st || Reflect.has(s, a);
        if (c !== void 0 || I !== null && (!h || Ne(s, a)?.writable)) {
          c === void 0 && (c = l(() => {
            var u = h ? gt(s[a]) : st, m = /* @__PURE__ */ M(u);
            return m;
          }), n.set(a, c));
          var d = f(c);
          if (d === st)
            return !1;
        }
        return h;
      },
      set(s, a, c, h) {
        var d = n.get(a), u = a in s;
        if (o && a === "length")
          for (var m = c; m < /** @type {Source<number>} */
          d.v; m += 1) {
            var v = n.get(m + "");
            v !== void 0 ? y(v, st) : m in s && (v = l(() => /* @__PURE__ */ M(st)), n.set(m + "", v));
          }
        if (d === void 0)
          (!u || Ne(s, a)?.writable) && (d = l(() => /* @__PURE__ */ M(void 0)), y(d, gt(c)), n.set(a, d));
        else {
          u = d.v !== st;
          var w = l(() => gt(c));
          y(d, w);
        }
        var p = Reflect.getOwnPropertyDescriptor(s, a);
        if (p?.set && p.set.call(h, c), !u) {
          if (o && typeof a == "string") {
            var S = (
              /** @type {Source<number>} */
              n.get("length")
            ), g = Number(a);
            Number.isInteger(g) && g >= S.v && y(S, g + 1);
          }
          an(i);
        }
        return !0;
      },
      ownKeys(s) {
        f(i);
        var a = Reflect.ownKeys(s).filter((d) => {
          var u = n.get(d);
          return u === void 0 || u.v !== st;
        });
        for (var [c, h] of n)
          h.v !== st && !(c in s) && a.push(c);
        return a;
      },
      setPrototypeOf() {
        Ac();
      }
    }
  );
}
var Vi, rl, ll, sl;
function Qc() {
  if (Vi === void 0) {
    Vi = window, rl = /Firefox/.test(navigator.userAgent);
    var e = Element.prototype, t = Node.prototype, n = Text.prototype;
    ll = Ne(t, "firstChild").get, sl = Ne(t, "nextSibling").get, Fi(e) && (e.__click = void 0, e.__className = void 0, e.__attributes = null, e.__style = void 0, e.__e = void 0), Fi(n) && (n.__t = void 0);
  }
}
function Qt(e = "") {
  return document.createTextNode(e);
}
// @__NO_SIDE_EFFECTS__
function qt(e) {
  return (
    /** @type {TemplateNode | null} */
    ll.call(e)
  );
}
// @__NO_SIDE_EFFECTS__
function Cn(e) {
  return (
    /** @type {TemplateNode | null} */
    sl.call(e)
  );
}
function Lt(e, t) {
  return /* @__PURE__ */ qt(e);
}
function G(e, t = !1) {
  {
    var n = /* @__PURE__ */ qt(e);
    return n instanceof Comment && n.data === "" ? /* @__PURE__ */ Cn(n) : n;
  }
}
function T(e, t = 1, n = !1) {
  let o = e;
  for (; t--; )
    o = /** @type {TemplateNode} */
    /* @__PURE__ */ Cn(o);
  return o;
}
function th(e) {
  e.textContent = "";
}
function al() {
  return !1;
}
function eh(e, t, n) {
  return (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    document.createElementNS(Br, e, void 0)
  );
}
function ii(e) {
  var t = L, n = I;
  Dt(null), Wt(null);
  try {
    return e();
  } finally {
    Dt(t), Wt(n);
  }
}
function cl(e) {
  I === null && (L === null && _c(), Sc()), ue && xc();
}
function nh(e, t) {
  var n = t.last;
  n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function Ut(e, t, n) {
  var o = I;
  o !== null && (o.f & Et) !== 0 && (e |= Et);
  var i = {
    ctx: X,
    deps: null,
    nodes: null,
    f: e | ht | zt,
    first: null,
    fn: t,
    last: null,
    next: null,
    parent: o,
    b: o && o.b,
    prev: null,
    teardown: null,
    wv: 0,
    ac: null
  };
  if (n)
    try {
      je(i);
    } catch (s) {
      throw vt(i), s;
    }
  else t !== null && Bt(i);
  var r = i;
  if (n && r.deps === null && r.teardown === null && r.nodes === null && r.first === r.last && // either `null`, or a singular child
  (r.f & Le) === 0 && (r = r.first, (e & te) !== 0 && (e & Ee) !== 0 && r !== null && (r.f |= Ee)), r !== null && (r.parent = o, o !== null && nh(r, o), L !== null && (L.f & ct) !== 0 && (e & fe) === 0)) {
    var l = (
      /** @type {Derived} */
      L
    );
    (l.effects ??= []).push(r);
  }
  return i;
}
function ri() {
  return L !== null && !Nt;
}
function hl(e) {
  const t = Ut(bn, null, !1);
  return Q(t, ot), t.teardown = e, t;
}
function lo(e) {
  cl();
  var t = (
    /** @type {Effect} */
    I.f
  ), n = !L && (t & $t) !== 0 && (t & gn) === 0;
  if (n) {
    var o = (
      /** @type {ComponentContext} */
      X
    );
    (o.e ??= []).push(e);
  } else
    return ul(e);
}
function ul(e) {
  return Ut(cn | qr, e, !1);
}
function oh(e) {
  return cl(), Ut(bn | qr, e, !0);
}
function ih(e) {
  Zt.ensure();
  const t = Ut(fe | Le, e, !0);
  return () => {
    vt(t);
  };
}
function rh(e) {
  Zt.ensure();
  const t = Ut(fe | Le, e, !0);
  return (n = {}) => new Promise((o) => {
    n.outro ? Se(t, () => {
      vt(t), o(void 0);
    }) : (vt(t), o(void 0));
  });
}
function lh(e) {
  return Ut(cn, e, !1);
}
function sh(e) {
  return Ut(Qo | Le, e, !0);
}
function dl(e, t = 0) {
  return Ut(bn | t, e, !0);
}
function ut(e, t = [], n = [], o = []) {
  Wc(o, t, n, (i) => {
    Ut(bn, () => e(...i.map(f)), !0);
  });
}
function so(e, t = 0) {
  var n = Ut(te | t, e, !0);
  return n;
}
function Mt(e) {
  return Ut($t | Le, e, !0);
}
function fl(e) {
  var t = e.teardown;
  if (t !== null) {
    const n = ue, o = L;
    qi(!0), Dt(null);
    try {
      t.call(null);
    } finally {
      qi(n), Dt(o);
    }
  }
}
function li(e, t = !1) {
  var n = e.first;
  for (e.first = e.last = null; n !== null; ) {
    const i = n.ac;
    i !== null && ii(() => {
      i.abort(Ce);
    });
    var o = n.next;
    (n.f & fe) !== 0 ? n.parent = null : vt(n, t), n = o;
  }
}
function ah(e) {
  for (var t = e.first; t !== null; ) {
    var n = t.next;
    (t.f & $t) === 0 && vt(t), t = n;
  }
}
function vt(e, t = !0) {
  var n = !1;
  (t || (e.f & Vr) !== 0) && e.nodes !== null && e.nodes.end !== null && (ml(
    e.nodes.start,
    /** @type {TemplateNode} */
    e.nodes.end
  ), n = !0), li(e, t && !n), hn(e, 0), Q(e, Gt);
  var o = e.nodes && e.nodes.t;
  if (o !== null)
    for (const r of o)
      r.stop();
  fl(e);
  var i = e.parent;
  i !== null && i.first !== null && pl(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = null;
}
function ml(e, t) {
  for (; e !== null; ) {
    var n = e === t ? null : /* @__PURE__ */ Cn(e);
    e.remove(), e = n;
  }
}
function pl(e) {
  var t = e.parent, n = e.prev, o = e.next;
  n !== null && (n.next = o), o !== null && (o.prev = n), t !== null && (t.first === e && (t.first = o), t.last === e && (t.last = n));
}
function Se(e, t, n = !0) {
  var o = [];
  vl(e, o, !0);
  var i = () => {
    n && vt(e), t && t();
  }, r = o.length;
  if (r > 0) {
    var l = () => --r || i();
    for (var s of o)
      s.out(l);
  } else
    i();
}
function vl(e, t, n) {
  if ((e.f & Et) === 0) {
    e.f ^= Et;
    var o = e.nodes && e.nodes.t;
    if (o !== null)
      for (const s of o)
        (s.is_global || n) && t.push(s);
    for (var i = e.first; i !== null; ) {
      var r = i.next, l = (i.f & Ee) !== 0 || // If this is a branch effect without a block effect parent,
      // it means the parent block effect was pruned. In that case,
      // transparency information was transferred to the branch effect.
      (i.f & $t) !== 0 && (e.f & te) !== 0;
      vl(i, t, l ? n : !1), i = r;
    }
  }
}
function si(e) {
  bl(e, !0);
}
function bl(e, t) {
  if ((e.f & Et) !== 0) {
    e.f ^= Et, (e.f & ot) === 0 && (Q(e, ht), Bt(e));
    for (var n = e.first; n !== null; ) {
      var o = n.next, i = (n.f & Ee) !== 0 || (n.f & $t) !== 0;
      bl(n, i ? t : !1), n = o;
    }
    var r = e.nodes && e.nodes.t;
    if (r !== null)
      for (const l of r)
        (l.is_global || t) && l.in();
  }
}
function gl(e, t) {
  if (e.nodes)
    for (var n = e.nodes.start, o = e.nodes.end; n !== null; ) {
      var i = n === o ? null : /* @__PURE__ */ Cn(n);
      t.append(n), n = i;
    }
}
let Bn = !1, ue = !1;
function qi(e) {
  ue = e;
}
let L = null, Nt = !1;
function Dt(e) {
  L = e;
}
let I = null;
function Wt(e) {
  I = e;
}
let Ot = null;
function wl(e) {
  L !== null && (Ot === null ? Ot = [e] : Ot.push(e));
}
let bt = null, yt = 0, Tt = null;
function ch(e) {
  Tt = e;
}
let Cl = 1, xe = 0, _e = xe;
function Wi(e) {
  _e = e;
}
function xl() {
  return ++Cl;
}
function xn(e) {
  var t = e.f;
  if ((t & ht) !== 0)
    return !0;
  if (t & ct && (e.f &= ~Re), (t & Ft) !== 0) {
    for (var n = (
      /** @type {Value[]} */
      e.deps
    ), o = n.length, i = 0; i < o; i++) {
      var r = n[i];
      if (xn(
        /** @type {Derived} */
        r
      ) && el(
        /** @type {Derived} */
        r
      ), r.wv > e.wv)
        return !0;
    }
    (t & zt) !== 0 && // During time traveling we don't want to reset the status so that
    // traversal of the graph in the other batches still happens
    Ht === null && Q(e, ot);
  }
  return !1;
}
function Sl(e, t, n = !0) {
  var o = e.reactions;
  if (o !== null && !(Ot !== null && Ue.call(Ot, e)))
    for (var i = 0; i < o.length; i++) {
      var r = o[i];
      (r.f & ct) !== 0 ? Sl(
        /** @type {Derived} */
        r,
        t,
        !1
      ) : t === r && (n ? Q(r, ht) : (r.f & ot) !== 0 && Q(r, Ft), Bt(
        /** @type {Effect} */
        r
      ));
    }
}
function _l(e) {
  var t = bt, n = yt, o = Tt, i = L, r = Ot, l = X, s = Nt, a = _e, c = e.f;
  bt = /** @type {null | Value[]} */
  null, yt = 0, Tt = null, L = (c & ($t | fe)) === 0 ? e : null, Ot = null, Ve(e.ctx), Nt = !1, _e = ++xe, e.ac !== null && (ii(() => {
    e.ac.abort(Ce);
  }), e.ac = null);
  try {
    e.f |= Io;
    var h = (
      /** @type {Function} */
      e.fn
    ), d = h();
    e.f |= gn;
    var u = e.deps, m = Y?.is_fork;
    if (bt !== null) {
      var v;
      if (m || hn(e, yt), u !== null && yt > 0)
        for (u.length = yt + bt.length, v = 0; v < bt.length; v++)
          u[yt + v] = bt[v];
      else
        e.deps = u = bt;
      if (ri() && (e.f & zt) !== 0)
        for (v = yt; v < u.length; v++)
          (u[v].reactions ??= []).push(e);
    } else !m && u !== null && yt < u.length && (hn(e, yt), u.length = yt);
    if (wn() && Tt !== null && !Nt && u !== null && (e.f & (ct | Ft | ht)) === 0)
      for (v = 0; v < /** @type {Source[]} */
      Tt.length; v++)
        Sl(
          Tt[v],
          /** @type {Effect} */
          e
        );
    if (i !== null && i !== e) {
      if (xe++, i.deps !== null)
        for (let w = 0; w < n; w += 1)
          i.deps[w].rv = xe;
      if (t !== null)
        for (const w of t)
          w.rv = xe;
      Tt !== null && (o === null ? o = Tt : o.push(.../** @type {Source[]} */
      Tt));
    }
    return (e.f & ae) !== 0 && (e.f ^= ae), d;
  } catch (w) {
    return Yr(w);
  } finally {
    e.f ^= Io, bt = t, yt = n, Tt = o, L = i, Ot = r, Ve(l), Nt = s, _e = a;
  }
}
function hh(e, t) {
  let n = t.reactions;
  if (n !== null) {
    var o = dc.call(n, e);
    if (o !== -1) {
      var i = n.length - 1;
      i === 0 ? n = t.reactions = null : (n[o] = n[i], n.pop());
    }
  }
  if (n === null && (t.f & ct) !== 0 && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (bt === null || !Ue.call(bt, t))) {
    var r = (
      /** @type {Derived} */
      t
    );
    (r.f & zt) !== 0 && (r.f ^= zt, r.f &= ~Re), ti(r), Gc(r), hn(r, 0);
  }
}
function hn(e, t) {
  var n = e.deps;
  if (n !== null)
    for (var o = t; o < n.length; o++)
      hh(e, n[o]);
}
function je(e) {
  var t = e.f;
  if ((t & Gt) === 0) {
    Q(e, ot);
    var n = I, o = Bn;
    I = e, Bn = !0;
    try {
      (t & (te | Ur)) !== 0 ? ah(e) : li(e), fl(e);
      var i = _l(e);
      e.teardown = typeof i == "function" ? i : null, e.wv = Cl;
      var r;
      Oo && Oc && (e.f & ht) !== 0 && e.deps;
    } finally {
      Bn = o, I = n;
    }
  }
}
function f(e) {
  var t = e.f, n = (t & ct) !== 0;
  if (L !== null && !Nt) {
    var o = I !== null && (I.f & Gt) !== 0;
    if (!o && (Ot === null || !Ue.call(Ot, e))) {
      var i = L.deps;
      if ((L.f & Io) !== 0)
        e.rv < xe && (e.rv = xe, bt === null && i !== null && i[yt] === e ? yt++ : bt === null ? bt = [e] : bt.push(e));
      else {
        (L.deps ??= []).push(e);
        var r = e.reactions;
        r === null ? e.reactions = [L] : Ue.call(r, L) || r.push(L);
      }
    }
  }
  if (ue && ce.has(e))
    return ce.get(e);
  if (n) {
    var l = (
      /** @type {Derived} */
      e
    );
    if (ue) {
      var s = l.v;
      return ((l.f & ot) === 0 && l.reactions !== null || El(l)) && (s = oi(l)), ce.set(l, s), s;
    }
    var a = (l.f & zt) === 0 && !Nt && L !== null && (Bn || (L.f & zt) !== 0), c = (l.f & gn) === 0;
    xn(l) && (a && (l.f |= zt), el(l)), a && !c && (nl(l), yl(l));
  }
  if (Ht?.has(e))
    return Ht.get(e);
  if ((e.f & ae) !== 0)
    throw e.v;
  return e.v;
}
function yl(e) {
  if (e.f |= zt, e.deps !== null)
    for (const t of e.deps)
      (t.reactions ??= []).push(e), (t.f & ct) !== 0 && (t.f & zt) === 0 && (nl(
        /** @type {Derived} */
        t
      ), yl(
        /** @type {Derived} */
        t
      ));
}
function El(e) {
  if (e.v === st) return !0;
  if (e.deps === null) return !1;
  for (const t of e.deps)
    if (ce.has(t) || (t.f & ct) !== 0 && El(
      /** @type {Derived} */
      t
    ))
      return !0;
  return !1;
}
function Sn(e) {
  var t = Nt;
  try {
    return Nt = !0, e();
  } finally {
    Nt = t;
  }
}
const nn = /* @__PURE__ */ Symbol("events"), Rl = /* @__PURE__ */ new Set(), Bo = /* @__PURE__ */ new Set();
function Al(e, t, n, o = {}) {
  function i(r) {
    if (o.capture || No.call(t, r), !r.cancelBubble)
      return ii(() => n?.call(this, r));
  }
  return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? Jt(() => {
    t.addEventListener(e, i, o);
  }) : t.addEventListener(e, i, o), i;
}
function J(e, t, n, o = {}) {
  var i = Al(t, e, n, o);
  return () => {
    e.removeEventListener(t, i, o);
  };
}
function zn(e, t, n, o, i) {
  var r = { capture: o, passive: i }, l = Al(e, t, n, r);
  (t === document.body || // @ts-ignore
  t === window || // @ts-ignore
  t === document || // Firefox has quirky behavior, it can happen that we still get "canplay" events when the element is already removed
  t instanceof HTMLMediaElement) && hl(() => {
    t.removeEventListener(e, l, r);
  });
}
function on(e, t, n) {
  (t[nn] ??= {})[e] = n;
}
function Tl(e) {
  for (var t = 0; t < e.length; t++)
    Rl.add(e[t]);
  for (var n of Bo)
    n(e);
}
let ji = null;
function No(e) {
  var t = this, n = (
    /** @type {Node} */
    t.ownerDocument
  ), o = e.type, i = e.composedPath?.() || [], r = (
    /** @type {null | Element} */
    i[0] || e.target
  );
  ji = e;
  var l = 0, s = ji === e && e[nn];
  if (s) {
    var a = i.indexOf(s);
    if (a !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e[nn] = t;
      return;
    }
    var c = i.indexOf(t);
    if (c === -1)
      return;
    a <= c && (l = a);
  }
  if (r = /** @type {Element} */
  i[l] || e.target, r !== t) {
    fc(e, "currentTarget", {
      configurable: !0,
      get() {
        return r || n;
      }
    });
    var h = L, d = I;
    Dt(null), Wt(null);
    try {
      for (var u, m = []; r !== null; ) {
        var v = r.assignedSlot || r.parentNode || /** @type {any} */
        r.host || null;
        try {
          var w = r[nn]?.[o];
          w != null && (!/** @type {any} */
          r.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === r) && w.call(r, e);
        } catch (p) {
          u ? m.push(p) : u = p;
        }
        if (e.cancelBubble || v === t || v === null)
          break;
        r = v;
      }
      if (u) {
        for (let p of m)
          queueMicrotask(() => {
            throw p;
          });
        throw u;
      }
    } finally {
      e[nn] = t, delete e.currentTarget, Dt(h), Wt(d);
    }
  }
}
const uh = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (e) => e
  })
);
function dh(e) {
  return (
    /** @type {string} */
    uh?.createHTML(e) ?? e
  );
}
function ai(e, t = !1) {
  var n = eh("template");
  return e = e.replaceAll("<!>", "<!---->"), n.innerHTML = t ? dh(e) : e, n.content;
}
function Ke(e, t) {
  var n = (
    /** @type {Effect} */
    I
  );
  n.nodes === null && (n.nodes = { start: e, end: t, a: null, t: null });
}
// @__NO_SIDE_EFFECTS__
function O(e, t) {
  var n = (t & hc) !== 0, o = (t & uc) !== 0, i, r = !e.startsWith("<!>");
  return () => {
    i === void 0 && (i = ai(r ? e : "<!>" + e, !0), n || (i = /** @type {TemplateNode} */
    /* @__PURE__ */ qt(i)));
    var l = (
      /** @type {TemplateNode} */
      o || rl ? document.importNode(i, !0) : i.cloneNode(!0)
    );
    if (n) {
      var s = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ qt(l)
      ), a = (
        /** @type {TemplateNode} */
        l.lastChild
      );
      Ke(s, a);
    } else
      Ke(l, l);
    return l;
  };
}
// @__NO_SIDE_EFFECTS__
function fh(e, t, n = "svg") {
  var o = !e.startsWith("<!>"), i = `<${n}>${o ? e : "<!>" + e}</${n}>`, r;
  return () => {
    if (!r) {
      var l = (
        /** @type {DocumentFragment} */
        ai(i, !0)
      ), s = (
        /** @type {Element} */
        /* @__PURE__ */ qt(l)
      );
      r = /** @type {Element} */
      /* @__PURE__ */ qt(s);
    }
    var a = (
      /** @type {TemplateNode} */
      r.cloneNode(!0)
    );
    return Ke(a, a), a;
  };
}
// @__NO_SIDE_EFFECTS__
function It(e, t) {
  return /* @__PURE__ */ fh(e, t, "svg");
}
function wt(e = "") {
  {
    var t = Qt(e + "");
    return Ke(t, t), t;
  }
}
function ci() {
  var e = document.createDocumentFragment(), t = document.createComment(""), n = Qt();
  return e.append(t, n), Ke(t, n), e;
}
function C(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
const mh = ["touchstart", "touchmove"];
function ph(e) {
  return mh.includes(e);
}
function Kt(e, t) {
  var n = t == null ? "" : typeof t == "object" ? t + "" : t;
  n !== (e.__t ??= e.nodeValue) && (e.__t = n, e.nodeValue = n + "");
}
function kl(e, t) {
  return vh(e, t);
}
const Ln = /* @__PURE__ */ new Map();
function vh(e, { target: t, anchor: n, props: o = {}, events: i, context: r, intro: l = !0 }) {
  Qc();
  var s = void 0, a = rh(() => {
    var c = n ?? t.appendChild(Qt());
    Vc(
      /** @type {TemplateNode} */
      c,
      {
        pending: () => {
        }
      },
      (u) => {
        me({});
        var m = (
          /** @type {ComponentContext} */
          X
        );
        r && (m.c = r), i && (o.$$events = i), s = e(u, o) || {}, pe();
      }
    );
    var h = /* @__PURE__ */ new Set(), d = (u) => {
      for (var m = 0; m < u.length; m++) {
        var v = u[m];
        if (!h.has(v)) {
          h.add(v);
          var w = ph(v);
          for (const g of [t, document]) {
            var p = Ln.get(g);
            p === void 0 && (p = /* @__PURE__ */ new Map(), Ln.set(g, p));
            var S = p.get(v);
            S === void 0 ? (g.addEventListener(v, No, { passive: w }), p.set(v, 1)) : p.set(v, S + 1);
          }
        }
      }
    };
    return d(io(Rl)), Bo.add(d), () => {
      for (var u of h)
        for (const w of [t, document]) {
          var m = (
            /** @type {Map<string, number>} */
            Ln.get(w)
          ), v = (
            /** @type {number} */
            m.get(u)
          );
          --v == 0 ? (w.removeEventListener(u, No), m.delete(u), m.size === 0 && Ln.delete(w)) : m.set(u, v);
        }
      Bo.delete(d), c !== n && c.parentNode?.removeChild(c);
    };
  });
  return Fo.set(s, a), s;
}
let Fo = /* @__PURE__ */ new WeakMap();
function zl(e, t) {
  const n = Fo.get(e);
  return n ? (Fo.delete(e), n(t)) : Promise.resolve();
}
class Ll {
  /** @type {TemplateNode} */
  anchor;
  /** @type {Map<Batch, Key>} */
  #t = /* @__PURE__ */ new Map();
  /**
   * Map of keys to effects that are currently rendered in the DOM.
   * These effects are visible and actively part of the document tree.
   * Example:
   * ```
   * {#if condition}
   * 	foo
   * {:else}
   * 	bar
   * {/if}
   * ```
   * Can result in the entries `true->Effect` and `false->Effect`
   * @type {Map<Key, Effect>}
   */
  #n = /* @__PURE__ */ new Map();
  /**
   * Similar to #onscreen with respect to the keys, but contains branches that are not yet
   * in the DOM, because their insertion is deferred.
   * @type {Map<Key, Branch>}
   */
  #e = /* @__PURE__ */ new Map();
  /**
   * Keys of effects that are currently outroing
   * @type {Set<Key>}
   */
  #o = /* @__PURE__ */ new Set();
  /**
   * Whether to pause (i.e. outro) on change, or destroy immediately.
   * This is necessary for `<svelte:element>`
   */
  #i = !0;
  /**
   * @param {TemplateNode} anchor
   * @param {boolean} transition
   */
  constructor(t, n = !0) {
    this.anchor = t, this.#i = n;
  }
  #s = () => {
    var t = (
      /** @type {Batch} */
      Y
    );
    if (this.#t.has(t)) {
      var n = (
        /** @type {Key} */
        this.#t.get(t)
      ), o = this.#n.get(n);
      if (o)
        si(o), this.#o.delete(n);
      else {
        var i = this.#e.get(n);
        i && (this.#n.set(n, i.effect), this.#e.delete(n), i.fragment.lastChild.remove(), this.anchor.before(i.fragment), o = i.effect);
      }
      for (const [r, l] of this.#t) {
        if (this.#t.delete(r), r === t)
          break;
        const s = this.#e.get(l);
        s && (vt(s.effect), this.#e.delete(l));
      }
      for (const [r, l] of this.#n) {
        if (r === n || this.#o.has(r)) continue;
        const s = () => {
          if (Array.from(this.#t.values()).includes(r)) {
            var c = document.createDocumentFragment();
            gl(l, c), c.append(Qt()), this.#e.set(r, { effect: l, fragment: c });
          } else
            vt(l);
          this.#o.delete(r), this.#n.delete(r);
        };
        this.#i || !o ? (this.#o.add(r), Se(l, s, !1)) : s();
      }
    }
  };
  /**
   * @param {Batch} batch
   */
  #r = (t) => {
    this.#t.delete(t);
    const n = Array.from(this.#t.values());
    for (const [o, i] of this.#e)
      n.includes(o) || (vt(i.effect), this.#e.delete(o));
  };
  /**
   *
   * @param {any} key
   * @param {null | ((target: TemplateNode) => void)} fn
   */
  ensure(t, n) {
    var o = (
      /** @type {Batch} */
      Y
    ), i = al();
    if (n && !this.#n.has(t) && !this.#e.has(t))
      if (i) {
        var r = document.createDocumentFragment(), l = Qt();
        r.append(l), this.#e.set(t, {
          effect: Mt(() => n(l)),
          fragment: r
        });
      } else
        this.#n.set(
          t,
          Mt(() => n(this.anchor))
        );
    if (this.#t.set(o, t), i) {
      for (const [s, a] of this.#n)
        s === t ? o.unskip_effect(a) : o.skip_effect(a);
      for (const [s, a] of this.#e)
        s === t ? o.unskip_effect(a.effect) : o.skip_effect(a.effect);
      o.oncommit(this.#s), o.ondiscard(this.#r);
    } else
      this.#s();
  }
}
function Te(e, t, ...n) {
  var o = new Ll(e);
  so(() => {
    const i = t() ?? null;
    o.ensure(i, i && ((r) => i(r, ...n)));
  }, Ee);
}
function ao(e) {
  X === null && Wr(), Ye && X.l !== null ? bh(X).m.push(e) : lo(() => {
    const t = Sn(e);
    if (typeof t == "function") return (
      /** @type {() => void} */
      t
    );
  });
}
function bh(e) {
  var t = (
    /** @type {ComponentContextLegacy} */
    e.l
  );
  return t.u ??= { a: [], b: [], m: [] };
}
function lt(e, t, n = !1) {
  var o = new Ll(e), i = n ? Ee : 0;
  function r(l, s) {
    o.ensure(l, s);
  }
  so(() => {
    var l = !1;
    t((s, a = 0) => {
      l = !0, r(a, s);
    }), l || r(!1, null);
  }, i);
}
function gh(e, t, n) {
  for (var o = [], i = t.length, r, l = t.length, s = 0; s < i; s++) {
    let d = t[s];
    Se(
      d,
      () => {
        if (r) {
          if (r.pending.delete(d), r.done.add(d), r.pending.size === 0) {
            var u = (
              /** @type {Set<EachOutroGroup>} */
              e.outrogroups
            );
            $o(io(r.done)), u.delete(r), u.size === 0 && (e.outrogroups = null);
          }
        } else
          l -= 1;
      },
      !1
    );
  }
  if (l === 0) {
    var a = o.length === 0 && n !== null;
    if (a) {
      var c = (
        /** @type {Element} */
        n
      ), h = (
        /** @type {Element} */
        c.parentNode
      );
      th(h), h.append(c), e.items.clear();
    }
    $o(t, !a);
  } else
    r = {
      pending: new Set(t),
      done: /* @__PURE__ */ new Set()
    }, (e.outrogroups ??= /* @__PURE__ */ new Set()).add(r);
}
function $o(e, t = !0) {
  for (var n = 0; n < e.length; n++)
    vt(e[n], t);
}
var Ki;
function On(e, t, n, o, i, r = null) {
  var l = e, s = /* @__PURE__ */ new Map(), a = (t & Hr) !== 0;
  if (a) {
    var c = (
      /** @type {Element} */
      e
    );
    l = c.appendChild(Qt());
  }
  var h = null, d = /* @__PURE__ */ ni(() => {
    var S = n();
    return Jo(S) ? S : S == null ? [] : io(S);
  }), u, m = !0;
  function v() {
    p.fallback = h, wh(p, u, l, t, o), h !== null && (u.length === 0 ? (h.f & Xt) === 0 ? si(h) : (h.f ^= Xt, rn(h, null, l)) : Se(h, () => {
      h = null;
    }));
  }
  var w = so(() => {
    u = /** @type {V[]} */
    f(d);
    for (var S = u.length, g = /* @__PURE__ */ new Set(), E = (
      /** @type {Batch} */
      Y
    ), x = al(), R = 0; R < S; R += 1) {
      var it = u[R], nt = o(it, R), W = m ? null : s.get(nt);
      W ? (W.v && We(W.v, it), W.i && We(W.i, R), x && E.unskip_effect(W.e)) : (W = Ch(
        s,
        m ? l : Ki ??= Qt(),
        it,
        nt,
        R,
        i,
        t,
        n
      ), m || (W.e.f |= Xt), s.set(nt, W)), g.add(nt);
    }
    if (S === 0 && r && !h && (m ? h = Mt(() => r(l)) : (h = Mt(() => r(Ki ??= Qt())), h.f |= Xt)), S > g.size && Cc(), !m)
      if (x) {
        for (const [ee, D] of s)
          g.has(ee) || E.skip_effect(D.e);
        E.oncommit(v), E.ondiscard(() => {
        });
      } else
        v();
    f(d);
  }), p = { effect: w, items: s, outrogroups: null, fallback: h };
  m = !1;
}
function tn(e) {
  for (; e !== null && (e.f & $t) === 0; )
    e = e.next;
  return e;
}
function wh(e, t, n, o, i) {
  var r = (o & oc) !== 0, l = t.length, s = e.items, a = tn(e.effect.first), c, h = null, d, u = [], m = [], v, w, p, S;
  if (r)
    for (S = 0; S < l; S += 1)
      v = t[S], w = i(v, S), p = /** @type {EachItem} */
      s.get(w).e, (p.f & Xt) === 0 && (p.nodes?.a?.measure(), (d ??= /* @__PURE__ */ new Set()).add(p));
  for (S = 0; S < l; S += 1) {
    if (v = t[S], w = i(v, S), p = /** @type {EachItem} */
    s.get(w).e, e.outrogroups !== null)
      for (const D of e.outrogroups)
        D.pending.delete(p), D.done.delete(p);
    if ((p.f & Xt) !== 0)
      if (p.f ^= Xt, p === a)
        rn(p, null, n);
      else {
        var g = h ? h.next : a;
        p === e.effect.last && (e.effect.last = p.prev), p.prev && (p.prev.next = p.next), p.next && (p.next.prev = p.prev), oe(e, h, p), oe(e, p, g), rn(p, g, n), h = p, u = [], m = [], a = tn(h.next);
        continue;
      }
    if ((p.f & Et) !== 0 && (si(p), r && (p.nodes?.a?.unfix(), (d ??= /* @__PURE__ */ new Set()).delete(p))), p !== a) {
      if (c !== void 0 && c.has(p)) {
        if (u.length < m.length) {
          var E = m[0], x;
          h = E.prev;
          var R = u[0], it = u[u.length - 1];
          for (x = 0; x < u.length; x += 1)
            rn(u[x], E, n);
          for (x = 0; x < m.length; x += 1)
            c.delete(m[x]);
          oe(e, R.prev, it.next), oe(e, h, R), oe(e, it, E), a = E, h = it, S -= 1, u = [], m = [];
        } else
          c.delete(p), rn(p, a, n), oe(e, p.prev, p.next), oe(e, p, h === null ? e.effect.first : h.next), oe(e, h, p), h = p;
        continue;
      }
      for (u = [], m = []; a !== null && a !== p; )
        (c ??= /* @__PURE__ */ new Set()).add(a), m.push(a), a = tn(a.next);
      if (a === null)
        continue;
    }
    (p.f & Xt) === 0 && u.push(p), h = p, a = tn(p.next);
  }
  if (e.outrogroups !== null) {
    for (const D of e.outrogroups)
      D.pending.size === 0 && ($o(io(D.done)), e.outrogroups?.delete(D));
    e.outrogroups.size === 0 && (e.outrogroups = null);
  }
  if (a !== null || c !== void 0) {
    var nt = [];
    if (c !== void 0)
      for (p of c)
        (p.f & Et) === 0 && nt.push(p);
    for (; a !== null; )
      (a.f & Et) === 0 && a !== e.fallback && nt.push(a), a = tn(a.next);
    var W = nt.length;
    if (W > 0) {
      var ee = (o & Hr) !== 0 && l === 0 ? n : null;
      if (r) {
        for (S = 0; S < W; S += 1)
          nt[S].nodes?.a?.measure();
        for (S = 0; S < W; S += 1)
          nt[S].nodes?.a?.fix();
      }
      gh(e, nt, ee);
    }
  }
  r && Jt(() => {
    if (d !== void 0)
      for (p of d)
        p.nodes?.a?.apply();
  });
}
function Ch(e, t, n, o, i, r, l, s) {
  var a = (l & ec) !== 0 ? (l & ic) === 0 ? /* @__PURE__ */ Jc(n, !1, !1) : Ae(n) : null, c = (l & nc) !== 0 ? Ae(i) : null;
  return {
    v: a,
    i: c,
    e: Mt(() => (r(t, a ?? n, c ?? i, s), () => {
      e.delete(o);
    }))
  };
}
function rn(e, t, n) {
  if (e.nodes)
    for (var o = e.nodes.start, i = e.nodes.end, r = t && (t.f & Xt) === 0 ? (
      /** @type {EffectNodes} */
      t.nodes.start
    ) : n; o !== null; ) {
      var l = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Cn(o)
      );
      if (r.before(o), o === i)
        return;
      o = l;
    }
}
function oe(e, t, n) {
  t === null ? e.effect.first = n : t.next = n, n === null ? e.effect.last = t : n.prev = t;
}
function xh(e, t, n = !1, o = !1, i = !1) {
  var r = e, l = "";
  ut(() => {
    var s = (
      /** @type {Effect} */
      I
    );
    if (l !== (l = t() ?? "") && (s.nodes !== null && (ml(
      s.nodes.start,
      /** @type {TemplateNode} */
      s.nodes.end
    ), s.nodes = null), l !== "")) {
      var a = l + "";
      n ? a = `<svg>${a}</svg>` : o && (a = `<math>${a}</math>`);
      var c = ai(a);
      if ((n || o) && (c = /** @type {Element} */
      /* @__PURE__ */ qt(c)), Ke(
        /** @type {TemplateNode} */
        /* @__PURE__ */ qt(c),
        /** @type {TemplateNode} */
        c.lastChild
      ), n || o)
        for (; /* @__PURE__ */ qt(c); )
          r.before(
            /** @type {TemplateNode} */
            /* @__PURE__ */ qt(c)
          );
      else
        r.before(c);
    }
  });
}
function Yi(e, t = !1) {
  var n = t ? " !important;" : ";", o = "";
  for (var i in e) {
    var r = e[i];
    r != null && r !== "" && (o += " " + i + ": " + r + n);
  }
  return o;
}
function Sh(e, t) {
  if (t) {
    var n = "", o, i;
    return Array.isArray(t) ? (o = t[0], i = t[1]) : o = t, o && (n += Yi(o)), i && (n += Yi(i, !0)), n = n.trim(), n === "" ? null : n;
  }
  return String(e);
}
function Eo(e, t = {}, n, o) {
  for (var i in n) {
    var r = n[i];
    t[i] !== r && (n[i] == null ? e.style.removeProperty(i) : e.style.setProperty(i, r, o));
  }
}
function Yn(e, t, n, o) {
  var i = e.__style;
  if (i !== t) {
    var r = Sh(t, o);
    r == null ? e.removeAttribute("style") : e.style.cssText = r, e.__style = t;
  } else o && (Array.isArray(o) ? (Eo(e, n?.[0], o[0]), Eo(e, n?.[1], o[1], "important")) : Eo(e, n, o));
  return o;
}
const _h = /* @__PURE__ */ Symbol("is custom element"), yh = /* @__PURE__ */ Symbol("is html");
function q(e, t, n, o) {
  var i = Eh(e);
  i[t] !== (i[t] = n) && (t === "loading" && (e[gc] = n), n == null ? e.removeAttribute(t) : typeof n != "string" && Rh(e).includes(t) ? e[t] = n : e.setAttribute(t, n));
}
function Eh(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    // @ts-expect-error
    e.__attributes ??= {
      [_h]: e.nodeName.includes("-"),
      [yh]: e.namespaceURI === Br
    }
  );
}
var Xi = /* @__PURE__ */ new Map();
function Rh(e) {
  var t = e.getAttribute("is") || e.nodeName, n = Xi.get(t);
  if (n) return n;
  Xi.set(t, n = []);
  for (var o, i = e, r = Element.prototype; r !== i; ) {
    o = mc(i);
    for (var l in o)
      o[l].set && n.push(l);
    i = Zo(i);
  }
  return n;
}
function Gi(e, t) {
  return e === t || e?.[sn] === t;
}
function Xn(e = {}, t, n, o) {
  return lh(() => {
    var i, r;
    return dl(() => {
      i = r, r = [], Sn(() => {
        e !== n(...r) && (t(e, ...r), i && Gi(n(...i), e) && t(null, ...i));
      });
    }), () => {
      Jt(() => {
        r && Gi(n(...r), e) && t(null, ...r);
      });
    };
  }), e;
}
let Dn = !1;
function Ah(e) {
  var t = Dn;
  try {
    return Dn = !1, [e(), Dn];
  } finally {
    Dn = t;
  }
}
function Uo(e, t, n, o) {
  var i = !Ye || (n & lc) !== 0, r = (n & ac) !== 0, l = (n & cc) !== 0, s = (
    /** @type {V} */
    o
  ), a = !0, c = () => (a && (a = !1, s = l ? Sn(
    /** @type {() => V} */
    o
  ) : (
    /** @type {V} */
    o
  )), s), h;
  if (r) {
    var d = sn in e || bc in e;
    h = Ne(e, t)?.set ?? (d && t in e ? (E) => e[t] = E : void 0);
  }
  var u, m = !1;
  r ? [u, m] = Ah(() => (
    /** @type {V} */
    e[t]
  )) : u = /** @type {V} */
  e[t], u === void 0 && o !== void 0 && (u = c(), h && (i && Ec(), h(u)));
  var v;
  if (i ? v = () => {
    var E = (
      /** @type {V} */
      e[t]
    );
    return E === void 0 ? c() : (a = !0, E);
  } : v = () => {
    var E = (
      /** @type {V} */
      e[t]
    );
    return E !== void 0 && (s = /** @type {V} */
    void 0), E === void 0 ? s : E;
  }, i && (n & sc) === 0)
    return v;
  if (h) {
    var w = e.$$legacy;
    return (
      /** @type {() => V} */
      (function(E, x) {
        return arguments.length > 0 ? ((!i || !x || w || m) && h(x ? v() : E), E) : v();
      })
    );
  }
  var p = !1, S = ((n & rc) !== 0 ? ro : ni)(() => (p = !1, v()));
  r && f(S);
  var g = (
    /** @type {Effect} */
    I
  );
  return (
    /** @type {() => V} */
    (function(E, x) {
      if (arguments.length > 0) {
        const R = x ? f(S) : i && r ? gt(E) : E;
        return y(S, R), p = !0, s !== void 0 && (s = R), E;
      }
      return ue && p || (g.f & Gt) !== 0 ? S.v : f(S);
    })
  );
}
function Xe(e) {
  return "ownerDocument" in e ? e.ownerDocument?.defaultView ?? window : window;
}
function un(e) {
  return "ownerDocument" in e ? e.ownerDocument : document;
}
function Ol(e) {
  return e instanceof Node || e instanceof Xe(e).Node;
}
function Th(e) {
  return e instanceof HTMLBRElement || e instanceof Xe(e).HTMLBRElement;
}
function Dl(e) {
  return e instanceof Element || e instanceof Xe(e).Element;
}
function kh(e) {
  return e instanceof HTMLElement || e instanceof Xe(e).HTMLElement;
}
function hi(e) {
  if (_(e) || !kh(e)) throw new Error("Target is not an HTMLElement");
  return e;
}
function Il(e, t) {
  return Ol(t) ? e.contains(t) : !1;
}
function Pl(e) {
  if (Ol(e))
    return Dl(e) ? e : e.parentElement ?? void 0;
}
function Ml(e, t) {
  return Pl(e)?.querySelector(ui(t)) ?? void 0;
}
function Hl(e, t) {
  return Pl(e)?.closest(ui(t)) ?? void 0;
}
function Bl(e, t) {
  return Dl(e) && e.matches(ui(t));
}
function zh({
  ancestor: e,
  descendent: t,
  getText: n
}) {
  const o = [];
  for (let i = t; i !== e; i = i.parentNode) {
    const r = [];
    for (let l = i.parentNode.firstChild; l !== i; l = l.nextSibling)
      r.push(n?.(l) ?? l.textContent ?? "");
    o.unshift(r.join(""));
  }
  return o.join("");
}
function ui(e) {
  return Js(e, (t, n) => `[data-${t}="${n}"]`).join("");
}
const Ji = -1;
function Lh(e, t) {
  const n = document.createElement("div");
  n.className = "cm-content", n.appendChild(t);
  const o = document.createElement("div");
  o.className = "cm-scroller", o.appendChild(n);
  const i = document.createElement("div");
  i.className = `cm-editor ${e.themeClasses}`, i.appendChild(o), i.style = "visibility: hidden;", un(e.dom).body.appendChild(i);
  const { height: r } = t.getBoundingClientRect();
  return un(e.dom).body.removeChild(i), r;
}
function Oh(e, t) {
  const n = Xe(e), o = new n.ResizeObserver(([i], r) => {
    const {
      borderBoxSize: [l]
    } = i;
    t({ height: l.blockSize });
  });
  return o.observe(e, { box: "border-box" }), () => o.disconnect();
}
async function Dh({ millis: e }) {
  return await new Promise((t) => setTimeout(t, e));
}
function ke(...e) {
  return () => e.forEach((t) => t());
}
function Ih({ delayMillis: e }) {
  let t = !1;
  return Dh({ millis: e }).then(() => t = !0), () => t;
}
const Fe = [
  "table.correct",
  "table.delete",
  "table.edit",
  "table.focus",
  "table.format",
  "table.navigate",
  "table.select"
], Ph = Fe.map((e) => `${e}.undo`), Mh = Fe.map((e) => `${e}.redo`), Hh = new Map([
  ...Fe.map((e) => [e, `${e}.undo`]),
  ...Fe.map((e) => [`${e}.undo`, `${e}.redo`]),
  ...Fe.map((e) => [`${e}.redo`, `${e}.undo`])
]), Bh = /* @__PURE__ */ new Set([
  "table.correct.undo",
  "table.delete.undo",
  "table.format.undo"
]), Nh = /* @__PURE__ */ new Set(["table.edit.undo", "table.edit.redo"]), Nl = [...Fe, ...Ph, ...Mh];
function Fh(e) {
  return Hh.get(e);
}
function $h(e) {
  return Bh.has(e);
}
function Uh(e) {
  return Nh.has(e);
}
const di = zs.define(), Vh = new Map(
  Nl.map((e) => [e, di.of(e)])
);
function he(e) {
  return Vh.get(e);
}
function fi(e) {
  return b(co(e));
}
function qh(e) {
  const t = co(e);
  return b(t) && $h(t);
}
function Wh(e) {
  const t = co(e);
  return b(t) && t === "table.focus";
}
function jh(e) {
  const t = co(e);
  return b(t) && Uh(t);
}
function co(e) {
  return e.annotation(di);
}
function re(e, { start: t, endExclusive: n }) {
  return t <= n ? e >= t && e < n : e <= t && e > n;
}
function Zi({ start: e, endExclusive: t }) {
  return e === t;
}
function Qi(e, t) {
  return e?.start === t?.start && e?.endExclusive === t?.endExclusive;
}
function Kh(e, t) {
  if (e.length === 0) return -1;
  let n = 0, o = e.length - 1;
  for (; n !== o; ) {
    const i = n + Ta((o - n) / 2);
    e[i] > t ? o = i - 1 : n = i;
  }
  return e[n] <= t ? n : -1;
}
class z {
  row;
  col;
  rowOrCol(t) {
    return t === "row" ? this.row : this.col;
  }
  get startRow() {
    return this.row.start;
  }
  get startCol() {
    return this.col.start;
  }
  startRowOrCol(t) {
    return t === "row" ? this.startRow : this.startCol;
  }
  get endRow() {
    return this.row.endExclusive - 1;
  }
  get endCol() {
    return this.col.endExclusive - 1;
  }
  endRowOrCol(t) {
    return t === "row" ? this.endRow : this.endCol;
  }
  get rowRange() {
    return this.row;
  }
  get colRange() {
    return this.col;
  }
  rowOrColRange(t) {
    return t === "row" ? this.rowRange : this.colRange;
  }
  get rowCount() {
    return this.row.endExclusive - this.row.start;
  }
  get colCount() {
    return this.col.endExclusive - this.col.start;
  }
  get topLeftCell() {
    return { row: this.startRow, col: this.startCol };
  }
  get topRightCell() {
    return { row: this.startRow, col: this.endCol };
  }
  get bottomRightCell() {
    return { row: this.endRow, col: this.endCol };
  }
  get bottomLeftCell() {
    return { row: this.endRow, col: this.startCol };
  }
  cornerCellAt(t) {
    switch (t) {
      case "top-left":
        return this.topLeftCell;
      case "top-right":
        return this.topRightCell;
      case "bottom-right":
        return this.bottomRightCell;
      case "bottom-left":
        return this.bottomLeftCell;
    }
  }
  containsRow(t) {
    return re(t, this.rowRange);
  }
  containsCol(t) {
    return re(t, this.colRange);
  }
  containsCell({ row: t, col: n }) {
    return this.containsRow(t) && this.containsCol(n);
  }
  containsOnEdge({ row: t, col: n }) {
    return this.containsCell({ row: t, col: n }) ? {
      top: t === this.startRow,
      right: n === this.endCol,
      bottom: t === this.endRow,
      left: n === this.startCol
    } : { top: !1, right: !1, bottom: !1, left: !1 };
  }
  isSingleCell() {
    return this.rowCount === 1 && this.colCount === 1;
  }
  shiftUp() {
    return z.of({
      row: { start: this.row.start - 1, endExclusive: this.row.endExclusive - 1 },
      col: { ...this.col }
    });
  }
  shiftRight() {
    return z.of({
      row: { ...this.row },
      col: { start: this.col.start + 1, endExclusive: this.col.endExclusive + 1 }
    });
  }
  shiftDown() {
    return z.of({
      row: { start: this.row.start + 1, endExclusive: this.row.endExclusive + 1 },
      col: { ...this.col }
    });
  }
  shiftLeft() {
    return z.of({
      row: { ...this.row },
      col: { start: this.col.start - 1, endExclusive: this.col.endExclusive - 1 }
    });
  }
  shift(t, n) {
    return t === "row" ? n === "backward" ? this.shiftUp() : this.shiftDown() : n === "backward" ? this.shiftLeft() : this.shiftRight();
  }
  expandUp() {
    return z.of({
      row: { start: this.row.start - 1, endExclusive: this.row.endExclusive },
      col: { ...this.col }
    });
  }
  expandRight() {
    return z.of({
      row: { ...this.row },
      col: { start: this.col.start, endExclusive: this.col.endExclusive + 1 }
    });
  }
  expandDown() {
    return z.of({
      row: { start: this.row.start, endExclusive: this.row.endExclusive + 1 },
      col: { ...this.col }
    });
  }
  expandLeft() {
    return z.of({
      row: { ...this.row },
      col: { start: this.col.start - 1, endExclusive: this.col.endExclusive }
    });
  }
  contractUp() {
    return z.of({
      row: { start: this.row.start, endExclusive: this.row.endExclusive - 1 },
      col: { ...this.col }
    });
  }
  contractRight() {
    return z.of({
      row: { ...this.row },
      col: { start: this.col.start + 1, endExclusive: this.col.endExclusive }
    });
  }
  contractDown() {
    return z.of({
      row: { start: this.row.start + 1, endExclusive: this.row.endExclusive },
      col: { ...this.col }
    });
  }
  contractLeft() {
    return z.of({
      row: { ...this.row },
      col: { start: this.col.start, endExclusive: this.col.endExclusive - 1 }
    });
  }
  addForwardsByRowOrCol(t, { start: n, count: o }) {
    if (n > this.endRowOrCol(t)) return this;
    const i = n <= this.startRowOrCol(t) ? o : 0, r = o;
    return this.withRowOrCol(t, {
      start: this.startRowOrCol(t) + i,
      endExclusive: this.endRowOrCol(t) + r + 1
    });
  }
  subtractBackwardsByRowOrCol(t, { start: n, count: o, min: i }) {
    if (n - o - 1 >= this.endRowOrCol(t)) return this;
    if (n <= this.startRowOrCol(t)) {
      const d = {
        start: ft(this.rowOrCol(t).start - o, { min: i }),
        endExclusive: ft(this.rowOrCol(t).endExclusive - o, { min: i })
      };
      return Zi(d) ? void 0 : this.withRowOrCol(t, d);
    }
    const r = this.rowOrColRange(t), l = { start: n - o, endExclusive: n }, s = {
      start: Xo(r.start, l.start),
      endExclusive: Wn(r.endExclusive, l.endExclusive)
    }, a = s.endExclusive - s.start, c = n > r.endExclusive ? 0 : o - a, h = {
      start: ft(r.start - c, { min: i }),
      endExclusive: ft(r.endExclusive - c - a, { min: i })
    };
    return Zi(h) ? void 0 : this.withRowOrCol(t, h);
  }
  withRowOrCol(t, n) {
    return t === "row" ? z.of({ row: n, col: { ...this.col } }) : z.of({ row: { ...this.row }, col: n });
  }
  static of(t) {
    return new z(t);
  }
  static ofCell(t) {
    return new z({
      row: { start: t.row, endExclusive: t.row + 1 },
      col: { start: t.col, endExclusive: t.col + 1 }
    });
  }
  constructor({ row: t, col: n }) {
    this.row = t, this.col = n;
  }
}
const Fl = dt(" "), tr = Fl, Yh = Fl;
function Xh(e, { hyphens: t = 0 } = {}) {
  return e === "none" ? dt("-").append(ln(t)) : e === "left" ? dt(":-").append(ln(t)) : e === "center" ? dt(":-").append(ln(t)).append(dt(":")) : ln(t).append(dt("-:"));
}
function ln(e) {
  return dt("-".repeat(e));
}
function Ro(e) {
  return dt(" ".repeat(e));
}
var dn;
((e) => {
  function t(o) {
    return $e.of(o);
  }
  e.of = t;
  function n(o) {
    return $e.maybeOf(o);
  }
  e.maybeOf = n;
})(dn || (dn = {}));
const k = 1, Vo = 1, ge = Vo, Ao = 1, er = Vo + Vo, nr = 2, Gh = /* @__PURE__ */ new Map([["none", 1], ["left", 2], ["center", 3], ["right", 2]]);
function or(e) {
  return Gh.get(e);
}
function In(e, t) {
  const n = e.from;
  return {
    from: n + t.from,
    to: n + t.to
  };
}
function en(e, t) {
  return e.from + t;
}
class $e {
  #t;
  get text() {
    return f(this.#t);
  }
  set text(t) {
    y(this.#t, t, !0);
  }
  #n;
  get colSizes() {
    return f(this.#n);
  }
  set colSizes(t) {
    y(this.#n, t, !0);
  }
  #e;
  get alignments() {
    return f(this.#e);
  }
  set alignments(t) {
    y(this.#e, t, !0);
  }
  #o;
  get contentSizes() {
    return f(this.#o);
  }
  set contentSizes(t) {
    y(this.#o, t, !0);
  }
  #i;
  get cells() {
    return f(this.#i);
  }
  set cells(t) {
    y(this.#i, t, !0);
  }
  cellAt({ row: t, col: n }) {
    return $(t, this.rowRange), $(n, this.colRange), this.cells[t][n];
  }
  /**
   * {@link Table.firstCellSpan}.
   */
  get firstCellSpan() {
    return this.cellSpan(this.firstCellLocation);
  }
  /**
   * {@link Table.lastCellSpan}.
   */
  get lastCellSpan() {
    return this.cellSpan(this.lastCellLocation);
  }
  /**
   * {@link Table.cellSpan}.
   */
  cellSpan(t) {
    return $(t.row, this.rowRange), $(t.col, this.colRange), this.absoluteCellContentSpan(t);
  }
  /**
   * {@link Table.closestCellAtPosition}.
   */
  closestCellAtPosition(t) {
    if (t > this.text.length) return this.lastCellLocation;
    const { number: n, from: o } = this.text.lineAt(t);
    if (n === nr)
      return this.hasDataRows() ? { row: this.firstDataRowIndex, col: this.firstColIndex } : { row: this.headerRowIndex, col: this.lastColIndex };
    const i = t - o, r = n === 1 ? this.headerRowIndex : n - 2;
    let l = k;
    const s = this.mapEachCol((c) => {
      const h = l;
      return l += this.colSizes[c] + k, h;
    }), a = Kh(s, i);
    return a === -1 ? { row: r, col: this.firstColIndex } : { row: r, col: a };
  }
  /**
   * {@link Table.firstRowIndex}.
   */
  firstRowIndex = 0;
  /**
   * {@link Table.firstColIndex}.
   */
  firstColIndex = 0;
  /**
   * {@link Table.headerRowIndex}.
   */
  headerRowIndex = 0;
  /**
   * {@link Table.firstDataRowIndex}.
   */
  firstDataRowIndex = 1;
  /**
   * {@link Table.firstRowOrColIndex}.
   */
  firstRowOrColIndex(t) {
    return 0;
  }
  /**
   * {@link Table.lastRowIndex}.
   */
  get lastRowIndex() {
    return this.rowCount - 1;
  }
  /**
   * {@link Table.lastColIndex}.
   */
  get lastColIndex() {
    return this.colCount - 1;
  }
  /**
   * {@link Table.lastRowOrColIndex}.
   */
  lastRowOrColIndex(t) {
    return t === "row" ? this.lastRowIndex : this.lastColIndex;
  }
  /**
   * {@link Table.rowCount}.
   */
  get rowCount() {
    return this.contentSizes.length;
  }
  /**
   * {@link Table.colCount}.
   */
  get colCount() {
    return this.colSizes.length;
  }
  /**
   * {@link Table.rowOrColCount}.
   */
  rowOrColCount(t) {
    return t === "row" ? this.rowCount : this.colCount;
  }
  /**
   * {@link Table.rowRange}.
   */
  get rowRange() {
    return {
      start: this.firstRowIndex,
      endExclusive: this.lastRowIndex + 1
    };
  }
  /**
   * {@link Table.colRange}.
   */
  get colRange() {
    return {
      start: this.firstColIndex,
      endExclusive: this.lastColIndex + 1
    };
  }
  /**
   * {@link Table.rowOrColRange}.
   */
  rowOrColRange(t) {
    return t === "row" ? this.rowRange : this.colRange;
  }
  /**
   * {@link Table.rowIndices}.
   */
  get rowIndices() {
    return De(this.rowRange, (t) => t);
  }
  /**
   * {@link Table.colIndices}.
   */
  get colIndices() {
    return De(this.colRange, (t) => t);
  }
  /**
   * {@link Table.dataRowIndices}.
   */
  get dataRowIndices() {
    return this.hasDataRows() ? De(
      {
        start: this.firstDataRowIndex,
        endExclusive: this.lastRowIndex + 1
      },
      (t) => t
    ) : [];
  }
  /**
   * {@link Table.firstCellLocation}.
   */
  firstCellLocation = { row: this.firstRowIndex, col: this.firstColIndex };
  /**
   * {@link Table.lastCellLocation}.
   */
  get lastCellLocation() {
    return { row: this.lastRowIndex, col: this.lastColIndex };
  }
  /**
   * {@link Table.rowCellCount}.
   */
  get rowCellCount() {
    return this.colCount;
  }
  /**
   * {@link Table.colCellCount}.
   */
  get colCellCount() {
    return this.rowCount;
  }
  /**
   * {@link Table.rowOrColCellCount}.
   */
  rowOrColCellCount(t) {
    return t === "row" ? this.rowCellCount : this.colCellCount;
  }
  /**
   * {@link Table.hasSingleRow}.
   */
  hasSingleRow() {
    return this.rowCount === 1;
  }
  /**
   * {@link Table.hasSingleCol}.
   */
  hasSingleCol() {
    return this.colCount === 1;
  }
  /**
   * {@link Table.hasSingleRowOrCol}.
   */
  hasSingleRowOrCol(t) {
    return t === "row" ? this.hasSingleRow() : this.hasSingleCol();
  }
  /**
   * {@link Table.hasDataRows}.
   */
  hasDataRows() {
    return this.rowCount > 1;
  }
  /**
   * {@link Table.hasRowAt}.
   */
  hasRowAt(t) {
    return re(t, this.rowRange);
  }
  /**
   * {@link Table.hasColAt}.
   */
  hasColAt(t) {
    return re(t, this.colRange);
  }
  /**
   * {@link Table.hasRowOrColAt}.
   */
  hasRowOrColAt(t, n) {
    return t === "row" ? this.hasRowAt(n) : this.hasColAt(n);
  }
  /**
   * {@link Table.hasEmptyRowAt}.
   */
  hasEmptyRowAt(t) {
    return this.hasRowAt(t) && this.contentSizes[t].every((n) => n === 0);
  }
  /**
   * {@link Table.hasEmptyColAt}.
   */
  hasEmptyColAt(t) {
    return this.hasColAt(t) && this.contentSizes.every((n) => n[t] === 0);
  }
  /**
   * {@link Table.hasEmptyRowOrColAt}.
   */
  hasEmptyRowOrColAt(t, n) {
    return t === "row" ? this.hasEmptyRowAt(n) : this.hasEmptyColAt(n);
  }
  /**
   * {@link Table.forEachRow}.
   */
  forEachRow(t) {
    Vt(this.rowRange, t);
  }
  /**
   * {@link Table.forEachCol}.
   */
  forEachCol(t) {
    Vt(this.colRange, t);
  }
  /**
   * {@link Table.mapEachRow}.
   */
  mapEachRow(t) {
    return De(this.rowRange, t);
  }
  /**
   * {@link Table.mapEachCol}.
   */
  mapEachCol(t) {
    return De(this.colRange, t);
  }
  /**
   * {@link Table.equals}.
   */
  equals(t) {
    const n = t._asInternal();
    return this.text.eq(n.text) && ie(this.alignments, n.alignments, (o, i) => o === i) && ie(this.cells, n.cells, (o, i) => ie(o, i, (r, l) => r.eq(l))) && ie(this.colSizes, n.colSizes, (o, i) => o === i) && ie(this.contentSizes, n.contentSizes, (o, i) => ie(o, i, (r, l) => r === l));
  }
  /**
   * {@link Table.sliceSectionAt}.
   */
  sliceSectionAt({ rowRange: t, colRange: n, startRow: o, startCol: i, endCol: r }) {
    we(t, { within: this.rowRange }), we(n, { within: this.colRange });
    const l = So(this.colSizes, n), s = So(this.alignments, n), a = [];
    let c = at.empty;
    Vt(t, (d) => {
      a.push(So(this.contentSizes[d], n));
      const u = this.absoluteCellStart({ row: d, col: i }) - k, m = this.absoluteCellEnd({ row: d, col: r }) + k;
      if (d === o) {
        c = c.append(this.sliceTextAt({ from: u, to: m })), c = c.append(Vn);
        const v = this.absoluteAlignmentStart(i) - k, w = this.absoluteAlignmentEnd(r) + k;
        c = c.append(this.sliceTextAt({ from: v, to: w }));
      } else
        c = c.append(Vn), c = c.append(this.sliceTextAt({ from: u, to: m }));
    });
    const h = new $e({ text: c, colSizes: l, contentSizes: a, alignments: s });
    return h.forEachCol((d) => {
      const u = h.calculateColSize(d), m = u - h.colSizes[d];
      h.forEachRow((v) => {
        h.addOrRemoveCellPadding({ row: v, col: d }, m);
      }), h.addOrRemoveAlignmentHyphens({ col: d, diff: m }), h.colSizes[d] = u;
    }), h.cells = h.parseCells(), h;
  }
  /**
   * {@link Table.setCellAt}.
   */
  setCellAt(t, n) {
    $(t.row, this.rowRange), $(t.col, this.colRange);
    const o = this.absoluteCellSpan(t), i = n.length;
    this.contentSizes[t.row][t.col] = i;
    const r = this.calculateColSize(t.col), l = r - ge - i;
    this.replaceTextAt(o, tr.append(n).append(Ro(l)));
    const s = r - this.colSizes[t.col];
    this.forEachRow((a) => {
      a !== t.row && this.addOrRemoveCellPadding({ row: a, col: t.col }, s);
    }), this.addOrRemoveAlignmentHyphens({ col: t.col, diff: s }), this.colSizes[t.col] = r, this.cells[t.row][t.col] = n;
  }
  /**
   * {@link Table.setAlignmentAt}.
   */
  setAlignmentAt(t, n) {
    $(t, this.colRange);
    const o = this.absoluteAlignmentSpan(t), i = or(n);
    this.alignments[t] = n;
    const r = this.calculateColSize(t), l = r - er - i, s = Xh(n, { hyphens: l });
    this.replaceTextAt(o, tr.append(s).append(Yh));
    const a = r - this.colSizes[t];
    this.forEachRow((c) => {
      this.addOrRemoveCellPadding({ row: c, col: t }, a);
    }), this.colSizes[t] = r;
  }
  /**
   * {@link Table.clearRow}.
   */
  clearRow(t) {
    $(t, this.rowRange), this.clearSection(z.of({
      row: { start: t, endExclusive: t + 1 },
      col: this.colRange
    }));
  }
  /**
   * {@link Table.clearCol}.
   */
  clearCol(t) {
    $(t, this.colRange), this.clearSection(z.of({
      row: this.rowRange,
      col: { start: t, endExclusive: t + 1 }
    }));
  }
  /**
   * {@link Table.clearRowOrCol}.
   */
  clearRowOrCol(t, n) {
    t === "row" ? this.clearRow(n) : this.clearCol(n);
  }
  /**
   * {@link Table.clearSection}.
   */
  clearSection({ rowRange: t, colRange: n }) {
    we(t, { within: this.rowRange }), we(n, { within: this.colRange }), Vt(n, (o) => {
      Vt(t, (l) => {
        this.contentSizes[l][o] = 0, this.cells[l][o] = at.empty;
      });
      const i = this.calculateColSize(o);
      Vt(t, (l) => {
        const s = this.absoluteCellSpan({ row: l, col: o });
        this.replaceTextAt(s, Ro(i));
      });
      const r = i - this.colSizes[o];
      this.forEachRow((l) => {
        re(l, t) || this.addOrRemoveCellPadding({ row: l, col: o }, r);
      }), this.addOrRemoveAlignmentHyphens({ col: o, diff: r }), this.colSizes[o] = i;
    });
  }
  /**
   * {@link Table.prependEmptyRows}.
   */
  prependEmptyRows(t) {
    this.addEmptyRowsAt({ row: this.firstRowIndex, count: t });
  }
  /**
   * {@link Table.prependEmptyCols}.
   */
  prependEmptyCols(t) {
    this.addEmptyColsAt({ col: this.firstColIndex, count: t });
  }
  /**
   * {@link Table.addEmptyRowsAt}.
   */
  addEmptyRowsAt({ row: t, count: n }) {
    if ($(t, { start: this.firstRowIndex, endExclusive: this.rowCount + 1 }), n === 0) return;
    const o = this.colSizes.map((r) => `|${" ".repeat(r)}`);
    o.push("|");
    const i = dt(o.join(""));
    if (t === this.headerRowIndex) {
      const r = this.headerRowLine(), l = this.sliceTextAt(r);
      this.replaceTextAt(r, i);
      const s = this.alignmentLine().to;
      this.addTextAt(l, s, { prependNewline: !0 }), Me(n - 1, () => this.addTextAt(i, s, { prependNewline: !0 }));
    } else if (t === this.rowCount) {
      const r = (this.hasSingleRow() ? this.alignmentLine() : this.rowLine(this.lastRowIndex)).to;
      Me(n, () => this.addTextAt(i, r, { prependNewline: !0 }));
    } else {
      const r = this.rowLine(t).from;
      Me(n, () => this.addTextAt(i, r, { appendNewline: !0 }));
    }
    this.contentSizes.splice(t, 0, ...Di(0, { rows: n, cols: this.colCount })), this.cells.splice(t, 0, ...Di(at.empty, { rows: n, cols: this.colCount }));
  }
  /**
   * {@link Table.addEmptyColsAt}.
   */
  addEmptyColsAt({ col: t, count: n }) {
    if ($(t, {
      start: this.firstColIndex,
      endExclusive: this.lastColIndex + 2
    }), n !== 0) {
      if (t === this.firstColIndex) {
        const o = dt("|   ".repeat(n)), i = dt("| - ".repeat(n));
        this.forEachRow((r) => {
          this.addTextAt(o, this.absoluteCellStart({ row: r, col: t }) - k);
        }), this.addTextAt(i, this.absoluteAlignmentStart(t) - k);
      } else {
        const o = dt("   |".repeat(n)), i = dt(" - |".repeat(n));
        this.forEachRow((r) => {
          this.addTextAt(o, this.absoluteCellEnd({ row: r, col: t - 1 }) + k);
        }), this.addTextAt(i, this.absoluteAlignmentEnd(t - 1) + k);
      }
      this.colSizes.splice(t, 0, ...He(3, { count: n })), this.alignments.splice(t, 0, ...He("none", { count: n })), this.contentSizes.forEach((o) => o.splice(t, 0, ...He(0, { count: n }))), this.cells.forEach((o) => o.splice(t, 0, ...He(at.empty, { count: n })));
    }
  }
  /**
   * {@link Table.addEmptyRowsOrColsAt}.
   */
  addEmptyRowsOrColsAt(t, { index: n, count: o }) {
    t === "row" ? this.addEmptyRowsAt({ row: n, count: o }) : this.addEmptyColsAt({ col: n, count: o });
  }
  /**
   * {@link Table.appendEmptyRows}.
   */
  appendEmptyRows(t) {
    this.addEmptyRowsAt({ row: this.lastRowIndex + 1, count: t });
  }
  /**
   * {@link Table.appendEmptyCols}.
   */
  appendEmptyCols(t) {
    this.addEmptyColsAt({ col: this.lastColIndex + 1, count: t });
  }
  /**
   * {@link Table.duplicateRowAt}.
   */
  duplicateRowAt(t) {
    if ($(t, this.rowRange), t === this.headerRowIndex) {
      const n = this.sliceTextAt(this.rowLine(t));
      this.addTextAt(n, this.alignmentLine().to, { prependNewline: !0 });
    } else {
      const n = this.rowLine(t), o = this.sliceTextAt(n);
      this.addTextAt(o, n.to, { prependNewline: !0 });
    }
    this.contentSizes.splice(t + 1, 0, [...this.contentSizes[t]]), this.cells.splice(t + 1, 0, [...this.cells[t]]);
  }
  /**
   * {@link Table.duplicateColAt}.
   */
  duplicateColAt(t) {
    $(t, this.colRange), this.forEachRow((i) => {
      const { from: r, to: l } = this.absoluteCellSpan({ row: i, col: t });
      this.addTextAt(this.sliceTextAt({ from: r, to: l + k }), l + k);
    });
    const { from: n, to: o } = this.absoluteAlignmentSpan(t);
    this.addTextAt(this.sliceTextAt({ from: n, to: o + k }), o + k), this.colSizes.splice(t + 1, 0, this.colSizes[t]), this.alignments.splice(t + 1, 0, this.alignments[t]), this.contentSizes.forEach((i) => i.splice(t + 1, 0, i[t])), this.cells.forEach((i) => i.splice(t + 1, 0, i[t]));
  }
  /**
   * {@link Table.duplicateRowOrColAt}.
   */
  duplicateRowOrColAt(t, n) {
    t === "row" ? this.duplicateRowAt(n) : this.duplicateColAt(n);
  }
  /**
   * {@link Table.moveRowAt}.
   */
  moveRowAt({ fromIndex: t, toIndex: n }) {
    if ($(t, this.rowRange), $(n, this.rowRange), t !== n) {
      if (ko(t - n) === 1) {
        const [o, i] = t < n ? [t, n] : [n, t], r = this.rowLine(o), l = this.sliceTextAt(r), s = this.rowLine(i), a = this.sliceTextAt(s);
        this.replaceTextAt(s, l), this.replaceTextAt(r, a);
      } else if (t === this.headerRowIndex) {
        const o = this.headerRowLine(), i = this.sliceTextAt(o), r = this.rowLine(this.firstDataRowIndex), l = this.sliceTextAt(r), s = this.rowLine(n);
        this.addTextAt(i, s.to, { prependNewline: !0 }), this.removeTextAt(r, { removeLeadingNewline: !0 }), this.replaceTextAt(o, l);
      } else if (n === this.headerRowIndex) {
        const o = this.rowLine(t), i = this.sliceTextAt(o), r = this.headerRowLine(), l = this.sliceTextAt(r);
        this.removeTextAt(o, { removeLeadingNewline: !0 }), this.addTextAt(l, this.alignmentLine().to, { prependNewline: !0 }), this.replaceTextAt(r, i);
      } else if (n < t) {
        const o = this.rowLine(t), i = this.sliceTextAt(o), r = this.rowLine(n);
        this.removeTextAt(o, { removeLeadingNewline: !0 }), this.addTextAt(i, r.from, { appendNewline: !0 });
      } else if (n > t) {
        const o = this.rowLine(t), i = this.sliceTextAt(o), r = this.rowLine(n);
        this.addTextAt(i, r.to, { prependNewline: !0 }), this.removeTextAt(o, { removeTrailingNewline: !0 });
      }
      Ie(this.contentSizes, { fromIndex: t, toIndex: n }), Ie(this.cells, { fromIndex: t, toIndex: n });
    }
  }
  /**
   * {@link Table.moveColAt}.
   */
  moveColAt({ fromIndex: t, toIndex: n }) {
    if ($(t, this.colRange), $(n, this.colRange), t === n) return;
    n < t ? this.forEachRow((i) => {
      const r = this.absoluteCellSpan({ row: i, col: t }), l = this.sliceTextAt({ from: r.from, to: r.to + k }), s = this.absoluteCellStart({ row: i, col: n });
      this.removeTextAt({ from: r.from, to: r.to + k }), this.addTextAt(l, s);
    }) : this.forEachRow((i) => {
      const r = this.absoluteCellSpan({ row: i, col: t }), l = this.sliceTextAt({ from: r.from - k, to: r.to }), s = this.absoluteCellEnd({ row: i, col: n });
      this.addTextAt(l, s), this.removeTextAt({ from: r.from - k, to: r.to });
    });
    const o = this.absoluteAlignmentSpan(t);
    if (n < t) {
      const i = this.sliceTextAt({
        from: o.from,
        to: o.to + k
      }), r = this.absoluteAlignmentStart(n);
      this.removeTextAt({
        from: o.from,
        to: o.to + k
      }), this.addTextAt(i, r);
    } else {
      const i = this.sliceTextAt({
        from: o.from - k,
        to: o.to
      }), r = this.absoluteAlignmentEnd(n);
      this.addTextAt(i, r), this.removeTextAt({
        from: o.from - k,
        to: o.to
      });
    }
    Ie(this.colSizes, { fromIndex: t, toIndex: n }), Ie(this.alignments, { fromIndex: t, toIndex: n }), this.contentSizes.forEach((i) => Ie(i, { fromIndex: t, toIndex: n })), this.cells.forEach((i) => Ie(i, { fromIndex: t, toIndex: n }));
  }
  /**
   * {@link Table.moveRowOrColAt}.
   */
  moveRowOrColAt(t, n) {
    t === "row" ? this.moveRowAt(n) : this.moveColAt(n);
  }
  /**
   * {@link Table.removeRowsAt}.
   */
  removeRowsAt({ row: t, count: n }) {
    if ($(t, this.rowRange), $(n, { start: 0, endExclusive: this.rowCount }), n !== 0) {
      if (t === this.headerRowIndex) {
        const o = this.rowLine(n), i = this.sliceTextAt(o), { from: r } = this.rowLine(this.firstDataRowIndex), { to: l } = o;
        this.removeTextAt({ from: r, to: l }, { removeLeadingNewline: !0 }), this.replaceTextAt(this.headerRowLine(), i);
      } else {
        const { from: o } = this.rowLine(t), { to: i } = this.rowLine(t + n - 1);
        this.removeTextAt({ from: o, to: i }, { removeLeadingNewline: !0 });
      }
      this.contentSizes.splice(t, n), this.cells.splice(t, n), this.forEachCol((o) => {
        const i = this.calculateColSize(o), r = i - this.colSizes[o];
        this.forEachRow((l) => {
          this.addOrRemoveCellPadding({ row: l, col: o }, r);
        }), this.addOrRemoveAlignmentHyphens({ col: o, diff: r }), this.colSizes[o] = i;
      });
    }
  }
  /**
   * {@link Table.removeColsAt}.
   */
  removeColsAt({ col: t, count: n }) {
    if ($(t, this.colRange), $(n, { start: 0, endExclusive: this.colCount }), n === 0) return;
    this.forEachRow((r) => {
      this.removeTextAt({
        from: this.absoluteCellStart({ row: r, col: t }),
        to: this.absoluteCellEnd({ row: r, col: t + n - 1 }) + k
      });
    });
    const { from: o } = this.absoluteAlignmentSpan(t), { to: i } = this.absoluteAlignmentSpan(t + n - 1);
    this.removeTextAt({
      from: o,
      to: i + k
    }), this.colSizes.splice(t, n), this.alignments.splice(t, n), this.contentSizes.forEach((r) => r.splice(t, n)), this.cells.forEach((r) => r.splice(t, n));
  }
  /**
   * {@link Table.removeRowsOrColsAt}.
   */
  removeRowsOrColsAt(t, { index: n, count: o }) {
    t === "row" ? this.removeRowsAt({ row: n, count: o }) : this.removeColsAt({ col: n, count: o });
  }
  /**
   * {@link Table.merge}.
   */
  merge(t, { row: n, col: o }) {
    $(n, this.rowRange), $(o, this.colRange);
    const i = n === this.headerRowIndex, r = ft(n + t.rowCount - this.rowCount, { min: 0 }), l = ft(o + t.colCount - this.colCount, { min: 0 }), s = { start: n, endExclusive: n + t.rowCount }, a = { start: o, endExclusive: o + t.colCount };
    this.appendEmptyRows(r), this.appendEmptyCols(l);
    const c = t._asInternal();
    if (Vt(s, (h) => {
      this.contentSizes[h].splice(o, c.colCount, ...c.contentSizes[h - n]), this.cells[h].splice(o, c.colCount, ...c.cells[h - n]);
      const d = {
        from: this.absoluteCellStart({ row: h, col: a.start }) - k,
        to: this.absoluteCellEnd({ row: h, col: a.endExclusive - 1 }) + k
      }, u = c.sliceTextAt(c.rowLine(h - n));
      this.replaceTextAt(d, u);
    }), i) {
      this.alignments.splice(o, c.colCount, ...c.alignments);
      const h = {
        from: this.absoluteAlignmentStart(a.start) - k,
        to: this.absoluteAlignmentEnd(a.endExclusive - 1) + k
      }, d = c.sliceTextAt(c.alignmentLine());
      this.replaceTextAt(h, d);
    }
    Vt(a, (h) => {
      const d = this.calculateColSize(h), u = d - this.colSizes[h], m = d - c.colSizes[h - o];
      this.forEachRow((v) => {
        this.addOrRemoveCellPadding({ row: v, col: h }, re(v, s) ? m : u);
      }), this.addOrRemoveAlignmentHyphens({ col: h, diff: i ? m : u }), this.colSizes[h] = d;
    });
  }
  /**
   * {@link Table.tile}.
   */
  tile({ rowRepeat: t, colRepeat: n }) {
    if (!(t === 0 && n === 0)) {
      if (n >= 1) {
        this.forEachRow((l) => {
          const { from: s, to: a } = this.rowLine(l), c = this.sliceTextAt({ from: s + k, to: a });
          this.addTextAt(xo(c, n), a);
        });
        const { from: o, to: i } = this.alignmentLine(), r = this.sliceTextAt({ from: o + k, to: i });
        this.addTextAt(xo(r, n), i), this.alignments = Tn(this.alignments, n + 1), this.colSizes = Tn(this.colSizes, n + 1), this.forEachRow((l) => {
          this.contentSizes[l] = Tn(this.contentSizes[l], n + 1), this.cells[l] = Tn(this.cells[l], n + 1);
        });
      }
      if (t >= 1) {
        const { from: o, to: i } = this.alignmentLine(), r = this.text.replace(o - k, i, at.empty);
        this.appendText(xo(eo(r, { prependNewline: !0 }), t));
        const l = this.rowRange;
        Me(t, () => {
          Vt(l, (s) => {
            this.contentSizes.push([...this.contentSizes[s]]), this.cells.push([...this.cells[s]]);
          });
        });
      }
    }
  }
  /**
   * {@link Table.sortByColAt}.
   */
  sortByColAt(t, n) {
    if ($(t, this.colRange), this.rowCount === 1) return;
    const o = {
      start: this.firstDataRowIndex,
      endExclusive: this.lastRowIndex + 1
    }, i = De(o, (c) => c).sort((c, h) => n(this.cellAt({ row: c, col: t }), this.cellAt({ row: h, col: t }))), r = this.rowLines(), l = r.map(({ from: c, to: h }) => this.sliceTextAt({ from: c, to: h })), s = [...this.contentSizes], a = [...this.cells];
    Vt(o, (c) => {
      const h = i[c - this.firstDataRowIndex];
      c !== h && (this.replaceTextAt(r[c], l[h]), this.contentSizes[c] = s[h], this.cells[c] = a[h]);
    });
  }
  /**
   * {@link Table.reset}.
   */
  reset(t) {
    const { text: n, colSizes: o, alignments: i, contentSizes: r } = zo(t);
    this.text = n, this.colSizes = o, this.alignments = i, this.contentSizes = r, this.cells = this.parseCells();
  }
  /**
   * {@link Table._asInternal}.
   */
  _asInternal() {
    return this;
  }
  toJSON() {
    return {
      text: this.text.toString(),
      colSizes: yo(this.colSizes),
      alignments: yo(this.alignments),
      contentSizes: yo(this.contentSizes),
      cells: this.cells.map((t) => t.map((n) => n.toString()))
    };
  }
  addTextAt(t, n, { prependNewline: o = !1, appendNewline: i = !1 } = {}) {
    this.text = sa(this.text, { text: t, at: n, prependNewline: o, appendNewline: i });
  }
  appendText(t, { prependNewline: n = !1, appendNewline: o = !1 } = {}) {
    this.text = aa(this.text, { text: t, prependNewline: n, appendNewline: o });
  }
  removeTextAt(t, { removeLeadingNewline: n = !1, removeTrailingNewline: o = !1 } = {}) {
    this.text = ca(this.text, { location: t, removeLeadingNewline: n, removeTrailingNewline: o });
  }
  replaceTextAt(t, n, { prependNewline: o = !1, appendNewline: i = !1 } = {}) {
    this.text = ha(this.text, { span: t, text: n, prependNewline: o, appendNewline: i });
  }
  sliceTextAt({ from: t, to: n }) {
    return this.text.slice(t, n);
  }
  addAlignmentHyphens({ col: t, count: n }) {
    this.addTextAt(ln(n), this.absoluteAlignmentStart(t) + ge + Ao);
  }
  removeAlignmentHyphens({ col: t, count: n }) {
    const o = this.absoluteAlignmentStart(t);
    this.removeTextAt({
      from: o + ge + Ao,
      to: o + ge + Ao + n
    });
  }
  addOrRemoveAlignmentHyphens({ col: t, diff: n }) {
    n < 0 ? this.removeAlignmentHyphens({ col: t, count: -n }) : n > 0 && this.addAlignmentHyphens({ col: t, count: n });
  }
  addCellPadding(t, n) {
    this.addTextAt(Ro(n), this.absoluteCellContentEnd(t) + 1);
  }
  removeCellPadding(t, n) {
    const o = this.absoluteCellContentEnd(t);
    this.removeTextAt({
      from: o,
      to: o + n
    });
  }
  addOrRemoveCellPadding(t, n) {
    n < 0 ? this.removeCellPadding(t, -n) : n > 0 && this.addCellPadding(t, n);
  }
  alignmentLine() {
    return this.text.line(nr);
  }
  headerRowLine() {
    return this.text.line(1);
  }
  rowLine(t) {
    return this.text.line(t === this.headerRowIndex ? t + 1 : t + 2);
  }
  rowLines() {
    return Un(this.text.lines - 1, (t) => this.text.line(t === this.headerRowIndex ? t + 1 : t + 2));
  }
  relativeCellStart(t) {
    const o = (t + 1) * k, i = Oi(this.colSizes, { start: 0, endExclusive: t });
    return o + i;
  }
  relativeCellStarts() {
    const t = _a(this.colSizes);
    return this.mapEachCol((n) => {
      const i = (n + 1) * k, r = n === this.firstColIndex ? 0 : t[n - 1];
      return i + r;
    });
  }
  relativeCellContentStart(t) {
    return this.relativeCellStart(t) + ge;
  }
  relativeCellContentStarts() {
    return this.relativeCellStarts().map((t) => t + ge);
  }
  relativeCellEnd(t) {
    const o = (t + 1) * k, i = Oi(this.colSizes, { start: 0, endExclusive: t + 1 });
    return o + i;
  }
  relativeCellSpan(t) {
    const n = this.relativeCellStart(t);
    return { from: n, to: n + this.colSizes[t] };
  }
  relativeAlignmentStart(t) {
    return this.relativeCellStart(t);
  }
  relativeAlignmentEnd(t) {
    return this.relativeCellEnd(t);
  }
  relativeAlignmentSpan(t) {
    return this.relativeCellSpan(t);
  }
  absoluteCellStart({ row: t, col: n }) {
    return en(this.rowLine(t), this.relativeCellStart(n));
  }
  absoluteCellContentSpan({ row: t, col: n }) {
    const o = this.relativeCellStart(n) + ge, i = o + this.contentSizes[t][n];
    return In(this.rowLine(t), { from: o, to: i });
  }
  absoluteCellContentEnd(t) {
    return en(this.rowLine(t.row), this.relativeCellContentStart(t.col) + this.contentSizes[t.row][t.col]);
  }
  absoluteCellEnd({ row: t, col: n }) {
    return en(this.rowLine(t), this.relativeCellEnd(n));
  }
  absoluteCellSpan({ row: t, col: n }) {
    return In(this.rowLine(t), this.relativeCellSpan(n));
  }
  absoluteAlignmentStart(t) {
    return en(this.alignmentLine(), this.relativeAlignmentStart(t));
  }
  absoluteAlignmentEnd(t) {
    return en(this.alignmentLine(), this.relativeAlignmentEnd(t));
  }
  absoluteAlignmentSpan(t) {
    return In(this.alignmentLine(), this.relativeAlignmentSpan(t));
  }
  calculateColSize(t) {
    const n = Un(this.rowCount, (i) => this.contentSizes[i][t]), o = or(this.alignments[t]);
    return Xo(...n, o) + er;
  }
  parseCells() {
    const t = this.rowLines(), n = this.relativeCellContentStarts();
    return this.mapEachRow((o) => this.mapEachCol((i) => {
      const r = {
        from: n[i],
        to: n[i] + this.contentSizes[o][i]
      }, { from: l, to: s } = In(t[o], r);
      return this.text.slice(l, s);
    }));
  }
  /**
   * {@link Table.of}.
   */
  static of(t) {
    return new $e(zo(t));
  }
  /**
   * {@link Table.maybeOf}.
   */
  static maybeOf(t) {
    const n = Dr(t);
    return b(n) ? new $e(n) : void 0;
  }
  constructor({ text: t, colSizes: n, alignments: o, contentSizes: i }) {
    this.#t = /* @__PURE__ */ M(gt(t)), this.#n = /* @__PURE__ */ M(gt(n)), this.#e = /* @__PURE__ */ M(gt(o)), this.#o = /* @__PURE__ */ M(gt(i)), this.#i = /* @__PURE__ */ M(gt(this.parseCells()));
  }
}
function ze(e, t) {
  return e?.row === t?.row && e?.col === t?.col;
}
function $l({ row: e, col: t }) {
  return { row: e - 1, col: t };
}
function Ul({ row: e, col: t }) {
  return { row: e, col: t + 1 };
}
function Vl({ row: e, col: t }) {
  return { row: e + 1, col: t };
}
function ql({ row: e, col: t }) {
  return { row: e, col: t - 1 };
}
function To(e, t, n) {
  return e === "row" ? n === "backward" ? $l(t) : Vl(t) : n === "backward" ? ql(t) : Ul(t);
}
function ir(e, t, { start: n, count: o }) {
  return qo(
    e,
    t,
    n <= t[e] ? t[e] + o : t[e]
  );
}
function rr(e, t, {
  start: n,
  count: o,
  boundary: i
}) {
  return b(i) && (i.min, i.max, void 0), n - o - 1 >= t[e] ? t : n <= t[e] ? qo(e, t, t[e] - o) : b(i) ? qo(
    e,
    t,
    ft(t[e], { min: i.min, max: i.max })
  ) : void 0;
}
function qo(e, t, n) {
  return e === "row" ? { row: n, col: t.col } : { row: t.row, col: n };
}
function Wl(e, t) {
  return e?.anchor === t?.anchor && e?.head === t?.head;
}
function jl({ anchor: e, head: t }) {
  return e <= t ? { from: e, to: t } : { from: t, to: e };
}
function Kl({ anchor: e, head: t }) {
  return e <= t;
}
function Jh(e, t) {
  return ze(e?.cell, t?.cell) && Wl(e?.section, t?.section);
}
function Zh(e) {
  return e === "hidden";
}
function Qh(e) {
  return e === "all";
}
function tu(e) {
  return e === "none";
}
function Nn(e) {
  return !Gs(e);
}
function ho(e, t) {
  return Nn(e) ? Nn(t) && Jh(e, t) : !Nn(t) && e === t;
}
class mi {
  #t;
  get value() {
    return f(this.#t);
  }
  set value(t) {
    y(this.#t, t, !0);
  }
  isHidden() {
    return Zh(this.value);
  }
  isAll() {
    return Qh(this.value);
  }
  isNone() {
    return tu(this.value);
  }
  isCell() {
    return Nn(this.value);
  }
  get cell() {
    return this.isCell() ? this.value.cell : void 0;
  }
  get cellSection() {
    return this.isCell() ? this.value.section : void 0;
  }
  equals(t) {
    return ho(this.value, t.value);
  }
  toJSON() {
    return this.isCell() ? { value: { cell: this.cell, section: this.cellSection } } : { value: this.value };
  }
  static of(t) {
    return new mi(t);
  }
  constructor(t) {
    this.#t = /* @__PURE__ */ M(gt(t));
  }
}
class pi {
  #t;
  get _editorTableText() {
    return f(this.#t);
  }
  set _editorTableText(t) {
    y(this.#t, t, !0);
  }
  #n;
  get _editorSelectionValue() {
    return f(this.#n);
  }
  set _editorSelectionValue(t) {
    y(this.#n, t, !0);
  }
  _span;
  source;
  table;
  selection;
  get editorTableText() {
    return this._editorTableText;
  }
  get editorSelectionValue() {
    return this._editorSelectionValue;
  }
  get span() {
    return this._span;
  }
  set span(t) {
    this._span = t;
  }
  get from() {
    return this._span.from;
  }
  get to() {
    return this._span.to;
  }
  get isValid() {
    return this.from < this.to;
  }
  containsSelection() {
    return this.selection.isCell() || this.selection.isHidden();
  }
  markSynchronized() {
    this._editorTableText = this.table.text, this._editorSelectionValue = this.selection.value;
  }
  applyTransaction(t) {
    t.docChanged ? this.applyStateChange(t) : this.applySelectionChange(t);
  }
  applyStateChange(t) {
    const { from: n, to: o } = this.span;
    if (this.span = {
      from: t.changes.mapPos(this.from, 1),
      to: t.changes.mapPos(this.to)
    }, this.isValid) {
      const r = t.newDoc.slice(this.from, this.to);
      if (jh(t) && t.changes.touchesRange(n, o) !== !1)
        this.table.reset(r), this._editorTableText = this.table.text;
      this.source = new SourceTable(r, this.table.colCount);
      this.applySelectionChange(t);
    }
  }
  applySelectionChange(t) {
    if (!this.isValid) return;
    const n = this.computeSelection(t.newSelection, fi(t) && this.selection.isCell() ? this.selection.cell : void 0);
    !ho(this.selection.value, n) && (this.selection.value = n, this._editorSelectionValue = n);
  }
  computeSelection(t, preferredCell) {
    if (!preferredCell && t.main.head === this.from + 1 && t.main.anchor === this.from + 1)
      return "hidden";
    if (Ni({ needle: this.span, haystack: t.main }))
      return "all";
    if (Ni({ needle: t.main, haystack: this.span })) {
      const n = this.source.closestCell(t.main.anchor - this.from, preferredCell), { from: o, to: i } = this.source.cellSpan(n);
      return {
        cell: n,
        section: {
          anchor: ft(t.main.anchor - this.from, { min: o, max: i }) - o,
          head: ft(t.main.head - this.from, { min: o, max: i }) - o
        }
      };
    } else
      return "none";
  }
  static of(t) {
    return new pi(t);
  }
  constructor({ span: t, doc: n, selection: o }) {
    this._span = t, this.table = dn.of(n.slice(this.from, this.to)), this.source = new SourceTable(n.slice(this.from, this.to), this.table.colCount), this.selection = mi.of(this.computeSelection(o)), this.#t = /* @__PURE__ */ M(gt(this.table.text)), this.#n = /* @__PURE__ */ M(gt(this.selection.value));
  }
}
const eu = { top: 0, right: 0, bottom: 0, left: 0 }, Yl = {
  pos: 0,
  clip: !1,
  create(e) {
    const t = un(e.dom).createElement("div");
    return t.className = "tbl-menu-tooltip", { dom: t, overlap: !0, resize: !1, getCoords: () => eu };
  }
}, fn = "Cell";
function _n(e) {
  return Hl(e, { component: fn });
}
function Gn(e, { row: t, col: n }) {
  return Ml(e, { component: fn, row: `${t}`, col: `${n}` });
}
function uo(e) {
  if (!Bl(e, { component: fn })) return;
  const t = hi(e);
  return {
    row: Mi(t.dataset.row),
    col: Mi(t.dataset.col)
  };
}
const nu = "5";
typeof window < "u" && ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add(nu);
const ou = typeof window < "u" ? window : void 0;
function iu(e) {
  let t = e.activeElement;
  for (; t?.shadowRoot; ) {
    const n = t.shadowRoot.activeElement;
    if (n === t)
      break;
    t = n;
  }
  return t;
}
class ru {
  #t;
  #n;
  constructor(t = {}) {
    const { window: n = ou, document: o = n?.document } = t;
    n !== void 0 && (this.#t = o, this.#n = tl((i) => {
      const r = J(n, "focusin", i), l = J(n, "focusout", i);
      return () => {
        r(), l();
      };
    }));
  }
  get current() {
    return this.#n?.(), this.#t ? iu(this.#t) : null;
  }
}
new ru();
function lu(e, t) {
  switch (e) {
    case "post":
      lo(t);
      break;
    case "pre":
      oh(t);
      break;
  }
}
function Xl(e, t, n, o = {}) {
  const { lazy: i = !1 } = o;
  let r = !i, l = Array.isArray(e) ? [] : void 0;
  lu(t, () => {
    const s = Array.isArray(e) ? e.map((c) => c()) : e();
    if (!r) {
      r = !0, l = s;
      return;
    }
    const a = Sn(() => n(s, l));
    return l = s, a;
  });
}
function vi(e, t, n) {
  Xl(e, "post", t, n);
}
function su(e, t, n) {
  Xl(e, "pre", t, n);
}
vi.pre = su;
function ye(e) {
  return e ? "" : void 0;
}
function lr(e) {
  return e.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function sr(...e) {
  return La($s(...e));
}
const au = ra();
function cu(e, t) {
  const n = jn(e), o = t.style([]) ?? void 0, i = [];
  return da(n, (r) => {
    if (ua(r)) {
      i.push([]);
      return;
    }
    const l = au.parse(new Ko(r)).cursor(), s = qn(l), a = [];
    Wo({
      cursor: s,
      from: 0,
      to: s.to,
      text: r,
      classes: b(o) ? o.split(" ") : [],
      highlighter: t,
      elementLine: a
    }), i.push(a);
  }), i;
}
function Wo({
  cursor: e,
  from: t,
  to: n,
  text: o,
  classes: i,
  passedClasses: r = [],
  highlighter: l,
  textOffset: s = 0,
  elementLine: a
}) {
  if (!e.firstChild()) {
    const d = e.tree?.prop(Ns.mounted)?.tree;
    if (b(d)) {
      const u = d.cursor();
      Wo({
        cursor: u,
        from: u.from,
        to: u.to,
        text: o,
        classes: i,
        passedClasses: r,
        highlighter: l,
        textOffset: s + t,
        elementLine: a
      });
    } else
      a.push({
        textContent: o.sliceString(s + t, s + n),
        classes: _o(i)
      });
    return;
  }
  let h = t;
  do {
    e.from > h && a.push({
      textContent: o.sliceString(s + h, s + e.from),
      classes: _o(i)
    }), h = e.to;
    const d = Us(e), u = l.style(d?.tags ?? []), m = b(u) ? u.split(" ") : [];
    Wo({
      cursor: e,
      from: e.from,
      to: e.to,
      text: o,
      classes: [...r, ...m],
      passedClasses: d?.inherit ?? !1 ? [...r, ...m] : r,
      highlighter: l,
      textOffset: s,
      elementLine: a
    });
  } while (e.nextSibling());
  h < n && a.push({
    textContent: o.sliceString(s + h, s + n),
    classes: _o(i)
  }), e.parent();
}
function hu(e, t) {
  return uu(cu(e, t));
}
function uu(e) {
  return e.map((t) => t.map(du).join("")).join(`<span data-br>
</span>`);
}
function du({ textContent: e, classes: t }) {
  return b(t) ? `<span class="${t.join(" ")}">${lr(e)}</span>` : lr(e);
}
const fu = [
  { type: "table", location: "bottom-right" },
  { type: "table", location: "right" },
  { type: "table", location: "bottom" }
];
function mu({ row: e, col: t }, n) {
  const o = [
    { type: "header", location: "col", index: t },
    { type: "border", location: "top", index: e }
  ], i = [
    { type: "border", location: "col", index: t + 1 },
    { type: "border", location: "row", index: e + 1 }
  ], r = [
    { type: "header", location: "row", index: e },
    { type: "border", location: "left", index: e }
  ];
  return [
    ...n.top ? o : [],
    ...i,
    ...n.left ? r : []
  ];
}
function pu({ location: e, type: t }, n) {
  return t === "header" ? { location: e, type: t, index: n[e] } : e === "top" ? { location: e, type: t, index: n.row } : e === "left" ? { location: e, type: t, index: n.col } : { location: e, type: t, index: n[e] + 1 };
}
function jo(e, t) {
  return e?.type !== t?.type || e?.location !== t?.location ? !1 : e?.type === "table" || t?.type === "table" ? !0 : e?.index === t?.index;
}
class Jn {
  state;
  extraTags;
  style(t) {
    return Ps(this.state, b(this.extraTags) ? [...t, ...this.extraTags] : t);
  }
  static of(t, n) {
    return new Jn(t, n);
  }
  constructor(t, n) {
    this.state = t, this.extraTags = n;
  }
}
function Gl(e) {
  return fo(e).type === "None";
}
function Jl(e) {
  return !Gl(e);
}
function ar(e) {
  return Jl(e) ? fo(e).getRangeAt(0).startOffset : void 0;
}
function vu(e) {
  return Jl(e) ? fo(e).getRangeAt(0).startContainer : void 0;
}
function bu(e) {
  fo(e).empty();
}
function fo(e) {
  return e.getSelection();
}
class bi {
  #t;
  get table() {
    return f(this.#t);
  }
  set table(t) {
    y(this.#t, t);
  }
  #n;
  get _selection() {
    return f(this.#n);
  }
  set _selection(t) {
    y(this.#n, t);
  }
  #e;
  get selectionChanged() {
    return f(this.#e);
  }
  set selectionChanged(t) {
    y(this.#e, t, !0);
  }
  #o;
  get activeCell() {
    return f(this.#o);
  }
  set activeCell(t) {
    y(this.#o, t);
  }
  #i;
  get anchorCell() {
    return f(this.#i);
  }
  set anchorCell(t) {
    y(this.#i, t);
  }
  #s;
  get outlinedSection() {
    return f(this.#s);
  }
  set outlinedSection(t) {
    y(this.#s, t);
  }
  #r;
  get rootEditor() {
    return f(this.#r);
  }
  set rootEditor(t) {
    y(this.#r, t);
  }
  #l;
  get extensions() {
    return f(this.#l);
  }
  set extensions(t) {
    y(this.#l, t);
  }
  #a;
  get markdownConfig() {
    return f(this.#a);
  }
  set markdownConfig(t) {
    y(this.#a, t);
  }
  #h;
  get globalKeyBindings() {
    return f(this.#h);
  }
  set globalKeyBindings(t) {
    y(this.#h, t);
  }
  #c;
  get selectionType() {
    return f(this.#c);
  }
  set selectionType(t) {
    y(this.#c, t);
  }
  #d;
  get lineWrapping() {
    return f(this.#d);
  }
  set lineWrapping(t) {
    y(this.#d, t);
  }
  #f;
  get wrapperElement() {
    return f(this.#f);
  }
  set wrapperElement(t) {
    y(this.#f, t);
  }
  #m;
  get tableElement() {
    return f(this.#m);
  }
  set tableElement(t) {
    y(this.#m, t);
  }
  #u;
  get scrollElement() {
    return f(this.#u);
  }
  set scrollElement(t) {
    y(this.#u, t);
  }
  #g;
  get menuRootElement() {
    return f(this.#g);
  }
  set menuRootElement(t) {
    y(this.#g, t);
  }
  #w;
  get headerCellHighlighter() {
    return f(this.#w);
  }
  set headerCellHighlighter(t) {
    y(this.#w, t);
  }
  #C;
  get dataCellHighlighter() {
    return f(this.#C);
  }
  set dataCellHighlighter(t) {
    y(this.#C, t);
  }
  #v;
  get onUndo() {
    return f(this.#v);
  }
  set onUndo(t) {
    y(this.#v, t);
  }
  #p;
  get onRedo() {
    return f(this.#p);
  }
  set onRedo(t) {
    y(this.#p, t);
  }
  #b;
  get onNavigate() {
    return f(this.#b);
  }
  set onNavigate(t) {
    y(this.#b, t);
  }
  #x;
  get onDelete() {
    return f(this.#x);
  }
  set onDelete(t) {
    y(this.#x, t);
  }
  #S;
  get activeTable() {
    return f(this.#S);
  }
  set activeTable(t) {
    y(this.#S, t);
  }
  #_;
  get hoveredCell() {
    return f(this.#_);
  }
  set hoveredCell(t) {
    y(this.#_, t);
  }
  #y;
  get activeHandle() {
    return f(this.#y);
  }
  set activeHandle(t) {
    y(this.#y, t);
  }
  #E;
  get menu() {
    return f(this.#E);
  }
  set menu(t) {
    y(this.#E, t);
  }
  #R;
  get move() {
    return f(this.#R);
  }
  set move(t) {
    y(this.#R, t);
  }
  #A;
  get outline() {
    return f(this.#A);
  }
  set outline(t) {
    y(this.#A, t);
  }
  #T;
  get resize() {
    return f(this.#T);
  }
  set resize(t) {
    y(this.#T, t);
  }
  #k;
  get interactive() {
    return f(this.#k);
  }
  set interactive(t) {
    y(this.#k, t);
  }
  #z;
  get pointerDown() {
    return f(this.#z);
  }
  set pointerDown(t) {
    y(this.#z, t);
  }
  static of(t) {
    return new bi(t);
  }
  focusTable() {
    this.activeTable = !0, this.tableElement.focus({ preventScroll: !0 }), this.selectionValue = "hidden", bu(this.document);
  }
  scrollToCell(t) {
    requestAnimationFrame(() => {
      Gn(this.tableElement, t)?.scrollIntoView({ inline: "nearest", block: "nearest" });
    });
  }
  scrollToFirstCell(t, n) {
    requestAnimationFrame(() => {
      Gn(this.tableElement, { ...this.table.firstCellLocation, [t]: n })?.scrollIntoView({ inline: "nearest", block: "nearest" });
    });
  }
  get document() {
    return this.rootEditor.dom.ownerDocument;
  }
  get window() {
    return this.document.defaultView ?? window;
  }
  get rootScrollElement() {
    return this.rootEditor.scrollDOM;
  }
  get scrollOffsetX() {
    return this.rootScrollElement.scrollLeft + this.scrollElement.scrollLeft;
  }
  get scrollOffsetY() {
    return this.rootScrollElement.scrollTop + this.scrollElement.scrollTop;
  }
  deleteTable() {
    this.onDelete();
  }
  navigate(t) {
    this.onNavigate(t);
  }
  undo() {
    this.onUndo();
  }
  redo() {
    this.onRedo();
  }
  get selection() {
    return this._selection;
  }
  get selectionValue() {
    return this._selection.value;
  }
  set selectionValue(t) {
    ho(this._selection.value, t) || (this._selection.value = t, this.selectionChanged = !0);
  }
  highlighter({ row: t }) {
    return t === this.table.firstRowIndex ? this.headerCellHighlighter : this.dataCellHighlighter;
  }
  cellHandleState(t, n) {
    return n.type === "border" || this.activeHandle?.state == "active" ? jo(this.activeHandle?.handle, n) ? this.activeHandle?.state : void 0 : jo(this.activeHandle?.handle, n) || t[n.location] === this.activeCell?.[n.location] ? "hover" : void 0;
  }
  constructor({
    table: t,
    selection: n,
    scrollElement: o,
    rootEditor: i,
    menuRootElement: r,
    extensions: l,
    markdownConfig: s,
    globalKeyBindings: a,
    selectionType: c,
    lineWrapping: h,
    onUndo: d,
    onRedo: u,
    onNavigate: m,
    onDelete: v
  }) {
    this.#t = /* @__PURE__ */ A(t), this.#n = /* @__PURE__ */ A(n), this.#e = /* @__PURE__ */ M(!1);
    const w = this.selection.isCell() ? this.selection.cell : void 0;
    this.#o = /* @__PURE__ */ M(w), this.#i = /* @__PURE__ */ M(w), this.#s = /* @__PURE__ */ M(b(w) ? z.ofCell(w) : void 0), this.#r = /* @__PURE__ */ A(i), this.#l = /* @__PURE__ */ A(l), this.#a = /* @__PURE__ */ A(s), this.#h = /* @__PURE__ */ A(a), this.#c = /* @__PURE__ */ A(c), this.#d = /* @__PURE__ */ A(h), this.#f = /* @__PURE__ */ M(void 0), this.#m = /* @__PURE__ */ M(void 0), this.#u = /* @__PURE__ */ A(o), this.#g = /* @__PURE__ */ A(r), this.#w = /* @__PURE__ */ A(() => Jn.of(this.rootEditor.state, [Vs.heading])), this.#C = /* @__PURE__ */ A(() => Jn.of(this.rootEditor.state)), this.#v = /* @__PURE__ */ A(d), this.#p = /* @__PURE__ */ A(u), this.#b = /* @__PURE__ */ A(m), this.#x = /* @__PURE__ */ A(v), this.#S = /* @__PURE__ */ M(!1), this.#_ = /* @__PURE__ */ M(void 0), this.#y = /* @__PURE__ */ M(void 0), this.#E = /* @__PURE__ */ M(void 0), this.#R = /* @__PURE__ */ M(void 0), this.#A = /* @__PURE__ */ M(void 0), this.#T = /* @__PURE__ */ M(void 0), this.#k = /* @__PURE__ */ A(() => _(this.move) && _(this.resize) && _(this.menu) && _(this.outline)), this.#z = /* @__PURE__ */ M(!1);
    const p = /* @__PURE__ */ A(() => {
      if (oo(this.window)) {
        if (b(this.menu))
          return "default";
        if (b(this.activeHandle)) {
          const { type: S, location: g } = this.activeHandle.handle;
          if (S === "table") {
            if (g === "right")
              return "col-resize";
            if (g === "bottom-right")
              return "nwse-resize";
            if (g === "bottom")
              return "row-resize";
          } else {
            if (S === "border")
              return g === "top" ? "row-resize" : g === "left" ? "col-resize" : `${g}-resize`;
            if (S === "header")
              return this.pointerDown ? "grabbing" : this.activeHandle.state === "hover" ? "pointer" : void 0;
          }
        } else {
          if (this.outline?.outlined ?? !1)
            return "cell";
          if (b(this.hoveredCell))
            return "text";
        }
      }
    });
    vi([() => this.selectionValue], () => {
      if (this.selectionChanged) {
        this.selectionChanged = !1;
        return;
      }
      this.selection.isCell() ? (this.activeCell = this.selection.cell, this.anchorCell = this.selection.cell, this.outlinedSection = z.ofCell(this.selection.cell)) : this.selection.isHidden() ? (this.focusTable(), this.activeCell = void 0, this.anchorCell = void 0, this.outlinedSection = void 0) : (this.activeTable = !1, this.activeCell = void 0, this.anchorCell = void 0, this.outlinedSection = void 0);
    }), lo(() => {
      this.document.body.style.cursor = f(p) ?? "";
    });
  }
}
function Zl({
  tableState: e,
  event: t
}) {
  if (_(e.outlinedSection)) return;
  t?.preventDefault();
  const n = Qi(
    e.outlinedSection.rowRange,
    e.table.rowRange
  ), o = Qi(
    e.outlinedSection.colRange,
    e.table.colRange
  ), i = o && !n && se(e.outlinedSection.rowRange).every(
    (s) => e.table.hasEmptyRowAt(s)
  ), r = n && !o && se(e.outlinedSection.colRange).every(
    (s) => e.table.hasEmptyColAt(s)
  ), l = n && o && se(e.outlinedSection.colRange).every(
    (s) => e.table.hasEmptyColAt(s)
  );
  if (i) {
    e.table.removeRowsAt({
      row: e.outlinedSection.startRow,
      count: e.outlinedSection.rowCount
    });
    const s = e.table.hasRowAt(e.outlinedSection.startRow) ? e.outlinedSection.startRow : e.table.lastRowIndex, a = { row: s, col: e.table.lastColIndex };
    e.outlinedSection = z.of({
      row: { start: s, endExclusive: s + 1 },
      col: e.table.colRange
    }), e.activeCell = a, e.anchorCell = a;
  } else if (r) {
    e.table.removeColsAt({
      col: e.outlinedSection.startCol,
      count: e.outlinedSection.colCount
    });
    const s = e.table.hasColAt(e.outlinedSection.startCol) ? e.outlinedSection.startCol : e.table.lastColIndex, a = { row: e.table.lastRowIndex, col: s };
    e.outlinedSection = z.of({
      row: e.table.rowRange,
      col: { start: s, endExclusive: s + 1 }
    }), e.activeCell = a, e.anchorCell = a;
  } else l ? e.deleteTable() : e.table.clearSection(e.outlinedSection);
}
function Ql(e) {
  es(e, "copy");
}
function ts(e) {
  es(e, "cut");
}
function gi({
  event: e,
  tableState: t
}) {
  if (_(t.outlinedSection)) return;
  const n = e.clipboardData.getData("text/plain"), o = dn.maybeOf(at.of(n.split(/\r\n|\n|\r/)));
  b(o) ? (e.preventDefault(), e.stopPropagation(), cr(o, t)) : t.selection.isCell() || (e.preventDefault(), e.stopPropagation(), cr(gu(n), t));
}
function cr(e, t) {
  const {
    startRow: n,
    startCol: o,
    rowCount: i,
    colCount: r
  } = t.outlinedSection, l = Pi(i / e.rowCount), s = Pi(r / e.colCount);
  e.tile({
    rowRepeat: ft(l - 1, { min: 0 }),
    colRepeat: ft(s - 1, { min: 0 })
  }), t.table.merge(e, { row: n, col: o }), t.outlinedSection = z.of({
    row: { start: n, endExclusive: n + e.rowCount },
    col: { start: o, endExclusive: o + e.colCount }
  }), _(t.anchorCell) && (t.anchorCell = t.activeCell);
  const a = t.anchorCell.row <= t.activeCell.row, c = t.anchorCell.col <= t.activeCell.col;
  t.anchorCell = t.outlinedSection.cornerCellAt(
    `${a ? "top" : "bottom"}-${c ? "left" : "right"}`
  ), t.activeCell = t.outlinedSection.cornerCellAt(
    `${a ? "bottom" : "top"}-${c ? "right" : "left"}`
  ), t.focusTable();
}
function gu(e) {
  const { text: t } = Lr([[dt(e)]], ["none"]);
  return dn.of(t);
}
function es({
  event: e,
  tableState: t
}, n) {
  if (_(t.outlinedSection) || t.selection.isCell()) return;
  e.preventDefault(), e.stopPropagation();
  const o = t.table.sliceSectionAt(t.outlinedSection);
  e.clipboardData?.setData("text/plain", o.text.toString()), n === "cut" && Zl({ tableState: t });
}
function wu(e) {
  e.pointerDown = !0;
}
function Cu(e) {
  e.pointerDown = !1;
}
function xu(e) {
  e.pointerDown = !1;
}
function Su(e, t) {
  t.selection.isCell() || Ql({ tableState: t, event: e });
}
function _u(e, t) {
  t.selection.isCell() || ts({ tableState: t, event: e });
}
function yu(e, t) {
  t.selection.isCell() || gi({ tableState: t, event: e });
}
const wi = "CellView";
function ns(e) {
  return Hl(e, { component: wi });
}
function Eu(e) {
  return Ml(e, { component: wi });
}
const le = "\0";
function os(e, t, { trim: n }) {
  const o = Kl(e), { from: i, to: r } = jl(e), l = t.toString(), s = at.of(
    `${l.slice(0, i)}${le}${l.slice(i, r)}${le}${l.slice(r)}`.split(
      `
`
    )
  ), a = Go(s, { trim: n }).toString(), c = a.indexOf(le), h = a.lastIndexOf(le) - 1;
  return o ? { anchor: c, head: h } : { head: c, anchor: h };
}
function hr(e, t) {
  const n = Kl(e), { from: o, to: i } = jl(e), r = t.toString(), l = at.of(
    `${r.slice(0, o)}${le}${r.slice(o, i)}${le}${r.slice(i)}`.split(
      `
`
    )
  ), s = jn(l).toString(), a = s.indexOf(le), c = s.lastIndexOf(le) - 1;
  return n ? { anchor: a, head: c } : { head: a, anchor: c };
}
function Ru(e) {
  if (_(e.tableElement) || Gl(e.document)) return;
  const t = vu(e.document);
  if (_(t) || !Il(e.tableElement, t)) return;
  const n = _n(t);
  if (_(n)) return;
  const o = uo(n);
  e.selection.isCell() && ze(e.selection.cell, o) || (e.activeTable = !1, e.selectionValue = {
    cell: o,
    section: Au(e.document, t)
  }, e.activeCell = o, e.anchorCell = o, e.outlinedSection = z.ofCell(o));
}
function Au(e, t) {
  const n = ns(t), o = zh({
    ancestor: n,
    descendent: t,
    getText: (a) => Th(a) ? `
` : a.textContent ?? ""
  }) ?? "", i = (t.textContent ?? "").slice(
    0,
    ar(e)
  ), r = dt(`${o}${i}`), l = o.length + ar(e);
  return os({ anchor: l, head: l }, r, { trim: !1 });
}
function Tu(e, t) {
  var n = ci(), o = G(n);
  Te(o, () => t.children), C(e, n);
}
function ku(e, t) {
  me(t, !0), ao(() => {
    const n = kl(Tu, {
      target: t.to,
      context: Pc(),
      props: { children: t.children }
    });
    return () => {
      zl(n);
    };
  }), pe();
}
Dc();
var zu = /* @__PURE__ */ O('<div class="tbl-blocking-overlay" aria-hidden="true"></div>');
function Lu(e) {
  var t = zu();
  C(e, t);
}
function Zn(e, t) {
  const n = t.devicePixelRatio;
  return ka(e * n) / n;
}
function Ou({ x: e, y: t }, n) {
  return { x: Zn(e, n), y: Zn(t, n) };
}
var Du = /* @__PURE__ */ O('<th class="tbl-cell tbl-header-cell"><!></th>'), Iu = /* @__PURE__ */ O('<td class="tbl-cell tbl-data-cell"><!></td>');
function Pu(e, t) {
  me(t, !0);
  const n = /* @__PURE__ */ A(() => sr(b(t.movement) ? t.movement.border : {
    top: t.position.top,
    right: !0,
    bottom: !0,
    left: t.position.left
  })), o = /* @__PURE__ */ A(() => sr(t.outline)), i = /* @__PURE__ */ A(() => {
    if (_(t.movement?.translate)) return;
    const { x: c, y: h } = t.movement.state === "moving" ? Ou(t.movement.translate, t.win) : t.movement.translate;
    return `translate3d(${c}px, ${h}px, 0px)`;
  });
  var r = ci(), l = G(r);
  {
    var s = (c) => {
      var h = Du();
      let d;
      var u = Lt(h);
      Te(u, () => t.children), ut(
        (m) => {
          q(h, "align", t.alignment === "none" ? void 0 : t.alignment), q(h, "data-component", fn), q(h, "data-row", t.location.row), q(h, "data-col", t.location.col), q(h, "data-border", f(n)), q(h, "data-outline", f(o)), q(h, "data-selected", m), q(h, "data-state", t.movement?.state), d = Yn(h, "", d, { transform: f(i) });
        },
        [() => ye(t.selected)]
      ), C(c, h);
    }, a = (c) => {
      var h = Iu();
      let d;
      var u = Lt(h);
      Te(u, () => t.children), ut(
        (m) => {
          q(h, "align", t.alignment === "none" ? void 0 : t.alignment), q(h, "data-component", fn), q(h, "data-row", t.location.row), q(h, "data-col", t.location.col), q(h, "data-border", f(n)), q(h, "data-outline", f(o)), q(h, "data-selected", m), q(h, "data-state", t.movement?.state), d = Yn(h, "", d, { transform: f(i) });
        },
        [() => ye(t.selected)]
      ), C(c, h);
    };
    lt(l, (c) => {
      t.position.top ? c(s) : c(a, !1);
    });
  }
  C(e, r), pe();
}
function is(e) {
  return b(un(e.dom).activeElement?.closest(".cm-panels"));
}
function ur(e) {
  return e.trim().split(/\s+/);
}
function Mu({
  doc: e,
  selection: t,
  parent: n,
  extensions: o,
  markdownConfig: i,
  selectionType: r,
  lineWrapping: l,
  globalKeyBindings: s,
  rootEditor: a,
  highlighter: c,
  onChange: h,
  eventHandlers: d
}) {
  return new pt({
    doc: e,
    selection: t,
    parent: n,
    extensions: [
      o,
      Ls.lowest([
        pt.editorAttributes.of((u) => {
          const m = new Set(ur(a.themeClasses)), v = new Set(ur(u.themeClasses));
          return { class: [...m.difference(v)].join(" ") };
        }),
        ps.of([
          ...s.map((u) => ({
            ...u,
            run: b(u.run) ? () => u.run(a) : void 0,
            shift: b(u.shift) ? () => u.shift(a) : void 0
          }))
        ]),
        r === "codemirror" ? vs() : [],
        Ms(c),
        Yo({
          extensions: [Rr, i.extensions ?? []],
          addKeymap: !1,
          completeHTMLTags: i.completeHTMLTags,
          pasteURLAsLink: i.pasteURLAsLink,
          htmlTagLanguage: i.htmlTagLanguage
        }),
        pt.domEventObservers(d),
        l === "wrap" ? pt.lineWrapping : []
      ])
    ],
    dispatchTransactions: (u, m) => {
      m.update(u), u.forEach(h);
    }
  });
}
var Hu = /* @__PURE__ */ O('<div class="tbl-cell-editor"></div>');
function Bu(e, t) {
  me(t, !0);
  let n = Uo(t, "text", 15), o = Uo(t, "selection", 15), i, r, l = !1, s = !1;
  function a(h) {
    const { docChanged: d, newDoc: u, selection: m } = h;
    if (l) return;
    const v = b(m);
    if (d || v) {
      if (d) {
        const p = Go(u, { trim: !0 });
        p.eq(n()) || (n(p), s = !0);
      }
      if (v) {
        const { head: p, anchor: S } = m.main, g = os({ head: p, anchor: S }, u, { trim: !0 });
        Wl(g, o()) || (o(g), s = !0);
      }
    }
  }
  vi(
    [() => n(), () => o()],
    () => {
      if (s) {
        s = !1;
        return;
      }
      l = !0, r.dispatch({
        changes: r.state.changes({
          from: 0,
          to: r.state.doc.length,
          insert: jn(n())
        }),
        selection: hr(o(), n())
      }), l = !1;
    },
    { lazy: !0 }
  ), ao(() => (r = Mu({
    doc: jn(n()),
    selection: hr(o(), n()),
    parent: i,
    selectionType: t.selectionType,
    lineWrapping: t.lineWrapping,
    extensions: t.extensions,
    markdownConfig: t.markdownConfig,
    globalKeyBindings: t.globalKeyBindings,
    rootEditor: t.rootEditor,
    highlighter: t.highlighter,
    onChange: a,
    eventHandlers: {
      beforeinput: t.onbeforeinput,
      dragstart: t.ondragstart,
      keydown: (h, { state: d }) => t.onkeydown(h, d),
      paste: t.onpaste
    }
  }), is(r) || r.focus(), () => r.destroy()));
  var c = Hu();
  Xn(c, (h) => i = h, () => i), C(e, c), pe();
}
class mo {
  event;
  tableState;
  position;
  static navigate(t) {
    new mo(t)[`navigate${t.key}`]();
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateTab() {
    this.moveRight({ createRow: !1, position: "end" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateShiftTab() {
    this.moveLeft({ createRow: !1, position: "end" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateEnter() {
    this.moveDown({ createRow: !1, position: "end" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateArrowLeft() {
    this.position.left && this.moveLeft({ createRow: !1, position: "end" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateArrowUp() {
    this.position.top && this.moveUp({ createRow: !1, position: "end" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateArrowRight() {
    this.position.right && this.moveRight({ createRow: !1, position: "start" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateArrowDown() {
    this.position.bottom && this.moveDown({ createRow: !1, position: "end" });
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateShiftArrowLeft() {
    if (!(!this.position.left || _(this.tableState.outlinedSection) || _(this.tableState.activeCell))) {
      if (this.event.preventDefault(), this.tableState.focusTable(), _(this.tableState.anchorCell) && (this.tableState.anchorCell = this.tableState.activeCell), this.tableState.outlinedSection.endCol === this.tableState.anchorCell.col) {
        if (this.tableState.outlinedSection.startCol === this.tableState.table.firstColIndex) return;
        this.tableState.outlinedSection = this.tableState.outlinedSection.expandLeft();
      } else
        this.tableState.outlinedSection = this.tableState.outlinedSection.contractLeft();
      this.tableState.activeCell = ql(this.tableState.activeCell);
    }
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateShiftArrowUp() {
    if (!(!this.position.top || _(this.tableState.outlinedSection) || _(this.tableState.activeCell))) {
      if (this.event.preventDefault(), this.tableState.focusTable(), _(this.tableState.anchorCell) && (this.tableState.anchorCell = this.tableState.activeCell), this.tableState.outlinedSection.endRow === this.tableState.anchorCell.row) {
        if (this.tableState.outlinedSection.startRow === this.tableState.table.firstRowIndex) return;
        this.tableState.outlinedSection = this.tableState.outlinedSection.expandUp();
      } else
        this.tableState.outlinedSection = this.tableState.outlinedSection.contractUp();
      this.tableState.activeCell = $l(this.tableState.activeCell);
    }
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateShiftArrowRight() {
    if (!(!this.position.right || _(this.tableState.outlinedSection) || _(this.tableState.activeCell))) {
      if (this.event.preventDefault(), this.tableState.focusTable(), _(this.tableState.anchorCell) && (this.tableState.anchorCell = this.tableState.activeCell), this.tableState.outlinedSection.startCol === this.tableState.anchorCell.col) {
        if (this.tableState.outlinedSection.endCol === this.tableState.table.lastColIndex) return;
        this.tableState.outlinedSection = this.tableState.outlinedSection.expandRight();
      } else
        this.tableState.outlinedSection = this.tableState.outlinedSection.contractRight();
      this.tableState.activeCell = Ul(this.tableState.activeCell);
    }
  }
  // noinspection JSUnusedGlobalSymbols -- Called dynamically
  navigateShiftArrowDown() {
    if (!(!this.position.bottom || _(this.tableState.outlinedSection) || _(this.tableState.activeCell))) {
      if (this.event.preventDefault(), this.tableState.focusTable(), _(this.tableState.anchorCell) && (this.tableState.anchorCell = this.tableState.activeCell), this.tableState.outlinedSection.startRow === this.tableState.anchorCell.row) {
        if (this.tableState.outlinedSection.endRow === this.tableState.table.lastRowIndex) return;
        this.tableState.outlinedSection = this.tableState.outlinedSection.expandDown();
      } else
        this.tableState.outlinedSection = this.tableState.outlinedSection.contractDown();
      this.tableState.activeCell = Vl(this.tableState.activeCell);
    }
  }
  moveLeft({
    createRow: t,
    position: n
  }) {
    if (!_(this.tableState.activeCell)) {
      if (this.event.preventDefault(), ze(this.tableState.activeCell, this.tableState.table.firstCellLocation)) {
        if (!t) {
          this.tableState.navigate("before");
          return;
        }
        this.tableState.table.prependEmptyRows(1), this.tableState.activeCell = {
          row: this.tableState.activeCell.row + 1,
          col: this.tableState.activeCell.col
        };
      }
      this.moveTo(
        this.tableState.activeCell.col === this.tableState.table.firstColIndex ? { row: this.tableState.activeCell.row - 1, col: this.tableState.table.lastColIndex } : { row: this.tableState.activeCell.row, col: this.tableState.activeCell.col - 1 },
        n
      );
    }
  }
  moveUp({ createRow: t, position: n }) {
    if (!_(this.tableState.activeCell)) {
      if (this.event.preventDefault(), this.tableState.activeCell.row === this.tableState.table.firstRowIndex) {
        if (!t) {
          this.tableState.navigate("before");
          return;
        }
        this.tableState.table.prependEmptyRows(1), this.tableState.activeCell = {
          row: this.tableState.activeCell.row + 1,
          col: this.tableState.activeCell.col
        };
      }
      this.moveTo(
        { row: this.tableState.activeCell.row - 1, col: this.tableState.activeCell.col },
        n
      );
    }
  }
  moveRight({
    createRow: t,
    position: n
  }) {
    if (!_(this.tableState.activeCell)) {
      if (this.event.preventDefault(), ze(this.tableState.activeCell, this.tableState.table.lastCellLocation)) {
        if (!t) {
          this.tableState.navigate("after");
          return;
        }
        this.tableState.table.appendEmptyRows(1);
      }
      this.moveTo(
        this.tableState.activeCell.col === this.tableState.table.lastColIndex ? { row: this.tableState.activeCell.row + 1, col: this.tableState.table.firstColIndex } : { row: this.tableState.activeCell.row, col: this.tableState.activeCell.col + 1 },
        n
      );
    }
  }
  moveDown({
    createRow: t,
    position: n
  }) {
    if (!_(this.tableState.activeCell)) {
      if (this.event.preventDefault(), this.tableState.activeCell.row === this.tableState.table.lastRowIndex) {
        if (!t) {
          this.tableState.navigate("after");
          return;
        }
        this.tableState.table.appendEmptyRows(1);
      }
      this.moveTo(
        { row: this.tableState.activeCell.row + 1, col: this.tableState.activeCell.col },
        n
      );
    }
  }
  moveTo(t, n) {
    if (this.tableState.activeCell = t, this.tableState.anchorCell = t, this.tableState.outlinedSection = z.ofCell(t), this.tableState.selection.isCell()) {
      const o = n === "start" ? 0 : this.tableState.table.cellAt(t).length;
      this.tableState.selectionValue = { cell: t, section: { anchor: o, head: o } };
    }
  }
  constructor({ event: t, tableState: n, position: o }) {
    this.event = t, this.tableState = n, this.position = o;
  }
}
const F = {
  alt: "Alt",
  arrowDown: "ArrowDown",
  arrowLeft: "ArrowLeft",
  arrowRight: "ArrowRight",
  arrowUp: "ArrowUp",
  backspace: "Backspace",
  c: "c",
  delete: "Delete",
  enter: "Enter",
  escape: "Escape",
  shift: "Shift",
  tab: "Tab",
  v: "v",
  x: "x"
}, Nu = [
  F.arrowDown,
  F.arrowLeft,
  F.arrowRight,
  F.arrowUp,
  F.enter,
  F.tab,
  `${F.shift}${F.arrowDown}`,
  `${F.shift}${F.arrowLeft}`,
  `${F.shift}${F.arrowRight}`,
  `${F.shift}${F.arrowUp}`,
  `${F.shift}${F.tab}`
], dr = new Set(Nu);
function rs({
  key: e,
  shiftKey: t,
  altKey: n,
  metaKey: o,
  ctrlKey: i
}) {
  if (!(n || o || i))
    return t ? dr.has(`${F.shift}${e}`) ? `${F.shift}${e}` : void 0 : dr.has(e) ? e : void 0;
}
function Fu(e, t) {
  e.inputType === "historyUndo" ? (t.undo(), e.preventDefault()) : e.inputType === "historyRedo" && (t.redo(), e.preventDefault());
}
function $u(e) {
  e.preventDefault();
}
function Uu(e, t, n) {
  const o = rs(e);
  if (_(o)) return;
  const i = t.selection.main.head, r = t.doc.lineAt(i).number, l = 0, s = t.doc.length, a = 1, c = t.doc.lines, h = {
    top: r === a,
    right: i === s,
    bottom: r === c,
    left: i === l
  };
  mo.navigate({ tableState: n, key: o, event: e, position: h });
}
function Vu(e, t) {
  gi({ tableState: t, event: e });
}
var qu = /* @__PURE__ */ O('<div class="tbl-cell-view" contenteditable="" tabindex="-1"><!></div>');
function Wu(e, t) {
  me(t, !0);
  var n = qu(), o = Lt(n);
  Te(o, () => t.children), ut(
    (i) => {
      q(n, "data-component", wi), q(n, "data-hidden", i);
    },
    [() => ye(t.hidden)]
  ), C(e, n), pe();
}
const ls = "Handle";
function Ci(e) {
  if (!Bl(e, { component: ls })) return;
  const { type: t, location: n } = hi(e).dataset;
  if (t === "table")
    return { type: t, location: n };
  {
    const o = uo(_n(e));
    return pu({ location: n, type: t }, o);
  }
}
var ju = /* @__PURE__ */ It('<svg class="tbl-handle-grip" width="15" height="3" fill="currentColor" viewBox="0 0 15 3" xmlns="http://www.w3.org/2000/svg"><circle cx="1.5" cy="1.5" r="1.5"></circle><circle cx="7.5" cy="1.5" r="1.5"></circle><circle cx="13.5" cy="1.5" r="1.5"></circle></svg>'), Ku = /* @__PURE__ */ It('<svg class="tbl-handle-grip" width="3" height="15" fill="currentColor" viewBox="0 0 3 15" xmlns="http://www.w3.org/2000/svg"><circle cy="1.5" cx="1.5" r="1.5"></circle><circle cy="7.5" cx="1.5" r="1.5"></circle><circle cy="13.5" cx="1.5" r="1.5"></circle></svg>'), Yu = /* @__PURE__ */ O('<div class="tbl-handle" role="button" aria-hidden="true"><!></div>');
function fr(e, t) {
  me(t, !0);
  let n = Uo(t, "toggle", 3, !1);
  const o = {
    table: { right: "vertical", bottom: "horizontal" },
    header: { row: "vertical", col: "horizontal" }
  }, i = /* @__PURE__ */ A(() => o[t.of.type]?.[t.of.location]);
  var r = Yu();
  Yn(r, "", {}, { opacity: "var(--tbl-handle-opacity, 0)" });
  var l = Lt(r);
  {
    var s = (c) => {
      var h = ju();
      C(c, h);
    }, a = (c) => {
      var h = Ku();
      C(c, h);
    };
    lt(l, (c) => {
      f(i) === "horizontal" ? c(s) : f(i) === "vertical" && c(a, 1);
    });
  }
  ut(
    (c, h, d) => {
      q(r, "data-component", ls), q(r, "data-type", t.of.type), q(r, "data-location", t.of.location), q(r, "data-active", c), q(r, "data-hover", h), q(r, "data-toggle", d);
    },
    [
      () => ye(t.state === "active"),
      () => ye(t.state === "hover"),
      () => ye(n())
    ]
  ), C(e, r), pe();
}
var Xu = /* @__PURE__ */ O('<div class="tbl-menu"><!></div>');
function Gu(e, t) {
  me(t, !0);
  let n, o = /* @__PURE__ */ M(void 0);
  ao(() => {
    t.translate(n).then((s) => y(o, s, !0));
  });
  var i = Xu();
  let r;
  var l = Lt(i);
  Te(l, () => t.children), Xn(i, (s) => n = s, () => n), ut((s) => r = Yn(i, "", r, s), [
    () => ({
      visibility: b(f(o)) ? void 0 : "hidden",
      transform: b(f(o)) ? `translate3d(${f(o).x}px, ${f(o).y}px, 0px)` : void 0
    })
  ]), C(e, i), pe();
}
var Ju = /* @__PURE__ */ O('<div class="tbl-menu-item" role="menuitem" tabindex="-1"><!></div>');
function Ct(e, t) {
  var n = Ju(), o = Lt(n);
  Te(o, () => t.children), on("click", n, function(...i) {
    t.onclick?.apply(this, i);
  }), C(e, n);
}
Tl(["click"]);
function xt(e, t) {
  switch (e.action) {
    case "add":
      return t.menu.clickAdd(e.direction);
    case "align":
      return t.menu.clickAlign(e.alignment);
    case "clear":
      return t.menu.clickClear();
    case "duplicate":
      return t.menu.clickDuplicate();
    case "move":
      return t.menu.clickMove(e.direction);
    case "remove":
      return t.menu.clickRemove();
    case "sort":
      return t.menu.clickSort(e.direction);
  }
}
var Zu = /* @__PURE__ */ It('<path d="M294.6 454.6L214.6 534.6C202.1 547.1 181.8 547.1 169.3 534.6L89.3 454.6C76.8 442.1 76.8 421.8 89.3 409.3C101.8 396.8 122.1 396.8 134.6 409.3L160 434.7L160 128C160 110.3 174.3 96 192 96C209.7 96 224 110.3 224 128L224 434.7L249.4 409.3C261.9 396.8 282.2 396.8 294.7 409.3C307.2 421.8 307.2 442.1 294.7 454.6zM476.6 113.7C527.3 215 553.9 268.4 556.6 273.7C564.5 289.5 558.1 308.7 542.3 316.6C526.5 324.5 507.3 318.1 499.4 302.3L492.2 288L403.8 288L396.6 302.3C388.7 318.1 369.5 324.5 353.7 316.6C337.9 308.7 331.5 289.5 339.4 273.7C342.1 268.4 368.7 215 419.4 113.7C424.8 102.9 435.9 96 448 96C460.1 96 471.2 102.8 476.6 113.7zM448 199.6L427.8 240L468.2 240L448 199.6zM352 384C352 366.3 366.3 352 384 352L512 352C524.9 352 536.6 359.8 541.6 371.8C546.6 383.8 543.8 397.5 534.7 406.7L461.3 480L512 480C529.7 480 544 494.3 544 512C544 529.7 529.7 544 512 544L384 544C371.1 544 359.4 536.2 354.4 524.2C349.4 512.2 352.2 498.5 361.3 489.3L434.7 415.9L384 415.9C366.3 415.9 352 401.6 352 383.9z"></path>'), Qu = /* @__PURE__ */ It('<path d="M294.6 454.6L214.6 534.6C202.1 547.1 181.8 547.1 169.3 534.6L89.3 454.6C76.8 442.1 76.8 421.8 89.3 409.3C101.8 396.8 122.1 396.8 134.6 409.3L160 434.7L160 128C160 110.3 174.3 96 192 96C209.7 96 224 110.3 224 128L224 434.7L249.4 409.3C261.9 396.8 282.2 396.8 294.7 409.3C307.2 421.8 307.2 442.1 294.7 454.6zM352 128C352 110.3 366.3 96 384 96L512 96C524.9 96 536.6 103.8 541.6 115.8C546.6 127.8 543.8 141.5 534.7 150.7L461.3 224L512 224C529.7 224 544 238.3 544 256C544 273.7 529.7 288 512 288L384 288C371.1 288 359.4 280.2 354.4 268.2C349.4 256.2 352.2 242.5 361.3 233.3L434.8 160L384 160C366.3 160 352 145.7 352 128zM476.6 337.7L556.6 497.7C564.5 513.5 558.1 532.7 542.3 540.6C526.5 548.5 507.3 542.1 499.4 526.3L492.2 512L403.8 512L396.6 526.3C388.7 542.1 369.5 548.5 353.7 540.6C337.9 532.7 331.5 513.5 339.4 497.7L419.4 337.7C424.8 326.9 435.9 320 448 320C460.1 320 471.2 326.8 476.6 337.7zM448 423.6L427.8 464L468.2 464L448 423.6z"></path>'), td = /* @__PURE__ */ It('<path d="M384 128C384 145.7 369.7 160 352 160L128 160C110.3 160 96 145.7 96 128C96 110.3 110.3 96 128 96L352 96C369.7 96 384 110.3 384 128zM384 384C384 401.7 369.7 416 352 416L128 416C110.3 416 96 401.7 96 384C96 366.3 110.3 352 128 352L352 352C369.7 352 384 366.3 384 384zM96 256C96 238.3 110.3 224 128 224L512 224C529.7 224 544 238.3 544 256C544 273.7 529.7 288 512 288L128 288C110.3 288 96 273.7 96 256zM544 512C544 529.7 529.7 544 512 544L128 544C110.3 544 96 529.7 96 512C96 494.3 110.3 480 128 480L512 480C529.7 480 544 494.3 544 512z"></path>'), ed = /* @__PURE__ */ It('<path d="M448 128C448 110.3 433.7 96 416 96L224 96C206.3 96 192 110.3 192 128C192 145.7 206.3 160 224 160L416 160C433.7 160 448 145.7 448 128zM544 256C544 238.3 529.7 224 512 224L128 224C110.3 224 96 238.3 96 256C96 273.7 110.3 288 128 288L512 288C529.7 288 544 273.7 544 256zM96 512C96 529.7 110.3 544 128 544L512 544C529.7 544 544 529.7 544 512C544 494.3 529.7 480 512 480L128 480C110.3 480 96 494.3 96 512zM448 384C448 366.3 433.7 352 416 352L224 352C206.3 352 192 366.3 192 384C192 401.7 206.3 416 224 416L416 416C433.7 416 448 401.7 448 384z"></path>'), nd = /* @__PURE__ */ It('<path d="M544 128C544 145.7 529.7 160 512 160L288 160C270.3 160 256 145.7 256 128C256 110.3 270.3 96 288 96L512 96C529.7 96 544 110.3 544 128zM544 384C544 401.7 529.7 416 512 416L288 416C270.3 416 256 401.7 256 384C256 366.3 270.3 352 288 352L512 352C529.7 352 544 366.3 544 384zM96 256C96 238.3 110.3 224 128 224L512 224C529.7 224 544 238.3 544 256C544 273.7 529.7 288 512 288L128 288C110.3 288 96 273.7 96 256zM544 512C544 529.7 529.7 544 512 544L128 544C110.3 544 96 529.7 96 512C96 494.3 110.3 480 128 480L512 480C529.7 480 544 494.3 544 512z"></path>'), od = /* @__PURE__ */ It('<path d="M342.6 81.4C330.1 68.9 309.8 68.9 297.3 81.4L137.3 241.4C124.8 253.9 124.8 274.2 137.3 286.7C149.8 299.2 170.1 299.2 182.6 286.7L288 181.3L288 552C288 569.7 302.3 584 320 584C337.7 584 352 569.7 352 552L352 181.3L457.4 286.7C469.9 299.2 490.2 299.2 502.7 286.7C515.2 274.2 515.2 253.9 502.7 241.4L342.7 81.4z"></path>'), id = /* @__PURE__ */ It('<path d="M566.6 342.6C579.1 330.1 579.1 309.8 566.6 297.3L406.6 137.3C394.1 124.8 373.8 124.8 361.3 137.3C348.8 149.8 348.8 170.1 361.3 182.6L466.7 288L96 288C78.3 288 64 302.3 64 320C64 337.7 78.3 352 96 352L466.7 352L361.3 457.4C348.8 469.9 348.8 490.2 361.3 502.7C373.8 515.2 394.1 515.2 406.6 502.7L566.6 342.7z"></path>'), rd = /* @__PURE__ */ It('<path d="M297.4 566.6C309.9 579.1 330.2 579.1 342.7 566.6L502.7 406.6C515.2 394.1 515.2 373.8 502.7 361.3C490.2 348.8 469.9 348.8 457.4 361.3L352 466.7L352 96C352 78.3 337.7 64 320 64C302.3 64 288 78.3 288 96L288 466.7L182.6 361.3C170.1 348.8 149.8 348.8 137.3 361.3C124.8 373.8 124.8 394.1 137.3 406.6L297.3 566.6z"></path>'), ld = /* @__PURE__ */ It('<path d="M73.4 297.4C60.9 309.9 60.9 330.2 73.4 342.7L233.4 502.7C245.9 515.2 266.2 515.2 278.7 502.7C291.2 490.2 291.2 469.9 278.7 457.4L173.3 352L544 352C561.7 352 576 337.7 576 320C576 302.3 561.7 288 544 288L173.3 288L278.7 182.6C291.2 170.1 291.2 149.8 278.7 137.3C266.2 124.8 245.9 124.8 233.4 137.3L73.4 297.3z"></path>'), sd = /* @__PURE__ */ It('<path d="M262.2 48C248.9 48 236.9 56.3 232.2 68.8L216 112L120 112C106.7 112 96 122.7 96 136C96 149.3 106.7 160 120 160L520 160C533.3 160 544 149.3 544 136C544 122.7 533.3 112 520 112L424 112L407.8 68.8C403.1 56.3 391.2 48 377.8 48L262.2 48zM128 208L128 512C128 547.3 156.7 576 192 576L448 576C483.3 576 512 547.3 512 512L512 208L464 208L464 512C464 520.8 456.8 528 448 528L192 528C183.2 528 176 520.8 176 512L176 208L128 208zM288 280C288 266.7 277.3 256 264 256C250.7 256 240 266.7 240 280L240 456C240 469.3 250.7 480 264 480C277.3 480 288 469.3 288 456L288 280zM400 280C400 266.7 389.3 256 376 256C362.7 256 352 266.7 352 280L352 456C352 469.3 362.7 480 376 480C389.3 480 400 469.3 400 456L400 280z"></path>'), ad = /* @__PURE__ */ O('<div class="tbl-menu-item-icon"><svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 640 640" fill="currentColor"><!></svg></div>');
function St(e, t) {
  var n = ad(), o = Lt(n), i = Lt(o);
  {
    var r = (g) => {
      var E = Zu();
      C(g, E);
    }, l = (g) => {
      var E = Qu();
      C(g, E);
    }, s = (g) => {
    }, a = (g) => {
      var E = td();
      C(g, E);
    }, c = (g) => {
      var E = ed();
      C(g, E);
    }, h = (g) => {
      var E = nd();
      C(g, E);
    }, d = (g) => {
      var E = od();
      C(g, E);
    }, u = (g) => {
      var E = id();
      C(g, E);
    }, m = (g) => {
      var E = rd();
      C(g, E);
    }, v = (g) => {
      var E = ld();
      C(g, E);
    }, w = (g) => {
    }, p = (g) => {
    }, S = (g) => {
      var E = sd();
      C(g, E);
    };
    lt(i, (g) => {
      t.name === "sort-ascending" ? g(r) : t.name === "sort-descending" ? g(l, 1) : t.name === "align-none" ? g(s, 2) : t.name === "align-left" ? g(a, 3) : t.name === "align-center" ? g(c, 4) : t.name === "align-right" ? g(h, 5) : t.name === "move-up" ? g(d, 6) : t.name === "move-right" ? g(u, 7) : t.name === "move-down" ? g(m, 8) : t.name === "move-left" ? g(v, 9) : t.name === "duplicate" ? g(w, 10) : t.name === "clear" ? g(p, 11) : t.name === "remove" && g(S, 12);
    });
  }
  C(e, n);
}
var cd = /* @__PURE__ */ O('<div class="tbl-menu-item-text"><!></div>');
function _t(e, t) {
  var n = cd(), o = Lt(n);
  Te(o, () => t.children), C(e, n);
}
var hd = /* @__PURE__ */ O('<div class="tbl-menu-separator"></div>');
function Pn(e) {
  var t = hd();
  C(e, t);
}
var ud = /* @__PURE__ */ O('<div class="tbl-select-all-overlay" aria-hidden="true"></div>');
function dd(e) {
  var t = ud();
  C(e, t);
}
const fd = /* @__PURE__ */ new Set([F.c, F.v, F.x]);
function md(e, t) {
  return fd.has(e.key) && e[tc(t)];
}
const pd = [F.backspace, F.delete], vd = new Set(pd);
function bd({ key: e }) {
  return vd.has(e) ? e : void 0;
}
function gd(e) {
  return /^F\d+$/.test(e);
}
const wd = /* @__PURE__ */ new Set([
  F.alt,
  F.escape,
  F.enter,
  F.shift
]);
function Cd({ metaKey: e, ctrlKey: t, key: n }) {
  return !t && !e && !wd.has(n) && !gd(n);
}
function xd(e, t) {
  t.selection.isCell() || Ql({ tableState: t, event: e });
}
function Sd(e, t) {
  t.selection.isCell() || ts({ tableState: t, event: e });
}
function _d(e, t) {
  t.selection.isCell() || gi({ tableState: t, event: e });
}
function yd(e, t) {
  if (b(e.target) && b(ns(e.target))) {
    e.preventDefault();
    return;
  }
  if (!t.interactive || t.selection.isCell()) return;
  const n = rs(e);
  if (b(n)) {
    mo.navigate({
      tableState: t,
      key: n,
      event: e,
      position: { left: !0, top: !0, right: !0, bottom: !0 }
    });
    return;
  }
  const o = bd(e);
  if (b(o)) {
    Zl({ tableState: t, event: e });
    return;
  }
  if (t.activeTable && b(t.activeCell) && Cd(e)) {
    t.activeTable = !1, t.anchorCell = t.activeCell;
    const i = t.table.cellAt(t.activeCell).length;
    t.selectionValue = {
      cell: t.activeCell,
      section: { head: i, anchor: i }
    }, t.outlinedSection = z.ofCell(t.activeCell);
    return;
  }
  md(e, t.window) || bs(t.rootEditor, e, "editor") && e.preventDefault();
}
function xi(e) {
  return e.buttons === 1;
}
function ss(e, t) {
  return t.setPointerCapture(e.pointerId), () => t.releasePointerCapture(e.pointerId);
}
class po {
  offset;
  maxScroll;
  boundaryElement;
  scrollElement;
  scroll;
  handle;
  xAmount;
  yAmount;
  updatePosition(t, n) {
    const o = this.boundaryElement.x.getBoundingClientRect();
    t < o.left + this.offset ? this.xAmount = -ft(this.offset + (o.left - t), {
      max: this.maxScroll
    }) : t > o.right - this.offset ? this.xAmount = ft(this.offset - (o.right - t), {
      max: this.maxScroll
    }) : this.xAmount = 0;
    const i = this.boundaryElement.y.getBoundingClientRect();
    n < i.top + this.offset ? this.yAmount = -ft(this.offset + (i.top - n), {
      max: this.maxScroll
    }) : n > i.bottom - this.offset ? this.yAmount = ft(this.offset - (i.bottom - n), {
      max: this.maxScroll
    }) : this.yAmount = 0, _(this.handle) && (this.xAmount !== 0 || this.yAmount !== 0) && this.scroll();
  }
  destroy() {
    b(this.handle) && cancelAnimationFrame(this.handle);
  }
  scrollInternal() {
    if (this.xAmount === 0 && this.yAmount === 0) {
      this.scroll();
      return;
    }
    this.scrollElement.x.scrollBy({ left: this.xAmount }), this.scrollElement.y.scrollBy({ top: this.yAmount }), this.scroll();
  }
  static of(t) {
    return new po(t);
  }
  constructor({ offset: t, maxScroll: n, boundaryElement: o, scrollElement: i }) {
    const r = this.scrollInternal.bind(this);
    this.scroll = () => {
      this.handle = requestAnimationFrame(r);
    }, this.xAmount = 0, this.yAmount = 0, this.offset = t ?? 0, this.maxScroll = n, this.boundaryElement = o, this.scrollElement = i;
  }
}
class Qn {
  start;
  size;
  get mid() {
    return this.start + this.size / 2;
  }
  get end() {
    return this.start + this.size;
  }
  static of(t) {
    return new Qn(t);
  }
  constructor({ start: t, size: n }) {
    this.start = t, this.size = n;
  }
}
var to;
((e) => {
  function t(n, o) {
    return Si.of(n, o);
  }
  e.of = t;
})(to || (to = {}));
class Si {
  rows;
  cols;
  rowsOrCols(t) {
    return t === "row" ? this.rows : this.cols;
  }
  rowAt(t) {
    return this.rows[t];
  }
  colAt(t) {
    return this.cols[t];
  }
  rowOrColAt(t, n) {
    return t === "row" ? this.rowAt(n) : this.colAt(n);
  }
  get firstRow() {
    return this.rows[this.firstRowIndex];
  }
  get firstCol() {
    return this.cols[this.firstColIndex];
  }
  firstRowOrCol(t) {
    return t === "row" ? this.firstRow : this.firstCol;
  }
  get lastRow() {
    return this.rows[this.lastRowIndex];
  }
  get lastCol() {
    return this.cols[this.lastColIndex];
  }
  lastRowOrCol(t) {
    return t === "row" ? this.lastRow : this.lastCol;
  }
  firstRowIndex = 0;
  firstColIndex = 0;
  firstRowOrColIndex(t) {
    return 0;
  }
  get lastRowIndex() {
    return this.rowCount - 1;
  }
  get lastColIndex() {
    return this.colCount - 1;
  }
  lastRowOrColIndex(t) {
    return t === "row" ? this.lastRowIndex : this.lastColIndex;
  }
  get rowCount() {
    return this.rows.length;
  }
  get colCount() {
    return this.cols.length;
  }
  get minRowSize() {
    return Wn(...this.rows.map((t) => t.size));
  }
  get minColSize() {
    return Wn(...this.cols.map((t) => t.size));
  }
  moveRowOrColAt(t, { fromIndex: n, toIndex: o }) {
    if (n === o) return;
    const i = this.rowsOrCols(t), r = i[n];
    if (n < o) {
      for (const l of se({ start: n, endExclusive: o }))
        i[l] = i[l + 1], i[l].start -= r.size;
      r.start = i[o].start + i[o].size;
    } else {
      for (const l of se({ start: n, endExclusive: o }))
        i[l] = i[l - 1], i[l].start += r.size;
      r.start = i[o].start - r.size;
    }
    i[o] = r;
  }
  lastCellBeforePosition(t) {
    const n = this.rows.map((i) => i.start).findLastIndex((i) => i < t.y), o = this.cols.map((i) => i.start).findLastIndex((i) => i < t.x);
    return { row: n === -1 ? 0 : n, col: o === -1 ? 0 : o };
  }
  static of(t, n) {
    return new Si(t, n);
  }
  constructor(t, n) {
    const o = [
      ...t.querySelectorAll("tr:first-child > th")
    ], i = [
      ...t.querySelectorAll(
        "tr > th:first-child,tr > td:first-child"
      )
    ];
    this.rows = i.map((r, l) => {
      const { top: s, height: a } = mr(r, n), c = 0;
      return Qn.of({ start: s + c, size: a - c });
    }), this.cols = o.map((r, l) => {
      const { left: s, width: a } = mr(r, n), c = l === 0 ? 1 : 0;
      return Qn.of({ start: s + c, size: a - c });
    });
  }
}
function mr(e, t) {
  const { top: n, left: o, width: i, height: r } = e.getBoundingClientRect();
  return { top: n + t.y, left: o + t.x, width: i, height: r };
}
class mn {
  tableState;
  tableMeasurement;
  autoScroller;
  shouldAutoScroll;
  removeEventListeners;
  currentCell;
  start() {
    this.tableState.activeCell = this.currentCell, this.tableState.anchorCell = this.currentCell, this.tableState.outlinedSection = z.ofCell(this.currentCell), this.tableState.outline = { outlined: !1 }, this.removeEventListeners = ke(
      J(this.tableState.window, "pointermove", (t) => this.drag(t)),
      J(this.tableState.window, "pointerup", () => this.end()),
      J(this.tableState.window, "pointerleave", () => this.end())
    );
  }
  resizeAndContinue(t) {
    t.preventDefault(), _(this.tableState.anchorCell) && (this.tableState.anchorCell = this.currentCell), this.expandOrContract(this.currentCell), this.tableState.outline = { outlined: !0 }, this.removeEventListeners = ke(
      J(this.tableState.window, "pointermove", (n) => this.drag(n)),
      J(this.tableState.window, "pointerup", () => this.end()),
      J(this.tableState.window, "pointerleave", () => this.end())
    );
  }
  drag(t) {
    if (!xi(t)) {
      this.end();
      return;
    }
    t.preventDefault(), this.shouldAutoScroll() && this.autoScroller.updatePosition(t.clientX, t.clientY);
    const n = this.tableMeasurement.lastCellBeforePosition({
      x: t.clientX + this.tableState.scrollOffsetX,
      y: t.clientY + this.tableState.scrollOffsetY
    });
    ze(n, this.currentCell) || (this.currentCell = n, this.tableState.outline = { outlined: !0 }, this.expandOrContract(n));
  }
  end() {
    this.removeEventListeners?.(), this.autoScroller.destroy(), this.tableState.outline = void 0;
  }
  expandOrContract(t) {
    this.tableState.focusTable();
    const [n, o] = t.row <= this.tableState.anchorCell.row ? [t.row, this.tableState.anchorCell.row] : [this.tableState.anchorCell.row, t.row], [i, r] = t.col <= this.tableState.anchorCell.col ? [t.col, this.tableState.anchorCell.col] : [this.tableState.anchorCell.col, t.col];
    this.tableState.outlinedSection = z.of({
      row: { start: n, endExclusive: o + 1 },
      col: { start: i, endExclusive: r + 1 }
    }), this.tableState.activeCell = t;
  }
  static startOutline(t) {
    new mn(t).start();
  }
  static resizeAndContinueOutline(t) {
    new mn(t).resizeAndContinue(t.event);
  }
  constructor({ tableState: t, cellLocation: n }) {
    this.tableState = t, this.currentCell = n, this.autoScroller = po.of({
      offset: 10,
      maxScroll: 32,
      boundaryElement: { x: t.scrollElement, y: t.rootScrollElement },
      scrollElement: { x: t.scrollElement, y: t.rootScrollElement }
    }), this.shouldAutoScroll = Ih({ delayMillis: 500 }), this.tableMeasurement = to.of(t.tableElement, {
      x: t.scrollOffsetX,
      y: t.scrollOffsetY
    });
  }
}
function Ed(e, t) {
  oo(t.window) && (t.hoveredCell = e);
}
function Rd(e) {
  oo(e.window) && (e.hoveredCell = void 0);
}
function Ad(e, t, n) {
  if (!(!n.interactive || !xi(e)))
    if (e.shiftKey) {
      if (n.selection.isCell() && ze(t, n.selection.cell))
        return;
      mn.resizeAndContinueOutline({ event: e, tableState: n, cellLocation: t });
    } else
      mn.startOutline({ event: e, tableState: n, cellLocation: t });
}
const Td = new Intl.Collator(navigator.language, {
  numeric: !0,
  sensitivity: "base"
});
function pr(e, t) {
  return Td.compare(e, t);
}
function kd({ metaKey: e, shiftKey: t, altKey: n, ctrlKey: o, key: i }) {
  return i === F.escape && !t && !n && !e && !o;
}
class _i {
  tableState;
  handle;
  point;
  removeEventListeners;
  get rowOrCol() {
    return this.handle.location;
  }
  get index() {
    return this.handle.index;
  }
  open() {
    const t = this.tableState.document.body;
    this.removeEventListeners = ke(
      J(t, "pointerdown", (l) => {
        l.preventDefault(), (_(l.target) || !Il(this.tableState.menuRootElement, l.target)) && this.close();
      }),
      J(t, "wheel", (l) => l.preventDefault(), {
        passive: !1
      }),
      J(t, "keydown", (l) => {
        l.preventDefault(), kd(l) && this.close();
      })
    ), this.tableState.focusTable(), this.tableState.activeHandle = { state: "active", handle: this.handle }, this.tableState.outlinedSection = z.of(
      this.rowOrCol === "row" ? {
        row: { start: this.index, endExclusive: this.index + 1 },
        col: this.tableState.table.colRange
      } : {
        row: this.tableState.table.rowRange,
        col: { start: this.index, endExclusive: this.index + 1 }
      }
    );
    const n = this.rowOrCol === "row" ? { row: this.index, col: this.tableState.table.lastColIndex } : { row: this.tableState.table.lastRowIndex, col: this.index };
    this.tableState.activeCell = n, this.tableState.anchorCell = n;
    const o = this.index !== this.tableState.table.firstRowOrColIndex(this.rowOrCol), i = this.index !== this.tableState.table.lastRowOrColIndex(this.rowOrCol);
    let r = !1;
    o ? r = i ? !0 : "backward" : i && (r = "forward"), this.tableState.menu = {
      type: this.rowOrCol,
      capabilities: {
        addable: !0,
        alignable: this.rowOrCol === "col",
        clearable: !0,
        duplicatable: !0,
        moveable: r,
        removable: !this.tableState.table.hasSingleRowOrCol(this.rowOrCol),
        sortable: this.rowOrCol === "col"
      },
      clickAdd: (l) => this.clickAdd(l),
      clickAlign: (l) => this.clickAlign(l),
      clickClear: () => this.clickClear(),
      clickDuplicate: () => this.clickDuplicate(),
      clickMove: (l) => this.clickMove(l),
      clickRemove: () => this.clickRemove(),
      clickSort: (l) => this.clickSort(l),
      computeTranslation: (l) => this.computeTranslation(l)
    };
  }
  close() {
    this.removeEventListeners?.(), this.tableState.menu = void 0, this.tableState.activeHandle = void 0;
  }
  async computeTranslation(t) {
    const n = await qs(
      {
        getBoundingClientRect: () => ({
          x: this.point.x,
          y: this.point.y,
          top: this.point.y,
          right: this.point.x,
          bottom: this.point.y,
          left: this.point.x,
          width: 0,
          height: 0
        })
      },
      t,
      {
        middleware: [
          Ws({
            allowedPlacements: this.rowOrCol === "row" ? ["right-start", "right-end"] : ["right-start", "right"]
          }),
          js({ crossAxis: !0 })
        ]
      }
    ), o = Xe(t);
    return {
      x: Zn(n.x, o),
      y: Zn(n.y, o)
    };
  }
  clickAdd(t) {
    if (this.tableState.table.addEmptyRowsOrColsAt(this.rowOrCol, {
      index: t === "before" ? this.index : this.index + 1,
      count: 1
    }), t === "after") {
      this.tableState.outlinedSection = this.tableState.outlinedSection?.shift(
        this.rowOrCol,
        "forward"
      );
      const n = To(this.rowOrCol, this.tableState.activeCell, "forward");
      this.tableState.activeCell = n, this.tableState.anchorCell = n;
    }
    this.close();
  }
  clickAlign(t) {
    this.tableState.table.setAlignmentAt(this.index, t), this.close();
  }
  clickClear() {
    this.tableState.table.clearRowOrCol(this.rowOrCol, this.index), this.close();
  }
  clickDuplicate() {
    this.tableState.table.duplicateRowOrColAt(this.rowOrCol, this.index), this.close();
  }
  clickMove(t) {
    this.tableState.table.moveRowOrColAt(this.rowOrCol, {
      fromIndex: this.index,
      toIndex: t === "backward" ? this.index - 1 : this.index + 1
    }), this.tableState.outlinedSection = this.tableState.outlinedSection?.shift(
      this.rowOrCol,
      t
    );
    const n = To(this.rowOrCol, this.tableState.activeCell, t);
    this.tableState.activeCell = n, this.tableState.anchorCell = n, this.close();
  }
  clickRemove() {
    if (this.tableState.table.removeRowsOrColsAt(this.rowOrCol, { index: this.index, count: 1 }), !this.tableState.table.hasRowOrColAt(this.rowOrCol, this.index)) {
      this.tableState.outlinedSection = this.tableState.outlinedSection?.shift(
        this.rowOrCol,
        "backward"
      );
      const t = To(this.rowOrCol, this.tableState.activeCell, "backward");
      this.tableState.activeCell = t, this.tableState.anchorCell = t;
    }
    this.close();
  }
  clickSort(t) {
    this.tableState.table.sortByColAt(
      this.index,
      t === "ascending" ? (n, o) => pr(n.toString(), o.toString()) : (n, o) => pr(o.toString(), n.toString())
    ), this.close();
  }
  static showMenu(t) {
    new _i(t).open();
  }
  constructor({ tableState: t, handle: n, point: o }) {
    this.tableState = t, this.handle = n, this.point = o;
  }
}
class yi {
  coordinate;
  initialIndex;
  size;
  initialPosition;
  minBound;
  maxBound;
  scrollOffsetX;
  scrollOffsetY;
  subject;
  rowOrCol;
  tableMeasurement;
  currentIndex;
  currentPosition;
  dragged;
  start() {
    return { cellMovement: (t) => this.cellMovement(t) };
  }
  drag(t) {
    this.currentPosition = t[this.coordinate];
    const { currentIndex: n, move: o } = this.calculateDrag();
    return this.currentIndex = n, this.initialIndex !== this.currentIndex && (this.dragged = !0), b(o) && this.tableMeasurement.moveRowOrColAt(this.rowOrCol, o), { cellMovement: (i) => this.cellMovement(i) };
  }
  end() {
    return this.initialIndex === this.currentIndex ? { moved: !1, dragged: this.dragged } : { moved: !0, toIndex: this.currentIndex };
  }
  cellMovement(t) {
    return {
      border: this.cellBorder(t),
      state: this.cellState(t),
      translate: this.cellTranslate(t)
    };
  }
  cellBorder(t) {
    const n = this.isRowOrColExposed(t[this.rowOrCol]), o = this.subject.containsCell(t);
    return this.rowOrCol === "row" ? {
      top: n,
      right: !0,
      bottom: !o || t.row === this.tableMeasurement.lastRowIndex,
      left: this.tableMeasurement.firstColIndex === t.col
    } : {
      top: this.tableMeasurement.firstRowIndex === t.row,
      right: !o || t.col === this.tableMeasurement.lastColIndex,
      bottom: !0,
      left: n
    };
  }
  cellState(t) {
    return this.subject.containsCell(t) ? "moving" : "shiftable";
  }
  cellTranslate(t) {
    const n = this.rowOrColTranslate(t[this.rowOrCol]);
    return this.rowOrCol === "row" ? { x: 0, y: n } : { x: n, y: 0 };
  }
  isRowOrColExposed(t) {
    const n = this.reorderIndex(t), o = n === this.tableMeasurement.firstRowOrColIndex(this.rowOrCol), i = n === this.currentIndex + 1;
    return o || i;
  }
  get rowOrColShift() {
    if (this.currentIndex !== this.initialIndex)
      return this.currentIndex < this.initialIndex ? {
        direction: "forwards",
        range: { start: this.currentIndex, endExclusive: this.initialIndex },
        indexDiff: 1,
        positionDiff: this.size - 1
      } : {
        direction: "backwards",
        range: { start: this.initialIndex + 1, endExclusive: this.currentIndex + 1 },
        indexDiff: -1,
        positionDiff: 1 - this.size
      };
  }
  rowOrColTranslate(t) {
    if (t === this.initialIndex)
      return ft(this.currentPosition - this.initialPosition, {
        min: this.minBound,
        max: this.maxBound
      });
    const n = this.rowOrColShift;
    return _(n) ? 0 : re(t, n.range) ? n.positionDiff : 0;
  }
  reorderIndex(t) {
    const n = this.rowOrColShift;
    return _(n) ? t : t === this.initialIndex ? this.currentIndex : re(t, n.range) ? t + n.indexDiff : t;
  }
  calculateDrag() {
    const t = this.tableMeasurement.rowsOrCols(this.rowOrCol), n = {
      name: "current",
      index: this.currentIndex,
      mid: t[this.currentIndex].mid
    }, o = this.currentIndex !== this.tableMeasurement.firstRowOrColIndex(this.rowOrCol) ? {
      name: "left",
      index: this.currentIndex - 1,
      mid: t[this.currentIndex - 1].start + t[this.currentIndex].size / 2
    } : void 0, i = this.currentIndex !== this.tableMeasurement.lastRowOrColIndex(this.rowOrCol) ? {
      name: "right",
      index: this.currentIndex + 1,
      mid: t[this.currentIndex].start + t[this.currentIndex + 1].size + t[this.currentIndex].size / 2
    } : void 0, r = ya(
      Ea([n, o, i]),
      (l, s) => ko(this.currentPosition - l.mid) - ko(this.currentPosition - s.mid)
    );
    return r.name === "current" ? { currentIndex: this.currentIndex, move: void 0 } : {
      currentIndex: r.index,
      move: { fromIndex: this.currentIndex, toIndex: r.index }
    };
  }
  static of(t) {
    return new yi(t);
  }
  constructor({
    rowOrCol: t,
    index: n,
    position: o,
    subject: i,
    tableElement: r,
    scrollOffsetX: l,
    scrollOffsetY: s
  }) {
    this.scrollOffsetX = l, this.scrollOffsetY = s;
    const a = to.of(r, {
      x: this.scrollOffsetX(),
      y: this.scrollOffsetY()
    });
    this.rowOrCol = t, this.coordinate = t === "row" ? "y" : "x", this.initialIndex = n, this.initialPosition = o[this.coordinate], this.minBound = a.firstRowOrCol(this.rowOrCol).start - a.rowOrColAt(this.rowOrCol, n).start, this.maxBound = a.lastRowOrCol(this.rowOrCol).end - a.rowOrColAt(this.rowOrCol, n).end, this.size = a.rowOrColAt(this.rowOrCol, n).size, this.subject = i, this.dragged = !1, this.tableMeasurement = a, this.currentIndex = n, this.currentPosition = o[this.coordinate];
  }
}
class Ei {
  tableState;
  rowOrCol;
  index;
  onClick;
  moveTracker;
  subject;
  autoScroller;
  removeEventListeners;
  start(t) {
    t.preventDefault();
    const n = this.moveTracker.start();
    this.tableState.outlinedSection = this.subject, this.tableState.move = n, this.tableState.activeHandle = {
      state: "active",
      handle: { type: "header", index: this.index, location: this.rowOrCol }
    };
    const o = this.rowOrCol === "row" ? { row: this.index, col: this.tableState.table.lastColIndex } : { row: this.tableState.table.lastRowIndex, col: this.index };
    this.tableState.activeCell = o, this.tableState.anchorCell = o, this.tableState.focusTable();
    const i = hi(t.target);
    this.removeEventListeners = ke(
      ss(t, i),
      J(i, "pointermove", (r) => this.drag(r)),
      J(i, "pointerup", () => this.end())
    );
  }
  drag(t) {
    t.preventDefault(), this.autoScroller.updatePosition(t.clientX, t.clientY), this.tableState.move = this.moveTracker.drag({
      x: t.clientX + this.tableState.scrollOffsetX,
      y: t.clientY + this.tableState.scrollOffsetY
    });
  }
  end() {
    this.removeEventListeners?.(), this.autoScroller.destroy();
    const t = this.moveTracker.end();
    if (t.moved) {
      this.tableState.table.moveRowOrColAt(this.rowOrCol, {
        fromIndex: this.index,
        toIndex: t.toIndex
      }), this.tableState.outlinedSection = z.of(
        this.rowOrCol === "row" ? {
          row: { start: t.toIndex, endExclusive: t.toIndex + 1 },
          col: this.tableState.table.colRange
        } : {
          row: this.tableState.table.rowRange,
          col: { start: t.toIndex, endExclusive: t.toIndex + 1 }
        }
      );
      const n = this.rowOrCol === "row" ? { row: t.toIndex, col: this.tableState.table.lastColIndex } : { row: this.tableState.table.lastRowIndex, col: t.toIndex };
      this.tableState.activeCell = n, this.tableState.anchorCell = n;
    }
    this.tableState.move = void 0, this.tableState.activeHandle = void 0, !t.moved && !t.dragged && this.onClick();
  }
  static startMove(t) {
    new Ei(t).start(t.event);
  }
  constructor({ event: t, tableState: n, rowOrCol: o, index: i, onClick: r }) {
    this.tableState = n, this.rowOrCol = o, this.index = i, this.subject = z.of(
      o === "row" ? { row: { start: i, endExclusive: i + 1 }, col: this.tableState.table.colRange } : { row: this.tableState.table.rowRange, col: { start: i, endExclusive: i + 1 } }
    ), this.onClick = r, this.autoScroller = po.of({
      offset: 16,
      maxScroll: 32,
      boundaryElement: { x: n.scrollElement, y: n.rootScrollElement },
      scrollElement: { x: n.scrollElement, y: n.rootScrollElement }
    }), this.moveTracker = yi.of({
      subject: this.subject,
      rowOrCol: o,
      index: i,
      position: {
        x: t.clientX + n.scrollOffsetX,
        y: t.clientY + n.scrollOffsetY
      },
      tableElement: n.tableElement,
      scrollOffsetX: () => this.tableState.scrollOffsetX,
      scrollOffsetY: () => this.tableState.scrollOffsetY
    });
  }
}
function zd(e) {
  return e === "row" ? "y" : "x";
}
class Ri {
  tableState;
  type;
  initialHandle;
  initialRowOrColCount;
  initialPosition;
  initialOutlinedSection;
  initialActiveCell;
  initialAnchorCell;
  cellSizePixels;
  dragThresholdPixels;
  dragged;
  start() {
    return { activeHandle: { state: "active", handle: this.initialHandle } };
  }
  drag(t) {
    return this.dragged = !0, this.calculateDrag(t);
  }
  end() {
    return this.dragged ? { activeHandle: void 0 } : this.calculateClick();
  }
  calculateClick() {
    if (this.type !== "table") return this.calculateClickRowOrCol(this.type);
    if (this.initialHandle.location === "right") return this.calculateClickRowOrCol("col");
    if (this.initialHandle.location === "bottom") return this.calculateClickRowOrCol("row");
    const t = this.calculateClickRowOrCol("row"), n = this.calculateClickRowOrCol("col");
    return {
      operation: { row: t.operation.row, col: n.operation.col },
      activeHandle: t.activeHandle,
      activeCell: b(t.activeCell) && b(n.activeCell) ? { row: t.activeCell.row, col: n.activeCell.col } : void 0,
      anchorCell: b(t.anchorCell) && b(n.anchorCell) ? { row: t.anchorCell.row, col: n.anchorCell.col } : void 0,
      outlinedSection: b(t.outlinedSection) && b(n.outlinedSection) ? z.of({
        row: t.outlinedSection.row,
        col: n.outlinedSection.col
      }) : void 0
    };
  }
  calculateClickRowOrCol(t) {
    const n = this.type === "table" ? this.tableState.table.lastRowOrColIndex(t) + 1 : this.initialHandle.index;
    return {
      operation: { [t]: { action: "add", index: n, count: 1 } },
      activeHandle: this.type === "table" ? void 0 : {
        state: "hover",
        handle: {
          type: "border",
          location: this.handleLocationAt(n),
          index: n
        }
      },
      ...this.calculateCellMovement(t, 1)
    };
  }
  calculateDrag(t) {
    if (this.type !== "table") return this.calculateDragRowOrCol(this.type, t);
    if (this.initialHandle.location === "right") return this.calculateDragRowOrCol("col", t);
    if (this.initialHandle.location === "bottom") return this.calculateDragRowOrCol("row", t);
    const n = this.calculateDragRowOrCol("row", t), o = this.calculateDragRowOrCol("col", t);
    if (_(n) && _(o)) return;
    const i = n ?? this.calculateCellMovement("row", this.rowOrColDiff("row")), r = o ?? this.calculateCellMovement("col", this.rowOrColDiff("col"));
    return {
      operation: { row: n?.operation.row, col: o?.operation.col },
      activeHandle: n?.activeHandle ?? o?.activeHandle,
      activeCell: b(i.activeCell) && b(r.activeCell) ? { row: i.activeCell.row, col: r.activeCell.col } : void 0,
      anchorCell: b(i.anchorCell) && b(r.anchorCell) ? { row: i.anchorCell.row, col: r.anchorCell.col } : void 0,
      outlinedSection: b(i.outlinedSection) && b(r.outlinedSection) ? z.of({
        row: i.outlinedSection.row,
        col: r.outlinedSection.col
      }) : void 0
    };
  }
  calculateDragRowOrCol(t, n) {
    const o = zd(t), i = n.position[o] - this.initialPosition[o], r = za(i / this.cellSizePixels[t]), s = i % this.cellSizePixels[t] >= this.dragThresholdPixels[t] ? 1 : 0, a = this.tableState.table.rowOrColCount(t) - this.initialRowOrColCount[t], h = r + s - a, d = this.type === "table" ? this.tableState.table.lastRowOrColIndex(t) + 1 : this.initialHandle.index + a;
    if (h !== 0)
      return h > 0 ? this.calculateDragRowOrColMore({ rowOrCol: t, start: d, length: h }) : this.calculateDragRowOrColLess({
        rowOrCol: t,
        start: d,
        length: Wn(-h, d, this.tableState.table.lastRowOrColIndex(t))
      });
  }
  calculateDragRowOrColLess({
    rowOrCol: t,
    start: n,
    length: o
  }) {
    let i = 0;
    for (const l of se({ start: n - 1, endExclusive: n - o - 1 })) {
      if (!this.tableState.table.hasEmptyRowOrColAt(t, l)) break;
      i++;
    }
    if (i === 0) return;
    const r = n - (i - 1) - 1;
    return {
      operation: {
        [t]: {
          action: "remove",
          index: n - i,
          count: i
        }
      },
      activeHandle: this.type === "table" ? { state: "active", handle: this.initialHandle } : {
        state: "active",
        handle: {
          type: "border",
          location: this.handleLocationAt(r),
          index: r
        }
      },
      ...this.calculateCellMovement(
        t,
        this.rowOrColDiff(t) - i
      )
    };
  }
  calculateDragRowOrColMore({
    rowOrCol: t,
    start: n,
    length: o
  }) {
    return {
      operation: { [t]: { action: "add", index: n, count: o } },
      activeHandle: {
        state: "active",
        handle: this.type === "table" ? this.initialHandle : {
          type: "border",
          location: this.handleLocationAt(n + o),
          index: n + o
        }
      },
      ...this.calculateCellMovement(t, this.rowOrColDiff(t) + o)
    };
  }
  calculateCellMovement(t, n) {
    const o = this.type === "table" ? this.initialRowOrColCount[t] : this.initialHandle.index;
    if (n >= 0)
      return {
        outlinedSection: this.initialOutlinedSection?.addForwardsByRowOrCol(t, {
          start: o,
          count: n
        }),
        activeCell: b(this.initialActiveCell) ? ir(t, this.initialActiveCell, {
          start: o,
          count: n
        }) : void 0,
        anchorCell: b(this.initialAnchorCell) ? ir(t, this.initialAnchorCell, {
          start: o,
          count: n
        }) : void 0
      };
    {
      const i = -n, r = this.initialOutlinedSection?.subtractBackwardsByRowOrCol(t, {
        start: o,
        count: i,
        min: this.tableState.table.firstRowOrColIndex(t)
      }), l = b(r) ? {
        min: r.startRowOrCol(t),
        max: r.endRowOrCol(t)
      } : void 0, s = b(this.initialActiveCell) ? rr(t, this.initialActiveCell, {
        start: o,
        count: i,
        boundary: l
      }) : void 0, a = b(this.initialAnchorCell) ? rr(t, this.initialAnchorCell, {
        start: o,
        count: i,
        boundary: l
      }) : void 0;
      return { outlinedSection: r, activeCell: s, anchorCell: a };
    }
  }
  rowOrColDiff(t) {
    return this.tableState.table.rowOrColCount(t) - this.initialRowOrColCount[t];
  }
  handleLocationAt(t) {
    if (this.type !== "table")
      return this.type === "row" && t === this.tableState.table.firstRowIndex ? "top" : this.type === "col" && t === this.tableState.table.firstColIndex ? "left" : this.type;
  }
  handleToType(t) {
    return t.type === "table" ? "table" : t.location === "top" ? "row" : t.location === "left" ? "col" : t.location;
  }
  static of(t) {
    return new Ri(t);
  }
  constructor({
    tableState: t,
    handle: n,
    position: o,
    cellSizePixels: i,
    dragThresholdPixels: r
  }) {
    this.tableState = t, this.type = this.handleToType(n), this.initialHandle = n, this.initialPosition = o, this.initialRowOrColCount = { row: t.table.rowCount, col: t.table.colCount }, this.initialActiveCell = t.activeCell, this.initialAnchorCell = t.anchorCell, this.initialOutlinedSection = t.outlinedSection, this.cellSizePixels = i, this.dragThresholdPixels = r, this.dragged = !1;
  }
}
function Ld(e) {
  const t = Gn(
    e.tableElement,
    e.table.firstCellLocation
  ), n = Eu(t), { minWidth: o } = getComputedStyle(t), { lineHeight: i, paddingTop: r, paddingBottom: l } = getComputedStyle(n), s = parseFloat(o) + 1, a = parseFloat(i) + parseFloat(r) + parseFloat(l) + 1;
  return { width: s, height: a };
}
class Ai {
  tableState;
  resizeTracker;
  removeEventListeners;
  start(t) {
    t.preventDefault();
    const n = this.resizeTracker.start();
    this.tableState.resize = {}, this.tableState.activeHandle = n.activeHandle, this.tableState.focusTable(), this.removeEventListeners = ke(
      ss(t, this.tableState.tableElement),
      J(this.tableState.tableElement, "pointermove", (o) => this.drag(o)),
      J(this.tableState.tableElement, "pointerup", () => this.end())
    );
  }
  drag(t) {
    t.preventDefault();
    const n = this.resizeTracker.drag({
      position: { x: t.clientX, y: t.clientY }
    });
    b(n) && (this.resizeTable(n.operation), this.tableState.activeHandle = n.activeHandle, this.tableState.activeCell = n.activeCell, this.tableState.anchorCell = n.anchorCell, this.tableState.outlinedSection = n.outlinedSection);
  }
  end() {
    this.removeEventListeners?.();
    const t = this.resizeTracker.end();
    "operation" in t && (this.resizeTable(t.operation), this.tableState.activeCell = t.activeCell, this.tableState.anchorCell = t.anchorCell, this.tableState.outlinedSection = t.outlinedSection), this.tableState.activeHandle = t.activeHandle, this.tableState.resize = void 0;
  }
  resizeTable({ row: t, col: n }) {
    if (b(t)) {
      const { action: o, index: i, count: r } = t;
      o === "add" ? this.tableState.table.addEmptyRowsAt({ row: i, count: r }) : this.tableState.table.removeRowsAt({ row: i, count: r });
    }
    if (b(n)) {
      const { action: o, index: i, count: r } = n;
      o === "add" ? this.tableState.table.addEmptyColsAt({ col: i, count: r }) : this.tableState.table.removeColsAt({ col: i, count: r });
    }
  }
  static startResize(t) {
    new Ai(t).start(t.event);
  }
  constructor({ event: t, tableState: n, handle: o }) {
    this.tableState = n;
    const { width: i, height: r } = Ld(n);
    this.resizeTracker = Ri.of({
      tableState: this.tableState,
      handle: o,
      position: { x: t.clientX, y: t.clientY },
      cellSizePixels: { row: r, col: i },
      dragThresholdPixels: { row: r / 2, col: i / 2 }
    });
  }
}
function Od(e, t) {
  t.interactive && (t.activeHandle = { state: "hover", handle: e });
}
function Dd(e) {
  e.interactive && (e.activeHandle = void 0);
}
function Id(e, t, n) {
  if (n.interactive) {
    if (!xi(e)) {
      e.preventDefault();
      return;
    }
    t.type === "table" || t.type === "border" ? Ai.startResize({ event: e, handle: t, tableState: n }) : t.type === "header" && Ei.startMove({
      event: e,
      rowOrCol: t.location,
      index: t.index,
      tableState: n,
      onClick: () => _i.showMenu({
        handle: t,
        point: { x: e.clientX, y: e.clientY },
        tableState: n
      })
    });
  }
}
function Pd(e, t) {
  const n = e.target;
  if (_(n)) return;
  const o = Ci(n);
  if (b(o)) {
    Od(o, t);
    return;
  }
  const i = _n(n);
  if (b(i)) {
    Ed(uo(i), t);
    return;
  }
}
function Md(e, t) {
  const n = e.target;
  if (_(n)) return;
  const o = Ci(n);
  if (b(o)) {
    Dd(t);
    return;
  }
  const i = _n(n);
  if (b(i)) {
    Rd(t);
    return;
  }
}
function Hd(e, t) {
  const n = e.target;
  if (_(n)) return;
  const o = Ci(n);
  if (b(o)) {
    Id(e, o, t);
    return;
  }
  const i = _n(n);
  if (b(i)) {
    Ad(e, uo(i), t);
    return;
  }
  e.preventDefault();
}
function Bd(e) {
  e.preventDefault();
}
var Nd = /* @__PURE__ */ O("<!> <!> <!>", 1), Fd = /* @__PURE__ */ O('<tr class="tbl-table-row"></tr>'), $d = /* @__PURE__ */ O('<tbody class="tbl-table-body"></tbody>'), Ud = /* @__PURE__ */ O("<!> <!>", 1), Vd = /* @__PURE__ */ O("<!> <!>", 1), qd = /* @__PURE__ */ O("<!> <!> <!>", 1), Wd = /* @__PURE__ */ O("<!> <!>", 1), jd = /* @__PURE__ */ O("<!> <!>", 1), Kd = /* @__PURE__ */ O("<!> <!>", 1), Yd = /* @__PURE__ */ O("<!> <!>", 1), Xd = /* @__PURE__ */ O("<!> <!> <!> <!> <!>", 1), Gd = /* @__PURE__ */ O("<!> <!>", 1), Jd = /* @__PURE__ */ O("<!> <!>", 1), Zd = /* @__PURE__ */ O("<!> <!> <!>", 1), Qd = /* @__PURE__ */ O("<!> <!>", 1), tf = /* @__PURE__ */ O("<!> <!>", 1), ef = /* @__PURE__ */ O("<!> <!> <!>", 1), nf = /* @__PURE__ */ O("<!> <!>", 1), of = /* @__PURE__ */ O("<!> <!>", 1), rf = /* @__PURE__ */ O("<!> <!>", 1), lf = /* @__PURE__ */ O("<!> <!> <!> <!> <!> <!> <!>", 1), sf = /* @__PURE__ */ O('<div class="tbl-table-wrapper"><table class="tbl-table" role="grid" tabindex="-1"><thead class="tbl-table-head"><!></thead><!></table> <!> <!> <!> <!></div>');
function af(e, t) {
  me(t, !0);
  const n = bi.of({
    table: () => t.table,
    selection: () => t.selection,
    scrollElement: () => t.scrollElement,
    rootEditor: () => t.rootEditor,
    menuRootElement: () => t.menuRootElement,
    extensions: () => t.extensions,
    markdownConfig: () => t.markdownConfig,
    globalKeyBindings: () => t.globalKeyBindings,
    selectionType: () => t.selectionType,
    lineWrapping: () => t.lineWrapping,
    onUndo: () => t.onUndo,
    onRedo: () => t.onRedo,
    onNavigate: () => t.onNavigate,
    onDelete: () => t.onDelete
  });
  ao(() => ke(J(n.document, "selectionchange", () => Ru(n)), J(n.document.body, "pointerdown", () => wu(n), { capture: !0, passive: !0 }), J(n.document.body, "pointerup", () => Cu(n), { capture: !0, passive: !0 }), J(n.document.body, "pointerleave", () => xu(n), { capture: !0, passive: !0 }), J(n.document.body, "copy", (x) => Su(x, n)), J(n.document.body, "cut", (x) => _u(x, n)), J(n.document.body, "paste", (x) => yu(x, n))));
  var o = sf(), i = Lt(o);
  {
    const x = (R, it = Fr) => {
      var nt = Fd();
      On(nt, 20, () => n.table.colIndices, (W) => W, (W, ee) => {
        const D = /* @__PURE__ */ A(() => ({ row: it(), col: ee })), Ge = /* @__PURE__ */ A(() => ({
          top: it() === n.table.firstRowIndex,
          left: ee === n.table.firstColIndex
        })), Oe = /* @__PURE__ */ A(() => n.selection.isCell() && ze(f(D), n.selection.cell));
        {
          let vo = /* @__PURE__ */ A(() => n.outlinedSection?.containsOnEdge(f(D)) ?? { top: !1, right: !1, bottom: !1, left: !1 }), yn = /* @__PURE__ */ A(() => n.move?.cellMovement(f(D)));
          Pu(W, {
            get location() {
              return f(D);
            },
            get alignment() {
              return n.table.alignments[ee];
            },
            get selected() {
              return f(Oe);
            },
            get position() {
              return f(Ge);
            },
            get outline() {
              return f(vo);
            },
            get movement() {
              return f(yn);
            },
            get win() {
              return n.window;
            },
            children: (bo, go) => {
              var En = Nd(), Je = G(En);
              On(Je, 16, () => mu(f(D), f(Ge)), (Rt) => Rt, (Rt, ve) => {
                {
                  let ne = /* @__PURE__ */ A(() => n.cellHandleState(f(D), ve)), be = /* @__PURE__ */ A(() => b(n.resize));
                  fr(Rt, {
                    get of() {
                      return ve;
                    },
                    get state() {
                      return f(ne);
                    },
                    get toggle() {
                      return f(be);
                    }
                  });
                }
              });
              var Rn = T(Je, 2);
              Wu(Rn, {
                get hidden() {
                  return f(Oe);
                },
                children: (Rt, ve) => {
                  var ne = ci(), be = G(ne);
                  xh(be, () => hu(n.table.cellAt(f(D)), n.highlighter(f(D)))), C(Rt, ne);
                },
                $$slots: { default: !0 }
              });
              var An = T(Rn, 2);
              {
                var wo = (Rt) => {
                  var ve = () => n.table.cellAt(f(D)), ne = (U) => n.table.setCellAt(f(D), U), be = () => n.selection.cellSection, P = (U) => {
                    n.selectionValue = { cell: f(D), section: U };
                  };
                  {
                    let U = /* @__PURE__ */ A(() => n.highlighter(f(D)));
                    Bu(Rt, {
                      get text() {
                        return ve();
                      },
                      set text(B) {
                        ne(B);
                      },
                      get selection() {
                        return be();
                      },
                      set selection(B) {
                        P(B);
                      },
                      get selectionType() {
                        return n.selectionType;
                      },
                      get lineWrapping() {
                        return n.lineWrapping;
                      },
                      get extensions() {
                        return n.extensions;
                      },
                      get markdownConfig() {
                        return n.markdownConfig;
                      },
                      get rootEditor() {
                        return n.rootEditor;
                      },
                      get globalKeyBindings() {
                        return n.globalKeyBindings;
                      },
                      get highlighter() {
                        return f(U);
                      },
                      onbeforeinput: (B) => Fu(B, n),
                      ondragstart: (B) => $u(B),
                      onkeydown: (B, j) => Uu(B, j, n),
                      onpaste: (B) => Vu(B, n)
                    });
                  }
                };
                lt(An, (Rt) => {
                  f(Oe) && Rt(wo);
                });
              }
              C(bo, En);
            },
            $$slots: { default: !0 }
          });
        }
      }), C(R, nt);
    };
    var r = Lt(i), l = Lt(r);
    x(l, () => n.table.headerRowIndex);
    var s = T(r);
    {
      var a = (R) => {
        var it = $d();
        On(it, 20, () => n.table.dataRowIndices, (nt) => nt, (nt, W) => {
          x(nt, () => W);
        }), C(R, it);
      }, c = /* @__PURE__ */ A(() => n.table.hasDataRows());
      lt(s, (R) => {
        f(c) && R(a);
      });
    }
    Xn(i, (R) => n.tableElement = R, () => n?.tableElement);
  }
  var h = T(i, 2);
  {
    var d = (x) => {
      const R = /* @__PURE__ */ A(() => n.menu.type === "row" ? "row" : "column");
      ku(x, {
        get to() {
          return n.menuRootElement;
        },
        children: (it, nt) => {
          Gu(it, {
            translate: (W) => n.menu.computeTranslation(W),
            children: (W, ee) => {
              const D = /* @__PURE__ */ A(() => {
                const {
                  addable: P,
                  alignable: U,
                  clearable: B,
                  duplicatable: j,
                  moveable: tt,
                  removable: et,
                  sortable: mt
                } = n.menu.capabilities;
                return {
                  addable: P,
                  alignable: U,
                  clearable: B,
                  duplicatable: j,
                  moveable: tt,
                  removable: et,
                  sortable: mt
                };
              });
              var Ge = lf(), Oe = G(Ge);
              {
                var vo = (P) => {
                  var U = qd(), B = G(U);
                  Ct(B, {
                    onclick: () => xt({ action: "sort", direction: "ascending" }, n),
                    children: (et, mt) => {
                      var H = Ud(), N = G(H);
                      St(N, { name: "sort-ascending" });
                      var Z = T(N, 2);
                      _t(Z, {
                        children: (V, rt) => {
                          var K = wt();
                          ut(() => Kt(K, `Sort by ${f(R) ?? ""} (A-Z)`)), C(V, K);
                        }
                      }), C(et, H);
                    }
                  });
                  var j = T(B, 2);
                  Ct(j, {
                    onclick: () => xt({ action: "sort", direction: "descending" }, n),
                    children: (et, mt) => {
                      var H = Vd(), N = G(H);
                      St(N, { name: "sort-descending" });
                      var Z = T(N, 2);
                      _t(Z, {
                        children: (V, rt) => {
                          var K = wt();
                          ut(() => Kt(K, `Sort by ${f(R) ?? ""} (Z-A)`)), C(V, K);
                        }
                      }), C(et, H);
                    }
                  });
                  var tt = T(j, 2);
                  Pn(tt), C(P, U);
                };
                lt(Oe, (P) => {
                  f(D).sortable && P(vo);
                });
              }
              var yn = T(Oe, 2);
              {
                var bo = (P) => {
                  var U = Xd(), B = G(U);
                  Ct(B, {
                    onclick: () => xt({ action: "align", alignment: "none" }, n),
                    children: (H, N) => {
                      var Z = Wd(), V = G(Z);
                      St(V, { name: "align-none" });
                      var rt = T(V, 2);
                      _t(rt, {
                        children: (K, Pt) => {
                          var jt = wt("Align none");
                          C(K, jt);
                        }
                      }), C(H, Z);
                    }
                  });
                  var j = T(B, 2);
                  Ct(j, {
                    onclick: () => xt({ action: "align", alignment: "left" }, n),
                    children: (H, N) => {
                      var Z = jd(), V = G(Z);
                      St(V, { name: "align-left" });
                      var rt = T(V, 2);
                      _t(rt, {
                        children: (K, Pt) => {
                          var jt = wt("Align left");
                          C(K, jt);
                        }
                      }), C(H, Z);
                    }
                  });
                  var tt = T(j, 2);
                  Ct(tt, {
                    onclick: () => xt({ action: "align", alignment: "center" }, n),
                    children: (H, N) => {
                      var Z = Kd(), V = G(Z);
                      St(V, { name: "align-center" });
                      var rt = T(V, 2);
                      _t(rt, {
                        children: (K, Pt) => {
                          var jt = wt("Align center");
                          C(K, jt);
                        }
                      }), C(H, Z);
                    }
                  });
                  var et = T(tt, 2);
                  Ct(et, {
                    onclick: () => xt({ action: "align", alignment: "right" }, n),
                    children: (H, N) => {
                      var Z = Yd(), V = G(Z);
                      St(V, { name: "align-right" });
                      var rt = T(V, 2);
                      _t(rt, {
                        children: (K, Pt) => {
                          var jt = wt("Align right");
                          C(K, jt);
                        }
                      }), C(H, Z);
                    }
                  });
                  var mt = T(et, 2);
                  Pn(mt), C(P, U);
                };
                lt(yn, (P) => {
                  f(D).alignable && P(bo);
                });
              }
              var go = T(yn, 2);
              {
                var En = (P) => {
                  var U = Zd(), B = G(U);
                  Ct(B, {
                    onclick: () => xt({ action: "add", direction: "before" }, n),
                    children: (et, mt) => {
                      var H = Gd(), N = G(H);
                      St(N, { name: "add-before" });
                      var Z = T(N, 2);
                      _t(Z, {
                        children: (V, rt) => {
                          var K = wt();
                          ut(() => Kt(K, `Add ${f(R) ?? ""} ${f(R) === "row" ? "above" : "before"}`)), C(V, K);
                        }
                      }), C(et, H);
                    }
                  });
                  var j = T(B, 2);
                  Ct(j, {
                    onclick: () => xt({ action: "add", direction: "after" }, n),
                    children: (et, mt) => {
                      var H = Jd(), N = G(H);
                      St(N, { name: "add-after" });
                      var Z = T(N, 2);
                      _t(Z, {
                        children: (V, rt) => {
                          var K = wt();
                          ut(() => Kt(K, `Add ${f(R) ?? ""} ${f(R) === "row" ? "below" : "after"}`)), C(V, K);
                        }
                      }), C(et, H);
                    }
                  });
                  var tt = T(j, 2);
                  Pn(tt), C(P, U);
                };
                lt(go, (P) => {
                  f(D).addable && P(En);
                });
              }
              var Je = T(go, 2);
              {
                var Rn = (P) => {
                  var U = ef(), B = G(U);
                  {
                    var j = (H) => {
                      Ct(H, {
                        onclick: () => xt({ action: "move", direction: "backward" }, n),
                        children: (N, Z) => {
                          var V = Qd(), rt = G(V);
                          {
                            let Pt = /* @__PURE__ */ A(() => `move-${f(R) === "row" ? "up" : "left"}`);
                            St(rt, {
                              get name() {
                                return f(Pt);
                              }
                            });
                          }
                          var K = T(rt, 2);
                          _t(K, {
                            children: (Pt, jt) => {
                              var Ze = wt();
                              ut(() => Kt(Ze, `Move ${f(R) ?? ""} ${f(R) === "row" ? "up" : "left"}`)), C(Pt, Ze);
                            }
                          }), C(N, V);
                        }
                      });
                    };
                    lt(B, (H) => {
                      (f(D).moveable === "backward" || f(D).moveable === !0) && H(j);
                    });
                  }
                  var tt = T(B, 2);
                  {
                    var et = (H) => {
                      Ct(H, {
                        onclick: () => xt({ action: "move", direction: "forward" }, n),
                        children: (N, Z) => {
                          var V = tf(), rt = G(V);
                          {
                            let Pt = /* @__PURE__ */ A(() => `move-${f(R) === "row" ? "down" : "right"}`);
                            St(rt, {
                              get name() {
                                return f(Pt);
                              }
                            });
                          }
                          var K = T(rt, 2);
                          _t(K, {
                            children: (Pt, jt) => {
                              var Ze = wt();
                              ut(() => Kt(Ze, `Move ${f(R) ?? ""} ${f(R) === "row" ? "down" : "right"}`)), C(Pt, Ze);
                            }
                          }), C(N, V);
                        }
                      });
                    };
                    lt(tt, (H) => {
                      (f(D).moveable === "forward" || f(D).moveable === !0) && H(et);
                    });
                  }
                  var mt = T(tt, 2);
                  Pn(mt), C(P, U);
                };
                lt(Je, (P) => {
                  f(D).moveable !== !1 && P(Rn);
                });
              }
              var An = T(Je, 2);
              {
                var wo = (P) => {
                  Ct(P, {
                    onclick: () => xt({ action: "duplicate" }, n),
                    children: (U, B) => {
                      var j = nf(), tt = G(j);
                      St(tt, { name: "duplicate" });
                      var et = T(tt, 2);
                      _t(et, {
                        children: (mt, H) => {
                          var N = wt();
                          ut(() => Kt(N, `Duplicate ${f(R) ?? ""}`)), C(mt, N);
                        }
                      }), C(U, j);
                    }
                  });
                };
                lt(An, (P) => {
                  f(D).duplicatable && P(wo);
                });
              }
              var Rt = T(An, 2);
              {
                var ve = (P) => {
                  Ct(P, {
                    onclick: () => xt({ action: "clear" }, n),
                    children: (U, B) => {
                      var j = of(), tt = G(j);
                      St(tt, { name: "clear" });
                      var et = T(tt, 2);
                      _t(et, {
                        children: (mt, H) => {
                          var N = wt();
                          ut(() => Kt(N, `Clear ${f(R) ?? ""}`)), C(mt, N);
                        }
                      }), C(U, j);
                    }
                  });
                };
                lt(Rt, (P) => {
                  f(D).clearable && P(ve);
                });
              }
              var ne = T(Rt, 2);
              {
                var be = (P) => {
                  Ct(P, {
                    onclick: () => xt({ action: "remove" }, n),
                    children: (U, B) => {
                      var j = rf(), tt = G(j);
                      St(tt, { name: "remove" });
                      var et = T(tt, 2);
                      _t(et, {
                        children: (mt, H) => {
                          var N = wt();
                          ut(() => Kt(N, `Delete ${f(R) ?? ""}`)), C(mt, N);
                        }
                      }), C(U, j);
                    }
                  });
                };
                lt(ne, (P) => {
                  f(D).removable && P(be);
                });
              }
              C(W, Ge);
            },
            $$slots: { default: !0 }
          });
        },
        $$slots: { default: !0 }
      });
    }, u = /* @__PURE__ */ A(() => b(n.menu));
    lt(h, (x) => {
      f(u) && x(d);
    });
  }
  var m = T(h, 2);
  On(m, 16, () => fu, (x) => x, (x, R) => {
    {
      let it = /* @__PURE__ */ A(() => jo(n.activeHandle?.handle, R) ? n.activeHandle.state : void 0);
      fr(x, {
        get of() {
          return R;
        },
        get state() {
          return f(it);
        }
      });
    }
  });
  var v = T(m, 2);
  {
    var w = (x) => {
      Lu(x);
    }, p = /* @__PURE__ */ A(() => !n.interactive && _(n.outline));
    lt(v, (x) => {
      f(p) && x(w);
    });
  }
  var S = T(v, 2);
  {
    var g = (x) => {
      dd(x);
    }, E = /* @__PURE__ */ A(() => n.selection.isAll());
    lt(S, (x) => {
      f(E) && x(g);
    });
  }
  Xn(o, (x) => n.wrapperElement = x, () => n?.wrapperElement), ut((x) => q(o, "data-select-all", x), [() => ye(n.selection.isAll())]), on("mouseover", o, (x) => Pd(x, n)), on("mouseout", o, (x) => Md(x, n)), on("pointerdown", o, (x) => Hd(x, n)), zn("dragover", o, (x) => Bd(x)), on("keydown", i, (x) => yd(x, n)), zn("copy", i, (x) => xd(x, n)), zn("cut", i, (x) => Sd(x, n)), zn("paste", i, (x) => _d(x, n)), C(e, o), pe();
}
Tl(["mouseover", "mouseout", "pointerdown", "keydown"]);
class Ti extends gs {
  tableDescription;
  widgetElement;
  height;
  destroyWidgetElement;
  get estimatedHeight() {
    return this.height;
  }
  coordsAt(t, n, o) {
    const i = this.tableDescription.source.closestCell(n), r = Gn(t, i);
    if (_(r)) return null;
    const l = r.getBoundingClientRect();
    return {
      top: l.top,
      right: l.right,
      bottom: l.bottom,
      left: l.left
    };
  }
  /**
   * Called shortly after creation and after destroy() if the widget is later recreated.
   */
  toDOM(t) {
    if (b(this.widgetElement)) return this.widgetElement;
    const { widgetElement: n, destroyWidgetElement: o } = this.create(t);
    return this.widgetElement = n, this.destroyWidgetElement = o, t.requestMeasure({
      read: () => {
        this.height = n.getBoundingClientRect().height;
      }
    }), n;
  }
  /**
   * Called whenever the table is removed or the widget is hidden due to scrolling the viewport.
   * May be called again to redestroy after the widget has been recreated.
   */
  destroy(t) {
    this.destroyWidgetElement?.(), this.destroyWidgetElement = void 0, this.widgetElement = void 0, this.height = Ji;
  }
  create(t) {
    const n = un(t.dom).createElement("div");
    n.className = "tbl-table-widget", n.tabIndex = -1, n.addEventListener("pointerdown", (m) => {
      m?.target === n && m.preventDefault();
    });
    const o = this.tableDescription, i = ih(() => {
      lo(() => {
        const m = !o.table.text.eq(o.editorTableText), v = !ho(o.selection.value, o.editorSelectionValue);
        if (!m && !v) return;
        const replacement = m ? o.source.applyContent(o.table.text, o.editorTableText) : void 0;
        const selectionSource = m ? new SourceTable(replacement, o.table.colCount) : o.source;
        let w;
        if (o.selection.isCell()) {
          const { from: S } = selectionSource.cellSpan(o.selection.cell);
          w = {
            anchor: o.from + S + o.selection.cellSection.anchor,
            head: o.from + S + o.selection.cellSection.head
          };
        } else o.selection.isAll() ? w = { anchor: o.from, head: o.to } : o.selection.isHidden() && (w = {
          anchor: o.from + 1,
          head: o.from + 1
        });
        const p = m ? {
          from: o.from,
          to: o.to,
          insert: replacement
        } : void 0;
        o.markSynchronized(), t.dispatch({
          annotations: he("table.edit"),
          changes: p,
          selection: w
        });
      });
    }), {
      extensions: r,
      markdownConfig: l,
      globalKeyBindings: s,
      selectionType: a,
      lineWrapping: c
    } = hs(t.state), h = kl(af, {
      target: n,
      props: {
        table: o.table,
        selection: o.selection,
        scrollElement: n,
        rootEditor: t,
        extensions: r,
        markdownConfig: l,
        globalKeyBindings: s,
        selectionType: a,
        lineWrapping: c,
        menuRootElement: ws(t, Yl).dom,
        onUndo: () => Es(t),
        onRedo: () => ys(t),
        onNavigate: (m) => {
          const anchor = m === "before" ? o.from - 1 : o.to + 1;
          if (anchor < 0 || anchor > t.state.doc.length) return;
          t.dispatch({
            annotations: he("table.navigate"),
            selection: { anchor }
          }), t.focus();
        },
        onDelete: () => {
          t.dispatch({
            annotations: he("table.delete"),
            changes: { from: o.from, to: o.to },
            selection: t.state.selection
          }), t.focus();
        }
      }
    }), d = () => {
      zl(h);
    }, u = Oh(n, ({ height: m }) => {
      this.height = m;
    });
    return {
      widgetElement: n,
      destroyWidgetElement: ke(i, d, u)
    };
  }
  static of(t, n) {
    return new Ti(t, n);
  }
  constructor(t, n) {
    super(), this.tableDescription = t;
    const o = Cf(n);
    if (b(o)) {
      const { widgetElement: i, destroyWidgetElement: r } = this.create(o);
      this.widgetElement = i, this.destroyWidgetElement = r, this.height = Lh(o, i);
    } else
      this.widgetElement = void 0, this.destroyWidgetElement = void 0, this.height = Ji;
  }
}
function cf(e, t) {
  return {
    widget: Ti.of(e, t),
    block: !0,
    inclusive: !0
  };
}
function hf(e, t) {
  return Cs.replace(cf(e, t));
}
function uf(e, t) {
  const n = new Os();
  for (const o of e)
    n.add(o.from, o.to, hf(o, t));
  return n.finish();
}
function df(e) {
  return as(e);
}
function ff(e, t) {
  return as(e, t);
}
function as(e, t = []) {
  const n = [];
  ba(Hs(e), (r) => {
    Ar(r) && n.push({ from: e.doc.lineAt(r.from).from, to: e.doc.lineAt(r.to).to });
  });
  return { spans: n, formatting: [], complete: Bs(e) };
}
function mf(e, t) {
  return [...pf(e, t), ...vf(e, t)];
}
function pf(e, { doc: t, lineBreak: n }) {
  return vn({ doc: t, lineBreak: n, span: e }).changes;
}
function vf({ from: e, to: t }, { doc: n }) {
  const o = n.slice(e, t), { text: i } = zo(o);
  return o.eq(i) ? [] : [{ from: e, to: t, insert: i }];
}
const bf = {
  create(e) {
    return Mn(e);
  },
  update(e, t) {
    if (Wh(t)) return Mn(t.state);
    if (!t.docChanged && _(t.selection) && e.complete)
      return e;
    const {
      tables: n,
      formatting: o,
      decorations: i
    } = e;
    if (!t.docChanged && e.complete)
      return {
        tables: vr(n, t),
        formatting: o,
        decorations: i.map(t.changes),
        complete: !0
      };
    if (qh(t) || gf(t, n))
      return Mn(t.state);
    const r = vr(n, t).map((c) => c.span), {
      complete: l,
      spans: s,
      formatting: a
    } = ff(t.state, r);
    return ie(r, s, Mr) ? {
      complete: l,
      tables: n,
      formatting: a,
      decorations: i.map(t.changes)
    } : Mn(t.state);
  },
  provide(e) {
    return pt.decorations.from(e, (t) => t.decorations);
  }
}, cs = Cr.define(bf);
function Mn(e) {
  const { spans: t, formatting: n, complete: o } = df(e), { doc: i, selection: r } = e, l = t.map((s) => pi.of({ span: s, doc: i, selection: r }));
  return { complete: o, tables: l, formatting: n, decorations: uf(l, e) };
}
function gf(e, t) {
  return !fi(e) && t.some((n) => e.changes.touchesRange(n.from, n.to) !== !1);
}
function vr(e, t) {
  return xa(e, (n) => n.applyTransaction(t));
}
const wf = {
  create() {
    return { view: void 0 };
  },
  update(e) {
    return e;
  }
}, ki = Cr.define(wf);
function hs(e) {
  return e.facet(Lo);
}
function de(e) {
  return e.field(cs);
}
function Cf(e) {
  return e.field(ki).view;
}
function xf(e) {
  const { handlePosition: t, selectionType: n, lineWrapping: o } = hs(e);
  return {
    // Enable styling hoverability based on element data
    // CodeMirror support for media queries has parsing issues
    ...oo(window) ? { "data-tbl-hoverable": "" } : {},
    // Enable styling light and dark themes based on element data since
    // CodeMirror only supports reading `darkTheme` property in javascript
    "data-tbl-theme-mode": e.facet(pt.darkTheme) ? "dark" : "light",
    "data-tbl-handle-position": t,
    "data-tbl-selection-type": n,
    "data-tbl-line-wrapping": o
  };
}
const Sf = ["undo", "redo", "select.undo", "select.redo"];
function _f(e) {
  return Sf.some((t) => e.isUserEvent(t));
}
function yf(e) {
  return us(e, "select.search");
}
function Ef(e) {
  return us(e, "select");
}
function Rf(e) {
  return e.isUserEvent("delete.forward");
}
function Af(e) {
  return e.isUserEvent("delete.backward");
}
function us(e, t) {
  return e.annotation(Ds.userEvent) === t;
}
const Tf = ({
  state: e,
  view: t,
  transactions: n
}) => {
  if (t.hasFocus || de(e).tables.some((i) => i.containsSelection()))
    return;
  n.some((i) => _f(i) || yf(i) && !is(t)) && t.focus();
}, ds = Is.define(), kf = new Map(Nl.map((e) => [e, ds.of(e)]));
function fs(e) {
  return kf.get(e);
}
const zf = (e, t) => !t || !de(e).tables.some((n) => n.containsSelection()) ? null : fs("table.focus"), Lf = (e) => {
  const { selection: t, startState: n, docChanged: o } = e;
  if (_(t) || o || !Ef(e) || !$n(t) || !$n(n.selection))
    return e;
  const i = n.selection.main, r = t.main;
  for (const l of de(n).tables) {
    const s = l.from === r.head, a = l.to === r.head, c = l.from === i.head + 1 && l.to === r.head - 1, h = l.from === r.head + 1 && l.to === i.head - 1;
    let d;
    if (s ? d = l.source.cellSpan(l.table.firstCellLocation).from : c ? d = l.source.cellSpan(l.table.firstCellLocation).to : (a || h) && (d = l.source.cellSpan(l.table.lastCellLocation).to), b(d))
      return [
        e,
        {
          annotation: he("table.navigate"),
          selection: ta({ pos: l.from + d })
        }
      ];
  }
  return e;
}, Of = (e) => {
  const { selection: t, startState: n } = e;
  if (_(t) || !$n(t)) return e;
  const o = n.selection.main;
  if (Rf(e)) {
    for (const i of de(n).tables)
      if (o.head === i.from - 1) {
        const r = i.source.cellSpan(i.table.firstCellLocation).from;
        return [
          {
            selection: { anchor: i.from + r, head: i.from + r }
          }
        ];
      }
    return e;
  } else if (Af(e)) {
    for (const i of de(n).tables)
      if (o.head === i.to + 1) {
        const r = i.source.cellSpan(i.table.lastCellLocation).to;
        return [
          {
            selection: { anchor: i.from + r, head: i.from + r }
          }
        ];
      }
    return e;
  } else
    return e;
};
function Df(e) {
  return Rs(e) > 0 || As(e) > 0;
}
const If = ({
  state: e,
  docChanged: t,
  selectionSet: n,
  transactions: o,
  view: i
}) => {
  if (!t && !n && Df(e) || o.some((a) => fi(a))) return;
  const { formatting: r } = de(e);
  if (no(r)) return;
  const l = xr.of(r, e.doc.length, e.lineBreak), s = e.selection.map(l);
  i.dispatch({
    annotations: he("table.format"),
    changes: l,
    selection: s
  });
}, Pf = (e) => {
  if (!e.docChanged || fi(e)) return e;
  const t = e.changes, { tables: n } = de(e.startState), o = [];
  for (const l of n)
    if (t.touchesRange(l.from - 1, l.from) !== !1 || t.touchesRange(l.to, l.to + 1) !== !1) {
      const s = { from: t.mapPos(l.from, 1), to: t.mapPos(l.to) };
      if (s.from >= s.to) continue;
      o.push(
        vn({
          doc: e.newDoc,
          lineBreak: e.startState.lineBreak,
          span: s
        }).changes
      );
    }
  if (no(o)) return e;
  const i = xr.of(
    o,
    e.changes.newLength,
    e.startState.lineBreak
  ), r = e.newSelection.map(i);
  return [
    e,
    {
      annotation: he("table.correct"),
      changes: i,
      selection: r,
      sequential: !0
    }
  ];
};
function Mf(e, {
  anchor: t,
  head: n,
  goalColumn: o,
  bidiLevel: i
} = {}) {
  return Fn.range(
    t ?? e.anchor,
    n ?? e.head,
    o ?? e.goalColumn,
    i ?? e.bidiLevel ?? void 0
  );
}
const Hf = (e) => {
  const { selection: t, startState: n, docChanged: o } = e;
  if (_(t) || o || $n(t)) return e;
  const i = t.ranges.map((r) => {
    if (r.empty) return r;
    const l = de(n).tables, s = br(r.anchor, l, n.doc.length), a = br(r.head, l, n.doc.length);
    return b(s) || b(a) ? Mf(r, { anchor: s, head: a }) : r;
  });
  return ie(t.ranges, i, (r, l) => r === l) ? e : [
    e,
    {
      annotations: he("table.select"),
      selection: Fn.create(i, t.mainIndex)
    }
  ];
};
function br(e, t, documentLength) {
  for (const n of t) {
    const o = n.from, i = n.to, r = n.from + 1, l = n.to - 1;
    if (e === o || e === r)
      return Math.max(0, o - 1);
    if (e === i || e === l)
      return Math.min(documentLength, i + 1);
  }
}
const Bf = {
  "& .cm-tooltip.cm-tooltip-autocomplete:has(.cm-completionIcon-table)": {
    border: "1px solid var(--tbl-theme-menu-border-color)",
    "box-shadow": "2px 2px 0 0 rgb(0 0 0 / 10%)",
    "font-family": "var(--tbl-style-menu-font-family)",
    "font-size": "var(--tbl-style-menu-font-size)"
  },
  "& .cm-tooltip.cm-tooltip-autocomplete > ul:has(.cm-completionIcon-table)": {
    "min-width": "auto",
    display: "flex",
    "flex-direction": "column",
    "justify-content": "center",
    padding: "0.25em 0",
    "line-height": 1,
    "font-family": "var(--tbl-style-menu-font-family)",
    "font-size": "var(--tbl-style-menu-font-size)",
    background: "var(--tbl-theme-menu-background)"
  },
  "& .cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]:has(.cm-completionIcon-table)": {
    color: "var(--tbl-theme-menu-hover-text-color)",
    "&::before": {
      background: "var(--tbl-theme-menu-hover-background)"
    }
  },
  "& .cm-tooltip.cm-tooltip-autocomplete ul li:not([aria-selected]):has(.cm-completionIcon-table)": {
    color: "var(--tbl-theme-menu-text-color)"
  },
  "& .cm-tooltip.cm-tooltip-autocomplete ul li:not([aria-selected]):has(.cm-completionIcon-table), & .cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]:has(.cm-completionIcon-table)": {
    position: "relative",
    padding: "0.5em 0.75em",
    background: "var(--tbl-theme-menu-background)",
    display: "flex",
    gap: "0.75em",
    "align-items": "center",
    "font-family": "var(--tbl-style-menu-font-family)",
    "font-size": "var(--tbl-style-menu-font-size)",
    "line-height": 1,
    "&::before": {
      position: "absolute",
      height: "100%",
      width: "calc(100% - 0.5em)",
      left: "0.25em",
      top: 0,
      content: '""',
      "pointer-events": "none"
    }
  },
  "& .cm-completionIcon.cm-completionIcon-table": {
    opacity: 1,
    // Using mask-image allows setting the color of the inline svg in CSS with `background`
    "mask-image": `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' height='14' width='12.25' viewBox='0 0 448 512'%3E%3C!--!Font Awesome Free v7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--%3E%3Cpath d='M384 96l-128 0 0 128 128 0 0-128zm64 128l0 192c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96C0 60.7 28.7 32 64 32l320 0c35.3 0 64 28.7 64 64l0 128zM64 288l0 128 128 0 0-128-128 0zm128-64l0-128-128 0 0 128 128 0zm64 64l0 128 128 0 0-128-128 0z'/%3E%3C/svg%3E")`,
    "mask-position": "center",
    "mask-repeat": "no-repeat",
    padding: 0,
    background: "currentColor",
    position: "relative",
    width: "1em",
    height: "1em",
    "font-family": "var(--tbl-style-menu-font-family)",
    "font-size": "var(--tbl-style-menu-font-size)",
    "line-height": 1
  },
  "& :has(.cm-completionIcon.cm-completionIcon-table) .cm-completionLabel": {
    position: "relative"
  }
}, Nf = {
  '&[data-tbl-handle-position="inside"] .tbl-table-widget': {
    "padding-left": "6px",
    "margin-left": 0
  },
  ".tbl-table-widget": {
    contain: "paint",
    "padding-top": "16px",
    "padding-right": "16px",
    "padding-bottom": "16px",
    "padding-left": "16px",
    "margin-left": "-10px",
    "overflow-x": "auto",
    "overflow-y": "hidden",
    "&, &::before, &::after, & *, & *::before, & *::after": {
      "box-sizing": "border-box"
    }
  },
  "&.cm-editor .cm-content div.tbl-table-widget::selection, & .cm-content div.tbl-table-widget ::selection, & .cm-content div.tbl-table-widget:focus::selection, & .cm-content div.tbl-table-widget :focus::selection": {
    "background-color": "transparent !important",
    // Override CM style which uses !important
    "caret-color": "transparent !important"
    // Override CM style which uses !important
  }
}, Ff = {
  ".cm-tooltip.tbl-menu-tooltip": {
    border: "none",
    "user-select": "none",
    "&, &::before, &::after, & *, & *::before, & *::after": {
      "box-sizing": "border-box"
    }
  }
}, $f = {
  ".tbl-blocking-overlay": {
    position: "absolute",
    top: 0,
    left: 0,
    "z-index": 900,
    "background-color": "transparent",
    width: "100%",
    height: "100%"
  }
}, Uf = {
  "& .cm-content div.tbl-table-widget .tbl-cell-editor ::selection, & .cm-content div.tbl-table-widget .tbl-cell-editor :focus::selection": {
    "background-color": "Highlight !important",
    // Override CM style which uses !important
    "caret-color": "initial !important"
    // Override CM style which uses !important
  },
  "&[data-tbl-selection-type='codemirror'] .tbl-cell-editor .cm-editor .cm-content": {
    "caret-color": "transparent !important"
    // Override CM style which uses !important
  },
  "&[data-tbl-selection-type='codemirror'] .tbl-cell-editor .cm-editor .cm-content ::selection, &[data-tbl-selection-type='codemirror'] .tbl-cell-editor .cm-editor .cm-content :focus::selection": {
    "background-color": "transparent !important",
    // Override CM style which uses !important
    "caret-color": "transparent !important"
    // Override CM style which uses !important
  },
  "&[data-tbl-line-wrapping='wrap'] .tbl-cell-editor .cm-editor .cm-content": {
    "word-break": "normal",
    "overflow-wrap": "break-word"
  },
  ".tbl-cell-editor": {
    height: "100%"
  },
  ".tbl-cell-editor .cm-editor": {
    margin: 0,
    padding: 0,
    outline: "none",
    height: "100%",
    background: "unset",
    color: "var(--tbl-theme-text-color)"
  },
  ".tbl-cell-editor .cm-editor .cm-scroller": {
    margin: 0,
    padding: 0,
    overflow: "hidden",
    "line-height": 1.5,
    "font-family": "var(--tbl-style-font-family)",
    "font-size": "var(--tbl-style-font-size)",
    color: "var(--tbl-theme-text-color)"
  },
  ".tbl-cell-editor .cm-editor .cm-content": {
    margin: 0,
    padding: "7px 9px",
    "line-height": 1.5,
    "font-family": "var(--tbl-style-font-family)",
    "font-size": "var(--tbl-style-font-size)",
    color: "var(--tbl-theme-text-color)"
  },
  ".tbl-cell-editor .cm-editor .cm-line": {
    margin: 0,
    padding: "0 1px",
    "line-height": 1.5,
    "touch-action": "none",
    "font-family": "var(--tbl-style-font-family)",
    "font-size": "var(--tbl-style-font-size)",
    color: "var(--tbl-theme-text-color)"
  }
}, Vf = {
  ".tbl-cell": {
    "box-sizing": "content-box",
    position: "relative",
    "vertical-align": "top",
    "background-color": "var(--tbl-row-background)",
    padding: 0,
    "font-family": "var(--tbl-style-font-family)",
    "font-size": "var(--tbl-style-font-size)",
    "min-width": "calc(4ch + 20px)",
    height: "inherit",
    "user-select": "none",
    border: "none",
    "scroll-margin-right": "1px",
    "scroll-margin-left": "1px",
    "&:first-child": {
      "scroll-margin-left": "16px"
    },
    "&:last-child": {
      "scroll-margin-right": "16px"
    },
    '&[align="left"]': {
      "text-align": "left"
    },
    '&[align="center"]': {
      "text-align": "center"
    },
    '&[align="right"]': {
      "text-align": "right"
    },
    '&[data-border~="top"]': {
      "border-top": "1px solid var(--tbl-theme-border-color)"
    },
    '&[data-border~="right"]': {
      "border-right": "1px solid var(--tbl-theme-border-color)"
    },
    '&[data-border~="bottom"]': {
      "border-bottom": "1px solid var(--tbl-theme-border-color)"
    },
    '&[data-border~="left"]': {
      "border-left": "1px solid var(--tbl-theme-border-color)"
    },
    '&[data-state="moving"]': {
      "z-index": 200,
      "background-color": "color-mix(in srgb, var(--tbl-row-background), transparent 15%)"
    },
    '&[data-state="shiftable"]': {
      transform: "translate3d(0, 0, 0)",
      transition: "transform 150ms ease"
    },
    "&[data-outline]": {
      "&::after": {
        display: "block",
        position: "absolute",
        top: "-1px",
        left: "-1px",
        border: "none",
        width: "calc(100% + 2px)",
        height: "calc(100% + 2px)",
        "pointer-events": "none",
        content: '""'
      },
      '&[data-outline~="top"]::after': {
        "border-top": "2px solid var(--tbl-theme-outline-color)"
      },
      '&[data-outline~="right"]::after': {
        "border-right": "2px solid var(--tbl-theme-outline-color)"
      },
      '&[data-outline~="bottom"]::after': {
        "border-bottom": "2px solid var(--tbl-theme-outline-color)"
      },
      '&[data-outline~="left"]::after': {
        "border-left": "2px solid var(--tbl-theme-outline-color)"
      }
    }
  },
  ".tbl-header-cell:not([align])": {
    "text-align": "var(--tbl-style-default-header-alignment)"
  }
}, qf = {
  '&[data-tbl-line-wrapping="wrap"] .tbl-cell-view': {
    "word-break": "normal",
    "overflow-wrap": "break-word"
  },
  '&[data-tbl-line-wrapping="nowrap"] .tbl-cell-view': {
    "white-space": "pre"
  },
  ".tbl-cell-view": {
    margin: 0,
    outline: "none",
    padding: "7px 10px",
    height: "100%",
    "line-height": 1.5,
    "white-space-collapse": "break-spaces",
    "font-family": "var(--tbl-style-font-family)",
    "font-size": "var(--tbl-style-font-size)",
    color: "var(--tbl-theme-text-color)",
    "&[data-hidden]": {
      display: "none"
    }
  },
  ".tbl-cell-view [data-br]": {
    "white-space": "pre"
  }
}, Wf = {
  ".tbl-handle": {
    display: "flex",
    position: "absolute",
    "justify-content": "center",
    "align-items": "center",
    "z-index": 200,
    transition: "opacity 150ms ease 50ms",
    "touch-action": "none"
  },
  ".tbl-handle[data-hover], .tbl-handle[data-active]": {
    "--tbl-handle-opacity": 1
  },
  '&:not([data-tbl-hoverable]) .tbl-handle[data-type="border"], &:not([data-tbl-hoverable]) .tbl-handle[data-type="table"]': {
    display: "none"
  },
  '.tbl-handle[data-type="border"]': {
    "background-color": "var(--tbl-theme-border-hover-color)"
  },
  '.tbl-handle[data-type="border"][data-active]': {
    "background-color": "var(--tbl-theme-border-active-color)"
  },
  '.tbl-handle[data-type="border"][data-toggle]': {
    transition: "none"
  },
  '.tbl-handle[data-type="border"][data-location="top"]': {
    top: "-1px",
    left: "-1px",
    width: "calc(100% + 2px)",
    height: "2px"
  },
  '.tbl-handle[data-type="border"][data-location="left"]': {
    top: "-1px",
    left: "-1px",
    width: "2px",
    height: "calc(100% + 2px)"
  },
  '.tbl-handle[data-type="border"][data-location="col"]': {
    top: "-1px",
    right: "-2px",
    width: "3px",
    height: "calc(100% + 2px)"
  },
  '.tbl-handle[data-type="border"][data-location="row"]': {
    bottom: "-2px",
    left: "-1px",
    width: "calc(100% + 2px)",
    height: "3px"
  },
  '.tbl-handle[data-type="table"]': {
    "box-sizing": "content-box",
    color: "var(--tbl-theme-border-hover-color)",
    "background-color": "color-mix(in srgb, var(--tbl-theme-border-color), var(--tbl-theme-header-row-background) 80%)"
  },
  '.tbl-handle[data-type="table"][data-location="right"]': {
    top: 0,
    left: "100%",
    width: "15px",
    height: "calc(100% - 2px)",
    border: "1px solid var(--tbl-theme-border-color)",
    "border-left": "none",
    "&::before": {
      position: "absolute",
      top: "-1px",
      left: "-2px",
      width: "2px",
      height: "calc(100% + 2px)",
      content: '""'
    },
    "&::after": {
      position: "absolute",
      "z-index": 366,
      top: "-1px",
      left: 0,
      content: '""',
      width: "calc(100% + 1px)",
      height: "calc(100% + 2px)",
      "background-color": "var(--tbl-overlay)"
    }
  },
  '.tbl-handle[data-type="table"][data-location="bottom-right"]': {
    left: "calc(100% - 1px)",
    top: "calc(100% - 1px)",
    "z-index": 250,
    width: "15px",
    height: "15px",
    border: "1px solid var(--tbl-theme-border-color)",
    "border-top-style": "dashed",
    "border-left-style": "dashed",
    "&::after": {
      position: "absolute",
      "z-index": 366,
      top: "-1px",
      left: "-1px",
      content: '""',
      width: "calc(100% + 2px)",
      height: "calc(100% + 2px)",
      "background-color": "var(--tbl-overlay)"
    }
  },
  '.tbl-handle[data-type="table"][data-location="bottom"]': {
    top: "100%",
    left: "0",
    width: "calc(100% - 2px)",
    height: "15px",
    border: "1px solid var(--tbl-theme-border-color)",
    "border-top": "none",
    "&::before": {
      position: "absolute",
      top: "-2px",
      left: "-1px",
      width: "calc(100% + 2px)",
      height: "2px",
      content: '""'
    },
    "&::after": {
      position: "absolute",
      "z-index": 366,
      top: 0,
      left: "-1px",
      content: '""',
      width: "calc(100% + 2px)",
      height: "calc(100% + 1px)",
      "background-color": "var(--tbl-overlay)"
    }
  },
  '.tbl-handle[data-type="table"][data-location="bottom-right"][data-hover] ~ .tbl-handle[data-type="table"][data-location="right"], .tbl-handle[data-type="table"][data-location="bottom-right"][data-active] ~ .tbl-handle[data-type="table"][data-location="right"], .tbl-handle[data-type="table"][data-location="bottom-right"][data-hover] ~ .tbl-handle[data-type="table"][data-location="bottom"], .tbl-handle[data-type="table"][data-location="bottom-right"][data-active] ~ .tbl-handle[data-type="table"][data-location="bottom"]': {
    "--tbl-handle-opacity": 1
  },
  '.tbl-handle[data-type="table"][data-location="bottom-right"][data-hover] ~ .tbl-handle[data-type="table"][data-location="right"], .tbl-handle[data-type="table"][data-location="bottom-right"][data-active] ~ .tbl-handle[data-type="table"][data-location="right"]': {
    "border-bottom": "none"
  },
  '.tbl-handle[data-type="table"][data-location="bottom-right"][data-hover] ~ .tbl-handle[data-type="table"][data-location="bottom"], .tbl-handle[data-type="table"][data-location="bottom-right"][data-active] ~ .tbl-handle[data-type="table"][data-location="bottom"]': {
    "border-right": "none"
  },
  '.tbl-handle[data-type="table"][data-active], .tbl-handle[data-type="table"][data-location="bottom-right"][data-active] ~ .tbl-handle[data-type="table"][data-location="right"], .tbl-handle[data-type="table"][data-location="bottom-right"][data-active] ~ .tbl-handle[data-type="table"][data-location="bottom"]': {
    "background-color": "color-mix(in srgb, var(--tbl-theme-border-color), var(--tbl-theme-header-row-background) 80%)",
    color: "var(--tbl-theme-border-active-color)"
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"]': {
    "box-sizing": "content-box",
    transition: "none",
    "z-index": 300,
    color: "var(--tbl-theme-border-hover-color)",
    border: "1px solid transparent",
    "&:hover": {
      "border-color": "var(--tbl-theme-border-color)",
      "background-color": "color-mix(in srgb, var(--tbl-theme-border-color), var(--tbl-theme-header-row-background) 80%)"
    },
    "&[data-active]": {
      "background-color": "var(--tbl-theme-outline-color)",
      "border-color": "var(--tbl-theme-outline-color)",
      color: "#ffffff"
    }
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"][data-location="row"]': {
    top: "-1px",
    left: "-17px",
    width: "15px",
    height: "100%",
    "border-right": "none"
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"][data-location="col"]': {
    top: "-17px",
    left: "-1px",
    width: "100%",
    height: "15px",
    "border-bottom": "none",
    "&:hover::after": {
      position: "absolute",
      "z-index": 366,
      top: "-1px",
      left: "-1px",
      content: '""',
      width: "calc(100% + 2px)",
      height: "calc(100% + 1px)",
      "background-color": "var(--tbl-overlay)"
    }
  },
  '&[data-tbl-handle-position="inside"] .tbl-handle[data-type="header"]': {
    transition: "none",
    "z-index": 300,
    color: "var(--tbl-theme-border-hover-color)",
    "&:hover": {
      color: "var(--tbl-theme-border-active-color)"
    },
    "&[data-active]": {
      color: "var(--tbl-theme-outline-color)"
    }
  },
  '&[data-tbl-handle-position="inside"] .tbl-handle[data-type="header"][data-location="row"]': {
    top: "calc(50% - 13px)",
    left: "-1px",
    width: "3px",
    height: "26px",
    "border-top": "4px solid var(--tbl-row-background)",
    "border-bottom": "4px solid var(--tbl-row-background)",
    "background-color": "var(--tbl-row-background)",
    "&:hover::after, &[data-active]::after": {
      position: "absolute",
      top: "-6px",
      left: 0,
      "box-sizing": "content-box",
      "border-top": "2px solid transparent",
      "border-bottom": "2px solid transparent",
      width: "calc(100% + 6px)",
      height: "calc(100% + 8px)",
      content: '""'
    }
  },
  '&[data-tbl-handle-position="inside"] .tbl-handle[data-type="header"][data-location="col"]': {
    top: "-1px",
    left: "calc(50% - 11.5px)",
    width: "23px",
    height: "3px",
    "border-right": "4px solid var(--tbl-row-background)",
    "border-left": "4px solid var(--tbl-row-background)",
    "background-color": "var(--tbl-row-background)",
    "&:hover::after, &[data-active]::after": {
      position: "absolute",
      top: 0,
      left: "-6px",
      "box-sizing": "content-box",
      "border-right": "2px solid transparent",
      "border-left": "2px solid transparent",
      width: "calc(100% + 8px)",
      height: "calc(100% + 6px)",
      content: '""'
    }
  },
  ".tbl-handle-grip": {
    "pointer-events": "none",
    "z-index": 333
  }
}, jf = {
  ".tbl-menu-item-icon": {
    "z-index": 200,
    width: "1em",
    height: "1em",
    "pointer-events": "none",
    "font-size": "var(--tbl-style-menu-font-size)"
  }
}, Kf = {
  ".tbl-menu-item-text": {
    "z-index": 200,
    "pointer-events": "none",
    "user-select": "none",
    "font-size": "var(--tbl-style-menu-font-size)"
  }
}, Yf = {
  ".tbl-menu-item": {
    display: "flex",
    position: "relative",
    "align-items": "center",
    gap: "0.75em",
    padding: "0.5em 0.75em",
    color: "var(--tbl-theme-menu-text-color)",
    "user-select": "none",
    "line-height": 1,
    "font-size": "var(--tbl-style-menu-font-size)",
    "&:active": {
      cursor: "pointer",
      color: "var(--tbl-theme-menu-hover-text-color)",
      "&::after": { "background-color": "var(--tbl-theme-menu-hover-background)" }
    },
    "&::after": {
      position: "absolute",
      left: "0.25em",
      width: "calc(100% - 0.5em)",
      height: "100%",
      content: '""'
    }
  },
  "&[data-tbl-hoverable] .tbl-menu-item:hover": {
    cursor: "pointer",
    color: "var(--tbl-theme-menu-hover-text-color)",
    "&::after": { "background-color": "var(--tbl-theme-menu-hover-background)" }
  }
}, Xf = {
  ".tbl-menu-separator": {
    margin: "0.25em 0.5em",
    "background-color": "var(--tbl-theme-menu-border-color)",
    height: "1px",
    "font-size": "var(--tbl-style-menu-font-size)"
  }
}, Gf = {
  ".tbl-menu": {
    position: "absolute",
    top: 0,
    left: 0,
    "z-index": 900,
    "box-shadow": "2px 2px 0 0 rgb(0 0 0 / 10%)",
    border: "1px solid var(--tbl-theme-menu-border-color)",
    "background-color": "var(--tbl-theme-menu-background)",
    padding: "0.25em 0",
    width: "max-content",
    "font-family": "var(--tbl-style-menu-font-family)",
    "font-size": "var(--tbl-style-menu-font-size)"
  }
}, Jf = {
  ".tbl-select-all-overlay": {
    position: "absolute",
    top: 0,
    left: 0,
    "z-index": 900,
    "background-color": "var(--tbl-overlay)",
    width: "100%",
    height: "100%",
    "pointer-events": "none"
  }
}, Zf = {
  "& .tbl-table-wrapper[data-select-all]": {
    "--tbl-select-all-overlay": "var(--tbl-theme-select-all-blur-overlay)"
  },
  "&.cm-focused .tbl-table-wrapper[data-select-all]": {
    "--tbl-select-all-overlay": "var(--tbl-theme-select-all-focus-overlay)"
  },
  ".tbl-table-wrapper": {
    "--tbl-overlay": "var(--tbl-select-all-overlay, transparent)",
    position: "relative",
    width: "fit-content",
    "white-space-collapse": "collapse",
    "touch-action": "none"
  },
  ".tbl-table": {
    "border-collapse": "separate",
    "border-spacing": 0,
    overflow: "visible",
    "touch-action": "none",
    "&:focus-visible": {
      outline: "none"
    }
  },
  ".tbl-table-head, .tbl-table-body": {
    height: "100%"
  },
  ".tbl-table-row": {
    height: 0
  },
  "@supports (-moz-appearance: none) /* TableTheme */": {
    ".tbl-table-row": {
      height: "fit-content"
    }
  },
  ".tbl-table-head .tbl-table-row": {
    "--tbl-row-background": "var(--tbl-theme-header-row-background)"
  },
  ".tbl-table-body .tbl-table-row:nth-child(2n + 1)": {
    "--tbl-row-background": "var(--tbl-theme-even-row-background)"
  },
  ".tbl-table-body .tbl-table-row:nth-child(2n)": {
    "--tbl-row-background": "var(--tbl-theme-odd-row-background)"
  }
}, Qf = {
  ...Bf,
  ...Ff,
  ...Nf,
  ...Zf,
  ...$f,
  ...Vf,
  ...Uf,
  ...qf,
  ...Wf,
  ...Gf,
  ...Yf,
  ...jf,
  ...Kf,
  ...Xf,
  ...Jf
}, tm = (e) => {
  const t = e.effects.find((n) => n.is(ds))?.value;
  return b(t) ? { annotations: he(t) } : null;
}, em = (e) => {
  const t = e.annotation(di);
  return b(t) ? [fs(Fh(t))] : [];
};
class zi {
  static of(t) {
    return t.state.field(ki).view = t, new zi();
  }
  constructor() {
  }
}
function nm(e) {
  return [
    Lo.of(e),
    cs,
    ki,
    xs.define((t) => zi.of(t)),
    pt.editorAttributes.compute(
      [Lo, pt.darkTheme],
      xf
    ),
    pt.baseTheme(Qf),
    // Wrap theme(s) with `:where()` to set CSS specificity to 0 and make it easy to override
    pt.theme(
      "light" in e.theme ? {
        ':where(:root:has(&[data-tbl-theme-mode="light"]))': e.theme.light.props,
        ':where(:root:has(&[data-tbl-theme-mode="dark"]))': e.theme.dark.props
      } : { ":where(:root:has(&))": e.theme.props }
    ),
    // Wrap style with `:where()` to set CSS specificity to 0 and make it easy to override
    pt.theme({ ":where(:root:has(&))": e.style.props }),
    Ts.of(em),
    Ss.of(Yl),
    Qe.transactionExtender.of(tm),
    Qe.transactionFilter.of(Of),
    Qe.transactionFilter.of(Lf),
    Qe.transactionFilter.of(Hf),
    pt.updateListener.of(Tf),
    pt.clipboardInputFilter.of(Za),
    pt.focusChangeEffect.of(zf)
  ];
}
function _m(e) {
  return nm(yr(e));
}
function om(e, t) {
  if (!_(e))
    for (const n of e)
      t(n);
}
function im(e, t) {
  _(e) || t(e);
}
function ms(e, t, n) {
  if (!Number.isInteger(e) || e <= 0) throw new Error(n);
  if (!Number.isInteger(t) || t <= 0) throw new Error(n);
}
function rm({
  pos: e,
  doc: t,
  lineBreak: n,
  rows: o,
  cols: i
}) {
  const [r, ...l] = He(`${"|   ".repeat(i)}|`, { count: o }), s = `${"| - ".repeat(i)}|`, { before: a, after: c } = vn({
    doc: t,
    lineBreak: n,
    span: { from: e - 1, to: e }
  }), h = `${a?.insert ?? ""}${[r, s, ...l].join(n)}${c?.insert ?? ""}`;
  return {
    // Unicode multiplication sign (\u00d7) looks slightly better than `x` (e.g. 4x4 table)
    // Using raw unicode to keep code ascii
    label: `${o}×${i} table`,
    type: "table",
    apply: (d, u) => {
      d.dispatch({
        annotations: Ks.of(u),
        changes: { from: e - 1, to: e, insert: h },
        selection: { anchor: e + 1 + (a?.count ?? 0) }
      });
    }
  };
}
const lm = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 }
];
function sm(e) {
  const t = e?.options ?? lm;
  return ({ state: n, pos: o }) => {
    const i = n.doc.lineAt(o);
    if (o !== i.from + 1 || i.length !== 1 || i.text.slice(0, 1) !== "|") return null;
    const { doc: l, lineBreak: s } = n;
    return {
      from: o,
      options: t.map(
        ({ rows: a, cols: c }) => rm({ pos: o, doc: l, lineBreak: s, rows: a, cols: c })
      )
    };
  };
}
function ym(e) {
  return om(e?.options, ({ rows: t, cols: n }) => {
    ms(t, n, "options[].{ rows, cols } must be positive integers");
  }), sm(e);
}
const am = { rows: 2, cols: 2 };
function cm(e) {
  const { rows: t, cols: n } = e?.size ?? am;
  return ({ state: o, dispatch: i }) => {
    const { anchor: r, head: l } = o.selection.main, { from: s, to: a } = r <= l ? { from: r, to: l } : { from: l, to: r }, { before: c, after: h } = vn({
      doc: o.doc,
      lineBreak: o.lineBreak,
      span: { from: s, to: a }
    }), [d, ...u] = He(`${"|   ".repeat(n)}|`, { count: t }), m = `${"| - ".repeat(n)}|`, v = `${c?.insert ?? ""}${[d, m, ...u].join(o.lineBreak)}${h?.insert ?? ""}`;
    return i(
      o.update({
        changes: { from: s, to: a, insert: v },
        selection: { anchor: s + 2 + (c?.count ?? 0) }
      })
    ), !0;
  };
}
function Em(e) {
  return im(e?.size, ({ rows: t, cols: n }) => {
    ms(t, n, "size.{rows, cols} must be positive integers");
  }), cm(e);
}
export {
  Pe as TableStyle,
  At as TableTheme,
  Em as insertEmptyMarkdownTable,
  ym as markdownTableAutocompleter,
  _m as markdownTables
};
