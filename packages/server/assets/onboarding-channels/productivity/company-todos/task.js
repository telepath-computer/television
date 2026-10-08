var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _root, _input, _syncing, _TaskCheckboxElement_instances, sync_fn, deriveAccessibleName_fn, _root2, _label, _TaskMetaDueElement_instances, render_fn;
const RESERVED_EVENT_KEYS = /* @__PURE__ */ new Set([
  "target",
  "currentTarget",
  "eventPhase",
  "defaultPrevented",
  "isTrusted",
  "timeStamp",
  "srcElement",
  "returnValue",
  "cancelBubble",
  "NONE",
  "CAPTURING_PHASE",
  "AT_TARGET",
  "BUBBLING_PHASE",
  "composedPath",
  "stopPropagation",
  "stopImmediatePropagation",
  "preventDefault",
  "initEvent"
]);
function assertNoReservedPayloadKeys(props) {
  for (const key of Object.keys(props)) {
    if (RESERVED_EVENT_KEYS.has(key)) {
      throw new Error(`Event payload key "${key}" is reserved; choose a different property name`);
    }
  }
}
function assignPayload(target, props) {
  assertNoReservedPayloadKeys(props);
  for (const key of Object.keys(props)) {
    Object.defineProperty(target, key, {
      value: props[key],
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
}
function defineEvent() {
  class DefinedEvent extends Event {
    constructor(type, init) {
      const { type: initType, bubbles, cancelable, composed, ...payload } = init ?? {};
      if (initType !== void 0) {
        throw new Error(`Do not pass "type" in init; use the constructor argument instead`);
      }
      super(type, { bubbles, cancelable, composed });
      assignPayload(this, payload);
    }
  }
  return DefinedEvent;
}
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
function parseLocalDate(dateISO) {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function isValidDueDate(dateISO) {
  return !Number.isNaN(parseLocalDate(dateISO).getTime());
}
function startOfLocalDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1e3;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
function dayDelta(dateISO, now) {
  const due = parseLocalDate(dateISO);
  const today = startOfLocalDay(now);
  return Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);
}
function dueState(dateISO, now) {
  const delta = dayDelta(dateISO, now);
  if (delta === 0) return "today";
  if (delta < 0) return "overdue";
  return "upcoming";
}
function formatDue(dateISO, now) {
  const delta = dayDelta(dateISO, now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  const due = parseLocalDate(dateISO);
  const label = `${MONTHS[due.getMonth()]} ${due.getDate()}`;
  return due.getFullYear() === now.getFullYear() ? label : `${label}, ${due.getFullYear()}`;
}
const ToggleEvent = defineEvent();
const CHECKBOX_STYLES = `
  :host {
    display: inline-block;
    position: relative;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  :host([disabled]) { cursor: default; }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .mark {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    overflow: hidden;
    border: 1.5px solid var(--color-border);
    border-radius: 9999px;
    pointer-events: none;
    transition:
      border-color 90ms ease-out,
      transform 120ms cubic-bezier(0.2, 1.6, 0.35, 1);
  }
  .mark::before {
    content: "";
    position: absolute;
    inset: -1.5px;
    border-radius: inherit;
    background: var(--color-primary);
    transform: scale(0);
    transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mark::after {
    content: "";
    width: 4px;
    height: 7px;
    border: solid var(--color-primary-text);
    border-width: 0 1.5px 1.5px 0;
    opacity: 0;
    transform: translateY(-0.5px) rotate(45deg) scale(0.75);
    transition:
      opacity 70ms ease-out 55ms,
      transform 100ms cubic-bezier(0.2, 1.6, 0.35, 1) 55ms;
    z-index: 1;
  }

  input:checked ~ .mark {
    border-color: var(--color-primary);
    animation: pop 180ms cubic-bezier(0.2, 1.7, 0.35, 1);
  }
  input:checked ~ .mark::before { transform: scale(1); }
  input:checked ~ .mark::after {
    opacity: 1;
    transform: translateY(-0.5px) rotate(45deg) scale(1);
  }
  input:active ~ .mark { transform: scale(0.9); }
  input:focus-visible ~ .mark {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  @keyframes pop {
    0% { transform: scale(0.9); }
    55% { transform: scale(1.12); }
    100% { transform: scale(1); }
  }
`;
class TaskCheckboxElement extends HTMLElement {
  constructor() {
    super();
    __privateAdd(this, _TaskCheckboxElement_instances);
    __privateAdd(this, _root);
    __privateAdd(this, _input);
    __privateAdd(this, _syncing, false);
    __privateSet(this, _root, this.attachShadow({ mode: "open" }));
    __privateGet(this, _root).innerHTML = `<style>${CHECKBOX_STYLES}</style><input type="checkbox" /><span class="mark" aria-hidden="true"></span>`;
    __privateSet(this, _input, __privateGet(this, _root).querySelector("input"));
    __privateGet(this, _input).addEventListener("change", () => {
      if (__privateGet(this, _syncing)) return;
      __privateSet(this, _syncing, true);
      this.toggleAttribute("checked", __privateGet(this, _input).checked);
      __privateSet(this, _syncing, false);
      this.dispatchEvent(
        new ToggleEvent("toggle", { checked: __privateGet(this, _input).checked, bubbles: true })
      );
    });
  }
  // Programmatic state. Reading reflects the host attribute; writing toggles it,
  // which drives #sync() through attributeChangedCallback. The #syncing guard
  // means this never emits a `toggle` event — only user interaction does.
  get checked() {
    return this.hasAttribute("checked");
  }
  set checked(v) {
    this.toggleAttribute("checked", Boolean(v));
  }
  connectedCallback() {
    if (Object.prototype.hasOwnProperty.call(this, "checked")) {
      const value = this.checked;
      delete this.checked;
      this.checked = Boolean(value);
    }
    __privateMethod(this, _TaskCheckboxElement_instances, sync_fn).call(this);
    __privateMethod(this, _TaskCheckboxElement_instances, deriveAccessibleName_fn).call(this);
  }
  attributeChangedCallback() {
    __privateMethod(this, _TaskCheckboxElement_instances, sync_fn).call(this);
  }
}
_root = new WeakMap();
_input = new WeakMap();
_syncing = new WeakMap();
_TaskCheckboxElement_instances = new WeakSet();
// Host attributes → inner input.
sync_fn = function() {
  if (__privateGet(this, _syncing)) return;
  __privateSet(this, _syncing, true);
  __privateGet(this, _input).checked = this.hasAttribute("checked");
  __privateGet(this, _input).disabled = this.hasAttribute("disabled");
  __privateSet(this, _syncing, false);
};
// Accessible name comes from the row's title, not a `label` attribute, so the
// author never repeats the title text.
deriveAccessibleName_fn = function() {
  var _a, _b, _c;
  const title = (_c = (_b = (_a = this.closest("tv-task")) == null ? void 0 : _a.querySelector("tv-task-title")) == null ? void 0 : _b.textContent) == null ? void 0 : _c.trim();
  __privateGet(this, _input).setAttribute("aria-label", title ?? "");
};
__publicField(TaskCheckboxElement, "observedAttributes", ["checked", "disabled"]);
if (!customElements.get("tv-task-checkbox")) {
  customElements.define("tv-task-checkbox", TaskCheckboxElement);
}
const CALENDAR_ICON = `<tv-icon name="calendar" size="sm" aria-hidden="true"></tv-icon>`;
const DUE_STYLES = `
  :host {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: currentColor;
  }
`;
class TaskMetaDueElement extends HTMLElement {
  constructor() {
    super();
    __privateAdd(this, _TaskMetaDueElement_instances);
    __privateAdd(this, _root2);
    __privateAdd(this, _label);
    __privateSet(this, _root2, this.attachShadow({ mode: "open" }));
    __privateGet(this, _root2).innerHTML = `<style>${DUE_STYLES}</style>${CALENDAR_ICON}<span class="label"></span>`;
    __privateSet(this, _label, __privateGet(this, _root2).querySelector(".label"));
  }
  connectedCallback() {
    __privateMethod(this, _TaskMetaDueElement_instances, render_fn).call(this);
  }
  attributeChangedCallback() {
    __privateMethod(this, _TaskMetaDueElement_instances, render_fn).call(this);
  }
}
_root2 = new WeakMap();
_label = new WeakMap();
_TaskMetaDueElement_instances = new WeakSet();
render_fn = function() {
  const date = this.getAttribute("date");
  if (!date || !isValidDueDate(date)) {
    this.removeAttribute("state");
    __privateGet(this, _label).textContent = date ? "Invalid date" : "";
    return;
  }
  const now = /* @__PURE__ */ new Date();
  this.setAttribute("state", dueState(date, now));
  __privateGet(this, _label).textContent = formatDue(date, now);
};
__publicField(TaskMetaDueElement, "observedAttributes", ["date"]);
if (!customElements.get("tv-task-meta-due")) {
  customElements.define("tv-task-meta-due", TaskMetaDueElement);
}
export {
  TaskCheckboxElement,
  TaskMetaDueElement,
  ToggleEvent
};
