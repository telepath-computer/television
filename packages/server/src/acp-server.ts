import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import { withDisposable } from "@telepath-computer/utils/disposable";
import { isACPBridgeClientMessage } from "@telepath-computer/television-shared";
import { ACPBridge } from "./acp-bridge.ts";
import { isAuthorizedQueryToken } from "./auth.ts";
import type { ACPAgentProfile } from "./config.ts";

const AUTH_FAILED_CLOSE_CODE = 4401;

export interface ACPServerOptions {
  authToken: string;
  authRequired: boolean;
  profile?: ACPAgentProfile;
  /** The launched agent's `tv` arguments, read when a client connects. */
  getAgentTVArgs: () => string[];
}

/**
 * Dedicated WebSocket endpoint for ACP bridge traffic. Kept isolated from the
 * shared `/events` stream so `/events` stays pure pub-sub.
 */
export class ACPServer extends withDisposable(class {}) {
  readonly wsServer: WebSocketServer;
  private readonly bridges = new Map<WebSocket, ACPBridge>();
  private readonly authToken: string;
  private readonly authRequired: boolean;
  private readonly profile: ACPAgentProfile;
  private readonly getAgentTVArgs: () => string[];

  constructor(options: ACPServerOptions) {
    super();
    if (!options.profile) {
      throw new Error("ACPServer requires an ACP agent profile.");
    }
    this.authToken = options.authToken;
    this.authRequired = options.authRequired;
    this.profile = options.profile;
    this.getAgentTVArgs = options.getAgentTVArgs;
    this.wsServer = new WebSocketServer({ noServer: true });

    this.wsServer.on("connection", (socket: WebSocket, request) => {
      if (this.authRequired && !isAuthorizedQueryToken(request.url, this.authToken)) {
        socket.close(AUTH_FAILED_CLOSE_CODE, "Authentication failed");
        return;
      }

      const bridge = new ACPBridge({
        profile: this.profile,
        tvArgs: this.getAgentTVArgs(),
        send: (message) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
          }
        },
      });
      this.bridges.set(socket, bridge);

      socket.on("message", (data: RawData) => {
        let message: unknown;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!isACPBridgeClientMessage(message)) {
          return;
        }
        bridge.handleClientMessage(message);
      });

      socket.on("close", () => {
        this.bridges.get(socket)?.detachSocket();
        this.bridges.delete(socket);
      });
    });
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): void {
    this.wsServer.handleUpgrade(request, socket, head, (ws) => {
      this.wsServer.emit("connection", ws, request);
    });
  }

  getChildPIDs(): number[] {
    return [...this.bridges.values()]
      .map((bridge) => bridge.getChildPID())
      .filter((pid): pid is number => pid !== null);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.bridges.values()].map((bridge) => bridge.dispose()));
    this.bridges.clear();
    for (const socket of this.wsServer.clients) {
      socket.terminate();
    }

    await new Promise<void>((resolve, reject) => {
      this.wsServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
