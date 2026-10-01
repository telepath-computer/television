import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUpdateChannelDocument } from "../../packages/server/src/updates/update-channel.ts";

// proofs/arch/updates/update-channel.md#^updates-t-channel-master-copy
// Publishing copies the master copy verbatim (^channel-master-copy), and the
// fleet silently ignores a document that fails shape validation
// (^channel-validation), so the production validator checks it here. The
// validator's result keeps only the fields the server reads, so comparing it
// with the file catches a misspelled key the server would silently ignore.
const MASTER_COPY = path.resolve(import.meta.dirname, "../../specs/arch/updates/update-channel.json");

describe("update channel master copy (^updates-t-channel-master-copy)", () => {
  it("passes the server's shape validation and has no field the server does not read", () => {
    const document: unknown = JSON.parse(readFileSync(MASTER_COPY, "utf8"));
    const parsed = parseUpdateChannelDocument(document);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(document);
  });
});
