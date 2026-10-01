import { describe, expect, test } from "vitest";

import { mirrorSelector } from "../lib/pseudo-states.ts";

// The pure half of pseudo-state mirroring: given a rule's selector, produce the
// selector that draws the same state from an attribute instead of a pointer.
// Specificity is the reason this works — `:hover` and `[data-hover]` are both
// (0,1,0) — so the mirrored rule competes exactly as the original does.
describe("mirrorSelector", () => {
  test("swaps the pseudo-class for its attribute", () => {
    expect(mirrorSelector(".channel:hover", "hover")).toBe(".channel[data-hover]");
  });

  test("returns null when the selector has no such pseudo-class", () => {
    expect(mirrorSelector(".channel", "hover")).toBeNull();
  });

  test("keeps the rest of a compound selector intact", () => {
    expect(mirrorSelector("button:hover:not(:disabled)", "hover")).toBe(
      "button[data-hover]:not(:disabled)",
    );
  });

  test("mirrors every part of a selector list that carries the pseudo-class", () => {
    expect(mirrorSelector("a:hover, b:hover", "hover")).toBe("a[data-hover], b[data-hover]");
  });

  test("drops the parts that do not carry it, so the mirror adds nothing new", () => {
    expect(mirrorSelector("a:hover, b", "hover")).toBe("a[data-hover]");
  });

  test("does not mirror a pseudo-class nested inside :not()", () => {
    // `button:not(:hover)` describes the resting state; mirroring it would make
    // the specimen claim to be resting while marked hovered.
    expect(mirrorSelector("button:not(:hover)", "hover")).toBeNull();
  });

  // `:where()` and `:is()` are transparent: they contribute nothing to
  // specificity and the pseudo-class inside them describes the state itself,
  // unlike `:not()`. The foundation wraps its ambient rules in `:where()` so a
  // component can override them, and those rules still need mirroring.
  test("mirrors a pseudo-class inside :where(), keeping the wrapper", () => {
    expect(mirrorSelector(":where(button:hover)", "hover")).toBe(":where(button[data-hover])");
  });

  test("mirrors inside :is() too", () => {
    expect(mirrorSelector(":is(button, a):hover", "hover")).toBe(":is(button, a)[data-hover]");
    expect(mirrorSelector(":is(button:hover)", "hover")).toBe(":is(button[data-hover])");
  });

  test("keeps :not() inside :where() alone while mirroring the state", () => {
    // The shape the button foundation actually uses.
    expect(mirrorSelector(":where(button:hover:not(:disabled))", "hover")).toBe(
      ":where(button[data-hover]:not(:disabled))",
    );
  });

  test("still refuses a pseudo-class nested inside :not() within :where()", () => {
    expect(mirrorSelector(":where(button:not(:hover))", "hover")).toBeNull();
  });

  test("handles active as well as hover", () => {
    expect(mirrorSelector(".channel:active", "active")).toBe(".channel[data-active]");
  });

  test("leaves a different pseudo-class alone", () => {
    expect(mirrorSelector(".channel:focus-visible", "hover")).toBeNull();
  });
});
