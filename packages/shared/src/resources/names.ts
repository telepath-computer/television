import { resourceError } from "./errors.ts";
import type { ResourceID } from "./types.ts";

/** 26 characters of Crockford's base32, as a ULID is written (specs/arch/resources/index.md#^rs-records). */
const RESOURCE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const MAX_DESCRIPTION_BYTES = 1024;
export const MAX_USAGE_BYTES = 16_384;

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Whether a value has a resource ID's form. A value of any other form names
 * no resource, so a resource ID never reaches the filesystem unchecked
 * (specs/arch/resources/index.md#^rs-records).
 */
export function isResourceID(value: unknown): value is ResourceID {
  return typeof value === "string" && RESOURCE_ID_PATTERN.test(value);
}

/** Throws `invalid-description` unless `description` is one line, not empty, of at most 1024 UTF-8 bytes. */
export function validateResourceDescription(description: unknown): asserts description is string {
  if (
    typeof description !== "string" ||
    description.length === 0 ||
    /[\n\r]/.test(description) ||
    utf8ByteLength(description) > MAX_DESCRIPTION_BYTES
  ) {
    throw resourceError(
      "invalid-description",
      `Invalid description: a description is one line, not empty, of at most ${MAX_DESCRIPTION_BYTES} bytes.`,
    );
  }
}

/** Throws `invalid-usage` unless `usage` is text of at most 16,384 UTF-8 bytes; line breaks are allowed. */
export function validateResourceUsage(usage: unknown): asserts usage is string {
  if (typeof usage !== "string" || utf8ByteLength(usage) > MAX_USAGE_BYTES) {
    throw resourceError("invalid-usage", `Invalid usage: a usage is text of at most ${MAX_USAGE_BYTES} bytes.`);
  }
}
