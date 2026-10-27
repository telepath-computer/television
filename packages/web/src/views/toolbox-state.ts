interface ToolboxItem {
  id: string;
  name: string;
}

export type ToolboxDirection = "up" | "down" | "left" | "right";

/** Number of tiles in each Toolbox row. */
export const TOOLBOX_COLUMNS = 3;

/** Search and highlight survive grid replacements independently of tile positions. */
export class ToolboxSelection<T extends ToolboxItem = ToolboxItem> {
  query = "";
  highlighted: string | null = null;
  #items: readonly T[] = [];

  get matches(): T[] {
    const query = this.query.trim().toLowerCase();
    return this.#items.filter(item => item.name.toLowerCase().includes(query));
  }

  update(items: readonly T[]): void {
    this.#items = items;
    if (!this.matches.some(item => item.id === this.highlighted)) this.highlighted = null;
  }

  search(query: string): void {
    this.query = query;
    this.highlighted = query.trim() ? this.matches[0]?.id ?? null : null;
  }

  move(direction: ToolboxDirection): void {
    const matches = this.matches;
    const index = matches.findIndex(item => item.id === this.highlighted);
    if (matches.length === 0) return;
    if (index < 0) {
      if (direction === "down") this.highlighted = matches[0]!.id;
      return;
    }
    let next = index;
    if (direction === "up" && index < TOOLBOX_COLUMNS) {
      this.highlighted = null;
      return;
    }
    if (direction === "up") next = index - TOOLBOX_COLUMNS;
    if (direction === "down") next = index + TOOLBOX_COLUMNS < matches.length ? index + TOOLBOX_COLUMNS : matches.length - 1;
    if (direction === "left") next = Math.max(0, index - 1);
    if (direction === "right") next = Math.min(matches.length - 1, index + 1);
    this.highlighted = matches[next]?.id ?? null;
  }
}

const ICON_PALETTE = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "neutral"];
const ICON_HASH_SEED = 7;
const ICON_HASH_MULTIPLIER = 31;

export function defaultToolboxIcon(id: string, name: string): { letter: string; color: string } {
  let hash = ICON_HASH_SEED;
  for (const character of id) hash = (hash * ICON_HASH_MULTIPLIER + character.codePointAt(0)!) >>> 0;
  return { letter: [...name][0]?.toUpperCase() ?? "", color: `var(--${ICON_PALETTE[hash % ICON_PALETTE.length]}-600)` };
}

export function isToolboxShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">,
  platform: string,
): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey || event.isComposing) return false;
  return platform.startsWith("Mac") ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
