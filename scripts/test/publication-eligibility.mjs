const NARROWING_OPTIONS = [
  "surface",
  "package",
  "file",
  "grep",
  "runner",
  "tag",
  "shard-indices",
];

function optionIsPresent(selectionOptions, key) {
  const value = selectionOptions?.[key];
  return value !== undefined && value !== null && value !== false;
}

/**
 * A publication-qualifying execution is the complete all suite on Blaxel.
 * Changing the shard total still covers the complete suite; selecting shard
 * indices does not.
 */
export function isQualifyingRun({ provider, selectionOptions = {} } = {}) {
  if (provider !== "blaxel") return false;
  const suite = optionIsPresent(selectionOptions, "suite") ? selectionOptions.suite : "all";
  if (suite !== "all") return false;
  return NARROWING_OPTIONS.every((key) => !optionIsPresent(selectionOptions, key));
}
