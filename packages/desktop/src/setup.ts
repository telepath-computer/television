import { html, nothing } from "lit-html";
import { copyButtonTemplate } from "../../web/src/views/copy-button.ts";
import "./setup.css";
import "../../web/src/views/artifact-view.css";

export const SETUP_PROMPT = "Read the Television admin guide at https://television.run/install.md and help me get Television installed. I'm on the desktop app connect screen.";
export type SetupState = "ready" | "connecting" | "connected" | "error";

export function setupTemplate(state: SetupState, link: string, error: string, submit: (event: Event) => void) {
  const busy = state === "connecting" || state === "connected";
  return html`<div class="setup-screen" data-state=${state}>
    <div class="setup-wallpaper" aria-hidden="true"></div>
    <div class="setup-window"><div class="artifact-frame"><div class="artifact-frame-clip">
    <div class="artifact-frame-content">
<div class="setup-body">
  <div class="setup-document" text-display="prose" ?inert=${state === "connected"}>
    <div class="setup-header">
      <h1>Let’s connect your <svg class="setup-logo" viewBox="0 0 55 55" aria-hidden="true"><defs><linearGradient id="tv-logo-shell" x1="27.5" y1="1.45" x2="27.5" y2="53.55" gradientUnits="userSpaceOnUse"><stop offset="0"/><stop offset="1" stop-color="#262626"/></linearGradient><clipPath id="tv-logo-screen"><path d="M14.2 7.7h26.6c3.15 0 5.7 2.66 5.7 5.94v27.72c0 3.28-2.55 5.94-5.7 5.94H14.2c-3.15 0-5.7-2.66-5.7-5.94V13.64c0-3.28 2.55-5.94 5.7-5.94Z"/></clipPath></defs><path fill="url(#tv-logo-shell)" d="M12.5 1.45h30c5.47 0 10.48 4.46 10.89 9.98.73 10.7.73 21.44 0 32.13-.41 5.52-5.42 9.98-10.89 9.98h-30c-5.47 0-10.48-4.46-10.89-9.98-.73-10.7-.73-21.44 0-32.13C2.02 5.91 7.03 1.45 12.5 1.45Z"/><g clip-path="url(#tv-logo-screen)"><rect fill="#fff" x="8.5" y="7.7" width="38" height="39.6" rx="5.7"/><path fill="#38c428" d="M27.5 48.78V6.71h-9.98v42.07h9.98Z"/><path fill="#ff01d0" d="M27.5 6.71v42.07h9.97V6.71H27.5Z"/><path fill="#40d2b3" d="M22.75 48.29c-3.8-18.22-1.58-34.98 0-41.08H10.87v41.08c3.96.33 11.88.79 11.88 0Z"/><path fill="#d24043" d="M32.25 7.21c3.8 18.22 1.58 34.98 0 41.08h11.88V7.21c-3.96-.33-11.88-.79-11.88 0Z"/><path fill="#ffcd27" d="M15.62 47.3c-5.7-17.42-2.38-33.66 0-39.6H7.07v39.6s9.03.49 8.55 0Z"/><path fill="#0015ff" d="M38.92 6.93c5.69 17.76 2.37 34.31 0 40.36h8.53V6.93s-9.01-.5-8.53 0Z"/></g><path fill="none" stroke="#fff" stroke-width="3" d="M14.2 8.74h26.6c2.56 0 5.25 2.06 5.8 4.64 1.89 9.31 1.89 18.91 0 28.23-.55 2.58-3.25 4.64-5.8 4.64H14.2c-2.56 0-5.25-2.06-5.8-4.64-1.89-9.31-1.89-18.91 0-28.23.55-2.58 3.25-4.64 5.8-4.64Z"/></svg> Television</h1>
      <p>Television runs alongside your agent, which needs to be running on macOS or Linux. Ask your agent to help you get connected, then paste the link it gives you.</p>
      <p class="setup-note">Don’t have an agent yet? Try
        <a href="https://hermes-agent.nousresearch.com/" target="_blank" rel="noopener noreferrer">Hermes</a>,
        <a href="https://openclaw.ai/" target="_blank" rel="noopener noreferrer">OpenClaw</a>,
        <a href="https://pi.dev/" target="_blank" rel="noopener noreferrer">Pi</a>,
        <a href="https://claude.com/product/claude-code" target="_blank" rel="noopener noreferrer">Claude Code</a>, or
        <a href="https://chatgpt.com/codex/" target="_blank" rel="noopener noreferrer">Codex</a>.</p>
    </div>
    <ol class="setup-steps">
      <li class="setup-step">
        <span class="setup-marker">1</span>
        <div class="setup-step-body">
          <h2>Give your agent this prompt</h2>
          <div class="setup-prompt">
            <p>${SETUP_PROMPT}</p>
            <div class="setup-prompt-actions">
              ${copyButtonTemplate({ label: "Copy", prompt: SETUP_PROMPT, size: "default" })}
            </div>
          </div>
        </div>
      </li>
      <li class="setup-step">
        <span class="setup-marker">2</span>
        <div class="setup-step-body">
          <h2>Paste the link from your agent</h2>
          <form class="setup-link" @submit=${submit}>
            <input type="text" data-size="lg" placeholder="Paste link here" aria-label="Link from your agent" required
              .value=${link} ?disabled=${busy} aria-invalid=${state === "error" ? "true" : nothing}
              aria-describedby=${state === "error" ? "setup-link-error" : nothing}>
            <button intent="primary" size="lg" class="setup-submit" ?disabled=${busy}>
              <span class="setup-submit-idle">Connect</span>
              <span class="setup-submit-busy"><tv-icon name="spinner" spinning></tv-icon>Connecting…</span>
            </button>
          </form>
          ${state === "error"
            ? html`<p class="tv-error" id="setup-link-error">${error}</p>`
            : html`<p class="setup-hint">The link looks like <code>http://…:32848/?token=…</code></p>`}
        </div>
      </li>
    </ol>
  </div>
  <div class="setup-done" aria-hidden=${state === "connected" ? nothing : "true"}>
    <span class="setup-done-mark"><tv-icon name="check" size="lg"></tv-icon></span>
    <p>Connected</p>
  </div>
</div>
    </div>
    <footer class="artifact-title-bar"><tv-icon name="artifact"></tv-icon><span class="artifact-title">Connect to Television</span></footer>
    </div></div></div>
  </div>`;
}
