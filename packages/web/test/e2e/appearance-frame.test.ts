import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

const HTTP_OK = 200;

interface AppearanceFrameFixture {
  setPreference(preference: "system" | "light" | "dark"): void;
  hostPrefersDark(): boolean;
}

async function startCrossOriginProbe(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(HTTP_OK, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(`<!doctype html>
<html data-scheme="light" data-events="0">
  <body>Cross-origin media probe</body>
  <script>
    const query = matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    const loadID = crypto.randomUUID();
    let events = 0;
    const publish = () => {
      root.dataset.scheme = query.matches ? "dark" : "light";
      root.dataset.events = String(events);
      root.dataset.loadId = loadID;
    };
    query.addEventListener("change", () => {
      events += 1;
      publish();
    });
    publish();
  </script>
</html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("cross-origin probe did not bind a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/probe.html` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function openFixture(page: Page, baseURL: string, childURL: string): Promise<void> {
  await page.goto(
    `${baseURL}/packages/web/test/e2e/fixtures/appearance-frame.html?child=${encodeURIComponent(childURL)}`,
  );
  await expect(page.frameLocator("#appearance-child").locator("body"))
    .toHaveText("Cross-origin media probe");
}

async function setPreference(
  page: Page,
  preference: "system" | "light" | "dark",
): Promise<void> {
  await page.evaluate((nextPreference) => {
    (window as unknown as { __appearanceFrameFixture: AppearanceFrameFixture })
      .__appearanceFrameFixture.setPreference(nextPreference);
  }, preference);
}

async function hostPrefersDark(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (window as unknown as { __appearanceFrameFixture: AppearanceFrameFixture })
      .__appearanceFrameFixture.hostPrefersDark()
  );
}

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-chromium-frame
test("Chromium explicit appearance crosses into the same un-emulated cross-origin iframe", async ({
  browser,
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== "chromium", "Chromium owns the un-emulated explicit-mode contract");
  if (!baseURL) throw new Error("appearance frame fixture requires baseURL");
  const probe = await startCrossOriginProbe();
  const context = await browser.newContext({ colorScheme: null });
  const page = await context.newPage();

  try {
    await openFixture(page, baseURL, probe.url);
    const childRoot = page.frameLocator("#appearance-child").locator("html");
    const iframe = page.locator("#appearance-child");
    const initialSrc = await iframe.getAttribute("src");
    const loadID = await childRoot.getAttribute("data-load-id");

    expect(await hostPrefersDark(page)).toBe(false);
    await expect(childRoot).toHaveAttribute("data-scheme", "light");

    await setPreference(page, "dark");
    await expect(childRoot).toHaveAttribute("data-scheme", "dark");
    expect(await hostPrefersDark(page)).toBe(false);

    await setPreference(page, "light");
    await expect(childRoot).toHaveAttribute("data-scheme", "light");
    await expect.poll(async () => Number(await childRoot.getAttribute("data-events")))
      .toBeGreaterThanOrEqual(2);
    await expect(iframe).toHaveAttribute("src", initialSrc ?? probe.url);
    await expect(childRoot).toHaveAttribute("data-load-id", loadID ?? "");
  } finally {
    await context.close();
    await closeServer(probe.server);
  }
});

// spec: proofs/arch/themes/delivery.md#^theme-delivery-t-firefox-frame
test("Firefox system appearance follows emulated preference in the same cross-origin iframe", async ({
  page,
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== "firefox", "Firefox owns the emulated system-mode contract");
  if (!baseURL) throw new Error("appearance frame fixture requires baseURL");
  const probe = await startCrossOriginProbe();

  try {
    await page.emulateMedia({ colorScheme: "light" });
    await openFixture(page, baseURL, probe.url);
    const childRoot = page.frameLocator("#appearance-child").locator("html");
    const loadID = await childRoot.getAttribute("data-load-id");
    await expect(childRoot).toHaveAttribute("data-scheme", "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(childRoot).toHaveAttribute("data-scheme", "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(childRoot).toHaveAttribute("data-scheme", "light");
    await expect(childRoot).toHaveAttribute("data-load-id", loadID ?? "");
  } finally {
    await closeServer(probe.server);
  }
});
