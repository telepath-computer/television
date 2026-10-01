import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "../../../../packages/web/src/foundation/index.css";
import "../../../../packages/web/src/global.css";

// Design workshop (not a spec): the skill-selector thumbnails, each a
// thumb-sized square with `overflow: hidden` cropping a detail of the real
// artifact — a corner of a calendar, a record table, a task list, a doc.
// These are designed here, then captured/ported into each skill's spec later.

const STYLE = /*css*/ `
  .stage {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-24);
    padding: var(--space-32);
    background: var(--color-bg);
    font-family: var(--font-sans);
  }
  .item { display: flex; flex-direction: column; align-items: center; gap: var(--space-10); }
  .caption { font-size: 12px; color: var(--color-text-muted); }

  .thumb {
    --t: 144px;
    width: var(--t);
    height: var(--t);
    border-radius: var(--radius-8);
    border: 0.5px solid var(--color-border);
    background: var(--white);
    overflow: hidden;
    position: relative;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
  }

  /* --- Calendar: a week-grid corner with a couple of events --- */
  .cal { height: 100%; display: flex; flex-direction: column; }
  .cal-head {
    display: grid; grid-template-columns: repeat(4, 1fr);
    font-size: 8px; letter-spacing: 0.04em; color: var(--color-text-muted);
    text-align: center; padding: 5px 0; border-bottom: 0.5px solid var(--color-border);
  }
  .cal-body {
    position: relative; flex: 1;
    background-image:
      repeating-linear-gradient(to right, transparent 0 calc(25% - 0.5px), var(--color-border) calc(25% - 0.5px) 25%),
      repeating-linear-gradient(to bottom, transparent 0 17px, rgb(0 0 0 / 0.05) 17px 17.5px);
  }
  .ev { position: absolute; border-radius: 4px; font-size: 8px; font-weight: 600; color: #fff; padding: 2px 4px; overflow: hidden; white-space: nowrap; }
  .ev-a { background: var(--blue-500); left: 2%; top: 6px; width: 44%; height: 24px; }
  .ev-b { background: var(--purple-500); left: 50%; top: 34px; width: 46%; height: 40px; }
  .ev-c { background: var(--green-500); left: 26%; top: 82px; width: 46%; height: 22px; }

  /* --- Table: dense record rows with a status pill --- */
  .tbl { font-size: 10px; color: var(--color-text); }
  .tr {
    display: grid; grid-template-columns: 1fr 44px 24px; height: 23px;
    border-bottom: 0.5px solid var(--color-border);
  }
  .tr > * {
    display: flex; align-items: center; padding: 0 7px;
    border-right: 0.5px solid var(--color-border);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  .tr.th { background: var(--neutral-100); font-weight: 600; color: var(--color-text-muted); font-size: 9px; }
  .pill { font-size: 8px; font-weight: 600; padding: 1px 5px; border-radius: 999px; }
  .pill.win { background: var(--green-100); color: var(--green-700); }
  .pill.new { background: var(--blue-100); color: var(--blue-700); }
  .pill.lost { background: var(--red-100); color: var(--red-700); }

  /* --- Tasks: a checklist, some done --- */
  .tasks { padding: 12px 12px 0; display: flex; flex-direction: column; gap: 10px; }
  .task { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--color-text); white-space: nowrap; }
  /* The tv-task checkbox: a circle with a --color-border ring, filled
     --color-primary when done with a white check. corner-shape: round opts out
     of the global squircle (elements.css) so a full radius renders as a true
     circle — the real component gets this for free inside its shadow DOM. */
  .task .box {
    flex: none; position: relative;
    width: 15px; height: 15px;
    border-radius: 9999px; corner-shape: round;
    border: 1.5px solid var(--color-border);
    display: grid; place-content: center;
  }
  .task.done .box { background: var(--color-primary); border-color: var(--color-primary); }
  .task.done .box::after {
    content: ""; width: 4px; height: 7px;
    border: solid #fff; border-width: 0 1.5px 1.5px 0;
    transform: translateY(-0.5px) rotate(45deg);
  }
  .task.done span { color: var(--color-text-muted); text-decoration: line-through; }

  /* --- Markdown: a document top --- */
  .md { padding: 12px; font-size: 10.5px; line-height: 1.45; color: var(--color-text); }
  .md .h { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
  .md .sh { font-size: 11px; font-weight: 600; margin: 9px 0 3px; }
  .md p { margin: 0; color: var(--color-text); }
  .md ul { margin: 3px 0 0; padding-left: 15px; }
  .md li { margin: 2px 0; }
`;

const CALENDAR = /*html*/ `
  <div class="cal">
    <div class="cal-head"><span>M</span><span>T</span><span>W</span><span>T</span></div>
    <div class="cal-body">
      <div class="ev ev-a">Standup</div>
      <div class="ev ev-b">Design sync</div>
      <div class="ev ev-c">1:1 Sam</div>
    </div>
  </div>
`;

const TABLE = /*html*/ `
  <div class="tbl">
    <div class="tr th"><span>Company</span><span>Stage</span><span>Own</span></div>
    <div class="tr"><span>Acme Co</span><span><i class="pill win">Won</i></span><span>JL</span></div>
    <div class="tr"><span>Globex</span><span><i class="pill new">New</i></span><span>RM</span></div>
    <div class="tr"><span>Initech</span><span><i class="pill lost">Lost</i></span><span>KP</span></div>
    <div class="tr"><span>Umbrella</span><span><i class="pill new">New</i></span><span>JL</span></div>
    <div class="tr"><span>Soylent</span><span><i class="pill win">Won</i></span><span>DV</span></div>
    <div class="tr"><span>Hooli</span><span><i class="pill new">New</i></span><span>RM</span></div>
  </div>
`;

const TASKS = /*html*/ `
  <div class="tasks">
    <div class="task done"><i class="box"></i><span>Draft the proposal</span></div>
    <div class="task done"><i class="box"></i><span>Review the designs</span></div>
    <div class="task"><i class="box"></i><span>Send the invoice</span></div>
    <div class="task"><i class="box"></i><span>Book the flights</span></div>
    <div class="task"><i class="box"></i><span>Reply to Sam</span></div>
    <div class="task"><i class="box"></i><span>Prep the deck</span></div>
  </div>
`;

const MARKDOWN = /*html*/ `
  <div class="md">
    <div class="h">Banana bread</div>
    <p>A quick loaf for using up the ripe ones on the counter.</p>
    <div class="sh">Ingredients</div>
    <ul>
      <li>3 ripe bananas</li>
      <li>2 cups flour</li>
      <li>1 tsp cinnamon</li>
    </ul>
  </div>
`;

const ITEMS: Array<{ name: string; art: string }> = [
  { name: "Calendar", art: CALENDAR },
  { name: "Table", art: TABLE },
  { name: "Tasks", art: TASKS },
  { name: "Markdown", art: MARKDOWN },
];

function thumbnails(): HTMLElement {
  const stage = document.createElement("div");
  stage.className = "stage";
  stage.innerHTML =
    `<style>${STYLE}</style>` +
    ITEMS.map(
      (i) => `<div class="item"><div class="thumb">${i.art}</div><div class="caption">${i.name}</div></div>`,
    ).join("");
  return stage;
}

const meta: Meta = {
  title: "Design/Skill thumbnails",
  parameters: { frame: false, layout: "fullscreen" },
};

export default meta;

export const Thumbnails: StoryObj = {
  render: () => thumbnails(),
};
