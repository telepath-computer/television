export interface ChecklistItem {
  order: number;
  text: string;
  done: boolean;
  [field: string]: unknown;
}

export type ChecklistItems = Record<string, ChecklistItem>;

export interface ChecklistData {
  title: string;
  items: ChecklistItems;
  [field: string]: unknown;
}

export function isItemMap(value: unknown): value is ChecklistItems;
export function isChecklistData(value: unknown): value is ChecklistData;
export function compareItemKeys(left: string, right: string): number;
export function orderedItems(items: ChecklistItems): Array<[string, ChecklistItem]>;
/** null inserts at the top; undefined or a missing predecessor appends. */
export function insertionOrder(items: ChecklistItems, afterKey?: string | null): number | null;
export function createRenumberUpdate(
  newKey: string,
  newItem: Pick<ChecklistItem, "text" | "done">,
  afterKey?: string | null,
): (current: unknown) => ChecklistItems | undefined;
export function isCompletionShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
  platform: string,
): boolean;
