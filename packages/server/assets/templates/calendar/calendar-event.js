// Ported from Television tv-calendar calendar-event.ts for an unbundled template.
/**
 * Carries one authored event; calendar-week validates and places it. The
 * event's fields are attributes, except `attendees`, an array of names kept
 * as a property so a name may contain any character.
 */
class CalendarEventElement extends HTMLElement {
  /** @type {string[] | null} */
  attendees = null;

  connectedCallback() {
    this.dispatchEvent(new Event("reactive:connect"));
  }

  disconnectedCallback() {
    this.dispatchEvent(new Event("reactive:disconnect"));
  }
}
customElements.define("calendar-event", CalendarEventElement);
export {
  CalendarEventElement
};
