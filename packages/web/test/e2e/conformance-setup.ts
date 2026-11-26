import { rmSync } from "node:fs";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { launchProductServer } from "../../../../test/helpers/product-server.ts";
import { TEMPLATES_BUNDLE } from "./template-harness.ts";

export const SERVER_ENV = "TV_CONFORMANCE_SERVER";

export interface SharedServer {
  serverURL: string;
  token: string;
  channelID: string;
}

/** Starts the one product server every conformance worker shares, and stops it after the run. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const product = await launchProductServer({ auth: true, cleanupHome: false, bundledTemplatesBundle: TEMPLATES_BUNDLE });
  const teardown = async () => {
    await product.dispose();
    rmSync(product.home, { recursive: true, force: true });
  };
  try {
    const client = new TelevisionClient(product.serverURL, { token: product.token });
    const channelID = (await client.channels.list()).channels[0]?.id;
    if (!channelID) throw new Error("Product server has no initial channel");
    const server: SharedServer = { serverURL: product.serverURL, token: product.token, channelID };
    process.env[SERVER_ENV] = JSON.stringify(server);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
