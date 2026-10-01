import type { IncomingMessage, ServerResponse } from "node:http";

export function skillbenchMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;
