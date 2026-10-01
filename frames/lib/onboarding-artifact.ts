// Artifact documents have the canonical foundation and real source components,
// not the app workshop's decoration or element stand-ins. The manifest chooses
// the same dependencies that the bake puts in the production document shell.
import { documentEnvironment } from "./environment";
import { channels } from "./onboarding";

const artifact = Object.values(channels).flatMap((channel) => channel.pages)
  .find((page) => page.src === location.pathname);
if (!artifact) throw new Error(`Unknown onboarding artifact: ${location.pathname}`);

documentEnvironment("artifact");

if (!artifact.markdown && artifact.components !== false) {
  await import("../../packages/canonical/canonical-components.ts");
}

switch (artifact.skill) {
  case undefined:
    break;
  case "tv-tasks":
    await Promise.all([
      import("../../packages/skills/skills/tv-tasks/src/task.css"),
      import("../../packages/skills/skills/tv-tasks/src/task.ts"),
    ]);
    break;
  case "tv-calendar":
    // The source entry imports each element's stylesheet, just as the skill
    // build collects them into the shipped calendar.css.
    await import("../../packages/skills/skills/tv-calendar/src/calendar-elements.ts");
    break;
  default:
    throw new Error(`No workshop source entry for onboarding skill: ${artifact.skill}`);
}
