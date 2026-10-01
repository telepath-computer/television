// A stand-in ACP agent for the home-context seam. It answers the ACP
// handshake, accepts any session, and appends the text of each prompt it
// receives to the file named by TV_TEST_ACP_PROMPT_LOG.
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

const promptLog = process.env.TV_TEST_ACP_PROMPT_LOG;
if (!promptLog) {
  process.stderr.write("TV_TEST_ACP_PROMPT_LOG is required\n");
  process.exit(2);
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
new AgentSideConnection(() => ({
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "television-acp-stub-agent", version: "0.0.0" },
      authMethods: [],
    };
  },
  async authenticate() {
    return {};
  },
  async newSession(params) {
    return { sessionId: String(params._meta?.sessionKey ?? "stub-session") };
  },
  async loadSession() {
    return { configOptions: [] };
  },
  async setSessionConfigOption() {
    return { configOptions: [] };
  },
  async prompt(params) {
    const text = params.prompt.flatMap((content) => content.type === "text" ? [content.text] : []).join("");
    appendFileSync(promptLog, `${text}\n`);
    return { stopReason: "end_turn" };
  },
  async cancel() {},
}), stream);
