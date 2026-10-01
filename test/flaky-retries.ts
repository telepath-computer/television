export const FLAKY_TEST_RETRIES = resolveFlakyTestRetries();

function resolveFlakyTestRetries(): number {
  const configured = process.env.FLAKY_TEST_RETRIES;
  if (configured !== undefined) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    throw new Error(`FLAKY_TEST_RETRIES must be a non-negative integer; received ${JSON.stringify(configured)}`);
  }
  return process.env.CI ? 5 : 0;
}
