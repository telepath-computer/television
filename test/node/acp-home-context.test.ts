import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ACPClient } from "../../packages/web/src/services/acp-client.ts";
import { launchProductServer } from "../helpers/product-server.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB_AGENT = path.join(HERE, "fixtures", "acp-stub-agent.mjs");

// Spec: [[arch/cli/index.md#^cli-acp-home-context|ACP agent home context]].
describe("ACP agent home context", () => {
  // proofs/arch/cli/index.md#^cli-acp-home-context-seam
  it("gives a launched agent the served home and the acquired port in its Television context block", async () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "television-acp-home-context-"));
    // The bridge creates the agent's working directory under the
    // operating-system home, so the server runs with a temporary one.
    const operatingSystemHome = path.join(scratch, "os-home");
    const stubBin = path.join(scratch, "bin");
    const promptLog = path.join(scratch, "prompts.log");
    mkdirSync(operatingSystemHome);
    mkdirSync(stubBin);
    writeFileSync(
      path.join(stubBin, "openclaw"),
      `#!/bin/sh\nexec '${process.execPath}' '${STUB_AGENT}' "$@"\n`,
      { mode: 0o755 },
    );

    const server = await launchProductServer({
      auth: true,
      env: {
        HOME: operatingSystemHome,
        PATH: `${stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
        TELEVISION_ACP_AGENT: "openclaw",
        // The temporary operating-system home holds no developer marker.
        DO_NOT_TRACK: "1",
        TV_TEST_ACP_PROMPT_LOG: promptLog,
        // The CLI skips its entry point under Vitest's marker.
        VITEST: "",
      },
    });
    const client = new ACPClient({
      serverURL: server.serverURL,
      token: server.token,
      enabled: true,
      createSocket: (url) => new WebSocket(url),
    });
    try {
      client.setChannelContext({ channelID: "01HOMECONTEXTSEAM", channelName: "Home context seam" });
      await client.connect();
      await client.sendMessage({ text: "first message" });

      const prompt = readFileSync(promptLog, "utf8");
      const acquiredPort = new URL(server.serverURL).port;
      expect(prompt).toContain("[Television channel context]");
      expect(prompt).toContain("channel_id: 01HOMECONTEXTSEAM");
      expect(prompt).toContain(`--home ${server.home} --port ${acquiredPort}`);
    } finally {
      await client.dispose();
      await server.dispose();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
