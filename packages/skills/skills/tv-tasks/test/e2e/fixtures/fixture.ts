// Side-effect imports register the custom elements globally:
//   - <tv-icon> (canonical), which the components ship via
//     /canonical/v2/components.js — <tv-task-meta-due> renders one in its shadow.
//   - the skill-local elements (<tv-task-checkbox>, <tv-task-meta-due>).
// Tests then build whatever markup they want via document.createElement /
// innerHTML. fixture.html omits canonical CSS for interaction tests;
// appearance.html separately composes canonical, theme, and task styles.
import "../../../../../../web/src/elements/icon.ts";
import "../../../src/task.ts";

export {};
