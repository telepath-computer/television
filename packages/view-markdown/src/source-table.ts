import { markdown } from "@codemirror/lang-markdown";
import { Text } from "@codemirror/state";
import { Table } from "@lezer/markdown";

interface Cell { row: number; col: number }
interface Span { from: number; to: number }
const parser = markdown({ extensions: [Table] }).language.parser;

/** Maps the table's normalized display cells to the original document source. */
export class SourceTable {
  private readonly rows: Span[][] = [];
  private readonly rowColumns: number[] = [];
  private readonly rowEndsWithDelimiter: boolean[] = [];
  private headerColumns = 0;

  private readonly text: Text;
  private readonly columns: number;

  constructor(text: Text, columns: number) {
    this.text = text;
    this.columns = columns;
    const tree = parser.parse(text.toString());
    tree.iterate({
      enter: (node) => {
        if (node.name !== "TableHeader" && node.name !== "TableRow") return;
        const cells: Span[] = [];
        let previousDelimiter = false;
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === "TableDelimiter") {
            if (previousDelimiter) cells.push({ from: child.from, to: child.from });
            previousDelimiter = true;
          } else if (child.name === "TableCell") {
            const raw = text.sliceString(child.from, child.to);
            const prefix = /^(?:\s|<br>)+/.exec(raw)?.[0].length ?? 0;
            const content = raw.slice(prefix).replace(/(?:\s|<br>)+$/, "");
            cells.push({ from: child.from + prefix, to: child.from + prefix + content.length });
            previousDelimiter = false;
          }
        }
        if (node.name === "TableHeader") this.headerColumns = cells.length;
        this.rowColumns.push(cells.length);
        this.rowEndsWithDelimiter.push(previousDelimiter);
        while (cells.length < columns) cells.push({ from: node.to, to: node.to });
        this.rows.push(cells.slice(0, columns));
        return false;
      },
    });
  }

  /** Preserve untouched source, including overflow cells and edge breaks, on cell edits. */
  applyContent(next: Text, baseline: Text): Text {
    const updated = new SourceTable(next, this.columns);
    const previous = new SourceTable(baseline, this.columns);
    if (updated.headerColumns !== this.headerColumns || updated.rows.length !== this.rows.length) return next;
    const changes: Array<Span & { insert: string }> = [];
    for (let row = 0; row < this.rows.length; row++) {
      let lastMissingChange = -1;
      for (let col = 0; col < this.columns; col++) {
        const before = previous.cellSpan({ row, col });
        const after = updated.cellSpan({ row, col });
        const insert = next.sliceString(after.from, after.to);
        if (baseline.sliceString(before.from, before.to) !== insert) {
          if (col >= this.rowColumns[row]) lastMissingChange = col;
          else changes.push({ ...this.cellSpan({ row, col }), insert });
        }
      }
      if (lastMissingChange >= 0) {
        const span = this.cellSpan({ row, col: lastMissingChange });
        let insert = this.rowEndsWithDelimiter[row] ? "" : "|";
        for (let col = this.rowColumns[row]; col <= lastMissingChange; col++) {
          const cell = updated.cellSpan({ row, col });
          insert += `${next.sliceString(cell.from, cell.to)}|`;
        }
        changes.push({ ...span, insert });
      }
    }
    // Alignment is an intentional edit to the separator, independent of cell text.
    const alignment = (line: string): string => line.replace(/[-\s]/g, "");
    if (alignment(baseline.line(2).text) !== alignment(next.line(2).text)) {
      const separator = this.text.line(2);
      changes.push({ from: separator.from, to: separator.to, insert: next.line(2).text });
    }
    let result = this.text;
    for (const change of changes.sort((a, b) => b.from - a.from)) {
      result = result.replace(change.from, change.to, Text.of(change.insert.split("\n")));
    }
    return result;
  }

  cellSpan({ row, col }: Cell): Span {
    return this.rows[row]?.[col] ?? { from: this.text.length, to: this.text.length };
  }

  closestCell(position: number, preferred?: Cell): Cell {
    const bounded = Math.max(0, Math.min(position, this.text.length));
    // Several missing cells share the row's end offset. Table-owned selection
    // updates retain the clicked column instead of inferring the final one.
    if (preferred) {
      const span = this.rows[preferred.row]?.[preferred.col];
      if (span && span.from === bounded && span.to === bounded) return preferred;
    }
    const line = this.text.lineAt(bounded).number;
    const row = Math.min(this.rows.length - 1, Math.max(0, line === 1 ? 0 : line === 2 && this.rows.length > 1 ? 1 : line - 2));
    let col = 0;
    for (let index = 0; index < this.columns; index++) {
      if (this.cellSpan({ row, col: index }).from <= bounded) col = index;
    }
    return { row, col };
  }
}
