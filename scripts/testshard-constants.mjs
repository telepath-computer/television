// A 72-worker pool supports two exact 36-shard verify lanes while remaining
// below the Blaxel tier's 75-shard limit.
export const RECOMMENDED_TEST_SHARD_COUNT = 36;
export const DEFAULT_BLAXEL_POOL_SIZE = 72;
