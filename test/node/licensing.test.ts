import { spawnSync, type ChildProcessByStdio } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  loadAssetManifest,
  loadLicenseConfig,
  type LicenseSurface,
} from "../../scripts/licenses/lib/config.mjs";
import { evaluateLicenseGate } from "../../scripts/licenses/lib/gate.mjs";
import {
  mergeSurfaceInventories,
  readSurfaceInventory,
  resolveInventoryRoot,
  type InventorySurface,
} from "../../scripts/licenses/lib/inventory.mjs";
import { renderFolderNotices, renderThirdPartyNotices } from "../../scripts/licenses/lib/notices.mjs";
import { includedLicenseSurfaces, LICENSE_INVENTORY_SURFACES } from "../../scripts/licenses/lib/surfaces.mjs";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const cliDist = path.join(repoRoot, "packages/cli/dist");
const desktopDist = path.join(repoRoot, "packages/desktop/dist");
const builtCLI = path.join(cliDist, "cli.cjs");
const inventoryRoot = resolveInventoryRoot({ root: repoRoot });
const noticeName = "THIRD-PARTY-NOTICES.txt";
const startTimeoutMs = 30_000;

const sourceNotices = {
  web: path.join(repoRoot, "packages/web/dist", noticeName),
  markdown: path.join(repoRoot, "packages/view-markdown/dist", noticeName),
  calendar: path.join(repoRoot, "packages/skills/skills/tv-calendar/dist", noticeName),
  tasks: path.join(repoRoot, "packages/skills/skills/tv-tasks/dist", noticeName),
};

const copiedNotices = {
  web: path.join(cliDist, "web", noticeName),
  markdown: path.join(cliDist, "views/markdown", noticeName),
  calendar: path.join(cliDist, "skills/tv-calendar", noticeName),
  tasks: path.join(cliDist, "skills/tv-tasks", noticeName),
};

describe("product licensing outputs", () => {
  test("license propagation regenerates byte-identical public package copies", () => {
    const rootLicense = readFileSync(path.join(repoRoot, "LICENSE"));
    expect(rootLicense.toString("utf8").split("\n").filter((line) => line.startsWith("Copyright"))).toEqual([
      "Copyright (c) 2026 Unternet PBC",
    ]);
    expect(readFileSync(path.join(repoRoot, "packages/cli/LICENSE"))).toEqual(rootLicense);
  });

  test("esbuild CLI inventory and umbrella notice contain real handled packages", () => {
    const inventory = readSurfaceInventory(inventoryRoot, "cli");
    expect(packageNames(inventory)).toContain("express");
    expectNoIgnoredPackageNames(JSON.stringify(inventory));

    const notice = readFileSync(path.join(cliDist, noticeName), "utf8");
    expect(packageNamesFromNotice(notice)).toContain("express");
    expectNoIgnoredPackageNames(notice);
  });

  test("esbuild desktop persists its bundled inventory and writes the matching notices file", () => {
    const inventory = readSurfaceInventory(inventoryRoot, "desktop");
    expect(packageNames(inventory)).toEqual(["@rupertsworld/event-target"]);
    expect(existsSync(path.join(desktopDist, noticeName))).toBe(true);
    const notice = readFileSync(path.join(desktopDist, noticeName), "utf8");
    expect(packageNamesFromNotice(notice)).toEqual(["@rupertsworld/event-target"]);
    expectNoIgnoredPackageNames(notice);
  });

  test("suite inventory handoff retains every product surface", () => {
    expect(LICENSE_INVENTORY_SURFACES.map((surface) => readSurfaceInventory(inventoryRoot, surface).surface)).toEqual(
      LICENSE_INVENTORY_SURFACES,
    );
  });

  test("suite-run gate consumes all prebuilt inventories without rebuilding products", () => {
    const expectedSurfaces = [...LICENSE_INVENTORY_SURFACES];
    const observedFiles = [
      path.join(cliDist, noticeName),
      ...expectedSurfaces.map((surface) => path.join(inventoryRoot, `${surface}.json`)),
    ];
    const before = observedFiles.map(fileSnapshot);

    const result = evaluateLicenseGate({ root: repoRoot, inventoryRoot });

    expect(result.ok, result.errors.join("\n")).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.surfaces).toEqual(expectedSurfaces);
    expect(observedFiles.map(fileSnapshot)).toEqual(before);
  });

  test("aggregation covers copied child surfaces without declared dependencies or raw inventories", () => {
    const notice = readFileSync(path.join(cliDist, noticeName), "utf8");
    const packageNames = packageNamesFromNotice(notice);
    // Samples from the copied-in web inventory: two direct web dependencies
    // and two reachable only transitively, so the aggregation is shown to
    // reach past declared dependencies. Kept to names the web build ships.
    expect(packageNames).toEqual(expect.arrayContaining([
      "@rupertsworld/event-target",
      "@codemirror/state",
      "dompurify",
      "es-abstract",
      "get-intrinsic",
      "lit-html",
    ]));
    expectNoIgnoredPackageNames(notice);
    for (const dependency of ["@todesktop/runtime", "electron", "skills", "yaml"]) {
      expect(packageNames).not.toContain(dependency);
    }
    expect(notice).toContain("Hind variable font\nLicensed under OFL-1.1.");
    expect(notice).toContain("@phosphor-icons/core@2.1.1\nLicensed under MIT.");

    expect(existsSync(copiedNotices.calendar)).toBe(false);
    assertAudienceNotice(readFileSync(copiedNotices.tasks, "utf8"));
    const rawInventories = [cliDist, desktopDist].flatMap((root) => listFiles(root))
      .filter((file) => /(?:oss-licenses|metafile|licenses-inventory).*\.json$/i.test(path.basename(file)));
    expect(rawInventories).toEqual([]);
  });

  test("real asset records reach source, CLI aggregate, and web notices", () => {
    const notices = [
      readFileSync(path.join(repoRoot, noticeName), "utf8"),
      readFileSync(path.join(cliDist, noticeName), "utf8"),
      readFileSync(sourceNotices.web, "utf8"),
    ];
    for (const notice of notices) {
      expect(materialSection(notice, "Hind variable font")).toContain("Licensed under OFL-1.1.");
      expect(materialSection(notice, "@phosphor-icons/core@2.1.1")).toContain("Licensed under MIT.");
      expectNoIgnoredPackageNames(notice);
    }
    for (const notice of notices.slice(0, 2)) {
      expect(materialSection(notice, "Nord color palette")).toContain("Copyright (c) 2016-present Sven Greb");
    }
  });
});

describe("shipped package licensing", () => {
  let packedRoot = "";
  let packedCLI: string;
  let desktopUpload: string;

  beforeAll(() => {
    packedRoot = mkdtempSync(path.join(os.tmpdir(), "television-packed-licensing-"));
    packedCLI = packAndExtract("@telepath-computer/television", "cli", packedRoot);
    desktopUpload = generateDesktopUpload(packedRoot);
  });

  afterAll(() => {
    if (packedRoot !== "") rmSync(packedRoot, { recursive: true, force: true });
  });

  test("CLI tarball carries the project license and every notice input class", () => {
    expect(readFileSync(path.join(packedCLI, "LICENSE"))).toEqual(readFileSync(path.join(repoRoot, "LICENSE")));
    const notice = readFileSync(path.join(packedCLI, "dist", noticeName), "utf8");
    expect(packageNamesFromNotice(notice)).toEqual(expect.arrayContaining([
      "@rupertsworld/event-target",
      "@codemirror/state",
      "cookie-signature",
      "dompurify",
      "es-abstract",
      "express",
      "get-intrinsic",
      "lit-html",
    ]));
    expectNoIgnoredPackageNames(notice);
    expect(packageSection(notice, "dompurify")).toContain("Licensed under Apache-2.0.");
    expect(materialSection(notice, "Hind variable font")).toContain("Licensed under OFL-1.1.");
    expect(materialSection(notice, "@phosphor-icons/core@2.1.1")).toContain("Licensed under MIT.");
    expect(materialSection(notice, "Nord color palette")).toContain("Licensed under MIT.");

    const configuredNotice = loadLicenseConfig({ root: repoRoot }).notices
      .find((entry) => entry.package === "cookie-signature");
    expect(configuredNotice).toBeDefined();
    expect(packageSection(notice, "cookie-signature")).toContain(configuredNotice!.text);
  });

  // proofs/product/licensing.md#^licensing-ac-theme-attribution
  test("CLI tarball ships the Nord theme with its attribution", () => {
    const nord = loadAssetManifest({ root: repoRoot }).find((asset) => asset.id === "nord-theme");
    expect(nord).toBeDefined();
    const licenseText = nord!.components[0].noticeText;
    const copyrightLine = licenseText.split("\n").find((line) => line.startsWith("Copyright (c)"));
    expect(copyrightLine).toBeDefined();

    const header = readFileSync(path.join(packedCLI, "dist/themes/nord/theme.css"), "utf8").split("*/")[0];
    expect(header).toMatch(/^\/\*/);
    expect(header).toContain("https://github.com/nordtheme/nord");
    expect(header).toContain(copyrightLine!);
    expect(header).toContain("MIT License");
    expect(header).toContain(noticeName);

    const folderNotice = readFileSync(path.join(packedCLI, "dist/themes/nord", noticeName), "utf8");
    expect(materialSection(folderNotice, "Nord color palette")).toContain(licenseText);

    const umbrella = readFileSync(path.join(packedCLI, "dist", noticeName), "utf8");
    expect(materialSection(umbrella, "Nord color palette")).toContain(licenseText);
  });

  // proofs/product/licensing.md#^licensing-ac-desktop-upload
  test("desktop upload directory carries the project license, and notices exactly when entries exist", () => {
    expect(readFileSync(path.join(desktopUpload, "LICENSE"))).toEqual(readFileSync(path.join(repoRoot, "LICENSE")));

    const expectedNotices = expectedSurfaceNotices("desktop", ["desktop"]);
    expect(expectedNotices).not.toBeNull();
    const uploadedNotices = path.join(desktopUpload, "dist", noticeName);
    expect(existsSync(uploadedNotices)).toBe(expectedNotices !== null);
    if (expectedNotices !== null) {
      expect(readFileSync(uploadedNotices, "utf8")).toBe(expectedNotices);
      expect(readFileSync(uploadedNotices)).toEqual(readFileSync(path.join(desktopDist, noticeName)));
    }
  });

  // proofs/arch/node-versions.md#^node-versions-t-packed-declarations
  test("the CLI tarball retains the published Node consumer floor", () => {
    const manifest = JSON.parse(readFileSync(path.join(packedCLI, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    expect(manifest.engines?.node).toBe(">=22.12.0");
  });

  // proofs/product/licensing.md#^licensing-ac-ignored-silent
  test("every real artifact has notices exactly where entries exist, and every file is written for readers", () => {
    const sourceExpected = expectedSurfaceNotices("source", []);
    const cliSurfaces = includedLicenseSurfaces("cli");
    const cliExpected = expectedSurfaceNotices("cli", cliSurfaces, cliSurfaces);
    const desktopExpected = expectedSurfaceNotices("desktop", ["desktop"]);
    const webExpected = expectedSurfaceNotices("web", ["web"]);
    const markdownExpected = expectedSurfaceNotices("view:markdown", ["view:markdown"]);
    const calendarExpected = expectedSurfaceNotices("skill:tv-calendar", ["skill:tv-calendar"]);
    const tasksExpected = expectedSurfaceNotices("skill:tv-tasks", ["skill:tv-tasks"]);
    const locations = [
      [path.join(repoRoot, noticeName), sourceExpected],
      [path.join(packedCLI, "dist", noticeName), cliExpected],
      [path.join(desktopUpload, "dist", noticeName), desktopExpected],
      [sourceNotices.web, webExpected],
      [sourceNotices.markdown, markdownExpected],
      [sourceNotices.calendar, calendarExpected],
      [sourceNotices.tasks, tasksExpected],
      [path.join(packedCLI, "dist/web", noticeName), webExpected],
      [path.join(packedCLI, "dist/views/markdown", noticeName), markdownExpected],
      [path.join(packedCLI, "dist/skills/tv-calendar", noticeName), calendarExpected],
      [path.join(packedCLI, "dist/skills/tv-tasks", noticeName), tasksExpected],
      [
        path.join(packedCLI, "dist/onboarding/productivity/company-todos", noticeName),
        readFileSync(path.join(repoRoot, "packages/server/assets/onboarding-channels/productivity/company-todos", noticeName), "utf8"),
      ],
      ...themeFolderNotices().flatMap(({ folder, text }) => [
        [path.join(repoRoot, folder, noticeName), text],
        [path.join(packedCLI, "dist/themes", path.basename(folder), noticeName), text],
      ] as const),
    ] as const;
    for (const [file, expected] of locations) {
      expect(existsSync(file), file).toBe(expected !== null);
      if (expected !== null) expect(readFileSync(file, "utf8"), file).toBe(expected);
    }

    const noticeFiles = [
      path.join(repoRoot, noticeName),
      ...listFiles(packedCLI).filter((file) => path.basename(file) === noticeName),
      ...listFiles(desktopUpload).filter((file) => path.basename(file) === noticeName),
      ...Object.values(sourceNotices).filter((file) => existsSync(file)),
      ...listFiles(path.join(repoRoot, bundledThemesSource)).filter((file) => path.basename(file) === noticeName),
    ];
    const expectedNoticeFiles = locations.filter(([, expected]) => expected !== null).map(([file]) => file);
    expect(noticeFiles.sort()).toEqual(expectedNoticeFiles.sort());
    for (const file of noticeFiles) assertAudienceNotice(readFileSync(file, "utf8"));
  });

});

describe("Vite licensing outputs", () => {
  test("Vite surfaces persist emitted package inventories and final notices", () => {
    const webInventory = readSurfaceInventory(inventoryRoot, "web");
    const markdownInventory = readSurfaceInventory(inventoryRoot, "view:markdown");
    const calendarInventory = readSurfaceInventory(inventoryRoot, "skill:tv-calendar");
    const tasksInventory = readSurfaceInventory(inventoryRoot, "skill:tv-tasks");

    expect(packageDeclaration(webInventory, "dompurify")).toBe("(MPL-2.0 OR Apache-2.0)");
    expect(packageNames(markdownInventory)).toContain("@codemirror/state");
    expect(packageNames(calendarInventory)).toEqual([]);
    expect(packageNames(tasksInventory)).toEqual(["@rupertsworld/event-target"]);

    const webNotice = readFileSync(sourceNotices.web, "utf8");
    expect(webNotice).toMatch(/dompurify@[^\n]+\nLicensed under Apache-2\.0\./);
    expect(webNotice).toContain("Hind variable font\nLicensed under OFL-1.1.");
    expect(webNotice).toContain("@phosphor-icons/core@2.1.1\nLicensed under MIT.");

    const markdownNotice = readFileSync(sourceNotices.markdown, "utf8");
    expect(markdownNotice).toMatch(/@codemirror\/state@[^\n]+\nLicensed under MIT\./);
    expect(markdownNotice).toContain("Hind variable font\nLicensed under OFL-1.1.");
    expect(markdownNotice).toContain("@phosphor-icons/core@2.1.1\nLicensed under MIT.");

    expect(existsSync(sourceNotices.calendar)).toBe(false);
    expect(readFileSync(sourceNotices.tasks, "utf8"))
      .toMatch(/@rupertsworld\/event-target@[^\n]+\nLicensed under MIT\./);
  });

  test("Vite output directories contain final notices and no raw inventory artifact", () => {
    const expectedNotices = [
      ...Object.entries(sourceNotices).filter(([surface]) => surface !== "calendar")
        .map(([surface, file]) => [`source ${surface}`, file] as const),
      ...Object.entries(copiedNotices).filter(([surface]) => surface !== "calendar")
        .map(([surface, file]) => [`copied ${surface}`, file] as const),
    ];
    for (const [surface, file] of expectedNotices) {
      expect(existsSync(file), `${surface}: ${file}`).toBe(true);
      assertAudienceNotice(readFileSync(file, "utf8"));
    }
    expect(existsSync(sourceNotices.calendar)).toBe(false);
    expect(existsSync(copiedNotices.calendar)).toBe(false);

    const shippingRoots = [
      path.join(repoRoot, "packages/web/dist"),
      path.join(repoRoot, "packages/view-markdown/dist"),
      path.join(repoRoot, "packages/skills/skills/tv-calendar/dist"),
      path.join(repoRoot, "packages/skills/skills/tv-tasks/dist"),
      path.join(repoRoot, "packages/skills/dist"),
      cliDist,
    ];
    const rawInventories = shippingRoots.flatMap((root) => listFiles(root))
      .filter((file) => path.basename(file) === "oss-licenses.json");
    expect(rawInventories).toEqual([]);
  });

  test("Vite minification retains known web legal comments and keeps calendar first-party-only", () => {
    const webJavaScript = readFilesWithExtension(path.join(repoRoot, "packages/web/dist"), ".js");
    expect(webJavaScript).toMatch(/@license DOMPurify/i);

    const calendarJavaScript = readFileSync(
      path.join(repoRoot, "packages/skills/skills/tv-calendar/dist/calendar.js"),
      "utf8",
    );
    expect(calendarJavaScript).not.toMatch(/(?:@lit\/reactive-element|lit-element|lit-html|Copyright 2017 Google LLC)/i);
  });

  test("browser serves generated web notices at the stable root URL", async () => {
    expect(existsSync(builtCLI), builtCLI).toBe(true);
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-license-browser-"));
    const server = spawnServe(storagePath);
    try {
      const port = await waitForPort(server.child as ServeChild);
      const response = await fetch(`http://127.0.0.1:${port}/${noticeName}`);
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).toMatch(/dompurify@[^\n]+\nLicensed under Apache-2\.0\./);
      expect(text).toContain("Hind variable font\nLicensed under OFL-1.1.");
      expect(text).toContain("@phosphor-icons/core@2.1.1\nLicensed under MIT.");
      assertAudienceNotice(text);
    } finally {
      const cleanup = await server.dispose();
      rmSync(storagePath, { recursive: true, force: true });
      if (cleanup.outcome === "survived") throw new Error(`Licensing test server ${server.pid} survived cleanup`);
    }
  });
});

type ServeChild = ChildProcessByStdio<null, Readable, Readable>;

const bundledThemesSource = "packages/server/assets/themes";

/** The bundled theme folders that owe a notices file, selected from the asset manifest and never from the files present. */
function themeFolderNotices(): { folder: string; text: string }[] {
  const owed = renderFolderNotices({ assets: loadAssetManifest({ root: repoRoot }) })
    .filter(({ folder }) => path.dirname(folder) === bundledThemesSource);
  expect(owed.map(({ folder }) => folder)).toContain(`${bundledThemesSource}/nord`);
  return owed;
}

function expectedSurfaceNotices(
  surface: LicenseSurface,
  inventorySurfaces: InventorySurface[],
  assetSurfaces: LicenseSurface[] = inventorySurfaces,
): string | null {
  const inventories = inventorySurfaces.map((candidate) => readSurfaceInventory(inventoryRoot, candidate));
  if (surface === "source" && inventories.length > 0) {
    throw new Error("The source surface cannot consume build inventories");
  }
  const inventory = surface === "source" || inventories.length === 0
    ? { surface, packages: [] }
    : mergeSurfaceInventories(surface, inventories);
  const config = loadLicenseConfig({ root: repoRoot });
  return renderThirdPartyNotices({
    surface,
    inventory,
    assetSurfaces: assetSurfaces.length === 0 ? [surface] : assetSurfaces,
    config,
    assets: loadAssetManifest({ root: repoRoot, config }),
    root: repoRoot,
  });
}

function assertAudienceNotice(notice: string): void {
  const header = notice.split(/^={80}$/m, 1)[0];
  expect(header).toContain("TELEVISION");
  expect(header).toContain("THIRD-PARTY LICENSING NOTICES");
  expect(header).not.toMatch(/surface|inventory|provenance|generated|do not edit|gate|ignored|status|workflow|tooling|spec/i);
  expect(notice).not.toMatch(/^(?:PACKAGE|ASSET|DESCRIPTION|ORIGIN|COMPONENT|LICENSE|NOTICE SOURCE):/m);
  const metadata = noticeMetadata(notice);
  for (const lines of metadata) {
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Licensed under .+\.$/);
  }
  const internalAssetIDs = loadAssetManifest({ root: repoRoot }).map((asset) => asset.id);
  for (const lines of metadata) expect(internalAssetIDs).not.toContain(lines[0]);
  expectNoIgnoredPackageNames(notice);
}

function expectNoIgnoredPackageNames(text: string): void {
  expect(text).not.toMatch(/^skills(?:@|$)/m);
}

function packageNames(inventory: ReturnType<typeof readSurfaceInventory>): string[] {
  return inventory.packages.map((entry) => entry.name);
}

function noticeSections(notice: string): string[] {
  return notice.split(/^={80}$/m).slice(1);
}

function noticeMetadata(notice: string): string[][] {
  return noticeSections(notice).map((section) => section.split(/^-{80}$/m, 1)[0].trim().split("\n"));
}

function packageNamesFromNotice(notice: string): string[] {
  return noticeMetadata(notice)
    .map(([heading]) => heading.match(/^(.+)@([^@\s]+)$/)?.[1] ?? null)
    .filter((name): name is string => name !== null);
}

function packageSection(notice: string, packageName: string): string {
  const section = noticeSections(notice).find((candidate) => candidate.trimStart().startsWith(`${packageName}@`));
  expect(section, `notice section for ${packageName}`).toBeDefined();
  return section!;
}

function materialSection(notice: string, materialName: string): string {
  const section = noticeSections(notice).find((candidate) => candidate.trimStart().startsWith(`${materialName}\n`));
  expect(section, `notice section for ${materialName}`).toBeDefined();
  return section!;
}

function packageDeclaration(
  inventory: ReturnType<typeof readSurfaceInventory>,
  packageName: string,
): string | null | undefined {
  return inventory.packages.find((entry) => entry.name === packageName)?.declaredLicense;
}

// The e2e:node preCommand has already built the desktop bundle; the build
// script's upload-only hook generates the upload directory from it.
function generateDesktopUpload(parent: string): string {
  const uploadDir = path.join(parent, "desktop-upload");
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "packages/desktop/scripts/todesktop-build.mjs"),
    "--upload-only",
    uploadDir,
  ], { cwd: repoRoot, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`desktop upload directory was not generated:\n${result.stdout}\n${result.stderr}`);
  return uploadDir;
}

function packAndExtract(workspace: string, label: string, root: string): string {
  const packDir = path.join(root, "packs");
  mkdirSync(packDir, { recursive: true });
  const packed = spawnSync("npm", [
    "pack",
    "--workspace",
    workspace,
    "--pack-destination",
    packDir,
    "--json",
    "--ignore-scripts",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (packed.status !== 0) {
    throw new Error(`npm pack failed for ${workspace}:\n${packed.stdout}\n${packed.stderr}`);
  }
  const result = JSON.parse(packed.stdout) as Array<{ filename?: string }>;
  const filename = result[0]?.filename;
  if (filename === undefined) throw new Error(`npm pack returned no filename for ${workspace}`);

  const extractDir = path.join(root, label);
  mkdirSync(extractDir, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", path.join(packDir, filename), "-C", extractDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    throw new Error(`tar extraction failed for ${workspace}:\n${extracted.stdout}\n${extracted.stderr}`);
  }
  return path.join(extractDir, "package");
}

function fileSnapshot(file: string): { bytes: Buffer; mtimeNs: bigint } {
  return {
    bytes: readFileSync(file),
    mtimeNs: statSync(file, { bigint: true }).mtimeNs,
  };
}

function listFiles(root: string, prefix = ""): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, entry);
    if (statSync(path.join(root, relative)).isDirectory()) files.push(...listFiles(root, relative));
    else files.push(path.join(root, relative));
  }
  return files;
}

function readFilesWithExtension(root: string, extension: string): string {
  return listFiles(root)
    .filter((file) => path.extname(file) === extension)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function serveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "" };
  delete env.TELEVISION_ACP_AGENT;
  return env;
}

function spawnServe(storagePath: string): OwnedProcess {
  writeHomeConfig(storagePath, { port: 0, auth: false });
  return spawnOwnedProcess(process.execPath, [builtCLI, "--home", storagePath, "serve"], {
    cwd: cliDist,
    env: serveEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForPort(child: ServeChild): Promise<number> {
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for tv serve startup. stderr:\n${stderr}`));
    }, startTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const url = stdout.match(/https?:\/\/[^\s\u001B]+/)?.[0];
      if (url) {
        clearTimeout(timeout);
        resolve(Number.parseInt(new URL(url).port, 10));
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`tv serve exited before startup (code ${code}, signal ${signal}). stdout:\n${stdout}\nstderr:\n${stderr}`));
    });
    child.once("error", reject);
  });
}
