import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent, type ServerStatusMessage, type UpdateState } from "@telepath-computer/television-shared";
import { ServerStatusEvent } from "../../src/events.ts";

// Shared fakes for the update-state relay's consumer side. The connection
// retains serverVersion + updateState before its owner forwards the status
// event (the retention invariant, update-channel.md ^relay; pinned against
// the real connection by server-connection.test.ts).

export interface RecordedSignal {
  event: string;
  properties: Record<string, string>;
}

/** The slice of ServerConnection that update consumers read, as a fake. */
export class FakeUpdateConnection {
  status = "connected";
  serverVersion: string | null = null;
  updateState: UpdateState | null = null;
  signals: RecordedSignal[] = [];

  readonly url: string;

  constructor(url: string = "http://primary.test") {
    this.url = url;
  }

  sendTelemetrySignal(event: string, properties: Record<string, string>): void {
    this.signals.push({ event, properties });
  }
}

export class FakeUpdateConnectionOwner extends EventTarget<ServerStatusEvent | ChangeEvent> {
  readonly connection: FakeUpdateConnection;

  constructor(connection: FakeUpdateConnection) {
    super();
    this.connection = connection;
  }
}

interface RetainingConnection {
  readonly url: string;
  serverVersion: string | null;
  updateState: UpdateState | null;
}

interface RetainingConnectionOwner {
  readonly connection: RetainingConnection;
  dispatchEvent(event: ServerStatusEvent): unknown;
}

/** Retain on the owned connection, then dispatch — ServerConnection's order. */
export function dispatchServerStatus(
  owner: RetainingConnectionOwner,
  message: ServerStatusMessage,
  serverURL: string,
): void {
  if (owner.connection.url === serverURL) {
    owner.connection.serverVersion = message.version;
    owner.connection.updateState = message.update ?? null;
  }
  owner.dispatchEvent(new ServerStatusEvent("server-status", { serverURL, message }));
}
