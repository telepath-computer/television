export function renewLease(options: {renew: () => Promise<unknown>; intervalMs: number; onLost: (error: Error) => void}): () => Promise<void>;
export function finishLease(options: {settleWrites: () => Promise<unknown>; teardown: () => Promise<unknown>; download: () => Promise<unknown>; release: () => Promise<unknown>; assertOwned: () => void; attempts?: number}): Promise<void>;
