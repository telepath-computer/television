import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function seedThemePackage(
  storagePath: string,
  themeID: string,
  css = "/* theme */\n",
  options: {
    name?: string;
    version?: string;
    authoredForAppVersion?: string;
    colorScheme?: string;
    enableMainJS?: boolean;
    enableIframeBackgroundJS?: boolean;
    enableIframeOverlayJS?: boolean;
    mainJS?: string;
    iframeBackgroundJS?: string;
    iframeOverlayJS?: string;
  } = {},
): string {
  const themeDir = path.join(storagePath, "themes", themeID);
  mkdirSync(themeDir, { recursive: true });
  writeFileSync(
    path.join(themeDir, "manifest.json"),
    `${JSON.stringify({
      name: options.name ?? themeID,
      version: options.version ?? "1.0.0",
      colorScheme: options.colorScheme ?? "light dark",
      ...(options.authoredForAppVersion === undefined
        ? {}
        : { authoredForAppVersion: options.authoredForAppVersion }),
      ...(options.enableMainJS === undefined
        ? {}
        : { enableMainJS: options.enableMainJS }),
      ...(options.enableIframeBackgroundJS === undefined
        ? {}
        : { enableIframeBackgroundJS: options.enableIframeBackgroundJS }),
      ...(options.enableIframeOverlayJS === undefined
        ? {}
        : { enableIframeOverlayJS: options.enableIframeOverlayJS }),
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(path.join(themeDir, "theme.css"), css, "utf8");
  for (const [filename, bytes] of [
    ["main.js", options.mainJS],
    ["iframe-background.js", options.iframeBackgroundJS],
    ["iframe-overlay.js", options.iframeOverlayJS],
  ] as const) {
    if (bytes !== undefined) writeFileSync(path.join(themeDir, filename), bytes, "utf8");
  }
  return themeDir;
}
