/** Resting layout measurements in pixels, with horizontal positions measured from the app's left edge. */
export interface SidebarGeometry {
  expandedSidebarWidth: number;
  expandedToggleLeft: number;
  collapsedToggleLeft: number;
  toggleWidth: number;
  toggleSwitcherGap: number;
  collapsedLeadReservation: number;
  hasSwitcher: boolean;
}

/** The visual properties controlled by the transition. Distances are pixels; opacities are 0–1. */
export interface SidebarPose {
  sidebarBoundary: number;
  toggleLeft: number;
  /** Width of the toggle that retains its expanded appearance, measured from its left edge. */
  toggleWipe: number;
  titlebarOpacity: number;
  switcherOpacity: number;
  leadReservation: number;
}

/**
 * Pose the shell at a sidebar boundary position: 0 is expanded, 1 is collapsed.
 * Progress measures distance, not time. The same geometry and progress always
 * produce the same pose, whether collapsing, expanding, reversing, or inspecting.
 * Geometry describes the resting layout, never the previous animation frame.
 */
export function sidebarPose(progress: number, geometry: SidebarGeometry): SidebarPose {
  const {
    expandedSidebarWidth,
    expandedToggleLeft,
    collapsedToggleLeft,
    toggleWidth,
    toggleSwitcherGap,
    collapsedLeadReservation,
    hasSwitcher,
  } = geometry;

  const sidebarBoundary = expandedSidebarWidth * (1 - progress);

  // The toggle follows the boundary until it reaches its collapsed resting place.
  const toggleInset = expandedSidebarWidth - expandedToggleLeft;
  const toggleLeft = Math.max(sidebarBoundary - toggleInset, collapsedToggleLeft);
  const dockingBoundary = collapsedToggleLeft + toggleInset;

  // The boundary wipes away the expanded appearance as it crosses the stopped toggle.
  const toggleWipe = Math.max(0, Math.min(toggleWidth, sidebarBoundary - toggleLeft));

  // The other titlebar controls disappear by the moment the toggle stops travelling.
  const titlebarOpacity = clampFraction(
    (sidebarBoundary - dockingBoundary) / (expandedSidebarWidth - dockingBoundary),
  );

  // Reveal the switcher as the boundary clears the toggle and its following gap.
  const switcherRevealDistance = toggleWidth + toggleSwitcherGap;
  const switcherRevealBoundary = collapsedToggleLeft + switcherRevealDistance;
  const switcherOpacity = hasSwitcher
    ? clampFraction((switcherRevealBoundary - sidebarBoundary) / switcherRevealDistance)
    : 0;

  // Usually the lead reservation grows with boundary travel.
  let leadReservation = progress * collapsedLeadReservation;
  if (collapsedLeadReservation > expandedSidebarWidth) {
    // Make room for a wide lead before the switcher becomes visible.
    // The left edge available to the tabs reaches its resting position by that
    // reveal, then stays there as the main region continues moving left.
    const revealProgress = 1 - switcherRevealBoundary / expandedSidebarWidth;
    const approachProgress = Math.min(1, progress / revealProgress);
    leadReservation = progress * expandedSidebarWidth +
      approachProgress * (collapsedLeadReservation - expandedSidebarWidth);
  }

  return {
    sidebarBoundary,
    toggleLeft,
    toggleWipe,
    titlebarOpacity,
    switcherOpacity,
    leadReservation,
  };
}

/**
 * Travel from a starting progress to a destination with quadratic ease-out.
 * durationMs is the duration of a complete expanded-to-collapsed journey.
 * A shorter journey takes proportionally less time. Reversal starts a new
 * journey from the current progress, easing out toward the new destination.
 * A zero duration settles immediately, including when reduced motion is requested.
 */
export function sidebarProgressAt(
  start: number,
  target: number,
  elapsedMs: number,
  durationMs: number,
): number {
  const journeyDuration = durationMs * Math.abs(target - start);
  if (journeyDuration === 0) return target;

  const timeProgress = clampFraction(elapsedMs / journeyDuration);
  const easedProgress = 1 - (1 - timeProgress) ** 2;
  return start + (target - start) * easedProgress;
}

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}
