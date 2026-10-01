import { copyButtonTemplate } from "./copy-button.ts";
import type { ClientSignalEventName } from "@telepath-computer/television-shared";
import { View, view } from "@telepath-computer/utils/lit-view";
import { html, type TemplateResult } from "lit-html";
import calendarThumb from "../assets/skill-thumbnails/calendar.png";
import tableThumb from "../assets/skill-thumbnails/table.png";
import tasksThumb from "../assets/skill-thumbnails/tasks.png";
import markdownThumb from "../assets/skill-thumbnails/markdown.png";
import "../elements/icon.ts";
import "../elements/popover.ts";
import "./skill-selector.css";

type ArtifactSkill = "calendar" | "table" | "tasks" | "markdown";

interface SkillCard {
  artifactSkill: ArtifactSkill;
  name: string;
  description: string;
  prompt: string;
  thumbnail: string;
}

export interface SkillSelectorTelemetrySignalSender {
  sendTelemetrySignal(
    event: ClientSignalEventName,
    properties: Record<string, string>,
  ): void;
}

const TRIGGER_LABEL = "Artifact skills";
const HEADING = "Artifact skills";
const INTRO =
  "Ready-made starting prompts for creating Television artifacts. Copy one, add the details of what you want, and send it to your agent.";
const COPY_PROMPT = "Copy prompt";

function skillCardTemplate(
  {
    artifactSkill,
    name,
    description,
    prompt,
    thumbnail,
  }: SkillCard,
  telemetrySender: SkillSelectorTelemetrySignalSender | null,
): TemplateResult {
  return html`
    <article class="skill-card">
      <div class="skill-thumb"><img src=${thumbnail} alt="" /></div>
      <div class="skill-name">${name}</div>
      <p class="skill-desc">${description}</p>
      ${copyButtonTemplate({
        label: COPY_PROMPT,
        prompt,
        onActivate: () => telemetrySender?.sendTelemetrySignal(
          "artifact_skill_prompt_copy_clicked",
          { artifact_skill: artifactSkill },
        ),
      })}
    </article>
  `;
}

/** Render the fixed artifact-skill trigger and its adjacent popover. */
export class SkillSelector extends View<[SkillSelectorTelemetrySignalSender?]> {
  template(telemetrySender: SkillSelectorTelemetrySignalSender | null = null): TemplateResult {
    return html`
    <button
      class="skill-trigger"
      variant="ghost"
      icon
      id="skills-trigger"
      aria-label=${TRIGGER_LABEL}
      title=${TRIGGER_LABEL}
    >
      <tv-icon name="skills" size="sm"></tv-icon>
    </button>

    <tv-popover
      id="skills-popover"
      trigger="skills-trigger"
      class="skill-popover"
    >
      <div class="skill-heading">${HEADING}</div>
      <p class="skill-intro">${INTRO}</p>
      <div class="skill-grid">
        ${skillCardTemplate({
          artifactSkill: "calendar",
          name: "Calendar",
          description: "Visualize your calendar events across day and week views.",
          prompt:
            "Use the tv-calendar skill to make a calendar artifact for the following request, and put it on TV: ",
          thumbnail: calendarThumb,
        }, telemetrySender)}
        ${skillCardTemplate({
          artifactSkill: "table",
          name: "Table",
          description:
            "Beautiful tables with headers, grouping, and chips for displaying data.",
          prompt:
            "Use the tv-table skill to make a table artifact for the following request, and put it on TV: ",
          thumbnail: tableThumb,
        }, telemetrySender)}
        ${skillCardTemplate({
          artifactSkill: "tasks",
          name: "Tasks",
          description:
            "Track tasks and plans in a checklist, with due dates, projects, and labels.",
          prompt:
            "Use the tv-tasks skill to make a task list artifact for the following request, and put it on TV: ",
          thumbnail: tasksThumb,
        }, telemetrySender)}
        ${skillCardTemplate({
          artifactSkill: "markdown",
          name: "Markdown",
          description:
            "An interactive markdown editor for Obsidian notes and other formatted docs.",
          prompt:
            "Make a markdown artifact for the following request, and put it on TV: ",
          thumbnail: markdownThumb,
        }, telemetrySender)}
      </div>
    </tv-popover>
    `;
  }
}

export const SkillSelectorView = view(SkillSelector);
