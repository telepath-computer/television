import { splitSelectorList } from "../../test/helpers/selector-list.ts";

// Drawing pointer states without a pointer.
//
// `:hover` and `:active` cannot be forced from script — only a real pointer or
// a debugger sets them — so a frame showing states side by side needs another
// way to draw them. The technique is the one Storybook's addon-pseudo-states
// uses: leave the rule alone and give it a second, non-pointer selector.
//
// It is exact rather than approximate because the mirror competes in the
// cascade identically. `:hover` is a pseudo-class at specificity (0,1,0) and
// `[data-hover]` is an attribute selector at (0,1,0); inserting the mirror
// immediately after the original preserves source order too. So the same
// declarations win for the same reasons, which is what a review surface needs.
//
// The alternative — reading a rule's declarations and applying them inline —
// looks equivalent and is not: inline styles outrank everything, so a state
// that should lose to a more specific rule would wrongly win, silently.

/** The pointer states worth drawing; each becomes `data-<state>`. */
export type PseudoState = "hover" | "active";

const attributeFor = (state: PseudoState): string => `[data-${state}]`;

// `:where()` and `:is()` are transparent: they match what they contain, so a
// pseudo-class inside one describes the state itself and is mirrored. The
// foundation wraps its ambient rules in `:where()` to keep them overridable,
// and those rules still need drawing without a pointer.
const TRANSPARENT_FUNCTIONS = new Set([":where", ":is"]);

const FUNCTION_NAME_RE = /(:[a-z-]+)\($/i;

// A pseudo-class inside any other functional selector — `:not(:hover)`,
// `:has(:hover)` — describes the *absence* or containment of the state rather
// than the state itself. Mirroring those would make a specimen claim to be
// resting while it is marked hovered, so they are left alone.
function statedPlainly(selector: string, pseudo: string): boolean {
  const enclosing: string[] = [];
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === "(") {
      const name = FUNCTION_NAME_RE.exec(selector.slice(0, i + 1));
      enclosing.push(name ? name[1]!.toLowerCase() : "");
    } else if (char === ")") {
      enclosing.pop();
    } else if (
      selector.startsWith(pseudo, i) &&
      enclosing.every((fn) => TRANSPARENT_FUNCTIONS.has(fn))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The selector that draws `state` from an attribute instead of a pointer, or
 * null when this rule says nothing about that state.
 *
 * A transparent wrapper is kept rather than unwrapped, so the mirror carries the
 * same specificity as the rule it copies — unwrapping `:where(...)` would make
 * the mirror outrank the original and stop being a faithful copy.
 *
 * A selector list is mirrored part by part: only the parts carrying the pseudo-
 * class are kept, since mirroring a part that never mentioned it would widen
 * what the rule matches.
 */
export function mirrorSelector(selectorText: string, state: PseudoState): string | null {
  const pseudo = `:${state}`;
  const mirrored = splitSelectorList(selectorText)
    .filter((part) => statedPlainly(part, pseudo))
    .map((part) => part.replaceAll(pseudo, attributeFor(state)));

  return mirrored.length > 0 ? mirrored.join(", ") : null;
}

/**
 * Give every pointer-state rule in `doc` a mirrored selector, so an element
 * marked `data-hover` or `data-active` draws that state.
 *
 * Mirrors are inserted immediately after the rule they copy, so source order —
 * and therefore the cascade — is unchanged. Stylesheets that cannot be read
 * (cross-origin) are skipped rather than throwing: a frame's own styles are
 * same-origin, and anything that is not is not the spec's.
 */
export function installPseudoStates(
  doc: Document = document,
  states: PseudoState[] = ["hover", "active"],
): number {
  const pending: Array<{ sheet: CSSStyleSheet; index: number; text: string }> = [];

  for (const sheet of doc.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];
      if (!(rule instanceof doc.defaultView!.CSSStyleRule)) continue;
      for (const state of states) {
        const selector = mirrorSelector(rule.selectorText, state);
        if (selector) pending.push({ sheet, index, text: `${selector} { ${rule.style.cssText} }` });
      }
    }
  }

  // Insert back to front: an insertion shifts every later index in that sheet.
  for (const { sheet, index, text } of pending.reverse()) {
    try {
      sheet.insertRule(text, index + 1);
    } catch {
      // A declaration the parser rejects is not worth failing a frame over.
    }
  }

  return pending.length;
}
