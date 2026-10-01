import { parse } from "yaml";

/** CSS is already the payload; a frame contributes its YAML-decoded style block. */
export function styleSourceText(sourcePath: string, source: string): string | undefined {
  if (sourcePath.endsWith(".css")) return source;
  if (!sourcePath.endsWith(".frame")) return undefined;
  const opening = source.match(/^---(?:\r?\n|$)/);
  if (!opening) return undefined;
  const rest = source.slice(opening[0].length);
  const closing = /^---\r?$/m.exec(rest);
  if (!closing) throw new Error(`${sourcePath}: front matter is not closed`);
  const metadata: unknown = parse(rest.slice(0, closing.index));
  if (metadata === null) return undefined;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${sourcePath}: front matter must be a mapping`);
  }
  if (!("style" in metadata)) return undefined;
  if (typeof metadata.style !== "string") throw new Error(`${sourcePath}: style must be a string`);
  return metadata.style;
}
