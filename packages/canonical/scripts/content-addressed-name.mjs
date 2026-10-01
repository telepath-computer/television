import { createHash } from "node:crypto";
import path from "node:path";

export function contentAddressedName(filename, bytes) {
  const extension = path.extname(filename);
  const stem = extension
    ? filename.slice(0, -extension.length)
    : filename;
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  return `${stem}.${digest}${extension}`;
}
