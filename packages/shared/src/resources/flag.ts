/**
 * The bindings flag (specs/arch/resources/index.md#^rs-flag-constant).
 * Creating stores explicitly, binding them to artifacts and a page's use of
 * stores by resource ID exist only with it on. Production code never passes
 * another value: tests turn it on through the `Server` option and the CLI
 * environment.
 */
export const RESOURCE_BINDINGS_ENABLED = false;
