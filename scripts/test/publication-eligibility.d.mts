export type PublicationProvider = "local" | "blaxel" | null;
export type PublicationSelectionOptions = Record<string, string | boolean | null | undefined>;
export function isQualifyingRun(options?: { provider?: PublicationProvider; selectionOptions?: PublicationSelectionOptions }): boolean;
