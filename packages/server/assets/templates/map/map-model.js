// Store-derived constants and media rules that do not depend on the DOM.
// Later writes bypass schema validation. URLs remain passive image and credit
// references, and local paths stay inside the copied artifact.
export const categoryColors = Object.freeze(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'neutral']);
const httpsPattern = /^https:\/\/[^\s/?#\u0000-\u001F]+(?:[/?#][^\s\u0000-\u001F]*)?$/;

export function httpsURL(value) {
  if (typeof value !== 'string' || !httpsPattern.test(value)) return null;
  try { return new URL(value).protocol === 'https:' ? value : null; } catch { return null; }
}

export function photoURL(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('https://')) return httpsURL(value);
  const path = value.startsWith('./') ? value.slice(2) : value;
  if (path !== path.trim() || /[\\:%?#\u0000-\u001f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return path;
}
