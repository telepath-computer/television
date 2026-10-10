import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** What the loading fixture's page reports once its script has run. */
export interface LoadingResults {
  origin: string;
  module: string;
  json: number;
  font: boolean;
  canonicalStyle: boolean;
  canonicalElement: boolean;
  store: string;
}

/**
 * Writes an HTML folder artifact whose page loads everything a sandboxed
 * artifact needs from its server (proofs/arch/artifact-frame/isolation.md
 * ^iso-t-artifacts-load): a module script that imports another from its own
 * folder, a font and a JSON file beside it, the canonical stylesheet and
 * components script, and its store through the resource SDK. The page writes
 * its results as JSON into `#results`. Returns the folder's path.
 */
export function writeLoadingFixture(folder: string): string {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Loading fixture</title>
    <link rel="stylesheet" href="/canonical/v2/styles.css">
    <link rel="stylesheet" href="own.css">
    <script type="module" src="/canonical/v2/components.js"></script>
    <script type="module" src="main.js"></script>
  </head>
  <body>
    <h1 class="own-font">Loads its own files</h1>
    <pre id="results"></pre>
  </body>
</html>
`);
  writeFileSync(path.join(folder, "own.css"), `@font-face { font-family: "OwnFont"; src: url("own-font.woff2") format("woff2"); }
.own-font { font-family: "OwnFont"; }
`);
  copyFileSync(path.join(REPO_ROOT, "packages/web/src/foundation/fonts/Hind-Variable.woff2"), path.join(folder, "own-font.woff2"));
  writeFileSync(path.join(folder, "data.json"), `{ "answer": 42 }\n`);
  writeFileSync(path.join(folder, "helper.js"), `export const value = "module ran";\n`);
  writeFileSync(path.join(folder, "main.js"), `import { value } from "./helper.js";
import { get, getStore, ref, set } from "/sdk/v1/resources.js";

const results = { origin: String(self.origin), module: value };
results.json = (await (await fetch("data.json")).json()).answer;
results.font = (await document.fonts.load('16px "OwnFont"')).length > 0;
results.canonicalStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() !== "";
results.canonicalElement = await Promise.race([
  customElements.whenDefined("tv-icon").then(() => true),
  new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
]);
const probe = ref(getStore(), "probe");
await set(probe, "round-trip");
results.store = (await get(probe)).val();
document.getElementById("results").textContent = JSON.stringify(results);
`);
  return folder;
}
