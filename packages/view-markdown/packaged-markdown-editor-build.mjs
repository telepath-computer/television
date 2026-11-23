/** Enforce the complete committed-file boundary of the packaged Markdown editor. */
export function createPackagedMarkdownEditorOutputPlugin() {
  return {
    name: "view-markdown-packaged-markdown-editor-output",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const expected = ["editor.css", "editor.js"];
      const actual = Object.keys(bundle).sort(compare);
      const unexpected = actual.filter((name) => !expected.includes(name));
      const missing = expected.filter((name) => !actual.includes(name));
      if (unexpected.length > 0 || missing.length > 0) {
        const details = [
          unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : null,
          missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
        ].filter(Boolean).join("; ");
        throw new Error(`Unexpected packaged Markdown editor output (${details})`);
      }
    },
  };
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
