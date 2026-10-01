import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { canonicalWrapper } from "../../src/canonical.ts";
import { Server } from "../../src/server.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../../test/helpers/theme-package.ts";

const CANONICAL_DIR = fileURLToPath(
  new URL("../../dist/canonical", import.meta.url),
);
const CANONICAL_VERSIONS = ["v1", "v2"] as const;
type CanonicalVersion = (typeof CANONICAL_VERSIONS)[number];
// Chromium serializes BlinkMacSystemFont as system-ui on macOS.
const EXPECTED_FONT_FAMILY = process.platform === "darwin"
  ? 'Hind, -apple-system, "system-ui", "Segoe UI", Helvetica, Arial, sans-serif'
  : 'Hind, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const PUBLIC_TAGS = ["tv-icon", "checkbox-list", "checkbox-item"];
const V1_ARTIFACT_FIXTURE = fileURLToPath(
  new URL("./fixtures/canonical-v1-artifact.html", import.meta.url),
);
const LOUD_THEME_CSS = `:root {
  --color-surface: rgb(250, 0, 200);
  --stranded-theme-probe: rgb(250, 0, 200);
  color-scheme: dark;
}
`;

type ExpressIncomingMessage = IncomingMessage & { originalUrl?: string };

function originalRequestPath(request: IncomingMessage, baseURL: string): string {
  const requestURL = (request as ExpressIncomingMessage).originalUrl ?? request.url ?? "/";
  return new URL(requestURL, baseURL).pathname;
}

function canonicalArtifactDocument(
  version: CanonicalVersion,
  label: string,
  includeLegacyGroundRegression = false,
): string {
  const legacyGroundRegression = includeLegacyGroundRegression
    ? "body[data-legacy-ground] { background: var(--color-bg); }"
    : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/canonical/${version}/styles.css">
    <script type="module" src="/canonical/${version}/components.js"></script>
    <style>
      :root {
        --color-text: var(--neutral-50);
        --color-surface: var(--neutral-800);
      }
      ${legacyGroundRegression}
      checkbox-item { --checkbox-color: rgb(1, 2, 3); }
    </style>
  </head>
  <body>
    <p>Hind canonical font ${label}</p>
    <tv-icon name="check" size="lg"></tv-icon>
    <checkbox-list>
      <checkbox-item checked>Complete</checkbox-item>
      <checkbox-item>Open</checkbox-item>
    </checkbox-list>
  </body>
</html>
`;
}

async function waitForCanonicalReady(
  page: Page,
  version: CanonicalVersion,
): Promise<void> {
  await page.evaluate(
    async ({ tags, version }) => {
      const stylesheet = document.querySelector<HTMLLinkElement>(
        `link[href="/canonical/${version}/styles.css"]`,
      );
      if (!stylesheet) throw new Error("canonical stylesheet link missing");
      if (!stylesheet.sheet) {
        await new Promise<void>((resolve, reject) => {
          stylesheet.addEventListener("load", () => resolve(), { once: true });
          stylesheet.addEventListener(
            "error",
            () => reject(new Error("canonical stylesheet failed to load")),
            { once: true },
          );
        });
      }
      await document.fonts.load('500 14.5px "Hind"');
      await document.fonts.ready;
      await Promise.all(tags.map((tag) => customElements.whenDefined(tag)));
    },
    { tags: PUBLIC_TAGS, version },
  );
}

async function assertCanonicalTreeLoads(
  version: CanonicalVersion,
  page: Page,
): Promise<void> {
  const storagePath = mkdtempSync(
    path.join(os.tmpdir(), "television-canonical-browser-storage-"),
  );
  const artifactPath = mkdtempSync(
    path.join(os.tmpdir(), "television-canonical-browser-artifact-"),
  );
  const canonicalVersionDir = path.join(CANONICAL_DIR, version);
  const frozen = existsSync(path.join(canonicalVersionDir, "frozen.json"));
  const canonicalBase = readFileSync(
    path.join(canonicalVersionDir, "styles.css"),
  );
  const canonicalStyles = Buffer.from(canonicalWrapper(version, frozen));
  const canonicalComponents = readFileSync(
    path.join(canonicalVersionDir, "components.js"),
  );
  const fontPaths = [
    ...canonicalBase
      .toString("utf8")
      .matchAll(
        new RegExp(
          `url\\((/canonical/${version}/fonts/[a-zA-Z0-9._-]+)\\)`,
          "g",
        ),
      ),
  ].map((match) => match[1]);
  expect(fontPaths).toHaveLength(1);
  expect(fontPaths[0]).toMatch(
    new RegExp(
      `^/canonical/${version}/fonts/Hind-Variable\\.[0-9a-f]{8}\\.woff2$`,
    ),
  );

  const firstPath = path.join(artifactPath, "first.html");
  const secondPath = path.join(artifactPath, "second.html");
  writeFileSync(
    firstPath,
    canonicalArtifactDocument(version, "first", version === "v1"),
  );
  writeFileSync(secondPath, canonicalArtifactDocument(version, "second"));

  const store = createServingStore(storagePath);
  const channel = store.listChannels()[0];
  if (!channel) throw new Error("expected the serving store's initial channel");
  const firstArtifact = store.createArtifact({
    channelID: channel.id,
    kind: "path",
    title: `Canonical ${version} first`,
    path: firstPath,
  });
  const secondArtifact = store.createArtifact({
    channelID: channel.id,
    kind: "path",
    title: `Canonical ${version} second`,
    path: secondPath,
  });
  const server = new Server({
    store,
    host: "127.0.0.1",
    port: 0,
    canonicalDir: CANONICAL_DIR,
  });

  try {
    await server.start();
    const expectedBodies = new Map<string, Buffer>([
      [`/canonical/${version}/styles.css`, canonicalStyles],
      [`/canonical/${version}/base.css`, canonicalBase],
      [`/canonical/${version}/components.js`, canonicalComponents],
      ...(!frozen ? [["/theme/theme.css", Buffer.alloc(0)] as const] : []),
      ...fontPaths.map(
        (fontPath) => [
          fontPath,
          readFileSync(
            path.join(
              canonicalVersionDir,
              fontPath.replace(`/canonical/${version}/`, ""),
            ),
          ),
        ] as const,
      ),
    ]);
    const firstResponsePromises = [...expectedBodies.keys()].map((resourcePath) =>
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === resourcePath,
      ),
    );

    const firstRequestPaths: string[] = [];
    const recordFirstRequest = (request: IncomingMessage) => {
      firstRequestPaths.push(originalRequestPath(request, server.getBaseURL()));
    };
    server.httpServer.on("request", recordFirstRequest);
    try {
      await page.goto(
        `${server.getBaseURL()}/artifact/${firstArtifact.id}/${path.basename(firstPath)}`,
      );
      await waitForCanonicalReady(page, version);
    } finally {
      server.httpServer.removeListener("request", recordFirstRequest);
    }

    const responses = await Promise.all(firstResponsePromises);
    for (const response of responses) {
      const resourcePath = new URL(response.url()).pathname;
      expect(response.status(), resourcePath).toBe(200);
      expect(await response.body(), resourcePath).toEqual(
        expectedBodies.get(resourcePath),
      );
    }
    expect(
      firstRequestPaths.filter((requestPath) => requestPath === "/theme/theme.css"),
    ).toEqual(frozen ? [] : ["/theme/theme.css"]);

    const observed = await page.evaluate((tags) => {
      const item = document.querySelector("checkbox-item[checked]");
      const icon = document.querySelector("tv-icon");
      if (!item || !icon) throw new Error("canonical element fixture missing");
      const bodyStyle = getComputedStyle(document.body);
      const surfaceBackgroundColor = bodyStyle.backgroundColor;
      const textColor = bodyStyle.color;
      document.body.toggleAttribute("data-legacy-ground", true);
      const legacyBackgroundColor = getComputedStyle(
        document.body,
      ).backgroundColor;
      const iconStyle = getComputedStyle(icon);
      const markerStyle = getComputedStyle(item, "::before");
      return {
        body: {
          paddingTop: bodyStyle.paddingTop,
          fontFamily: bodyStyle.fontFamily,
          fontSize: bodyStyle.fontSize,
          fontWeight: bodyStyle.fontWeight,
          color: textColor,
          surfaceBackgroundColor,
          legacyBackgroundColor,
        },
        fontLoaded: document.fonts.check('500 14.5px "Hind"'),
        registered: tags.map((tag) => Boolean(customElements.get(tag))),
        icon: {
          hasSvg: Boolean(icon.shadowRoot?.querySelector("svg")),
          width: iconStyle.width,
        },
        checkbox: {
          listDisplay: getComputedStyle(
            document.querySelector("checkbox-list")!,
          ).display,
          markerColor: markerStyle.backgroundColor,
        },
      };
    }, PUBLIC_TAGS);

    expect(observed).toEqual({
      body: {
        paddingTop: "0px",
        fontFamily: EXPECTED_FONT_FAMILY,
        fontSize: version === "v1" ? "14.5px" : "14px",
        fontWeight: version === "v1" ? "500" : "400",
        color: version === "v1" ? "oklch(0.985 0 none)" : "oklch(0.985 0 0)",
        surfaceBackgroundColor: version === "v1" ? "oklch(0.269 0 none)" : "rgba(0, 0, 0, 0)",
        legacyBackgroundColor: version === "v1"
          ? "oklch(0.985 0 none)"
          : "rgba(0, 0, 0, 0)",
      },
      fontLoaded: true,
      registered: [true, true, true],
      icon: { hasSvg: true, width: "24px" },
      checkbox: { listDisplay: "grid", markerColor: "rgb(1, 2, 3)" },
    });

    const secondRequestPaths: string[] = [];
    const recordRequest = (request: IncomingMessage) => {
      secondRequestPaths.push(originalRequestPath(request, server.getBaseURL()));
    };
    const stableResponsePromises = [
      `/canonical/${version}/styles.css`,
      `/canonical/${version}/components.js`,
    ].map((resourcePath) =>
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === resourcePath,
      ),
    );
    server.httpServer.on("request", recordRequest);
    try {
      await page.goto(
        `${server.getBaseURL()}/artifact/${secondArtifact.id}/${path.basename(secondPath)}`,
      );
      await waitForCanonicalReady(page, version);
      await Promise.all(stableResponsePromises);
    } finally {
      server.httpServer.removeListener("request", recordRequest);
    }

    expect(
      secondRequestPaths.filter((requestPath) =>
        requestPath.startsWith(`/canonical/${version}/fonts/`),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        (tags) => ({
          fontLoaded: document.fonts.check('500 14.5px "Hind"'),
          registered: tags.map((tag) => Boolean(customElements.get(tag))),
          fontFamily: getComputedStyle(document.body).fontFamily,
        }),
        PUBLIC_TAGS,
      ),
    ).toEqual({
      fontLoaded: true,
      registered: [true, true, true],
      fontFamily: EXPECTED_FONT_FAMILY,
    });
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(artifactPath, { recursive: true, force: true });
  }
}

for (const version of CANONICAL_VERSIONS) {
  test(
    `an artifact loads the fresh canonical ${version} tree through the production server`,
    async ({ page }) => assertCanonicalTreeLoads(version, page),
  );
}

test("frozen v1 stays fixed light while live v2 receives the active theme", async ({
  page,
}) => {
  const storagePath = mkdtempSync(
    path.join(os.tmpdir(), "television-stranded-v1-storage-"),
  );
  const artifactPath = mkdtempSync(
    path.join(os.tmpdir(), "television-stranded-v1-artifact-"),
  );
  const v2Path = path.join(artifactPath, "canonical-v2-artifact.html");
  writeFileSync(
    v2Path,
    readFileSync(V1_ARTIFACT_FIXTURE, "utf8")
      .replaceAll("/canonical/v1/", "/canonical/v2/")
      .replace("Frozen canonical v1", "Live canonical v2"),
  );
  seedThemePackage(storagePath, "loud", LOUD_THEME_CSS);

  const store = createServingStore(storagePath);
  store.patchDisplay({ activeThemeName: "loud" });
  const channel = store.listChannels()[0];
  if (!channel) throw new Error("expected the serving store's initial channel");
  const v1Artifact = store.createArtifact({
    channelID: channel.id,
    kind: "path",
    title: "Frozen canonical v1",
    path: V1_ARTIFACT_FIXTURE,
  });
  const v2Artifact = store.createArtifact({
    channelID: channel.id,
    kind: "path",
    title: "Live canonical v2",
    path: v2Path,
  });
  const server = new Server({
    store,
    host: "127.0.0.1",
    port: 0,
    canonicalDir: CANONICAL_DIR,
  });

  async function loadProbe(
    artifactID: string,
    artifactFile: string,
  ): Promise<{
    requestPaths: string[];
    backgroundColor: string;
    probeColor: string;
    colorScheme: string;
  }> {
    const requestPaths: string[] = [];
    const recordRequest = (request: IncomingMessage) => {
      requestPaths.push(originalRequestPath(request, server.getBaseURL()));
    };
    server.httpServer.on("request", recordRequest);
    try {
      await page.goto(
        `${server.getBaseURL()}/artifact/${artifactID}/${path.basename(artifactFile)}`,
      );
      await page.evaluate(async () => {
        await document.fonts.load('500 14.5px "Hind"');
        await document.fonts.ready;
        await customElements.whenDefined("tv-icon");
      });
    } finally {
      server.httpServer.removeListener("request", recordRequest);
    }

    return page.evaluate((observedRequestPaths) => {
      const probe = document.querySelector<HTMLElement>(".canonical-probe");
      if (!probe) throw new Error("canonical stranding probe missing");
      const style = getComputedStyle(probe);
      return {
        requestPaths: observedRequestPaths,
        backgroundColor: style.backgroundColor,
        probeColor: style.color,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      };
    }, requestPaths);
  }

  try {
    await server.start();
    await page.emulateMedia({ colorScheme: "dark" });

    const v1 = await loadProbe(v1Artifact.id, V1_ARTIFACT_FIXTURE);
    expect(v1.requestPaths).toEqual(expect.arrayContaining([
      "/canonical/v1/styles.css",
      "/canonical/v1/base.css",
      "/canonical/v1/components.js",
      "/canonical/v1/fonts/Hind-Variable.933e9900.woff2",
    ]));
    expect(v1.requestPaths).not.toContain("/theme/theme.css");
    expect(v1).toMatchObject({
      backgroundColor: "rgb(255, 255, 255)",
      probeColor: "rgb(1, 2, 3)",
      colorScheme: "light",
    });

    const v2 = await loadProbe(v2Artifact.id, v2Path);
    expect(v2.requestPaths).toContain("/theme/theme.css");
    expect(v2).toMatchObject({
      backgroundColor: "rgb(250, 0, 200)",
      probeColor: "rgb(250, 0, 200)",
      colorScheme: "dark",
    });
  } finally {
    await server.dispose();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(artifactPath, { recursive: true, force: true });
  }
});
