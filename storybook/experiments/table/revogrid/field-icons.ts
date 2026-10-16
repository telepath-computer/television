// One glyph per field type, shared by headers and the type menu.
import type { ColumnType } from "../data";

const icons: Record<ColumnType, string> = {
  text: "edit",
  number: "hash",
  currency: "money",
  date: "calendar",
  checkbox: "check",
  select: "tag",
  multiselect: "tag",
  person: "user",
  url: "link",
};

export function fieldIcon(type: ColumnType): string { return icons[type]; }
