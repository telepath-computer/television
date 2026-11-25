// Ported from Television tv-calendar calendar-time-axis.ts for an unbundled template.
const HOURS_PER_HALF_DAY = 12;
/** Renders the 24 hour labels inside the calendar grid. */
class CalendarTimeAxisElement extends HTMLElement {
  connectedCallback() {
    this.dispatchEvent(new Event("reactive:connect"));
    this.#render();
  }
  disconnectedCallback() {
    this.dispatchEvent(new Event("reactive:disconnect"));
  }
  #render() {
    const labels = Array.from({ length: 24 }, (_, hour) => {
      const label = document.createElement("div");
      label.classList.add("hour-label");
      label.style.setProperty("--hour-index", String(hour));
      label.setAttribute("data-hour", String(hour));
      label.textContent = formatHour(hour);
      return label;
    });
    this.replaceChildren(...labels);
  }
}
customElements.define("calendar-time-axis", CalendarTimeAxisElement);
function formatHour(hour) {
  const period = hour < HOURS_PER_HALF_DAY ? "AM" : "PM";
  const display = hour % HOURS_PER_HALF_DAY === 0 ? HOURS_PER_HALF_DAY : hour % HOURS_PER_HALF_DAY;
  return `${display} ${period}`;
}
export {
  CalendarTimeAxisElement
};
