var St = Object.defineProperty;
var F = (e) => {
  throw TypeError(e);
};
var bt = (e, r, t) => r in e ? St(e, r, { enumerable: !0, configurable: !0, writable: !0, value: t }) : e[r] = t;
var z = (e, r, t) => bt(e, typeof r != "symbol" ? r + "" : r, t), O = (e, r, t) => r.has(e) || F("Cannot " + t);
var s = (e, r, t) => (O(e, r, "read from private field"), t ? t.call(e) : r.get(e)), h = (e, r, t) => r.has(e) ? F("Cannot add the same private member more than once") : r instanceof WeakSet ? r.add(e) : r.set(e, t), u = (e, r, t, n) => (O(e, r, "write to private field"), n ? n.call(e, t) : r.set(e, t), t), d = (e, r, t) => (O(e, r, "access private method"), t);
class vt extends HTMLElement {
  connectedCallback() {
    this.dispatchEvent(new Event("reactive:connect"));
  }
  disconnectedCallback() {
    this.dispatchEvent(new Event("reactive:disconnect"));
  }
}
customElements.define("calendar-event", vt);
const N = 12;
var K, Q;
class Pt extends HTMLElement {
  constructor() {
    super(...arguments);
    h(this, K);
  }
  connectedCallback() {
    this.dispatchEvent(new Event("reactive:connect")), d(this, K, Q).call(this);
  }
  disconnectedCallback() {
    this.dispatchEvent(new Event("reactive:disconnect"));
  }
}
K = new WeakSet(), Q = function() {
  const t = Array.from({ length: 24 }, (n, a) => {
    const i = document.createElement("div");
    return i.classList.add("hour-label"), i.style.setProperty("--hour-index", String(a)), i.setAttribute("data-hour", String(a)), i.textContent = Dt(a), i;
  });
  this.replaceChildren(...t);
};
customElements.define("calendar-time-axis", Pt);
function Dt(e) {
  const r = e < N ? "AM" : "PM";
  return `${e % N === 0 ? N : e % N} ${r}`;
}
const q = 24, Ct = 8, Mt = 6e4, Z = 23, xt = 59, Tt = 1e3, L = 60, $ = q * L, tt = $ * L * Tt, At = /^(\d{4})-(\d{2})-(\d{2})$/, kt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/, Ht = ["days", "startDate", "startHour"];
var g, v, y, k, m, b, x, T, M, H, A, P, D, C, w, o, nt, R, I, rt, st, at, it, ot, lt, ct, dt, B, ut, ht, yt, Y, pt, U;
class et extends HTMLElement {
  constructor() {
    super();
    h(this, o);
    h(this, g, null);
    h(this, v, 0);
    h(this, y, null);
    h(this, k, !1);
    h(this, m, null);
    h(this, b, null);
    h(this, x, !1);
    h(this, T, null);
    h(this, M, /* @__PURE__ */ new Set());
    h(this, H, /* @__PURE__ */ new Map());
    h(this, A, null);
    h(this, P, "");
    h(this, D);
    h(this, C, !1);
    h(this, w, !1);
    const t = this;
    for (const n of Ht)
      Object.hasOwn(this, n) && (s(this, H).set(n, t[n]), delete t[n]);
  }
  get days() {
    return s(this, v);
  }
  set days(t) {
    Object.is(s(this, v), t) || (u(this, v, t), d(this, o, R).call(this, "days"));
  }
  get startDate() {
    return s(this, P);
  }
  set startDate(t) {
    s(this, P) !== t && (u(this, P, t), d(this, o, R).call(this, "start-date"));
  }
  get startHour() {
    return s(this, D);
  }
  set startHour(t) {
    Object.is(s(this, D), t) || (u(this, D, t), d(this, o, R).call(this, "start-hour"));
  }
  connectedCallback() {
    this.dispatchEvent(new Event("reactive:connect")), u(this, T, setInterval(() => d(this, o, Y).call(this), Mt)), s(this, k) ? (s(this, x) || s(this, C)) && d(this, o, I).call(this) : (u(this, k, !0), s(this, M).add("days"), s(this, M).add("start-date"), d(this, o, nt).call(this), u(this, C, !0), d(this, o, I).call(this));
  }
  disconnectedCallback() {
    var t;
    this.dispatchEvent(new Event("reactive:disconnect")), s(this, T) !== null && (clearInterval(s(this, T)), u(this, T, null)), (t = s(this, b)) == null || t.disconnect();
  }
  attributeChangedCallback(t, n, a) {
    n !== a && d(this, o, at).call(this, t, a) && (u(this, C, !0), d(this, o, I).call(this));
  }
  changed() {
    const t = d(this, o, lt).call(this), n = Lt(this.startDate, this.days), a = t.map((c) => ({
      event: c,
      placement: n ? _t(c, n) : null
    })), i = qt(a), l = Kt(this.startHour, a.map(({ placement: c }) => c));
    if (u(this, A, n), this.style.setProperty("--day-count", String((n == null ? void 0 : n.dayCount) ?? 0)), this.style.setProperty("--hour-count", String(q)), this.style.setProperty("--start-hour", String(l)), !n) {
      d(this, o, ut).call(this);
      for (const { event: c } of a)
        W(c), this.append(c);
      return;
    }
    d(this, o, ht).call(this, n), d(this, o, yt).call(this, a, n, i), d(this, o, Y).call(this), d(this, o, ot).call(this);
  }
}
g = new WeakMap(), v = new WeakMap(), y = new WeakMap(), k = new WeakMap(), m = new WeakMap(), b = new WeakMap(), x = new WeakMap(), T = new WeakMap(), M = new WeakMap(), H = new WeakMap(), A = new WeakMap(), P = new WeakMap(), D = new WeakMap(), C = new WeakMap(), w = new WeakMap(), o = new WeakSet(), nt = function() {
  for (const [t, n] of s(this, H))
    switch (t) {
      case "days":
        this.days = n;
        break;
      case "startDate":
        this.startDate = n;
        break;
      case "startHour":
        this.startHour = n;
        break;
    }
  s(this, H).clear();
}, R = function(t) {
  s(this, M).add(t), u(this, C, !0), d(this, o, I).call(this);
}, I = function() {
  s(this, w) || (u(this, w, !0), queueMicrotask(() => d(this, o, rt).call(this)));
}, rt = function() {
  if (u(this, w, !1), !s(this, k)) return;
  const t = s(this, C) || s(this, x);
  if (u(this, C, !1), u(this, x, !1), d(this, o, st).call(this), !this.isConnected) {
    u(this, x, t);
    return;
  }
  t && d(this, o, it).call(this);
}, st = function() {
  const t = [...s(this, M)];
  s(this, M).clear();
  for (const n of t) {
    const a = n === "days" ? s(this, v) : n === "start-date" ? s(this, P) : s(this, D), i = a === void 0 ? null : String(a);
    i === null ? this.removeAttribute(n) : this.getAttribute(n) !== i && this.setAttribute(n, i);
  }
}, at = function(t, n) {
  switch (t) {
    case "days": {
      const a = X(n);
      return Object.is(s(this, v), a) ? !1 : (u(this, v, a), !0);
    }
    case "start-date": {
      const a = n ?? void 0;
      return s(this, P) === a ? !1 : (u(this, P, a), !0);
    }
    case "start-hour": {
      const a = X(n);
      return Object.is(s(this, D), a) ? !1 : (u(this, D, a), !0);
    }
    default:
      return !1;
  }
}, it = function() {
  try {
    this.changed();
  } catch (t) {
    console.error(t);
  }
}, ot = function() {
  requestAnimationFrame(() => {
    var l, c, p;
    d(this, o, U).call(this);
    const t = (l = s(this, y)) == null ? void 0 : l.querySelector(":scope > .start-hour-marker");
    if (!t) return;
    const n = (((c = s(this, m)) == null ? void 0 : c.offsetHeight) ?? 0) + (((p = s(this, g)) == null ? void 0 : p.offsetHeight) ?? 0), a = Math.max(this.scrollHeight - this.clientHeight, 0);
    if (a <= 0) return;
    const i = this.scrollTop + (t.getBoundingClientRect().top - this.getBoundingClientRect().top) - n;
    this.scrollTop = Math.max(0, Math.min(i, a));
  });
}, lt = function() {
  return Array.from(this.querySelectorAll("calendar-event"));
}, ct = function() {
  s(this, m) || (u(this, m, document.createElement("calendar-headers")), this.append(s(this, m))), s(this, y) || (u(this, y, document.createElement("calendar-grid")), this.append(s(this, y)));
}, dt = function(t) {
  s(this, g) || (u(this, g, document.createElement("calendar-allday")), this.insertBefore(s(this, g), s(this, y)));
  const n = t.days.map((a, i) => wt(a, i + 1));
  s(this, g).replaceChildren(...n);
}, B = function() {
  var t;
  (t = s(this, g)) == null || t.remove(), u(this, g, null), this.style.removeProperty("--allday-lane-count");
}, ut = function() {
  var t, n, a;
  (t = s(this, b)) == null || t.disconnect(), (n = s(this, m)) == null || n.remove(), d(this, o, B).call(this), (a = s(this, y)) == null || a.remove(), u(this, m, null), u(this, y, null), this.style.removeProperty("--headers-height"), this.style.removeProperty("--allday-lane-count");
}, ht = function(t) {
  d(this, o, ct).call(this);
  const n = t.days.map((i, l) => It(i, l + 1)), a = [
    document.createElement("calendar-time-axis"),
    ...t.days.map((i, l) => Nt(i, l + 1)),
    Rt()
  ];
  s(this, m).replaceChildren(...n), s(this, y).replaceChildren(...a), d(this, o, pt).call(this);
}, yt = function(t, n, a) {
  const i = t.filter(Et);
  if (i.length > 0) {
    d(this, o, dt).call(this, n), this.style.setProperty("--allday-lane-count", String(a));
    for (const { event: l, placement: c } of i)
      V(l, c), s(this, g).append(l);
  } else
    d(this, o, B).call(this);
  for (const { event: l, placement: c } of t.filter(gt).sort(ft))
    V(l, c), s(this, y).append(l);
  for (const { event: l } of t.filter(({ placement: c }) => c === null))
    W(l), this.append(l);
}, Y = function() {
  var f, S;
  const t = (f = s(this, y)) == null ? void 0 : f.querySelector(":scope > .now-line"), n = (S = s(this, y)) == null ? void 0 : S.querySelector(":scope > .now-line-faint");
  if (!s(this, y) || !s(this, A)) {
    n == null || n.remove(), t == null || t.remove();
    return;
  }
  const a = /* @__PURE__ */ new Date(), l = j(a.getFullYear(), a.getMonth() + 1, a.getDate()) - s(this, A).startDayKey + 1;
  if (l < 1 || l > s(this, A).dayCount) {
    n == null || n.remove(), t == null || t.remove();
    return;
  }
  const c = (a.getHours() + a.getMinutes() / L) / q, p = n ?? document.createElement("div");
  n || (p.classList.add("now-line-faint"), s(this, y).append(p));
  const E = t ?? document.createElement("div");
  t || (E.classList.add("now-line"), s(this, y).append(E)), p.style.setProperty("--y-fraction", String(c)), E.style.setProperty("--day-index", String(l)), E.style.setProperty("--y-fraction", String(c));
}, pt = function() {
  var t;
  if (!s(this, m)) {
    (t = s(this, b)) == null || t.disconnect(), this.style.removeProperty("--headers-height");
    return;
  }
  if (typeof ResizeObserver != "function") {
    d(this, o, U).call(this);
    return;
  }
  s(this, b) || u(this, b, new ResizeObserver(() => d(this, o, U).call(this))), s(this, b).disconnect(), s(this, b).observe(s(this, m));
}, U = function() {
  var t;
  this.style.setProperty("--headers-height", `${((t = s(this, m)) == null ? void 0 : t.offsetHeight) ?? 0}px`);
}, z(et, "observedAttributes", ["days", "start-date", "start-hour"]);
customElements.define("calendar-week", et);
function wt(e, r) {
  const t = document.createElement("calendar-cell");
  return t.setAttribute("date", e.iso), t.style.setProperty("--day-index", String(r)), t;
}
function It(e, r) {
  const t = document.createElement("calendar-day");
  t.setAttribute("date", e.iso), t.style.setProperty("--day-index", String(r));
  const n = document.createElement("span");
  n.classList.add("weekday"), n.textContent = e.labelWeekday;
  const a = document.createElement("span");
  return a.classList.add("date-num"), a.textContent = e.labelDay, t.append(n, a), t;
}
function Nt(e, r) {
  const t = document.createElement("calendar-column");
  return t.setAttribute("date", e.iso), t.style.setProperty("--day-index", String(r)), t;
}
function Rt() {
  const e = document.createElement("div");
  return e.classList.add("start-hour-marker"), e;
}
function V(e, r) {
  const t = Ut(e), n = e.getAttribute("title") ?? "";
  if (t.querySelector("h3").textContent = n, r.kind === "all-day") {
    e.style.setProperty("--day-start", String(r.dayStart)), e.style.setProperty("--day-span", String(r.daySpan)), e.style.setProperty("--lane-index", String(r.laneIndex)), e.style.removeProperty("--day-index"), e.style.removeProperty("--y-start"), e.style.removeProperty("--y-end"), e.style.removeProperty("--cascade-depth");
    return;
  }
  e.style.setProperty("--day-index", String(r.dayIndex)), e.style.setProperty("--y-start", String(r.yStart)), e.style.setProperty("--y-end", String(r.yEnd)), e.style.setProperty("--cascade-depth", String(r.cascadeDepth)), e.style.removeProperty("--day-start"), e.style.removeProperty("--day-span"), e.style.removeProperty("--lane-index");
}
function W(e) {
  var r;
  (r = e.querySelector(":scope > .event-block")) == null || r.remove(), e.style.removeProperty("--day-index"), e.style.removeProperty("--y-start"), e.style.removeProperty("--y-end"), e.style.removeProperty("--day-start"), e.style.removeProperty("--day-span"), e.style.removeProperty("--lane-index"), e.style.removeProperty("--cascade-depth");
}
function Ut(e) {
  let r = e.querySelector(":scope > .event-block");
  if (r) return r;
  r = document.createElement("div"), r.classList.add("event-block");
  const t = document.createElement("div");
  t.classList.add("event-block-inner");
  const n = document.createElement("h3");
  return t.append(n), r.append(t), e.append(r), r;
}
function _t(e, r) {
  const t = e.getAttribute("title"), n = e.getAttribute("start"), a = e.getAttribute("end");
  if (t === null || n === null || a === null) return null;
  if (e.hasAttribute("all-day")) {
    const p = _(n), E = _(a);
    if (!p || !E || E.dayKey <= p.dayKey) return null;
    const f = Math.max(p.dayKey, r.startDayKey), S = Math.min(E.dayKey, r.endDayKey);
    return S <= f ? null : {
      kind: "all-day",
      daySpan: S - f,
      dayStart: f - r.startDayKey + 1,
      laneIndex: 1
    };
  }
  const i = G(n), l = G(a);
  if (!i || !l || i.dayKey !== l.dayKey || l.totalMinutes <= i.totalMinutes) return null;
  const c = i.dayKey - r.startDayKey + 1;
  return c < 1 || c > r.dayCount ? null : {
    cascadeDepth: 0,
    kind: "timed",
    dayIndex: c,
    endMinutes: l.totalMinutes,
    startHour: i.hour,
    startMinutes: i.totalMinutes,
    yEnd: l.totalMinutes / $,
    yStart: i.totalMinutes / $
  };
}
function Kt(e, r) {
  if (Number.isInteger(e) && e >= 0 && e <= Z)
    return e;
  const t = r.filter((n) => (n == null ? void 0 : n.kind) === "timed").map((n) => n.startHour);
  return t.length > 0 ? Math.max(Math.min(...t) - 1, 0) : Ct;
}
function Lt(e, r) {
  if (typeof r != "number" || !Number.isInteger(r) || r < 1 || e === void 0) return null;
  const t = _(e);
  if (!t) return null;
  const n = Array.from({ length: r }, (a, i) => Ot(t, i));
  return {
    dayCount: r,
    days: n,
    endDayKey: t.dayKey + r,
    startDayKey: t.dayKey
  };
}
function X(e) {
  return e === null ? void 0 : Number(e);
}
function _(e) {
  const r = At.exec(e);
  if (!r) return null;
  const [, t, n, a] = r, i = Number(t), l = Number(n), c = Number(a);
  if (!mt(i, l, c)) return null;
  const p = new Date(i, l - 1, c);
  return {
    dayKey: j(i, l, c),
    iso: e,
    labelDay: String(c),
    labelWeekday: p.toLocaleDateString(void 0, { weekday: "short" })
  };
}
function G(e) {
  const r = kt.exec(e);
  if (!r) return null;
  const [, t, n, a, i, l] = r, c = Number(t), p = Number(n), E = Number(a), f = Number(i), S = Number(l);
  return !mt(c, p, E) || !Number.isInteger(f) || f < 0 || f > Z || !Number.isInteger(S) || S < 0 || S > xt ? null : {
    dayKey: j(c, p, E),
    hour: f,
    totalMinutes: f * L + S
  };
}
function Ot(e, r) {
  const t = new Date((e.dayKey + r) * tt), n = t.getUTCFullYear(), a = t.getUTCMonth() + 1, i = t.getUTCDate();
  return _(
    `${n}-${String(a).padStart(2, "0")}-${String(i).padStart(2, "0")}`
  );
}
function mt(e, r, t) {
  const n = new Date(Date.UTC(e, r - 1, t));
  return n.getUTCFullYear() === e && n.getUTCMonth() === r - 1 && n.getUTCDate() === t;
}
function j(e, r, t) {
  return Date.UTC(e, r - 1, t) / tt;
}
function qt(e) {
  const r = [];
  for (const { placement: n } of e.filter(Et)) {
    const a = n.dayStart + n.daySpan;
    let i = r.findIndex(
      (l) => l.every((c) => !J(c.dayStart, c.dayStart + c.daySpan, n.dayStart, a))
    );
    i === -1 && (r.push([]), i = r.length - 1), n.laneIndex = i + 1, r[i].push(n);
  }
  const t = /* @__PURE__ */ new Map();
  for (const { placement: n } of e.filter(gt).sort(ft)) {
    const a = t.get(n.dayIndex) ?? [];
    n.cascadeDepth = a.filter(
      (i) => i.startMinutes < n.startMinutes && J(i.startMinutes, i.endMinutes, n.startMinutes, n.endMinutes)
    ).length, a.push(n), t.set(n.dayIndex, a);
  }
  return r.length;
}
function ft(e, r) {
  return e.placement.dayIndex - r.placement.dayIndex || e.placement.startMinutes - r.placement.startMinutes || e.placement.endMinutes - r.placement.endMinutes;
}
function Et(e) {
  var r;
  return ((r = e.placement) == null ? void 0 : r.kind) === "all-day";
}
function gt(e) {
  var r;
  return ((r = e.placement) == null ? void 0 : r.kind) === "timed";
}
function J(e, r, t, n) {
  return e < n && t < r;
}
