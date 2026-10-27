import fs from "node:fs";
import path from "node:path";

// Initial public boundary for the red collector/writer contracts.
export function startResourceDiagnostics({ root, identity }) {
  const file = path.join(root, "resources", `${identity.surfaceId.replace(/[^a-zA-Z0-9-]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1 }));
  return { file, finish: () => [file] };
}

export function writeResourceDiagnostic(root, name, record) {
  const file = path.join(root, "resources", `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}
