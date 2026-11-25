// Spec template functions take parameters and return HTML built with `html`.
// A value inserted into a template is escaped, unless it is HTML returned by
// another template function, which is how one template nests another. Arrays
// are inserted item by item; null, undefined and false insert nothing.

export class Html {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function insert(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(insert).join("");
  return String(value).replace(/[&<>"']/g, (c) => entities[c]);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  values.forEach((value, i) => {
    out += insert(value) + strings[i + 1];
  });
  return new Html(out);
}
