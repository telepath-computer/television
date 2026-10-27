import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("packaged local document", () => {
  it("loads the renderer and local styles as an application document", () => {
    const html = readFileSync(new URL("../src/connect.html", import.meta.url), "utf8");
    expect(html).toContain('data-television-document="app"');
    expect(html).toContain('src="connect-page.cjs"');
    expect(html).toContain('href="connect-page.css"');
    expect(html).toContain('href="clouds/theme.css"');
    expect(html).toContain("style-src 'self' 'unsafe-inline'");
  });
});
