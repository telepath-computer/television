import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { createRequire, findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ViteDevServer } from "vite";
import frameset from "frameset/vite";
import type { TabPage } from "@telepath-computer/television-shared";

// Bake script coverage (proofs/arch/onboarding/bake.md): every
// assertion drives the real script — spawned as a real process with real argv
// and exit codes — with no mocks: the real render pipeline, really-built
// skill assets (the real skills build runs when dist is absent), and the real
// validator. The root options are the sanctioned fixture mechanism: --root
// points at disposable content trees; --designs/--skills-dist at fixture
// roots where a scenario needs authored designs. No test writes the
// production content tree.

const REPO_ROOT = path.resolve(process.cwd());
const SCRIPT = path.join(REPO_ROOT, "scripts", "bake-onboarding.mjs");
const PRODUCTION_ASSETS = path.join(REPO_ROOT, "packages", "server", "assets", "onboarding-channels");
const DESIGN_ROOT = path.join(REPO_ROOT, "specs", "ui", "onboarding-artifacts");
const SKILLS_DIST = path.join(REPO_ROOT, "packages", "skills", "dist");
const DATE_MODULE = path.join(REPO_ROOT, "packages", "server", "assets", "onboarding-relative-dates.js");
const TODO_MODULE = path.join(REPO_ROOT, "packages", "server", "assets", "onboarding-company-todos.js");
const VALIDATOR = path.join(REPO_ROOT, "packages", "server", "scripts", "validate-onboarding.mjs");

// The real design channels, derived from the design root at runtime: every
// directory carrying a channel manifest.
const designChannels = readdirSync(DESIGN_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(DESIGN_ROOT, e.name, "layout.yml")))
  .map((e) => e.name)
  .sort();

type ManifestCard = {
  id: string;
  slug: string;
  title: string;
  skill?: string;
  components?: boolean;
  size?: TabPage["size"];
  geometry?: TabPage["geometry"];
  store?: unknown;
};
type Manifest = { name: string; cards: ManifestCard[] };

function readManifest(designRoot: string, channel: string): Manifest {
  return parseYaml(readFileSync(path.join(designRoot, channel, "layout.yml"), "utf8")) as Manifest;
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A disposable copy of the shipped content tree as the starting --root. */
function shippedTreeCopy(): string {
  const dir = path.join(tempDir("tv-bake-root-"), "onboarding-channels");
  cpSync(PRODUCTION_ASSETS, dir, { recursive: true });
  return dir;
}

function runBake(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [SCRIPT, ...args], { encoding: "utf8", cwd: REPO_ROOT, env });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runValidator(root: string): { status: number | null; stderr: string } {
  const result = spawnSync("node", [VALIDATOR, root], { encoding: "utf8", cwd: REPO_ROOT });
  return { status: result.status, stderr: result.stderr ?? "" };
}

/** Byte snapshot of a tree: sorted relative path -> base64 contents. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else out[relPath] = readFileSync(path.join(dir, relPath)).toString("base64");
    }
  };
  walk("");
  return out;
}

// The byte-exact document shell (specs/arch/onboarding/bake.md#^baked-shell),
// assembled independently here from the spec's serialization so the test does
// not trust the script's own assembly.
function escapeTitle(title: string): string {
  return title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shellDoc(
  title: string,
  opts: { components?: boolean; skillCss?: string[]; skillJs?: string[]; relativeDates?: boolean; todoStore?: boolean },
  rendering: { markup: string; style?: string },
): string {
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeTitle(title)}</title>`,
    '<link rel="stylesheet" href="/canonical/v2/styles.css">',
    ...(opts.relativeDates ? ['<script type="module" src="./onboarding-relative-dates.js"></script>'] : []),
    ...(opts.todoStore ? ['<script type="module" src="./onboarding-company-todos.js"></script>'] : []),
    ...(opts.components !== false ? ['<script type="module" src="/canonical/v2/components.js"></script>'] : []),
    ...(opts.skillCss ?? []).map((f) => `<link rel="stylesheet" href="./${f}">`),
    ...(opts.skillJs ?? []).map((f) => `<script type="module" src="./${f}"></script>`),
    ...(rendering.style === undefined ? [] : ["<style>", rendering.style, "</style>"]),
    "</head>",
    "<body>",
    rendering.markup,
    "</body>",
    "</html>",
  ];
  return lines.join("\n") + "\n";
}

// The canonical config serialization
// (specs/arch/onboarding/bake.md#^config-update): 2-space JSON, trailing
// newline, keys in schema-declared order — mirrored here independently.
const KEY_ORDERS: Record<string, string[]> = {
  config: ["version", "focusChannel", "channels"],
  channel: ["slug", "name", "artifacts"],
  artifact: ["slug", "title", "size", "geometry", "store"],
  size: ["width", "height"],
  geometry: ["kind", "full_screen"],
  store: ["value", "shiftDatesFrom"],
};

function ordered(value: unknown, kind: string): unknown {
  if (Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  const keys = KEY_ORDERS[kind] ?? Object.keys(obj);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const field = obj[key];
    if (field === undefined) continue;
    out[key] =
      kind === "artifact" &&
      (key === "size" || key === "geometry" || key === "store") &&
      typeof field === "object" &&
      field !== null &&
      !Array.isArray(field)
        ? ordered(field, key)
        : field;
  }
  for (const key of Object.keys(obj)) if (!(key in out)) out[key] = obj[key];
  return out;
}

function canonicalConfig(config: {
  version: number;
  focusChannel: string;
  channels: Array<{ slug: string; name: string; artifacts: unknown[] }>;
}): string {
  const shaped = ordered(
    {
      ...config,
      channels: config.channels.map((channel) =>
        ordered(
          {
            ...channel,
            artifacts: channel.artifacts.map((artifact) => ordered(artifact, "artifact")),
          },
          "channel",
        ),
      ),
    },
    "config",
  );
  return JSON.stringify(shaped, null, 2) + "\n";
}

// --- fixture builders -------------------------------------------------------

/** A minimal valid content tree: one hand-authored channel. */
function minimalContentTree(dir: string): void {
  mkdirSync(path.join(dir, "alpha"), { recursive: true });
  writeFileSync(path.join(dir, "alpha", "intro.html"), "<p>alpha intro</p>\n");
  writeFileSync(
    path.join(dir, "onboarding-channels.json"),
    canonicalConfig({
      version: 3,
      focusChannel: "alpha",
      channels: [
        {
          slug: "alpha",
          name: "Alpha",
          artifacts: [{ slug: "intro", title: "Intro" }],
        },
      ],
    }),
  );
}

type FixtureFiles = Record<string, string>;

/** Writes one fixture design channel; returns nothing (paths derive from root). */
function writeDesign(designRoot: string, channel: string, manifest: unknown, files: FixtureFiles): void {
  const channelDir = path.join(designRoot, channel);
  mkdirSync(channelDir, { recursive: true });
  // JSON is valid YAML, and it round-trips every fixture type distinction
  // (non-string, non-integer, non-boolean) unambiguously. A string manifest
  // is written raw, for malformed-manifest fixtures.
  const manifestText = typeof manifest === "string" ? manifest : JSON.stringify(manifest) + "\n";
  writeFileSync(path.join(channelDir, "layout.yml"), manifestText);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(channelDir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function validCard(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id: "main", slug: "main-card", title: "Main Card", ...overrides };
}

function validManifest(cards: Array<Record<string, unknown>> = [validCard()]): unknown {
  return { name: "Fixture", cards };
}

const FRAME = "<main><h1>Fixture</h1></main>\n";

function styledFrame(style: string, body = FRAME): string {
  return `---\n${JSON.stringify({ style })}\n---\n${body}`;
}

/** One valid fixture design channel named `screen-one`. */
function standardFixtureEnv(): { root: string; designs: string } {
  const base = tempDir("tv-bake-fixture-");
  const root = path.join(base, "content");
  const designs = path.join(base, "designs");
  mkdirSync(root, { recursive: true });
  mkdirSync(designs, { recursive: true });
  minimalContentTree(root);
  writeDesign(designs, "screen-one", validManifest(), { "main-card.frame": FRAME });
  return { root, designs };
}

/** A fixture skills dist with one valid built skill. */
function fixtureSkillsDist(): string {
  const dist = path.join(tempDir("tv-bake-skills-"), "dist");
  mkdirSync(path.join(dist, "fixture-skill"), { recursive: true });
  writeFileSync(path.join(dist, "fixture-skill", "skill.css"), ".fixture-skill { color: green; }\n");
  writeFileSync(path.join(dist, "fixture-skill", "skill.js"), "export {};\n");
  writeFileSync(path.join(dist, "fixture-skill", "SKILL.md"), "# fixture skill\n");
  return dist;
}

// --- independent rendering through the spec machinery -----------------------

let vite: ViteDevServer | undefined;

async function renderFrame(absPath: string): Promise<{ markup: string; style?: string }> {
  if (!vite) {
    // Frameset owns its Vite dependency; the app's older Vite cannot load its
    // virtual CSS modules through SSR. Keep this independent of the bake.
    const { createServer } = await import(pathToFileURL(
      createRequire(findPackageJSON("frameset", import.meta.url)!).resolve("vite"),
    ).href);
    vite = await createServer({
      configFile: false,
      root: REPO_ROOT,
      cacheDir: path.join(tempDir("tv-bake-vite-"), "cache"),
      plugins: [frameset()],
      server: { middlewareMode: true, hmr: false, watch: null, ws: false },
      appType: "custom",
      logLevel: "error",
    });
  }
  const mod = (await vite!.ssrLoadModule(absPath)) as {
    default: { render(): string; style?: string };
  };
  return { markup: mod.default.render(), style: mod.default.style };
}

beforeAll(() => {
  // Really-built skill assets: the harness runs the real skills build when
  // the dist is absent (proofs/arch/onboarding/bake.md#^t-baked-content).
  const needed = new Set<string>();
  for (const channel of designChannels) {
    for (const card of readManifest(DESIGN_ROOT, channel).cards) if (card.skill) needed.add(card.skill);
  }
  const missing = [...needed].filter((skill) => !existsSync(path.join(SKILLS_DIST, skill)));
  if (missing.length > 0) {
    const build = spawnSync("node", [path.join(REPO_ROOT, "packages", "skills", "scripts", "build.mjs")], {
      encoding: "utf8",
      cwd: path.join(REPO_ROOT, "packages", "skills"),
    });
    if (build.status !== 0) throw new Error(`skills build failed: ${build.stderr}`);
  }
}, 120_000);

afterAll(async () => {
  await vite?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// --- acceptance (specs/arch/onboarding/bake.md, spawned-script boundary) ----

describe("bake acceptance", () => {
  // ^t-bake-succeeds
  it("bakes every design channel into a shipped-tree copy and the result passes build validation", () => {
    const root = shippedTreeCopy();
    const result = runBake([...designChannels, "--root", root]);
    expect(result.status, result.stderr).toBe(0);
    const validation = runValidator(root);
    expect(validation.status, validation.stderr).toBe(0);

    const config = JSON.parse(readFileSync(path.join(root, "onboarding-channels.json"), "utf8")) as {
      channels: Array<{
        slug: string;
        artifacts: Array<Pick<ManifestCard, "slug" | "title" | "size" | "geometry" | "store">>;
      }>;
    };
    for (const channel of designChannels) {
      const manifest = readManifest(DESIGN_ROOT, channel);
      const expectedArtifacts = manifest.cards.map(({ slug, title, size, geometry, store }) => ({
        slug,
        title,
        ...(size === undefined ? {} : { size }),
        ...(geometry === undefined ? {} : { geometry }),
        ...(store === undefined ? {} : { store }),
      }));
      expect(config.channels.find((entry) => entry.slug === channel)?.artifacts, channel).toEqual(
        expectedArtifacts,
      );
    }
  });

  // ^t-bake-rejects
  it("rejects an unknown design channel with a nonzero exit and writes nothing", () => {
    const root = shippedTreeCopy();
    const before = snapshot(root);
    const result = runBake(["no-such-screen", "--root", root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-such-screen");
    expect(snapshot(root)).toEqual(before);
  });

  // ^t-bake-validation-exit — also the real crossing of the bake → validator
  // handoff: the starting tree carries an authored defect in a channel the
  // invocation does not name. The baked channel does NOT pre-exist in the
  // starting tree, so its presence afterwards proves the write really
  // happened before the validator's nonzero exit.
  it("surfaces a post-write validation failure as a nonzero exit, leaving the written output in place", () => {
    const { root, designs } = standardFixtureEnv();
    writeFileSync(path.join(root, "alpha", "stray.txt"), "orphan\n");
    const result = runBake(["screen-one", "--root", root, "--designs", designs]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unreferenced|invalid/i);
    // The baked artifact and config entry were written and left in place.
    expect(readFileSync(path.join(root, "screen-one", "main-card.html"), "utf8")).toContain("<h1>Fixture</h1>");
    const config = JSON.parse(readFileSync(path.join(root, "onboarding-channels.json"), "utf8")) as {
      channels: Array<{ slug: string }>;
    };
    expect(config.channels.map((s) => s.slug)).toEqual(["alpha", "screen-one"]);
  });
});

// --- contracts (producer side; expectations derived at runtime) -------------

describe("baked artifact content (^t-baked-content)", () => {
  const root = shippedTreeCopy();

  beforeAll(() => {
    const result = runBake([...designChannels, "--root", root]);
    expect(result.status, result.stderr).toBe(0);
  }, 120_000);

  it("produces, for each source shape, exactly the design source's packaged form", async () => {
    for (const channel of designChannels) {
      const manifest = readManifest(DESIGN_ROOT, channel);
      for (const card of manifest.cards) {
        const sourceBase = path.join(DESIGN_ROOT, channel, card.slug);
        const contentMd = `${sourceBase}.md`;
        if (existsSync(contentMd)) {
          // Markdown artifact: byte-identical copy.
          const baked = readFileSync(path.join(root, channel, `${card.slug}.md`));
          expect(baked.equals(readFileSync(contentMd)), `${channel}/${card.slug}`).toBe(true);
          continue;
        }
        const rendering = await renderFrame(`${sourceBase}.frame`);
        if (card.skill) {
          // Directory artifact: complete file set = index.html + permitted
          // dist files; every copied asset byte-identical; links in order.
          const distDir = path.join(SKILLS_DIST, card.skill);
          const distFiles = readdirSync(distDir)
            .filter((f) => f !== "SKILL.md")
            .sort();
          const bakedDir = path.join(root, channel, card.slug);
          const relativeDates = channel === "productivity" && card.slug === "todays-calendar";
          const todoStore = channel === "productivity" && card.slug === "company-todos";
          expect(readdirSync(bakedDir).sort(), `${channel}/${card.slug}`).toEqual(
            [
              "index.html",
              ...distFiles,
              ...(relativeDates ? ["onboarding-relative-dates.js"] : []),
              ...(todoStore ? ["onboarding-company-todos.js"] : []),
            ].sort(),
          );
          for (const file of distFiles) {
            expect(
              readFileSync(path.join(bakedDir, file)).equals(readFileSync(path.join(distDir, file))),
              `${channel}/${card.slug}/${file}`,
            ).toBe(true);
          }
          // proofs/arch/onboarding/bake.md#^t-relative-dates-module
          if (relativeDates) {
            expect(
              readFileSync(path.join(bakedDir, "onboarding-relative-dates.js")).equals(readFileSync(DATE_MODULE)),
              `${channel}/${card.slug}/onboarding-relative-dates.js`,
            ).toBe(true);
          }
          // proofs/arch/onboarding/bake.md#^t-todo-store-module
          if (todoStore) {
            expect(
              readFileSync(path.join(bakedDir, "onboarding-company-todos.js")).equals(readFileSync(TODO_MODULE)),
              `${channel}/${card.slug}/onboarding-company-todos.js`,
            ).toBe(true);
          }
          const expected = shellDoc(
            card.title,
            {
              components: card.components,
              skillCss: distFiles.filter((f) => f.endsWith(".css")),
              skillJs: distFiles.filter((f) => f.endsWith(".js")),
              relativeDates,
              todoStore,
            },
            rendering,
          );
          expect(readFileSync(path.join(bakedDir, "index.html"), "utf8"), `${channel}/${card.slug}`).toBe(expected);
        } else {
          // Single-file HTML artifact: the shell wrapping the machinery's
          // own rendering, obtained independently above.
          const expected = shellDoc(card.title, { components: card.components }, rendering);
          expect(readFileSync(path.join(root, channel, `${card.slug}.html`), "utf8"), `${channel}/${card.slug}`).toBe(
            expected,
          );
        }
      }
    }
  }, 120_000);

  it("escapes HTML special characters in the serialized title and keeps the config title raw", () => {
    const { root: fixtureRoot, designs } = standardFixtureEnv();
    const title = `Fix & <Title> "q" 'a'`;
    writeDesign(designs, "escape-screen", validManifest([validCard({ id: "esc", slug: "esc-card", title })]), {
      "esc-card.frame": FRAME,
    });
    const result = runBake(["escape-screen", "--root", fixtureRoot, "--designs", designs]);
    expect(result.status, result.stderr).toBe(0);
    const baked = readFileSync(path.join(fixtureRoot, "escape-screen", "esc-card.html"), "utf8");
    expect(baked).toContain(`<title>Fix &amp; &lt;Title&gt; &quot;q&quot; &#39;a&#39;</title>`);
    const config = JSON.parse(readFileSync(path.join(fixtureRoot, "onboarding-channels.json"), "utf8")) as {
      channels: Array<{ slug: string; artifacts: Array<{ title: string }> }>;
    };
    expect(config.channels.find((s) => s.slug === "escape-screen")!.artifacts[0]!.title).toBe(title);
  });
});

// ^t-custom-design-root — the whole of design-root resolution, positively.
describe("custom design root (^t-custom-design-root)", () => {
  it("renders a flat frame with inline styles and copies flat Markdown from a custom root", async () => {
    const { root, designs } = standardFixtureEnv();
    const markdown = "# Fixture notes\r\n\r\nKeep these exact bytes.\r\n";
    writeDesign(
      designs,
      "custom-screen",
      validManifest([
        validCard({ id: "custom", slug: "custom-card", title: "Custom Main" }),
        validCard({ id: "notes", slug: "notes", title: "Notes" }),
      ]),
      {
        "custom-card.frame": styledFrame(".fixture-local-style { color: red; }\n", "<main><h1>Fixture Heading Value</h1></main>"),
        "notes.md": markdown,
      },
    );
    const result = runBake(["custom-screen", "--root", root, "--designs", designs]);
    expect(result.status, result.stderr).toBe(0);
    const baked = readFileSync(path.join(root, "custom-screen", "custom-card.html"), "utf8");
    const rendering = await renderFrame(path.join(designs, "custom-screen", "custom-card.frame"));
    expect(baked).toBe(shellDoc("Custom Main", {}, rendering));
    expect(readFileSync(path.join(root, "custom-screen", "notes.md"), "utf8")).toBe(markdown);
  });
});

describe("optional frame styles and canonical components (^t-baked-content)", () => {
  it.each([
    { name: "absent", style: undefined, components: undefined },
    { name: "empty", style: "", components: true },
    { name: "nonempty", style: "main { color: red; }\n", components: false },
  ])("serializes the exact shell with $name style", async ({ style, components }) => {
    const { root, designs } = standardFixtureEnv();
    writeDesign(designs, "screen-one", validManifest([validCard({ components })]), {
      "main-card.frame": style === undefined ? FRAME : styledFrame(style),
    });
    const result = runBake(["screen-one", "--root", root, "--designs", designs]);
    expect(result.status, result.stderr).toBe(0);
    const rendering = await renderFrame(path.join(designs, "screen-one", "main-card.frame"));
    expect(readFileSync(path.join(root, "screen-one", "main-card.html"), "utf8")).toBe(
      shellDoc("Main Card", { components }, rendering),
    );
  });
});

it("keeps render examples in raw and comment blocks inert", () => {
  const { root, designs } = standardFixtureEnv();
  const example = "{% render '../not-a-frame.frame' %}";
  writeDesign(designs, "screen-one", validManifest(), {
    "main-card.frame": `<p>{% raw %}${example}{% endraw %}</p>\n{% comment %}${example}{% endcomment %}\n`,
  });
  const result = runBake(["screen-one", "--root", root, "--designs", designs]);
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(path.join(root, "screen-one", "main-card.html"), "utf8")).toContain(`<p>${example}</p>`);
});

// ^t-self-containment-exemptions — every permitted or non-reference form in
// one authored stylesheet bakes successfully.
describe("self-containment exemptions (^t-self-containment-exemptions)", () => {
  it("accepts data: URIs and fragments in either case, and ignores comments and quoted string values", () => {
    const { root, designs } = standardFixtureEnv();
    writeDesign(designs, "exempt-screen", validManifest([validCard({ id: "ex", slug: "ex-card", title: "Exempt" })]), {
      "ex-card.frame": styledFrame([
        ".a { background: url(data:image/png;base64,AAAA); }",
        ".b { background: URL(DATA:image/gif;base64,AA==); }",
        ".c { fill: url(#gradient); }",
        ".d { fill: URL(#Gradient); }",
        '.e { background: url("\\64 ata:image/png;base64,AAAA"); }',
        '.f { fill: url("\\23 gradient"); }',
        '.g { background: url("da\\\r\nta:image/png,AA"); }',
        '/* @import "https://example.com/x.css"; */',
        '.h::before { content: "url(https://example.com/x.png)"; }',
        '.i { background-image: image-set(url(#frag) 1x type("image/png")); }',
        ".j { --token: éurl(https://example.com/x.png); }",
        "",
      ].join("\n")),
    });
    const result = runBake(["exempt-screen", "--root", root, "--designs", designs]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(root, "exempt-screen", "ex-card.html"), "utf8")).toContain("url(#gradient)");
  });
});

// A Vite dev server rooted at this checkout keeps its optimized dependencies
// in node_modules/.vite by default. The bake's renderer must not write there:
// the browser-app e2e server serves from that cache while another test in its
// Playwright run bakes onboarding content.
describe("renderer cache isolation (^t-renderer-cache)", () => {
  it("leaves the checkout's shared Vite cache untouched and removes its own cache", () => {
    const sharedCache = path.join(REPO_ROOT, "node_modules", ".vite");
    const cacheEntries = () => existsSync(sharedCache)
      ? readdirSync(sharedCache).sort().map((name) => `${name}@${lstatSync(path.join(sharedCache, name)).ino}`)
      : [];
    const tmp = tempDir("tv-bake-tmpdir-");
    const { root, designs } = standardFixtureEnv();
    const before = cacheEntries();
    const result = runBake(["screen-one", "--root", root, "--designs", designs], { ...process.env, TMPDIR: tmp });
    expect(result.status, result.stderr).toBe(0);
    expect(cacheEntries()).toEqual(before);
    expect(readdirSync(tmp)).toEqual([]);
  });
});

// The multi-file link sequence of ^t-baked-content's shell claim: several
// same-extension skill files, created out of filename order, must link in
// ascending byte order — stylesheets before scripts.
describe("skill link ordering (^t-baked-content)", () => {
  it("links multiple same-extension skill files in byte order of their names", () => {
    const { root, designs } = standardFixtureEnv();
    const dist = path.join(tempDir("tv-bake-order-skill-"), "dist");
    mkdirSync(path.join(dist, "order-skill"), { recursive: true });
    // Created deliberately out of the expected order.
    writeFileSync(path.join(dist, "order-skill", "z-late.css"), ".z {}\n");
    writeFileSync(path.join(dist, "order-skill", "m-mid.js"), "export {};\n");
    writeFileSync(path.join(dist, "order-skill", "a-early.css"), ".a {}\n");
    writeFileSync(path.join(dist, "order-skill", "b-first.js"), "export {};\n");
    writeDesign(
      designs,
      "order-screen",
      validManifest([validCard({ id: "ord", slug: "ord-card", title: "Ordered", skill: "order-skill" })]),
      { "ord-card.frame": FRAME },
    );
    const result = runBake(["order-screen", "--root", root, "--designs", designs, "--skills-dist", dist]);
    expect(result.status, result.stderr).toBe(0);
    const baked = readFileSync(path.join(root, "order-screen", "ord-card", "index.html"), "utf8");
    expect(baked).toContain(
      [
        '<link rel="stylesheet" href="./a-early.css">',
        '<link rel="stylesheet" href="./z-late.css">',
        '<script type="module" src="./b-first.js"></script>',
        '<script type="module" src="./m-mid.js"></script>',
      ].join("\n"),
    );
    expect(readdirSync(path.join(root, "order-screen", "ord-card")).sort()).toEqual([
      "a-early.css",
      "b-first.js",
      "index.html",
      "m-mid.js",
      "z-late.css",
    ]);
  });
});

// The shared TypeScript layout validator needs native type stripping.
describe("Node toolchain guard", () => {
  it("fails with the capability error when type stripping is disabled, before reading any input", () => {
    // Deliberately invalid roots: an implementation that read any input
    // before the capability check would report these instead.
    const result = spawnSync(
      "node",
      [
        "--no-experimental-strip-types",
        SCRIPT,
        "some-screen",
        "--root",
        "/nonexistent-bake-root",
        "--designs",
        "/nonexistent-bake-designs",
        "--skills-dist",
        "/nonexistent-bake-skills",
      ],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr ?? "").toMatch(/Node 24/i);
    expect(result.stderr ?? "").toMatch(/type stripping/i);
    expect(result.stderr ?? "").not.toMatch(/22\.18|nonexistent-bake/);
  });
});

// ^t-config-update
describe("config update (^t-config-update)", () => {
  it("appends new entries in invocation order with names seeded from the manifests", () => {
    const { root, designs } = standardFixtureEnv();
    writeDesign(
      designs,
      "screen-two",
      {
        name: "Second Fixture",
        cards: [
          validCard({
            id: "two-b",
            slug: "two-b",
            title: "Two B",
            size: { height: 640.25, width: 960.5 },
            geometry: { full_screen: false, kind: "single" },
          }),
          validCard({
            id: "two-a",
            slug: "two-a",
            title: "Two A",
            geometry: { kind: "single", full_screen: true },
            // Authored out of the schema's key order, with a value whose own key order is its data.
            store: { shiftDatesFrom: "2026-07-08", value: { b: 1, a: [2, { d: null, c: true }] } },
          }),
        ],
      },
      {
        "two-b.frame": FRAME,
        "two-a.frame": FRAME,
      },
    );
    const result = runBake(["screen-two", "screen-one", "--root", root, "--designs", designs]);
    expect(result.status, result.stderr).toBe(0);

    const expectedConfig = canonicalConfig({
      version: 3,
      focusChannel: "alpha",
      channels: [
        {
          slug: "alpha",
          name: "Alpha",
          artifacts: [{ slug: "intro", title: "Intro" }],
        },
        {
          slug: "screen-two",
          name: "Second Fixture",
          artifacts: [
            {
              slug: "two-b",
              title: "Two B",
              size: { width: 960.5, height: 640.25 },
              geometry: { kind: "single", full_screen: false },
            },
            {
              slug: "two-a",
              title: "Two A",
              geometry: { kind: "single", full_screen: true },
              store: { value: { b: 1, a: [2, { d: null, c: true }] }, shiftDatesFrom: "2026-07-08" },
            },
          ],
        },
        {
          slug: "screen-one",
          name: "Fixture",
          artifacts: [{ slug: "main-card", title: "Main Card" }],
        },
      ],
    });
    expect(readFileSync(path.join(root, "onboarding-channels.json"), "utf8")).toBe(expectedConfig);
  });

  it("rewrites an existing entry's artifacts and folder while keeping its name and position", async () => {
    const { root, designs } = standardFixtureEnv();
    // The design channel already shipped: custom hand-edited name, non-final
    // position, and a stale artifact source in its folder.
    mkdirSync(path.join(root, "screen-one"), { recursive: true });
    writeFileSync(path.join(root, "screen-one", "stale.html"), "<p>stale</p>\n");
    const startingConfig = {
      version: 3,
      focusChannel: "alpha",
      channels: [
        {
          slug: "screen-one",
          name: "Custom Name",
          artifacts: [{ slug: "stale", title: "Stale" }],
        },
        {
          slug: "alpha",
          name: "Alpha",
          artifacts: [{ slug: "intro", title: "Intro" }],
        },
      ],
    };
    writeFileSync(path.join(root, "onboarding-channels.json"), canonicalConfig(startingConfig));
    const alphaBefore = snapshot(path.join(root, "alpha"));

    const result = runBake(["screen-one", "--root", root, "--designs", designs]);
    expect(result.status, result.stderr).toBe(0);

    // Raw canonical bytes: key order, indentation, trailing newline included.
    const expectedConfig = canonicalConfig({
      version: 3,
      focusChannel: "alpha",
      channels: [
        {
          slug: "screen-one",
          name: "Custom Name",
          artifacts: [{ slug: "main-card", title: "Main Card" }],
        },
        startingConfig.channels[1]!,
      ],
    });
    expect(readFileSync(path.join(root, "onboarding-channels.json"), "utf8")).toBe(expectedConfig);
    // Folder rewritten whole: the stale source is gone, the baked one present.
    expect(existsSync(path.join(root, "screen-one", "stale.html"))).toBe(false);
    const rendering = await renderFrame(path.join(designs, "screen-one", "main-card.frame"));
    expect(readFileSync(path.join(root, "screen-one", "main-card.html"), "utf8")).toBe(
      shellDoc("Main Card", {}, rendering),
    );
    // Unbaked folder byte-identical.
    expect(snapshot(path.join(root, "alpha"))).toEqual(alphaBefore);
  });
});

// ^t-bake-deterministic
describe("determinism (^t-bake-deterministic)", () => {
  it("produces byte-identical trees across roots and re-bakes", () => {
    const rootA = shippedTreeCopy();
    const rootB = shippedTreeCopy();
    const first = runBake([...designChannels, "--root", rootA]);
    expect(first.status, first.stderr).toBe(0);
    const second = runBake([...designChannels, "--root", rootB]);
    expect(second.status, second.stderr).toBe(0);
    expect(snapshot(rootA)).toEqual(snapshot(rootB));
    // The compared bytes include both production modules.
    expect(Object.keys(snapshot(rootA))).toEqual(
      expect.arrayContaining([
        "productivity/company-todos/onboarding-company-todos.js",
        "productivity/todays-calendar/onboarding-relative-dates.js",
      ]),
    );
    const again = runBake([...designChannels, "--root", rootA]);
    expect(again.status, again.stderr).toBe(0);
    expect(snapshot(rootA)).toEqual(snapshot(rootB));
  }, 180_000);
});

// ^t-input-contract — one fixture per independent branch of every input
// contract rule (specs/arch/onboarding/bake.md#^input-contract), each
// rejected with a nonzero exit and an untouched content tree.
describe("input contract rejections (^t-input-contract)", () => {
  type Case = {
    name: string;
    match: RegExp;
    // Returns bake argv. The env starts as standardFixtureEnv() plus a
    // fixture skills dist; setup mutates it and picks the invocation.
    setup: (env: { root: string; designs: string; skillsDist: string; base: string }) => string[];
  };

  const withStore = (env: { designs: string }, store: unknown): string[] => {
    writeDesign(env.designs, "s", validManifest([validCard({ store })]), { "main-card.frame": FRAME });
    return ["s"];
  };
  // Store declarations on cards (specs/ui/onboarding-artifacts/index.md#^channel-layout).
  function storeCases(): Case[] {
    const declarationCases: Array<{ name: string; store: unknown; match: RegExp }> = [
      { name: "a store that is not a mapping", store: [{ value: {} }], match: /'store' must be a mapping/ },
      { name: "a store with an unknown field", store: { value: {}, access: "read" }, match: /unknown field 'access' on the store/ },
      { name: "a store without value", store: { shiftDatesFrom: "2026-07-08" }, match: /store .*is missing 'value'/ },
      { name: "a store whose shiftDatesFrom is not a calendar date", store: { value: {}, shiftDatesFrom: "2026-02-30" }, match: /shiftDatesFrom.*calendar date/ },
    ];
    return [
      ...declarationCases.map(({ name, store, match }): Case => ({
        name,
        match,
        setup: (env) => [...withStore(env, store), "--root", env.root, "--designs", env.designs],
      })),
      {
        // YAML reads 1e400 as an infinity, which no JSON store holds.
        name: "a store whose starting value breaks the JSON store's value rules",
        match: /finite/,
        setup: (env) => {
          writeDesign(
            env.designs,
            "s",
            '{"name":"Fixture","cards":[{"id":"main","slug":"main-card","title":"Main Card","store":{"value":{"n":1e400}}}]}\n',
            { "main-card.frame": FRAME },
          );
          return ["s", "--root", env.root, "--designs", env.designs];
        },
      },
    ];
  }

  const withSkill = (env: { designs: string }, skill: unknown): void =>
    writeDesign(env.designs, "skill-screen", validManifest([validCard({ id: "s", slug: "s-card", title: "S", skill })]), {
      "s-card.frame": FRAME,
    });

  const cases: Case[] = [
    // Roots are checked by real path before any destructive replacement.
    { name: "nonexistent content-tree root", match: /root/i, setup: (env) => ["screen-one", "--root", path.join(env.base, "missing"), "--designs", env.designs] },
    { name: "nonexistent design root", match: /design/i, setup: (env) => ["screen-one", "--root", env.root, "--designs", path.join(env.base, "missing")] },
    { name: "nonexistent skills-dist root", match: /skills/i, setup: (env) => { withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", path.join(env.base, "missing")]; } },
    { name: "content-tree root is a regular file", match: /director/i, setup: (env) => { const f = path.join(env.base, "file-root"); writeFileSync(f, "x"); return ["screen-one", "--root", f, "--designs", env.designs]; } },
    { name: "design root is a regular file", match: /director/i, setup: (env) => { const f = path.join(env.base, "file-designs"); writeFileSync(f, "x"); return ["screen-one", "--root", env.root, "--designs", f]; } },
    { name: "skills-dist root is a regular file", match: /director/i, setup: (env) => { const f = path.join(env.base, "file-skills"); writeFileSync(f, "x"); withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", f]; } },
    { name: "content-tree root equals the design root", match: /overlap|disjoint|contain/i, setup: (env) => ["screen-one", "--root", env.designs, "--designs", env.designs] },
    { name: "content-tree root equals the skills-dist root", match: /overlap|disjoint|contain/i, setup: (env) => ["screen-one", "--root", env.root, "--designs", env.designs, "--skills-dist", env.root] },
    { name: "content-tree root contains the design root", match: /overlap|disjoint|contain/i, setup: (env) => { const inside = path.join(env.root, "designs"); mkdirSync(inside); return ["screen-one", "--root", env.root, "--designs", inside]; } },
    { name: "content-tree root contains the skills-dist root", match: /overlap|disjoint|contain/i, setup: (env) => { const inside = path.join(env.root, "dist"); mkdirSync(inside, { recursive: true }); withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", inside]; } },
    { name: "design root contains the content-tree root", match: /overlap|disjoint|contain/i, setup: (env) => { const inside = path.join(env.designs, "content"); mkdirSync(inside, { recursive: true }); minimalContentTree(inside); return ["screen-one", "--root", inside, "--designs", env.designs]; } },
    { name: "skills-dist root contains the content-tree root", match: /overlap|disjoint|contain/i, setup: (env) => { const inside = path.join(env.skillsDist, "content"); minimalContentTree(inside); return ["screen-one", "--root", inside, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    { name: "overlap reachable only through a symlink", match: /overlap|disjoint|contain/i, setup: (env) => { const link = path.join(env.base, "link"); symlinkSync(env.root, link); return ["screen-one", "--root", env.root, "--designs", link] ; } },
    // starting config
    { name: "missing starting config", match: /onboarding-channels\.json|config/i, setup: (env) => { rmSync(path.join(env.root, "onboarding-channels.json")); return ["screen-one", "--root", env.root, "--designs", env.designs]; } },
    { name: "unparseable starting config", match: /pars|config/i, setup: (env) => { writeFileSync(path.join(env.root, "onboarding-channels.json"), "{nope"); return ["screen-one", "--root", env.root, "--designs", env.designs]; } },
    { name: "starting config is valid JSON but not an object", match: /object|config/i, setup: (env) => { writeFileSync(path.join(env.root, "onboarding-channels.json"), '"hello"\n'); return ["screen-one", "--root", env.root, "--designs", env.designs]; } },
    { name: "starting config lacks channels", match: /channels/i, setup: (env) => { writeFileSync(path.join(env.root, "onboarding-channels.json"), "{}\n"); return ["screen-one", "--root", env.root, "--designs", env.designs]; } },
    { name: "starting config channels is not an array", match: /channels/i, setup: (env) => { writeFileSync(path.join(env.root, "onboarding-channels.json"), '{ "channels": 5 }\n'); return ["screen-one", "--root", env.root, "--designs", env.designs]; } },
    // arguments
    { name: "zero design channels", match: /design channel|usage/i, setup: (env) => ["--root", env.root, "--designs", env.designs] },
    { name: "duplicate design-channel argument", match: /duplicate/i, setup: (env) => ["screen-one", "screen-one", "--root", env.root, "--designs", env.designs] },
    { name: "channel directory without a manifest", match: /manifest|layout\.yml/i, setup: (env) => { mkdirSync(path.join(env.designs, "bare-screen")); return ["bare-screen", "--root", env.root, "--designs", env.designs]; } },
    // slugs
    { name: "malformed channel directory name", match: /slug/i, setup: (env) => { writeDesign(env.designs, "Bad_Name", validManifest(), { "main-card.frame": FRAME }); return ["Bad_Name", "--root", env.root, "--designs", env.designs]; } },
    { name: "malformed card slug", match: /slug/i, setup: (env) => { writeDesign(env.designs, "bad-card", validManifest([validCard({ slug: "Bad Slug" })]), {}); return ["bad-card", "--root", env.root, "--designs", env.designs]; } },
    { name: "path-escaping card slug", match: /slug/i, setup: (env) => { writeDesign(env.designs, "escape-card", validManifest([validCard({ slug: "../evil" })]), {}); return ["escape-card", "--root", env.root, "--designs", env.designs]; } },
    // manifest schema
    { name: "unparseable manifest", match: /parse/i, setup: (env) => { writeDesign(env.designs, "s", "{nope\n", {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "manifest that is not a mapping", match: /mapping/i, setup: (env) => { writeDesign(env.designs, "s", '"just a string"\n', {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "card entry that is not a mapping", match: /mapping/i, setup: (env) => { writeDesign(env.designs, "s", { name: "S", cards: [5] }, {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "unknown top-level manifest field", match: /unknown/i, setup: (env) => { writeDesign(env.designs, "s", { name: "S", cards: [validCard()], extra: 1 }, { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "missing name", match: /name/i, setup: (env) => { writeDesign(env.designs, "s", { cards: [validCard()] }, { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-string name", match: /name/i, setup: (env) => { writeDesign(env.designs, "s", { name: 5, cards: [validCard()] }, { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "empty name", match: /name/i, setup: (env) => { writeDesign(env.designs, "s", { name: "  ", cards: [validCard()] }, { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "missing cards", match: /cards/i, setup: (env) => { writeDesign(env.designs, "s", { name: "S" }, {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-list cards", match: /cards/i, setup: (env) => { writeDesign(env.designs, "s", { name: "S", cards: 5 }, {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "empty cards", match: /cards/i, setup: (env) => { writeDesign(env.designs, "s", { name: "S", cards: [] }, {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "card missing id", match: /id/i, setup: (env) => { const card = validCard(); delete card["id"]; writeDesign(env.designs, "s", validManifest([card]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "card missing slug", match: /slug/i, setup: (env) => { const card = validCard(); delete card["slug"]; writeDesign(env.designs, "s", validManifest([card]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "card missing title", match: /title/i, setup: (env) => { const card = validCard(); delete card["title"]; writeDesign(env.designs, "s", validManifest([card]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "unknown card field", match: /unknown/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ unexpected: 4 })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-object page size", match: /size.*object/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: null })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size with an unknown key", match: /size.*unknown.*depth/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: { width: 900, height: 600, depth: 1 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size missing width", match: /size width.*finite positive/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: { height: 600 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size missing height", match: /size height.*finite positive/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: { width: 900 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size with a non-numeric axis", match: /size width.*finite positive/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: { width: "900", height: 600 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size with a non-finite axis", match: /size width.*finite positive/i, setup: (env) => { writeDesign(env.designs, "s", '{"name":"Fixture","cards":[{"id":"main","slug":"main-card","title":"Main Card","size":{"width":1e400,"height":600}}]}\n', { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size with a zero axis", match: /size width.*finite positive/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: { width: 0, height: 600 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page size with a negative axis", match: /size height.*finite positive/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ size: { width: 900, height: -1 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-object page geometry", match: /geometry.*object/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ geometry: null })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page geometry with an unknown key", match: /geometry.*unknown.*row/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ geometry: { kind: "single", full_screen: false, row: 1 } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page geometry with an unknown kind", match: /unknown geometry kind/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ geometry: { kind: "grid", full_screen: false } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page geometry missing full_screen", match: /geometry.*boolean full_screen/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ geometry: { kind: "single" } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "page geometry with non-boolean full_screen", match: /geometry.*boolean full_screen/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ geometry: { kind: "single", full_screen: "true" } })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "duplicate card id", match: /duplicate/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard(), validCard({ slug: "other-card" })]), { "main-card.frame": FRAME, "other-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "duplicate card slug", match: /duplicate/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard(), validCard({ id: "other" })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-string id", match: /id/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ id: 5 })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "empty id", match: /id/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ id: " " })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-string title", match: /title/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ title: 7 })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "empty title", match: /title/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ title: "  " })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "non-boolean components", match: /components/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ components: "false" })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    ...storeCases(),
    { name: "malformed skill name", match: /skill/i, setup: (env) => { writeDesign(env.designs, "s", validManifest([validCard({ skill: "Bad_Skill" })]), { "main-card.frame": FRAME }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    // flat sources
    { name: "neither flat source file exists", match: /source|missing/i, setup: (env) => { writeDesign(env.designs, "s", validManifest(), {}); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "source path is a directory", match: /source|file/i, setup: (env) => { writeDesign(env.designs, "s", validManifest(), {}); mkdirSync(path.join(env.designs, "s", "main-card.frame")); return ["s", "--root", env.root, "--designs", env.designs]; } },
    { name: "ambiguous source (frame and Markdown)", match: /ambiguous|both/i, setup: (env) => { writeDesign(env.designs, "s", validManifest(), { "main-card.frame": FRAME, "main-card.md": "# Both\n" }); return ["s", "--root", env.root, "--designs", env.designs]; } },
    ...["frame", "md"].map((extension): Case => ({
      name: `flat ${extension} source omitted from manifest`, match: /manifest|omit|unlisted/i,
      setup: (env) => {
        writeDesign(env.designs, "s", validManifest(), { "main-card.frame": FRAME, [`orphan-card.${extension}`]: FRAME });
        return ["s", "--root", env.root, "--designs", env.designs];
      },
    })),
    // skill dist
    { name: "skill naming no built dist directory", match: /skill|dist/i, setup: (env) => { withSkill(env, "absent-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    { name: "skill location is a regular file", match: /skill|director/i, setup: (env) => { writeFileSync(path.join(env.skillsDist, "file-skill"), "x"); withSkill(env, "file-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    { name: "skill dist containing a subdirectory", match: /subdirector|director/i, setup: (env) => { mkdirSync(path.join(env.skillsDist, "fixture-skill", "nested")); withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    { name: "skill dist containing index.html", match: /index\.html/i, setup: (env) => { writeFileSync(path.join(env.skillsDist, "fixture-skill", "index.html"), "<p>clash</p>"); withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    { name: "skill dist containing a non-regular entry", match: /regular|symlink/i, setup: (env) => { symlinkSync(path.join(env.skillsDist, "fixture-skill", "skill.css"), path.join(env.skillsDist, "fixture-skill", "link.css")); withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    { name: "skill dist filename outside the safe pattern", match: /filename|name/i, setup: (env) => { writeFileSync(path.join(env.skillsDist, "fixture-skill", "weird name.css"), "x"); withSkill(env, "fixture-skill"); return ["skill-screen", "--root", env.root, "--designs", env.designs, "--skills-dist", env.skillsDist]; } },
    // Every prohibited declaration is rejected even when empty or defaulted.
    ...[
      ["params", { x: { type: "string" } }],
      ["params", { x: { type: "string", default: "defaulted" } }],
      ["params", {}],
      ["imports", ["./helper.js"]],
      ["data", { value: "fixture" }],
      ["script", ""],
      ["adoptedStyles", { "fixture-card": ":host { color: red; }" }],
    ].map(([key, value]): Case => ({
      name: `frame declaring ${key}: ${JSON.stringify(value)}`, match: new RegExp(String(key)),
      setup: (env) => {
        writeDesign(env.designs, "s", validManifest(), {
          "main-card.frame": `---\n${JSON.stringify({ [String(key)]: value })}\n---\n${FRAME}`,
          "helper.js": "export {};\n",
        });
        return ["s", "--root", env.root, "--designs", env.designs];
      },
    })),
    ...["../helper", "../helper.frame"].map((target): Case => ({
      name: `frame importing a composition through ${target}`, match: /composition|import/i,
      setup: (env) => {
        writeDesign(env.designs, "composed", validManifest(), {
          "main-card.frame": `{% render '${target}' %}`,
          "../helper.frame": styledFrame(".child { color: red; }", '<p class="child">Child content</p>'),
        });
        return ["screen-one", "composed", "--root", env.root, "--designs", env.designs];
      },
    })),
    { name: "frame failing compilation after a valid channel", match: /render|compil|frame/i, setup: (env) => { writeDesign(env.designs, "broken", validManifest(), { "main-card.frame": "{% if %}" }); return ["screen-one", "broken", "--root", env.root, "--designs", env.designs]; } },
    // Real local resources ensure Vite could resolve/inline them if validation
    // accidentally ran only on the transformed CSS.
    ...[
      ".x { background: url(https://example.com/x.png); }",
      '@import "./other.css";\n.x { color: red; }',
      '.x { background: url("./pixel.svg"); }',
      ".x { background: URL(https://example.com/x.png); }",
      '@IMPORT "https://example.com/x.css";',
      ".x { background: u\\72l(https://example.com/x.png); }",
      '@impo\\72t "https://example.com/x.css";',
      '.x { background-image: image-set("https://example.com/x.png" 1x); }',
      '.x { background-image: -webkit-image-set("https://example.com/x.png" 1x); }',
      '.x { background: src("https://example.com/x.png"); }',
      '.x { background-image: image-set(url(#a) 1x, "https://example.com/x.png" 2x); }',
      '.x { background-image: image\\2d set("https://example.com/x.png" 1x); }',
    ].map((style): Case => ({
      name: `authored CSS with an external resource: ${style}`, match: /url|@import|self-contained/i,
      setup: (env) => {
        writeDesign(env.designs, "s", validManifest(), {
          "main-card.frame": styledFrame(style),
          "other.css": ".imported { color: red; }\n",
          "pixel.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
        });
        return ["s", "--root", env.root, "--designs", env.designs];
      },
    })),
  ];

  // The write-nothing claim is asserted against the ACTUAL --root each
  // fixture passes, whatever its state: a nonexistent root must stay
  // nonexistent, a regular-file root must keep its bytes, a directory root
  // its full byte tree. The helper content tree is asserted untouched too.
  type RootState = { kind: "missing" } | { kind: "file"; data: string } | { kind: "dir"; data: Record<string, string> };
  function rootState(p: string): RootState {
    if (!existsSync(p)) return { kind: "missing" };
    const stats = lstatSync(p);
    if (stats.isFile()) return { kind: "file", data: readFileSync(p).toString("base64") };
    return { kind: "dir", data: snapshot(p) };
  }

  it.each(cases.map((c) => [c.name, c] as const))("rejects %s and writes nothing", (_name, testCase) => {
    const base = tempDir("tv-bake-reject-");
    const root = path.join(base, "content");
    const designs = path.join(base, "designs");
    mkdirSync(root, { recursive: true });
    mkdirSync(designs, { recursive: true });
    minimalContentTree(root);
    writeDesign(designs, "screen-one", validManifest(), { "main-card.frame": FRAME });
    const skillsDist = fixtureSkillsDist();
    const args = testCase.setup({ root, designs, skillsDist, base });
    const actualRoot = args[args.indexOf("--root") + 1]!;
    const actualBefore = rootState(actualRoot);
    const helperBefore = snapshot(root);
    const result = runBake(args);
    expect(result.status, `expected nonzero exit\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).not.toBe(0);
    expect(result.stderr).toMatch(testCase.match);
    expect(rootState(actualRoot)).toEqual(actualBefore);
    expect(snapshot(root)).toEqual(helperBefore);
  }, 60_000);
});
