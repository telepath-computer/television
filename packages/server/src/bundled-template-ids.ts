/** Closed identifiers reserved for Television's bundled artifact templates. */
export const BUNDLED_ARTIFACT_TEMPLATE_IDS = ["checklist", "sticky-note"] as const;
export type BundledArtifactTemplateID = typeof BUNDLED_ARTIFACT_TEMPLATE_IDS[number];
