import "./calendar-time-axis.css";

const HOURS_PER_HALF_DAY = 12;

export class CalendarTimeAxisElement extends HTMLElement {
  connectedCallback(): void {
    this.dispatchEvent(new Event("reactive:connect"));
    this.#render();
  }

  disconnectedCallback(): void {
    this.dispatchEvent(new Event("reactive:disconnect"));
  }

  #render(): void {
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

// 0 → "12 AM", 12 → "12 PM", 13 → "1 PM", 23 → "11 PM".
function formatHour(hour: number): string {
  const period = hour < HOURS_PER_HALF_DAY ? "AM" : "PM";
  const display = hour % HOURS_PER_HALF_DAY === 0 ? HOURS_PER_HALF_DAY : hour % HOURS_PER_HALF_DAY;
  return `${display} ${period}`;
}
