/** The refusal code a call throws, or undefined when it returns. */
export function refusalCode(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code !== "string") throw error;
    return code;
  }
  return undefined;
}
