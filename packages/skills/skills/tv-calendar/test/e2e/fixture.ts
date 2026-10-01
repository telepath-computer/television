// Side-effect imports register the custom elements globally and adopt the
// canonical artifact stylesheet on the document. Tests then build whatever
// markup they want via document.createElement.
import "../../../../../canonical/styles/canonical/v2/index.css";
import "../../src/calendar-week.ts";
import "../../src/calendar-event.ts";

const DEFAULT_FLUSH_TURNS = 5;

declare global {
  interface Window {
    flushReactiveMicrotasks(turns?: number): Promise<void>;
  }
}

window.flushReactiveMicrotasks = async (turns = DEFAULT_FLUSH_TURNS) => {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
};

export {};
