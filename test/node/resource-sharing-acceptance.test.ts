import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "playwright";
import {
  adminRoutes,
  artifactRoutes,
  encodeWriteValue,
  type PageClientMessage,
  type PageServerMessage,
} from "../../packages/shared/src/resources/index.ts";
import {
  ProductContext,
  artifactFrame,
  browserAvailable,
  createPathArtifact,
  focusedChannel,
  ok,
  openApp,
  origin,
  share,
  writeArtifactPage,
  type BuiltServer,
  type PageWindow,
  type Shot,
} from "./resource-product-harness.ts";

/*
 * Sharing and permissions across two servers, as the resources spec's
 * testing directive requires: a producer and a viewer run as separate built
 * servers with authentication on and the bindings flag off, at different
 * mapped host names. The producer shares an artifact through its share link,
 * which the viewer adds as a shared artifact; the browser holds only the
 * viewer's token and opens the viewer's app. Proves
 * [[product/resources/resources.md#^rs-ac-sharing]].
 */

const PRODUCER_HOST = "tv-producer.test";
const VIEWER_HOST = "tv-viewer.test";
const context = new ProductContext();

afterEach(async () => {
  await context.cleanup();
});

function eventually(check: () => unknown): Promise<unknown> {
  return vi.waitFor(check, { timeout: 10_000, interval: 50 });
}

/**
 * The shared page: it uses its artifact's store, and it can also open its
 * own page connection, bypassing the SDK, and send messages a test gives it
 * in the shared framing. The page sends nothing until a test asks.
 */
const SHARED_PAGE = `
window.stores = { own: sdk.getStore() };
window.rawExchange = (connectionPath, messages, answers) => new Promise((resolve) => {
  const socket = new WebSocket("ws://" + location.host + connectionPath);
  const received = [];
  const finish = () => { socket.close(); resolve(received); };
  setTimeout(finish, 5000);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "open") {
      for (const next of messages) socket.send(JSON.stringify(next));
      return;
    }
    if (message.type === "event" || message.type === "access") return;
    received.push(message);
    if (received.length === answers) finish();
  });
  socket.addEventListener("close", finish);
});
`;

interface SharedWindow extends PageWindow {
  rawExchange(connectionPath: string, messages: unknown[], answers: number): Promise<unknown[]>;
}

async function shots(frame: Frame, name: string): Promise<Shot[]> {
  return frame.evaluate((log) => (window as unknown as PageWindow).logs[log] as Shot[], name);
}

async function logged(frame: Frame, name: string): Promise<unknown[]> {
  return frame.evaluate((log) => (window as unknown as PageWindow).logs[log]!, name);
}

/** Sets `note` in the page's store through the SDK, and reports how it ended. */
function pageSet(frame: Frame, value: string) {
  return frame.evaluate((written) => {
    const page = window as unknown as PageWindow;
    return page.outcome(() => page.sdk.set(page.sdk.ref(page.stores.own!, "note"), written));
  }, value);
}

/** Registers listeners for the page's note, its errors and its access level, logged as `note`, `noteErrors` and `access`. */
function listen(frame: Frame): Promise<void> {
  return frame.evaluate(() => {
    const page = window as unknown as PageWindow;
    const { sdk } = page;
    const note = page.record("note");
    const errors = page.record("noteErrors");
    const access = page.record("access");
    sdk.onValue(sdk.ref(page.stores.own!, "note"), (snapshot) => note.push(page.shot(snapshot)), (error) => {
      errors.push((error as Error & { code?: string }).code);
    });
    sdk.onAccessChanged((current) => access.push(current));
  });
}

/** The answers the server gives a page that bypasses the SDK and sends `messages` after the opening state on its own connection under `id`. */
function rawExchange(frame: Frame, id: string, messages: PageClientMessage[]): Promise<PageServerMessage[]> {
  // The messages travel to the page as JSON text, exactly as the page sends them.
  const sent = JSON.stringify(messages);
  return frame.evaluate(({ connectionPath, text }) => {
    const parsed = JSON.parse(text) as unknown[];
    return (window as unknown as SharedWindow).rawExchange(connectionPath, parsed, parsed.length);
  }, { connectionPath: artifactRoutes.connection(id), text: sent }) as Promise<PageServerMessage[]>;
}

/** A write of `note` to the artifact's own store, in the page connection's framing. */
function rawSet(seq: number, value: string): PageClientMessage {
  return { type: "write", seq, write: { kind: "set", path: "note", value: encodeWriteValue(value) } };
}

async function storeNote(producer: BuiltServer, artifactID: string): Promise<string> {
  return (await producer.tv(["resource", "json", "get", "--artifact", artifactID, "note"])).stdout;
}

describe.each(["chromium", "firefox"] as const)("sharing and permissions across two servers (%s)", (browserName) => {
  it.skipIf(!browserAvailable(browserName))("enforces a share link's level in a shared page, including against a page that bypasses the SDK, as the level changes and the link is revoked", async () => {
    const producer = await context.serve(context.temporaryDirectory("television-resource-producer-"));
    const viewer = await context.serve(context.temporaryDirectory("television-resource-viewer-"));
    expect(producer.token).not.toBeNull();

    const folder = writeArtifactPage(context, "Shared page", SHARED_PAGE);
    const producerChannel = await focusedChannel(producer, "Produced");
    const artifactA = await createPathArtifact(producer, producerChannel, "A", folder);
    expect((await producer.tv(["resource", "json", "set", "--artifact", artifactA, '{"note":"start"}'])).exitCode).toBe(0);
    const first = await share(producer, artifactA, "read", PRODUCER_HOST);

    const viewerChannel = await focusedChannel(viewer, "Shared with me");
    const added = await viewer.tv(["create-url-artifact", "--channel", viewerChannel, "--title", "Shared A", "--url", first.link, "--no-focus"]);
    expect(added.exitCode, added.stderr).toBe(0);

    // The browser holds only the viewer's token: it opens the viewer's app and never the producer's.
    const browser = await context.launch(browserName, [PRODUCER_HOST, VIEWER_HOST]);
    const { page } = await openApp(browser, viewer, VIEWER_HOST);
    const frame = await artifactFrame(page, first.link);
    expect(await frame.evaluate(() => location.origin)).toBe(origin(producer, PRODUCER_HOST));

    // At read: the page shows the store, and its level is read.
    await listen(frame);
    await eventually(async () => {
      expect((await shots(frame, "note")).at(-1)?.value).toBe("start");
      expect(await logged(frame, "access")).toEqual(["read"]);
    });
    expect(await frame.evaluate(() => (window as unknown as PageWindow).sdk.getAccess())).toBe("read");

    // A write is refused through the SDK without being shown, and by the producer when the SDK is bypassed.
    expect(await pageSet(frame, "written by the page")).toMatchObject({ ok: false, isError: true, code: "read-only" });
    expect((await shots(frame, "note")).map((shot) => shot.value)).not.toContain("written by the page");
    expect(await rawExchange(frame, first.shareID, [rawSet(1, "written around the SDK")])).toEqual([
      { type: "refused", seq: 1, code: "read-only", error: expect.any(String) },
    ]);
    expect(await storeNote(producer, artifactA)).toBe('{"exists":true,"value":"start"}\n');

    // A change on the producer reaches the page's open listener live.
    expect(await producer.tv(["resource", "json", "set", "--artifact", artifactA, "note", '"from the producer"'])).toEqual(
      ok(`JSON store of artifact ${artifactA} updated.\n`),
    );
    await eventually(async () => expect((await shots(frame, "note")).at(-1)?.value).toBe("from the producer"));

    // At read-write, while the page stays open: the link is the same, the page hears the new level, and its write lands.
    const second = await share(producer, artifactA, "read-write", PRODUCER_HOST);
    expect(second.printed).toBe(first.printed);
    await eventually(async () => expect(await logged(frame, "access")).toEqual(["read", "read-write"]));
    expect(await pageSet(frame, "from the page")).toEqual({ ok: true, value: undefined });
    expect(await storeNote(producer, artifactA)).toBe('{"exists":true,"value":"from the page"}\n');
    await frame.evaluate(() => {
      (window as unknown as { reloading: boolean }).reloading = true;
      setTimeout(() => location.reload(), 0);
    });
    await frame.waitForFunction(() => (window as unknown as { reloading?: boolean; pageReady?: boolean }).reloading === undefined
      && (window as unknown as PageWindow).pageReady === true, undefined, { timeout: 20_000 });
    await listen(frame);
    await eventually(async () => {
      expect((await shots(frame, "note")).at(-1)?.value).toBe("from the page");
      expect(await logged(frame, "access")).toEqual(["read-write"]);
    });

    // The shared page, sandboxed by the viewer's frame and the producer's header, can use no browser storage, and its
    // request to the producer's administrative routes gives it no response.
    const reach = await frame.evaluate(async (listPath) => {
      const attempt = (use: () => unknown): string => {
        try {
          use();
          return "usable";
        } catch (error) {
          return (error as Error).name;
        }
      };
      return {
        origin: String(self.origin),
        storage: [
          attempt(() => localStorage.length),
          attempt(() => sessionStorage.length),
          attempt(() => document.cookie),
          attempt(() => indexedDB.open("probe")),
        ],
        admin: await fetch(listPath).then((response) => String(response.status), (error: Error) => error.name),
      };
    }, adminRoutes.list);
    expect(reach).toEqual({ origin: "null", storage: ["SecurityError", "SecurityError", "SecurityError", "SecurityError"], admin: "TypeError" });

    // A page on the viewer's origin that knows the share link reaches the store at the link's level, since the share ID
    // is the connection's authority, while its request to the administrative routes, without the token, changes nothing.
    const viewerOrigin = await page.evaluate(async ({ connectionURL, setURL, store }) => {
      const access = await new Promise<unknown>((resolve) => {
        const socket = new WebSocket(connectionURL);
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as { type: string; access?: unknown };
          if (message.type !== "open") return;
          socket.close();
          resolve(message.access);
        });
        socket.addEventListener("close", () => resolve("closed before its opening state"));
      });
      // A form-style request a browser sends to another origin without asking first.
      await fetch(setURL, { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ store, path: "note", value: { value: "from the viewer's origin" } }) });
      return { origin: location.origin, access };
    }, {
      connectionURL: `ws://${PRODUCER_HOST}:${producer.port}${artifactRoutes.connection(first.shareID)}`,
      setURL: `${origin(producer, PRODUCER_HOST)}${adminRoutes.jsonSet}`,
      store: { artifactID: artifactA },
    });
    expect(viewerOrigin).toEqual({ origin: origin(viewer, VIEWER_HOST), access: "read-write" });
    expect(await storeNote(producer, artifactA)).toBe('{"exists":true,"value":"from the page"}\n');

    // Revoked: the page hears that it has no access, its next operation fails, and the link's address no longer serves the artifact.
    expect(await producer.tv(["unshare-artifact", "--id", artifactA])).toEqual(ok(`Artifact ${artifactA} is no longer shared.\n`));
    await eventually(async () => expect(await logged(frame, "access")).toEqual(["read-write", null]));
    expect(await frame.evaluate(() => {
      const page = window as unknown as PageWindow;
      return page.outcome(() => page.sdk.get(page.sdk.ref(page.stores.own!, "note")));
    })).toMatchObject({ ok: false, isError: true, code: "no-store" });
    const fresh = await browser.newPage();
    const response = await fresh.goto(first.link);
    expect(response?.status()).toBe(404);
    expect(await fresh.content()).not.toContain("Shared page");
    expect(await storeNote(producer, artifactA)).toBe('{"exists":true,"value":"from the page"}\n');
  });
});
