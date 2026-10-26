// The attendees line of an event block: a person icon, then as many names as
// fit whole in the block's width and a count of the rest ("Ana, Ben +2"). When
// not even one name fits, the line shows the icon and the total count. A name
// is never cut off.
//
// The fit is measured with a canvas in the line's own font, so trying each
// candidate text writes nothing to the page; the line's text changes only
// when the chosen text does. A resize observer refits a line whenever its
// width changes, as when a window resize or the 100px column minimum changes
// a column's width, or when the line first becomes visible. Font loading
// refits every line, because a fallback font measures differently.

const SVG_NS = "http://www.w3.org/2000/svg";
// Phosphor's "user" icon, fill weight, drawn in the line's text colour.
// Phosphor Icons, MIT. See THIRD-PARTY-NOTICES.txt for the upstream terms.
const PERSON_ICON_PATH = "M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z";
// Canvas text metrics and layout widths can differ by a fraction of a pixel.
const FIT_TOLERANCE_PX = 0.5;

const namesByLine = new WeakMap();
const observedLines = new Set();
let resizeObserver = null;
let measuringContext = null;

/**
 * Chooses the attendees text for a line `availablePx` wide: every name that
 * fits whole, in order, then "+n" for the rest, or the total count when no
 * name fits. `measure` returns a candidate text's width in pixels.
 */
export function fitAttendees(names, availablePx, measure) {
  for (let shown = names.length; shown >= 1; shown -= 1) {
    const rest = names.length - shown;
    const text = names.slice(0, shown).join(", ") + (rest > 0 ? ` +${rest}` : "");
    if (measure(text) <= availablePx + FIT_TOLERANCE_PX) return text;
  }
  return String(names.length);
}

/** Builds an empty attendees line: the icon and the element for its names. */
export function createAttendeesLine() {
  const line = document.createElement("div");
  line.className = "event-attendees";
  line.hidden = true;
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("class", "event-attendees-icon");
  icon.setAttribute("viewBox", "0 0 256 256");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", PERSON_ICON_PATH);
  icon.append(path);
  const label = document.createElement("span");
  label.className = "event-attendees-names";
  line.append(icon, label);
  return line;
}

/**
 * Shows `names` on an attendees line, or hides the line when `names` is null
 * or empty, and keeps the line fitted to its width from then on.
 */
export function setAttendees(line, names) {
  if (!names || names.length === 0) {
    if (!line.hidden) line.hidden = true;
    namesByLine.delete(line);
    observedLines.delete(line);
    resizeObserver?.unobserve(line);
    return;
  }
  const previous = namesByLine.get(line);
  if (line.hidden) line.hidden = false;
  if (previous && previous.length === names.length && previous.every((name, index) => name === names[index])) return;
  namesByLine.set(line, [...names]);
  // A line seen before keeps its width, so it is refitted now. A new line is
  // not yet in its place in the calendar; the observer fits it once it has
  // been laid out there, before it is painted.
  if (observedLines.has(line)) {
    fitLine(line);
  } else {
    setLabelText(line, names.join(", "));
    observedLines.add(line);
    observeResizes().observe(line);
  }
}

function observeResizes() {
  if (resizeObserver) return resizeObserver;
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) fitLine(entry.target);
  });
  document.fonts?.addEventListener("loadingdone", () => {
    for (const line of observedLines) fitLine(line);
  });
  return resizeObserver;
}

function fitLine(line) {
  const names = namesByLine.get(line);
  if (!names) return;
  // The observer reports a line once more when its event is removed from
  // the page; it is then forgotten.
  if (!line.isConnected) {
    observedLines.delete(line);
    resizeObserver?.unobserve(line);
    return;
  }
  const label = line.querySelector(".event-attendees-names");
  // A line hidden because its block is too short has no width. It keeps the
  // whole list until it shows, when the observer fits it.
  const availablePx = label.clientWidth;
  if (availablePx === 0) {
    setLabelText(line, names.join(", "));
    return;
  }
  const context = measuringCanvas();
  // Built from the longhands, because the computed shorthand is empty in some
  // browsers when a font property has no shorthand form.
  const style = getComputedStyle(label);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  setLabelText(line, fitAttendees(names, availablePx, (text) => context.measureText(text).width));
}

function setLabelText(line, text) {
  const label = line.querySelector(".event-attendees-names");
  if (label.textContent !== text) label.textContent = text;
}

function measuringCanvas() {
  measuringContext ??= document.createElement("canvas").getContext("2d");
  return measuringContext;
}
