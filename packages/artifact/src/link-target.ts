export type LinkTargetDisposition =
  | { kind: "web"; url: string }
  | { kind: "application"; url: string }
  | { kind: "browser-local"; url: string }
  | { kind: "invalid" };

const browserLocalProtocols = new Set([
  "about:",
  "blob:",
  "chrome-extension:",
  "chrome:",
  "data:",
  "devtools:",
  "file:",
  "filesystem:",
  "javascript:",
  "view-source:",
]);

export function classifyLinkTarget(value: string, baseURL: string): LinkTargetDisposition {
  try {
    const base = new URL(baseURL);
    const parsed = new URL(value, base);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { kind: "web", url: parsed.href };
    }
    if (browserLocalProtocols.has(parsed.protocol)) {
      return { kind: "browser-local", url: parsed.href };
    }
    return { kind: "application", url: parsed.href };
  } catch {
    return { kind: "invalid" };
  }
}

export function isWebNavigationURL(value: string, baseURL: string): boolean {
  return classifyLinkTarget(value, baseURL).kind === "web";
}
