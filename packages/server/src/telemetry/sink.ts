import type { BuiltTelemetryEvent } from "./types.ts";
import { POSTHOG_PRODUCTION_PROJECT, type PostHogProjectConfig } from "./posthog-config.ts";

export interface TelemetryTransport {
  send(event: BuiltTelemetryEvent): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface TelemetrySink {
  enqueue(event: BuiltTelemetryEvent): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  pendingCount(): number;
}

export interface TelemetrySinkOptions {
  transport?: TelemetryTransport;
  project?: PostHogProjectConfig;
  maxBufferSize?: number;
  autoFlush?: boolean;
}

export interface PostHogTransportOptions {
  project?: PostHogProjectConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_MAX_BUFFER_SIZE = 1_000;
const DEFAULT_POSTHOG_TIMEOUT_MS = 10_000;

export function createTelemetrySink(options: TelemetrySinkOptions = {}): TelemetrySink {
  return new BufferedTelemetrySink(
    options.transport ?? createPostHogTransport({ project: options.project }),
    options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    options.autoFlush ?? true,
  );
}

export function createPostHogTransport(options: PostHogTransportOptions = {}): TelemetryTransport {
  const project = options.project ?? POSTHOG_PRODUCTION_PROJECT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POSTHOG_TIMEOUT_MS;
  const captureUrl = new URL("/capture/", project.ingestionHost).toString();

  return {
    async send(event: BuiltTelemetryEvent): Promise<void> {
      const controller = new AbortController();
      const timeout = timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
      try {
        const response = await fetchImpl(captureUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: project.projectToken,
            event: event.name,
            distinct_id: event.distinctId,
            properties: { ...event.properties, $ip: "0.0.0.0", $geoip_disable: true },
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`PostHog capture failed with HTTP ${response.status}`);
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`PostHog capture timed out after ${timeoutMs}ms`);
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

class BufferedTelemetrySink implements TelemetrySink {
  private readonly transport: TelemetryTransport;
  private readonly maxBufferSize: number;
  private readonly autoFlush: boolean;
  private readonly buffer: BuiltTelemetryEvent[] = [];
  private flushing = false;
  private flushScheduled = false;

  constructor(transport: TelemetryTransport, maxBufferSize: number, autoFlush: boolean) {
    this.transport = transport;
    this.maxBufferSize = Math.max(1, maxBufferSize);
    this.autoFlush = autoFlush;
  }

  enqueue(event: BuiltTelemetryEvent): void {
    try {
      if (this.buffer.length >= this.maxBufferSize) this.buffer.shift();
      this.buffer.push(event);
      if (this.autoFlush) this.scheduleFlush();
    } catch {
      // Delivery is best-effort; telemetry cannot affect product behavior.
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.buffer.length > 0) {
        const next = this.buffer[0]!;
        try {
          await this.transport.send(next);
          this.buffer.shift();
        } catch {
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
    try {
      await this.transport.shutdown?.();
    } catch {
      // Ignore shutdown failures for the same reason enqueue/flush are best-effort.
    }
  }

  pendingCount(): number {
    return this.buffer.length;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      void this.flush();
    });
  }
}
