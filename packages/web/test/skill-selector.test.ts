// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit-html";
import { SkillSelectorView } from "../src/views/skill-selector.ts";
import calendarThumb from "../src/assets/skill-thumbnails/calendar.png";
import tableThumb from "../src/assets/skill-thumbnails/table.png";
import tasksThumb from "../src/assets/skill-thumbnails/tasks.png";
import markdownThumb from "../src/assets/skill-thumbnails/markdown.png";

afterEach(() => document.body.replaceChildren());

const HEADING = "Artifact skills";
const INTRO =
  "Ready-made starting prompts for creating Television artifacts. Copy one, add the details of what you want, and send it to your agent.";

const skills = [
  {
    name: "Calendar",
    description: "Visualize your calendar events across day and week views.",
    prompt:
      "Use the tv-calendar skill to make a calendar artifact for the following request, and put it on TV: ",
    thumbnail: calendarThumb,
  },
  {
    name: "Table",
    description:
      "Beautiful tables with headers, grouping, and chips for displaying data.",
    prompt:
      "Use the tv-table skill to make a table artifact for the following request, and put it on TV: ",
    thumbnail: tableThumb,
  },
  {
    name: "Tasks",
    description:
      "Track tasks and plans in a checklist, with due dates, projects, and labels.",
    prompt:
      "Use the tv-tasks skill to make a task list artifact for the following request, and put it on TV: ",
    thumbnail: tasksThumb,
  },
  {
    name: "Markdown",
    description:
      "An interactive markdown editor for Obsidian notes and other formatted docs.",
    prompt:
      "Make a markdown artifact for the following request, and put it on TV: ",
    thumbnail: markdownThumb,
  },
] as const;

describe("SkillSelectorView (^ss-ac-markup-smoke)", () => {
  it("renders the paired custom popover and exact fixed skill cards", () => {
    const host = document.createElement("main");
    document.body.append(host);
    render(html`${SkillSelectorView()}`, host);

    expect(host.children).toHaveLength(2);

    const trigger = host.children[0];
    expect(trigger.matches("button.skill-trigger[icon]")).toBe(true);
    expect(trigger.getAttribute("variant")).toBe("ghost");
    expect(trigger.getAttribute("aria-label")).toBe("Artifact skills");
    expect(trigger.getAttribute("title")).toBe("Artifact skills");
    expect(trigger.id).toBe("skills-trigger");
    expect(trigger.querySelectorAll('tv-icon[name="skills"][size="sm"]')).toHaveLength(1);

    const panel = host.children[1];
    expect(panel.matches("tv-popover#skills-popover.skill-popover")).toBe(true);
    expect(panel.hasAttribute("placement")).toBe(false);
    expect(panel.getAttribute("trigger")).toBe(trigger.id);
    expect(panel.querySelector(":scope > .skill-heading")?.textContent).toBe(HEADING);
    expect(panel.querySelector(":scope > .skill-intro")?.textContent).toBe(INTRO);

    const cards = panel.querySelectorAll(":scope > .skill-grid > article.skill-card");
    expect(cards).toHaveLength(skills.length);

    for (const [index, expected] of skills.entries()) {
      const card = cards[index]!;
      const thumbnail = card.querySelector<HTMLImageElement>(":scope > .skill-thumb > img");
      expect(thumbnail?.getAttribute("src"), expected.name).toBe(expected.thumbnail);
      expect(thumbnail?.getAttribute("alt"), expected.name).toBe("");
      expect(card.querySelector(":scope > .skill-name")?.textContent, expected.name).toBe(
        expected.name,
      );
      expect(card.querySelector(":scope > .skill-desc")?.textContent, expected.name).toBe(
        expected.description,
      );

      const copyButtons = card.querySelectorAll<HTMLButtonElement>(
        ":scope > button.copy-button[size='sm']",
      );
      expect(copyButtons, expected.name).toHaveLength(1);
      expect(copyButtons[0]?.getAttribute("aria-label"), expected.name).toBe("Copy prompt");
      expect(copyButtons[0]?.getAttribute("prompt"), expected.name).toBe(expected.prompt);
      expect(copyButtons[0]?.querySelector(".copy-button-idle")?.textContent, expected.name).toBe(
        "Copy prompt",
      );
    }
  });
});
