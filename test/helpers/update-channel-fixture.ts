import http from "node:http";

// Request-recording update-channel fixture server for the update-notifications
// harnesses: serves an authored update-channel document over real HTTP (the
// URL is handed to a server under test via the operational
// TV_UPDATE_CHANNEL_URL override — specs/arch/updates/update-channel.md Test
// hooks), records every request's URL and headers so polling behavior
// (cache-bust query, request headers, cadence) is assertable, and can swap
// the response mid-test to stage channel deploys and failure modes.

export interface RecordedChannelRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
}

export interface ChannelResponseOptions {
  status?: number;
  contentType?: string;
}

export interface UpdateChannelFixtureServer {
  /** Full URL to the served channel document. */
  url: string;
  /** Every request received, in order. */
  requests: RecordedChannelRequest[];
  /** Replace the response. Objects are served as JSON; strings verbatim. */
  setResponse(body: unknown, options?: ChannelResponseOptions): void;
  dispose(): Promise<void>;
}

export async function startUpdateChannelFixture(initial: unknown): Promise<UpdateChannelFixtureServer> {
  const requests: RecordedChannelRequest[] = [];
  let body = "";
  let status = 200;
  let contentType = "application/json";

  function setResponse(nextBody: unknown, options: ChannelResponseOptions = {}): void {
    if (typeof nextBody === "string") {
      body = nextBody;
      contentType = options.contentType ?? "text/plain";
    } else {
      body = JSON.stringify(nextBody);
      contentType = options.contentType ?? "application/json";
    }
    status = options.status ?? 200;
  }

  setResponse(initial);

  const server = http.createServer((request, response) => {
    requests.push({ url: request.url ?? "", headers: request.headers });
    response.writeHead(status, { "content-type": contentType });
    response.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server has no port");

  let disposed = false;
  return {
    url: `http://127.0.0.1:${address.port}/update-channel.json`,
    requests,
    setResponse,
    async dispose() {
      if (disposed) return;
      disposed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
