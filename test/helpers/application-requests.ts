import { expect, type Page, type TestInfo } from "@playwright/test";

/** Retain paths only: authentication fragments and query values are never recorded. */
export function recordApplicationRequests(pages: readonly Page[]) {
  const inventories = pages.map((page) => {
    const entries = new Set<string>();
    page.on("request", (request) => {
      entries.add(JSON.stringify({
        path: new URL(request.url()).pathname,
        type: request.resourceType(),
        application: request.frame() === page.mainFrame(),
      }));
    });
    return entries;
  });
  const snapshot = () => inventories.map((entries) => [...entries].sort().map((entry) =>
    JSON.parse(entry) as { path: string; type: string; application: boolean }
  ));
  return {
    expectBuilt(): void {
      for (const requests of snapshot()) {
        const application = requests.filter((request) => request.application);
        expect(application.some((request) => /^\/(packages|@vite|@id|@fs|node_modules)\//.test(request.path)),
          "the application loads shipped assets without development modules").toBe(false);
        expect(application.some((request) => request.type === "document" && request.path === "/")).toBe(true);
        expect(application.some((request) => request.type === "script" && /^\/assets\/.+\.js$/.test(request.path))).toBe(true);
      }
    },
    async attach(info: TestInfo): Promise<void> {
      await info.attach("application-request-inventory", {
        body: Buffer.from(JSON.stringify(snapshot(), null, 2)), contentType: "application/json",
      });
    },
  };
}
