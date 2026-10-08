// The resource layer's shared code (specs/arch/resources/index.md, Code layout).
// Browser-compatible and dependency-free: the resource SDK bundles it.
export * from "./types.ts";
export { RESOURCE_BINDINGS_ENABLED } from "./flag.ts";
export { isResourceError, isResourceRefusal, resourceError, type ResourceError } from "./errors.ts";
export {
  MAX_DESCRIPTION_BYTES,
  MAX_USAGE_BYTES,
  isResourceID,
  utf8ByteLength,
  validateResourceDescription,
  validateResourceUsage,
} from "./names.ts";
export {
  JSON_STORE_MAX_DEPTH,
  JSON_STORE_MAX_KEY_BYTES,
  checkPathSegments,
  childKeys,
  compareChildKeys,
  isIndexKey,
  isJsonObject,
  isValidKey,
  jsonEqual,
  parseJsonPath,
  pathsMeet,
  readJsonValue,
} from "./json-paths.ts";
export {
  DeleteValuePlaceholder,
  ServerValuePlaceholder,
  decodeUpdateEntries,
  decodeWriteValue,
  deleteValue,
  encodeUpdateEntries,
  encodeWriteValue,
  increment,
  serverTimestamp,
  validateJsonValue,
  validateUpdateValues,
  validateWriteValue,
  type EncodedServerValue,
  type EncodedUpdateEntry,
  type EncodedWriteValue,
  type ServerValueSpec,
  type UpdateEntryValue,
  type WriteValue,
} from "./json-values.ts";
export {
  JSON_STORE_MAX_BYTES,
  JSON_STORE_MAX_WRITE_MESSAGE_BYTES,
  applyJsonWrite,
  checkJsonLimits,
  checkWriteMessage,
  jsonByteLength,
  jsonWritePaths,
  writeMessageTooLarge,
  type JsonWrite,
  type ServerValueContext,
} from "./json-apply.ts";
export { generatePushKey } from "./push-keys.ts";
export * from "./wire.ts";
export * from "./page-wire.ts";
