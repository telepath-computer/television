// The Preview-leaf convention (specs/arch/making-skills.md): a skill's
// story file embeds skillbench pointed at the skill's eval config.
export function skillbenchFrame(configPath: string, label: string): HTMLElement {
  const iframe = document.createElement("iframe");
  iframe.title = `Skillbench — ${label}`;
  iframe.src = `/skillbench/?eval=${configPath}`;
  iframe.style.cssText = "display: block; width: 100vw; height: 100vh; border: 0;";
  return iframe;
}
