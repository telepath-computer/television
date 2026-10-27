// Later writes bypass schema validation. URLs must remain passive image and
// credit references, and local paths must stay inside the copied artifact.
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
