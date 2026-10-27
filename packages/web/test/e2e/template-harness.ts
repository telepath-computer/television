import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, type Frame, type Page } from "@playwright/test";
import { TelevisionClient } from "@telepath-computer/television-shared";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { APPLICATION_SHELL_STATES, waitForApplicationRender } from "../../../../test/helpers/application-readiness.ts";
import { NetworkProxy } from "../../../server/test/e2e/network-proxy.ts";
import { configureTestMotion } from "./helpers.ts";

export const TEST_HOST = "tv-sdk.test";
export const TEMPLATES_BUNDLE = path.resolve(import.meta.dirname, "../../../server/assets/templates");

/** Browser launch options mapping the test host name to the loopback server. */
export const TEST_HOST_LAUNCH = { args:[`--host-resolver-rules=MAP ${TEST_HOST} 127.0.0.1`] };

/** Real installed templates and copied artifacts behind a stable, controllable browser connection. */
export class TemplateHarness {
  product: ProductServer;
  readonly proxy: NetworkProxy;
  readonly home: string;
  readonly channelID: string;
  private readonly template: { id: string; name: string };

  private constructor(product: ProductServer, proxy: NetworkProxy, channelID: string, template: { id: string; name: string }) {
    this.product = product;
    this.proxy = proxy;
    this.home = product.home;
    this.channelID = channelID;
    this.template = template;
  }

  static async start(template: { id: string; name: string }): Promise<TemplateHarness> {
    const product = await launchProductServer({ auth: true, cleanupHome: false, bundledTemplatesBundle: TEMPLATES_BUNDLE });
    let proxy: NetworkProxy | undefined;
    try {
      proxy = await NetworkProxy.start(Number(new URL(product.serverURL).port));
      const client = new TelevisionClient(product.serverURL, { token: product.token });
      const channelID = (await client.channels.list()).channels[0]?.id;
      if (!channelID) throw new Error("Product server has no initial channel");
      return new TemplateHarness(product, proxy, channelID, template);
    } catch (error) {
      await proxy?.close();
      await product.dispose();
      rmSync(product.home, { recursive: true, force: true });
      throw error;
    }
  }

  /** Administrative requests bypass the browser proxy, as a separate real client does. */
  get client(): TelevisionClient {
    return new TelevisionClient(this.product.serverURL, { token: this.product.token });
  }

  url(artifactID: string, shareID?: string): string {
    return `${this.origin}/artifact/${encodeURIComponent(shareID ?? artifactID)}/index.html`;
  }

  private get origin(): string {
    return `http://${TEST_HOST}:${this.proxy.port}`;
  }

  async openApp(page: Page): Promise<void> {
    const url = new URL("/", this.origin);
    url.searchParams.set("token", this.product.token);
    await page.goto(url.toString());
    await waitForApplicationRender(page, APPLICATION_SHELL_STATES, 15_000);
    await configureTestMotion(page);
    await expect(page.locator("#app")).toHaveAttribute("data-app-state", /^(connected|empty-channel)$/);
  }

  async create(page: Page): Promise<{ artifactID: string; frame: Frame }> {
    await this.openApp(page);
    await page.getByRole("button", { name: "Toolbox", exact: true }).click();
    await expect(page.locator(".toolbox-popover")).toHaveAttribute("open", "");
    const tile = page.getByRole("gridcell", { name: this.template.name, exact: true });
    // The tile shows the template's own icon rather than the default letter.
    await expect(tile.locator("img.toolbox-icon")).toBeVisible();
    const created = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/templates/artifacts" && response.request().method() === "POST");
    await tile.click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { artifactID } = await response.json() as { artifactID: string };
    return { artifactID, frame: await this.frame(page, artifactID) };
  }

  async createStored(value?: JSONValue): Promise<string> {
    const { artifactID } = await this.client.templates.create({
      templateID: this.template.id, channelID: this.channelID, source: "cli",
    });
    if (value !== undefined) await this.set(artifactID, value);
    return artifactID;
  }

  async frame(page: Page, artifactID: string): Promise<Frame> {
    const iframe = page.locator(`.stage .page[data-page-key="${artifactID}"] iframe`);
    await expect(iframe).toBeVisible();
    const frame = await (await iframe.elementHandle())?.contentFrame();
    if (!frame) throw new Error(`Artifact ${artifactID} has no browser frame`);
    await expect.poll(() => frame.url()).toContain(`/artifact/${artifactID}/`);
    await frame.waitForLoadState("domcontentloaded");
    await this.checkSandbox(frame);
    return frame;
  }

  async open(page: Page, artifactID: string, shareID?: string): Promise<Frame> {
    await page.goto(this.url(artifactID, shareID), { waitUntil: "domcontentloaded" });
    await configureTestMotion(page);
    await this.checkSandbox(page.mainFrame());
    return page.mainFrame();
  }

  private async checkSandbox(frame: Frame): Promise<void> {
    expect(await frame.evaluate(() => window.origin)).toBe("null");
    expect(await frame.evaluate(() => window.isSecureContext)).toBe(false);
  }

  async read<T = JSONValue>(artifactID: string, jsonPath = ""): Promise<T | undefined> {
    const result = await this.client.resources.json.get({ store: { artifactID }, path: jsonPath });
    return result.exists ? result.value as T : undefined;
  }

  set(artifactID: string, value: JSONValue, jsonPath = ""): Promise<void> {
    return this.client.resources.json.set({ store: { artifactID }, path: jsonPath, value });
  }

  remove(artifactID: string, jsonPath = ""): Promise<void> {
    return this.client.resources.json.remove({ store: { artifactID }, path: jsonPath });
  }

  /** A separate ordinary page supplies the clipboard; the artifact receives real paste keys. */
  async clipboard(page: Page, text: string, html?: string): Promise<void> {
    const fixture = await page.context().newPage();
    try {
      await fixture.setContent('<textarea aria-label="Clipboard fixture"></textarea>');
      const textarea = fixture.getByRole("textbox", { name: "Clipboard fixture" });
      await textarea.fill(text);
      if (html !== undefined) {
        await fixture.evaluate(({ plain, rich }) => {
          document.addEventListener("copy", event => {
            event.clipboardData!.setData("text/plain", plain);
            event.clipboardData!.setData("text/html", rich);
            event.preventDefault();
          }, { once: true });
        }, { plain: text, rich: html });
      }
      await textarea.press("ControlOrMeta+A");
      await textarea.press("ControlOrMeta+C");
    } finally {
      await fixture.close();
      await page.bringToFront();
    }
  }

  /** Reads the real clipboard by pasting into a separate ordinary text field. */
  async readClipboard(page: Page): Promise<string> {
    const fixture = await page.context().newPage();
    try {
      await fixture.setContent('<textarea aria-label="Clipboard fixture"></textarea>');
      const textarea = fixture.getByRole("textbox", { name: "Clipboard fixture" });
      await textarea.focus();
      await textarea.press("ControlOrMeta+V");
      return await textarea.inputValue();
    } finally {
      await fixture.close();
      await page.bringToFront();
    }
  }

  contentFile(artifactID: string): string {
    const record = JSON.parse(readFileSync(path.join(this.home, "state", "artifacts", `${artifactID}.json`), "utf8")) as { store?: string };
    if (!record.store) throw new Error(`Artifact ${artifactID} has no own store`);
    return path.join(this.home, "resources", "json", record.store, "content.json");
  }

  /** The callback edits saved files only once the old process has completely stopped. */
  async restart(edit?: (home: string) => void): Promise<void> {
    await this.product.dispose();
    edit?.(this.home);
    this.product = await launchProductServer({
      home: this.home, cleanupHome: false, auth: true, bundledTemplatesBundle: TEMPLATES_BUNDLE,
    });
    this.proxy.retarget(Number(new URL(this.product.serverURL).port));
  }

  async cleanup(): Promise<void> {
    try {
      await this.proxy.close();
    } finally {
      await this.product.dispose();
      rmSync(this.home, { recursive: true, force: true });
    }
  }
}
