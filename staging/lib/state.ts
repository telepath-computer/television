// Shared staging for the App frame (not spec content): the example world, and
// the selection state over it.
//
// A channel holds pages, each in the ordinary or full-screen size state and
// containing one artifact or a staging-only split composition. Staging hands
// templates only the state they currently accept.
//
// Shared as a module rather than by embedding one frame inside another. An
// `<frameset-frame src>` would put the sidebar in its own document, and the
// iframe boundary is precisely the relationship the App shell demonstrates — in
// the real app the sidebar is in the shell's document, inheriting its type,
// sharing its focus order and one cascade.

/** One artifact: a document. Nothing about presentation. */
export type Artifact = { id: string; name: string; src: string };

/** A split: two slots at a ratio, in flex terms — `row` side by side,
 *  `column` stacked; `ratio` is the first child's share, 0.5 by default. */
export type Split = {
  direction: "row" | "column";
  ratio: number;
  children: [Artifact | Split, Artifact | Split];
};

/** One page: what a tab stands for — a box holding one artifact, or a
 *  staging-only split composition. Every page has a size in the model
 *  ([[arch/layout/index.md#^ly-page-size]]); this vehicle leaves `size`
 *  unset until a resize and renders the shared default in its place — the
 *  same rendered result, in reference pixels ([[ui/app/stage/index.md]],
 *  The size). Full-screen is a mode over it. */
export type Page = { full_screen?: boolean; size?: { w: number; h: number }; content: Artifact | Split };

/** One channel: a workspace holding pages. Pinned is a property of the channel, not a separate list.
 *  `created` is staging-only fixture data that stands in for the creation time
 *  production derives from the channel's ULID; the array's order is the pinned
 *  arrangement. */
export type Channel = { id: string; name: string; pinned?: boolean; created: number; pages: Page[] };

// The fixture artifacts are the onboarding designs, hosted as same-origin
// frames (Onboarding → Productivity), matching the production frame's
// same-origin document path.
const FIXTURES = [
  "/specs/ui/onboarding-artifacts/productivity/todays-calendar",
  "/specs/ui/onboarding-artifacts/productivity/priorities-today",
  "/specs/ui/onboarding-artifacts/productivity/company-todos",
  "/specs/ui/onboarding-artifacts/productivity/meeting-prep",
];
let nextFixture = 0;
const artifact = (id: string, name: string): Artifact => ({
  id,
  name,
  src: FIXTURES[nextFixture++ % FIXTURES.length]!,
});

const page = (id: string, name: string, full_screen = false): Page => ({
  content: artifact(id, name),
  ...(full_screen && { full_screen }),
});

/** The artifacts a placement shows, in order: a split's leaves, or the artifact itself. */
export const artifactsOf = (content: Artifact | Split): Artifact[] =>
  "children" in content ? content.children.flatMap(artifactsOf) : [content];

/** What a page's tab shows: the lone artifact's name, or the members' names joined. */
export const pageName = (of: Page): string =>
  artifactsOf(of.content)
    .map((a) => a.name)
    .join(" + ");

export const CHANNELS: Channel[] = [
  {
    id: "today",
    created: 1,
    name: "Today",
    pinned: true,
    pages: [page("brief", "Daily brief"), page("calendar", "Calendar"), page("todo", "To-do list")],
  },
  {
    id: "research",
    created: 2,
    name: "Research",
    pinned: true,
    pages: [page("sources", "Sources", true), page("notes", "Notes")],
  },
  {
    id: "q3",
    created: 3,
    name: "Q3 launch",
    pinned: true,
    pages: [page("plan", "Plan"), page("risks", "Risks"), page("timeline", "Timeline")],
  },
  // A freshly created channel, empty: selecting it shows the empty stage
  // ([[ui/app/stage/index.md]], The empty channel).
  { id: "fresh", created: 9, name: "New channel", pages: [] },
  { id: "sam", created: 8, name: "Meeting with Sam", pages: [page("agenda", "Agenda")] },
  { id: "login", created: 7, name: "Fix login bug", pages: [page("repro", "Repro"), page("trace", "Trace")] },
  { id: "lisbon", created: 6, name: "Trip to Lisbon", pages: [page("itinerary", "Itinerary")] },
  { id: "tax", created: 5, name: "Tax return", pages: [page("forms", "Forms")] },
  { id: "post", created: 4, name: "Blog post draft", pages: [page("draft", "Draft")] },
  {
    id: "sweep",
    created: 3,
    name: "Research sweep",
    // Enough pages that the tab strip overflows its band: the specimen for
    // strip scrolling and the selected-tab centring comparison.
    pages: [
      page("sw-sources", "Sources"),
      page("sw-notes", "Notes"),
      page("sw-papers", "Papers to read"),
      page("sw-competitors", "Competitor landscape"),
      page("sw-interviews", "Interview transcripts"),
      page("sw-pricing", "Pricing comparison"),
      page("sw-timeline", "Timeline"),
      page("sw-risks", "Risks"),
      page("sw-summary", "Summary"),
      page("sw-questions", "Open questions"),
      page("sw-market", "Market sizing"),
      page("sw-personas", "User personas"),
      page("sw-channels", "Channel analysis"),
      page("sw-financials", "Financial model"),
      page("sw-legal", "Legal review notes"),
      page("sw-partners", "Partnership options"),
      page("sw-metrics", "Metrics dashboard"),
      page("sw-roadmap", "Roadmap sketch"),
      page("sw-hiring", "Hiring plan"),
      page("sw-retro", "Retro notes"),
    ],
  },
];

/**
 * Which channel is open, and which screen is shown within each of them.
 *
 * The shown screen is remembered per channel rather than globally, so returning
 * to a channel returns to the screen you left it on — the alternative resets a
 * person's place every time they look at something else.
 */
export class Selection {
  #channel = 0;
  readonly #shown = new Map<string, number>();

  get channelIndex(): number {
    return this.#channel;
  }

  get channel(): Channel {
    return CHANNELS[this.#channel]!;
  }

  get shown(): number {
    return this.#shown.get(this.channel?.id ?? "") ?? 0;
  }

  /** Selects a channel by index, returning the direction moved: -1 up, 1 down, 0 nowhere. */
  selectChannel(index: number): number {
    if (index === this.#channel || index < 0 || index >= CHANNELS.length) return 0;
    const direction = index > this.#channel ? 1 : -1;
    this.#channel = index;
    return direction;
  }

  showScreen(index: number): void {
    this.#shown.set(this.channel.id, index);
  }
}

/** The channels a sidebar group holds, in the order the sidebar shows them:
 *  the pinned arrangement is the array's own order; the unpinned follow
 *  created date, newest first. */
export const pinned = (): Channel[] => CHANNELS.filter((c) => c.pinned);
export const unpinned = (): Channel[] => CHANNELS.filter((c) => !c.pinned).sort((a, b) => b.created - a.created);
export const nextCreated = (): number => Math.max(0, ...CHANNELS.map((c) => c.created)) + 1;

/** Grows the sample world for boards that need an overflowing list (the
 *  scrolling board); other frames keep the authored eight. */
export function padChannels(count: number): void {
  const names = ["Reading list", "Garden plan", "Sketches", "House hunt", "Piano practice", "Recipes", "Year notes", "Inbox zero", "Home lab", "Photo picks", "Gift ideas", "Workout log"];
  for (let i = 0; i < count; i++) {
    CHANNELS.push({ id: `pad-${i}`, name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""), created: nextCreated(), pages: [] });
  }
}
