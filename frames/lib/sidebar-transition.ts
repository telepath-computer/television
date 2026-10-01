import {
  sidebarPose,
  sidebarProgressAt,
  type SidebarGeometry,
} from "../../specs/ui/app/sidebar-transition";
import appMeasures from "../../specs/ui/app/measures.yml";

const INSPECTION_SLOWDOWN_FACTOR = 30;

/** Workshop adapter: measure the resting frames, then apply the specified pose. */
export function sidebarTransition(
  host: HTMLElement,
  options: { collapsed: boolean; onChange: (collapsed: boolean) => void },
): () => void {
  const app = host.querySelector<HTMLElement>("#app")!;
  const sidebar = app.querySelector<HTMLElement>(".app-sidebar")!;
  const main = app.querySelector<HTMLElement>(".app-main")!;
  const bar = app.querySelector<HTMLElement>(".top-bar")!;
  const lead = bar.querySelector<HTMLElement>(".top-bar-lead")!;
  const expandedToggle = sidebar.querySelector<HTMLElement>(".sidebar-collapse")!;
  const collapsedToggle = lead.querySelector<HTMLElement>(".sidebar-expand")!;
  const toggle = app.querySelector<HTMLButtonElement>(".sidebar-motion-toggle")!;
  const switcher = lead.querySelector<HTMLElement>(".channel-switcher");
  const controls = host.closest<HTMLElement>("[data-sidebar-animation]");
  const inspect = controls?.dataset.inspect === "true";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let progress = inspect ? Math.max(0, Math.min(1, Number(controls?.dataset.progress))) : Number(options.collapsed);
  let target = Number(options.collapsed);
  let animation = 0;
  let restoreToggleFocus = false;
  let geometry: SidebarGeometry;
  let barInset = 0;

  const pixels = (name: string, value: number) => app.style.setProperty(`--motion-${name}`, `${value}px`);
  const attach = () => {
    if (!sidebar.isConnected) app.insertBefore(sidebar, main);
    if (!lead.isConnected) bar.prepend(lead);
    if (!toggle.isConnected) app.append(toggle);
  };

  // Measure the two authored resting layouts synchronously, before painting.
  // No stage page or artifact document is removed or replaced.
  const measure = () => {
    restoreToggleFocus ||= [toggle, expandedToggle, collapsedToggle].includes(document.activeElement as HTMLElement);
    app.removeAttribute("data-sidebar-motion");
    attach();
    lead.remove();
    const origin = app.getBoundingClientRect();
    const expanded = expandedToggle.getBoundingClientRect();
    const width = sidebar.getBoundingClientRect().width;
    app.style.setProperty("--sidebar-width", `${width}px`);
    const previousMargin = sidebar.style.marginLeft;
    sidebar.style.marginLeft = `${-width}px`;
    bar.prepend(lead);
    const collapsed = collapsedToggle.getBoundingClientRect();
    const leadBox = lead.getBoundingClientRect();
    const switcherBox = switcher?.getBoundingClientRect();
    barInset = bar.getBoundingClientRect().left - origin.left;
    geometry = {
      expandedSidebarWidth: width,
      expandedToggleLeft: expanded.left - origin.left,
      collapsedToggleLeft: collapsed.left - origin.left,
      toggleWidth: collapsed.width,
      toggleSwitcherGap: switcherBox ? switcherBox.left - collapsed.right : 0,
      collapsedLeadReservation: leadBox.width,
      hasSwitcher: Boolean(switcher),
    };
    pixels("toggle-top", collapsed.top - origin.top);
    pixels("toggle-width", collapsed.width);
    pixels("toggle-height", collapsed.height);
    sidebar.style.marginLeft = previousMargin;
    attach();
  };

  const apply = () => {
    const pose = sidebarPose(progress, geometry);
    const focusedToggle = restoreToggleFocus || [toggle, expandedToggle, collapsedToggle].includes(document.activeElement as HTMLElement);
    restoreToggleFocus = false;
    attach();
    app.setAttribute("data-sidebar-motion", "");
    pixels("boundary", pose.sidebarBoundary);
    pixels("toggle-left", pose.toggleLeft);
    pixels("toggle-wipe", pose.toggleWipe);
    pixels("lead-reservation", pose.leadReservation);
    pixels("switcher-left", pose.toggleLeft + geometry.toggleWidth + geometry.toggleSwitcherGap - pose.sidebarBoundary - barInset);
    app.style.setProperty("--motion-titlebar-opacity", String(pose.titlebarOpacity));
    app.style.setProperty("--motion-switcher-opacity", String(pose.switcherOpacity));
    toggle.setAttribute("aria-label", target === 1 ? "Show sidebar" : "Collapse sidebar");
    // Faded content must not remain keyboard-interactive while moving.
    sidebar.inert = progress > 0;
    lead.inert = progress < 1;
    if (progress === 0 || progress === 1) {
      app.removeAttribute("data-sidebar-motion");
      toggle.remove();
      if (progress === 0) lead.remove();
      else sidebar.remove();
      if (focusedToggle) (progress === 0 ? expandedToggle : collapsedToggle).focus({ preventScroll: true });
    } else if (focusedToggle) {
      toggle.focus({ preventScroll: true });
    }
    host.dispatchEvent(new Event("sidebar-transition-pose"));
    const strip = bar.querySelector<HTMLElement>(".tab-strip");
    const selected = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (strip && selected && strip.scrollWidth > strip.clientWidth) {
      strip.scrollLeft += selected.getBoundingClientRect().left + selected.offsetWidth / 2
        - strip.getBoundingClientRect().left - strip.clientWidth / 2;
    }
    host.dataset.sidebarProgress = String(progress);
    host.dataset.sidebarBoundary = String(pose.sidebarBoundary);
  };

  const onClick = (event: MouseEvent) => {
    if (inspect || !(event.target as Element).closest(".sidebar-collapse, .sidebar-expand, .sidebar-motion-toggle")) return;
    cancelAnimationFrame(animation);
    measure();
    const start = progress;
    target = target === 1 ? 0 : 1;
    options.onChange(target === 1);
    const startedAt = performance.now();
    const duration = reducedMotion.matches ? 0
      : appMeasures.sidebar.collapse.duration_ms * (controls?.dataset.slowMotion === "true" ? INSPECTION_SLOWDOWN_FACTOR : 1);
    const tick = (now: number) => {
      progress = sidebarProgressAt(start, target, now - startedAt, duration);
      apply();
      if (progress !== target) animation = requestAnimationFrame(tick);
    };
    tick(startedAt);
  };

  const onResize = () => { measure(); apply(); };
  const onReducedMotion = () => {
    if (!reducedMotion.matches || inspect) return;
    cancelAnimationFrame(animation);
    progress = target;
    apply();
  };
  measure();
  apply();
  const observer = new ResizeObserver(() => {
    if (sidebar.isConnected && sidebar.getBoundingClientRect().width !== geometry.expandedSidebarWidth) onResize();
  });
  observer.observe(sidebar);
  host.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);
  reducedMotion.addEventListener("change", onReducedMotion);
  return () => {
    cancelAnimationFrame(animation);
    observer.disconnect();
    host.removeEventListener("click", onClick);
    window.removeEventListener("resize", onResize);
    reducedMotion.removeEventListener("change", onReducedMotion);
  };
}
