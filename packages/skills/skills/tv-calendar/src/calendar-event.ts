import "./calendar-event.css";

// Data carrier for authored event attributes. <calendar-week> validates,
// routes, and positions events into its generated allday or timed sections.
export class CalendarEventElement extends HTMLElement {
  connectedCallback(): void {
    this.dispatchEvent(new Event("reactive:connect"));
  }

  disconnectedCallback(): void {
    this.dispatchEvent(new Event("reactive:disconnect"));
  }
}

customElements.define("calendar-event", CalendarEventElement);
