// Sample tables shared by the Table prototypes, so each prototype's stories
// show the same data and can be compared side by side. A prototype copies a
// table before changing it; nothing here is saved.
//
// The model is richer than the Table template's draft (string cells only):
// columns have types, and select columns carry their options. Rows are an
// ordered array with stable ids, standing in for the store's keyed rows.

export type ColumnType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "checkbox"
  | "select"
  | "multiselect"
  | "person"
  | "url";

// Option colors name hues of the foundation's color scales (colors.css).
export type OptionColor = "neutral" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";

export interface SelectOption {
  id: string;
  label: string;
  color: OptionColor;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  // Width in CSS pixels.
  width: number;
  // The row's name, as in Airtable's primary field: kept in view when the
  // table scrolls sideways.
  primary?: boolean;
  // For select and multiselect columns.
  options?: SelectOption[];
  // For currency columns, an ISO 4217 code.
  currency?: string;
}

// Text, url and person cells hold strings; number and currency cells
// numbers; date cells YYYY-MM-DD strings; checkbox cells booleans; select
// cells one option id; multiselect cells an array of option ids. An empty
// cell is null or absent.
export type CellValue = string | number | boolean | string[] | null;

export interface Row {
  id: string;
  cells: Record<string, CellValue>;
}

export interface TableData {
  title: string;
  columns: Column[];
  rows: Row[];
}

// A deep copy, for a story to change freely.
export const copyTable = (table: TableData): TableData => structuredClone(table);

const statusOptions: SelectOption[] = [
  { id: "todo", label: "To do", color: "neutral" },
  { id: "progress", label: "In progress", color: "blue" },
  { id: "blocked", label: "Blocked", color: "red" },
  { id: "review", label: "In review", color: "purple" },
  { id: "done", label: "Done", color: "green" },
];

const areaOptions: SelectOption[] = [
  { id: "skills", label: "skills", color: "orange" },
  { id: "acp", label: "acp", color: "purple" },
  { id: "server", label: "server", color: "blue" },
  { id: "cli", label: "cli", color: "yellow" },
  { id: "design", label: "design", color: "pink" },
  { id: "spec", label: "spec", color: "green" },
  { id: "web", label: "web", color: "neutral" },
];

export const projectTracker: TableData = {
  title: "Television sprint",
  columns: [
    { id: "title", name: "Title", type: "text", width: 320, primary: true },
    { id: "status", name: "Status", type: "select", width: 140, options: statusOptions },
    { id: "owner", name: "Owner", type: "person", width: 130 },
    { id: "area", name: "Area", type: "multiselect", width: 170, options: areaOptions },
    { id: "points", name: "Points", type: "number", width: 90 },
    { id: "due", name: "Due", type: "date", width: 120 },
    { id: "shipped", name: "Shipped", type: "checkbox", width: 90 },
    { id: "link", name: "Link", type: "url", width: 220 },
  ],
  rows: [
    ["Wire /canonical/v2/ stylesheet", "progress", "Rupert", ["skills"], 3, "2026-10-21", false, "https://github.com/telepath-computer/television/pull/412"],
    ["Land artifacts skill", "progress", "Rupert", ["skills", "spec"], 5, "2026-10-21", false, ""],
    ["Hermes ACP regression suite", "review", "Josh", ["acp"], 8, "2026-10-23", false, "https://github.com/telepath-computer/television/pull/420"],
    ["Promote canonical bundle to production server", "todo", "Stephen", ["server"], 2, "2026-10-24", false, ""],
    ["CLI distribution for skills", "todo", "Josh", ["cli", "skills"], 3, "2026-10-28", false, ""],
    ["Token curation pass for v2", "todo", "Stephen", ["design"], 5, "2026-11-04", false, ""],
    ["Bundle-on-export for downloadable artifacts", "blocked", "Rupert", ["spec"], 8, "2026-10-30", false, ""],
    ["Migrate tasks template to a table", "done", "Rupert", ["skills"], 2, "2026-10-14", true, ""],
    ["Fix iframe blob base href resolution", "done", "Rupert", ["web"], 1, "2026-10-14", true, "https://github.com/telepath-computer/television/pull/398"],
    ["Runtime manifest spec", "done", "Rupert", ["spec"], 3, "2026-10-09", true, ""],
    ["Drag controller refactor", "done", "Stephen", ["web", "design"], 5, "2026-10-07", true, ""],
    ["Markdown view scroll bridge", "done", "Josh", ["web"], 2, "2026-10-02", true, ""],
  ].map(([title, status, owner, area, points, due, shipped, link], index) => ({
    id: `task-${index + 1}`,
    cells: { title, status, owner, area, points, due, shipped, link: link || null } as Record<string, CellValue>,
  })),
};

const categoryOptions: SelectOption[] = [
  { id: "travel", label: "Travel", color: "blue" },
  { id: "meals", label: "Meals", color: "orange" },
  { id: "software", label: "Software", color: "purple" },
  { id: "hardware", label: "Hardware", color: "neutral" },
  { id: "office", label: "Office", color: "green" },
];

export const expenses: TableData = {
  title: "October expenses",
  columns: [
    { id: "item", name: "Item", type: "text", width: 260, primary: true },
    { id: "category", name: "Category", type: "select", width: 130, options: categoryOptions },
    { id: "amount", name: "Amount", type: "currency", width: 120, currency: "USD" },
    { id: "date", name: "Date", type: "date", width: 120 },
    { id: "paidBy", name: "Paid by", type: "person", width: 130 },
    { id: "reimbursed", name: "Reimbursed", type: "checkbox", width: 110 },
  ],
  rows: [
    ["Flight SFO to JFK", "travel", 412.6, "2026-10-02", "Rupert", true],
    ["Hotel, three nights", "travel", 897.0, "2026-10-02", "Rupert", true],
    ["Team dinner", "meals", 286.45, "2026-10-03", "Stephen", false],
    ["Figma, annual", "software", 180.0, "2026-10-05", "Josh", true],
    ["USB-C hub", "hardware", 59.99, "2026-10-06", "Rupert", false],
    ["Coffee with investors", "meals", 23.5, "2026-10-08", "Rupert", false],
    ["Desk lamp", "office", 74.0, "2026-10-09", "Stephen", false],
    ["Claude Max", "software", 200.0, "2026-10-10", "Rupert", true],
    ["Taxi to demo night", "travel", 38.2, "2026-10-14", "Josh", false],
    ["Monitor arm", "hardware", 129.0, "2026-10-15", "Stephen", false],
  ].map(([item, category, amount, date, paidBy, reimbursed], index) => ({
    id: `expense-${index + 1}`,
    cells: { item, category, amount, date, paidBy, reimbursed } as Record<string, CellValue>,
  })),
};

// A new table, as the template starts: a few columns and no rows.
export const empty: TableData = {
  title: "Untitled table",
  columns: [
    { id: "name", name: "Name", type: "text", width: 260, primary: true },
    { id: "notes", name: "Notes", type: "text", width: 260 },
    { id: "status", name: "Status", type: "select", width: 140, options: statusOptions.slice(0, 3) },
  ],
  rows: [],
};

// A deterministic pseudo-random sequence, so generated tables are the same
// on every render. The seed is scrambled first: nearby seeds would otherwise
// start with nearly the same values.
const sequence = (seed: number) => {
  seed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
};

const people = ["Rupert", "Josh", "Stephen", "Izzi", "Ade", "Julie"];
const words = ["Audit", "Draft", "Ship", "Review", "Plan", "Fix", "Design", "Measure", "Prototype", "Write"];
const subjects = ["onboarding", "the sidebar", "theme loading", "the share sheet", "search", "keyboard focus", "the CLI", "artifact sizes"];

// Many rows of the project tracker's columns, for scrolling and speed.
export const largeTable = (rowCount = 2000): TableData => {
  const random = sequence(rowCount);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  return {
    title: `${rowCount.toLocaleString("en-US")} rows`,
    columns: structuredClone(projectTracker.columns),
    rows: Array.from({ length: rowCount }, (_, index) => {
      const day = 1 + Math.floor(random() * 28);
      return {
        id: `row-${index + 1}`,
        cells: {
          title: `${pick(words)} ${pick(subjects)}`,
          status: pick(statusOptions).id,
          owner: pick(people),
          area: random() < 0.3 ? [pick(areaOptions).id, pick(areaOptions).id].filter((id, i, all) => all.indexOf(id) === i) : [pick(areaOptions).id],
          points: 1 + Math.floor(random() * 8),
          due: `2026-11-${String(day).padStart(2, "0")}`,
          shipped: random() < 0.25,
          link: null,
        },
      };
    }),
  };
};

// More columns than fit across the page: the project tracker plus a
// numbered measurement for each month.
export const wideTable: TableData = {
  title: "Monthly measurements",
  columns: [
    { id: "title", name: "Title", type: "text", width: 260, primary: true },
    { id: "owner", name: "Owner", type: "person", width: 130 },
    ...["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
      (month): Column => ({ id: month.toLowerCase(), name: month, type: "number", width: 90 }),
    ),
    { id: "status", name: "Status", type: "select", width: 140, options: statusOptions },
  ],
  rows: projectTracker.rows.map((row, index) => {
    const random = sequence(index + 7);
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    return {
      id: row.id,
      cells: {
        title: row.cells.title,
        owner: row.cells.owner,
        status: row.cells.status,
        ...Object.fromEntries(months.map((month) => [month, Math.round(random() * 1000) / 10])),
      },
    };
  }),
};
