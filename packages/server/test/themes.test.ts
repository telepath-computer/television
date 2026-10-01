import { afterEach, describe, expect, it } from "vitest";
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getThemeDir,
  getThemeEntryPath,
  getThemesDir,
  scanThemesDirectory,
  validateThemePackage,
} from "../src/themes.ts";

const JAVASCRIPT_ENTRIES = [
  ["enableMainJS", "main.js"],
  ["enableIframeBackgroundJS", "iframe-background.js"],
  ["enableIframeOverlayJS", "iframe-overlay.js"],
] as const;
type JavaScriptEntryFile = typeof JAVASCRIPT_ENTRIES[number][1];

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-themes-"));
}

function seedTheme(
  storagePath: string,
  themeID: string,
  options: {
    css?: string;
    manifest?: Record<string, unknown>;
    manifestText?: string;
    themeEntry?: "file" | "directory" | "missing";
    scripts?: Partial<Record<JavaScriptEntryFile, string>>;
    scriptEntries?: Partial<Record<JavaScriptEntryFile, "file" | "directory" | "missing">>;
  } = {},
): string {
  const themeDir = path.join(storagePath, "themes", themeID);
  mkdirSync(themeDir, { recursive: true });
  const manifest = {
    colorScheme: "light dark",
    ...(options.manifest ?? { name: themeID, version: "1.0.0" }),
  };
  if (options.manifestText !== undefined) {
    writeFileSync(path.join(themeDir, "manifest.json"), options.manifestText);
  } else {
    writeFileSync(path.join(themeDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  if (options.themeEntry === "directory") {
    mkdirSync(path.join(themeDir, "theme.css"));
  } else if (options.themeEntry !== "missing") {
    writeFileSync(path.join(themeDir, "theme.css"), options.css ?? "/* theme */");
  }
  for (const [, filename] of JAVASCRIPT_ENTRIES) {
    if (options.scriptEntries?.[filename] === "directory") {
      mkdirSync(path.join(themeDir, filename));
    } else if (
      options.scriptEntries?.[filename] === "file" ||
      options.scripts?.[filename] !== undefined
    ) {
      writeFileSync(
        path.join(themeDir, filename),
        options.scripts?.[filename] ?? "/* theme script */",
      );
    }
  }
  return themeDir;
}

// proofs/arch/themes/index.md#^themes-t-package-validation,
// #^themes-t-scan, and #^themes-t-build-validation.
describe("themes paths and package validation", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds package paths from exact filesystem theme IDs", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    expect(getThemesDir(storagePath)).toBe(path.join(storagePath, "themes"));
    expect(getThemeEntryPath(storagePath, "Paper Theme.v2")).toBe(
      path.join(storagePath, "themes", "Paper Theme.v2", "theme.css"),
    );
  });

  // proofs/arch/themes/index.md#^themes-t-color-scheme-package
  it("normalizes theme color schemes and rejects every invalid class", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    for (const [themeID, colorScheme, expected] of [
      ["canonical-light", "light", "light"],
      ["padded-dark", "  DARK\t", "dark"],
      ["mixed-both", "  LiGhT\n dark  ", "light dark"],
      ["repeated-reversed", "dark dark\tLIGHT", "light dark"],
    ] as const) {
      const themeDir = seedTheme(storagePath, themeID, {
        manifest: { name: themeID, version: "1.0.0", colorScheme },
      });
      expect(validateThemePackage(themeDir, themeID)).toEqual({
        theme: {
          id: themeID,
          name: themeID,
          version: "1.0.0",
          colorScheme: expected,
        },
        errors: [],
      });
    }

    for (const [themeID, colorScheme] of [
      ["missing", undefined],
      ["non-string", 7],
      ["empty", " \t\n "],
      ["unrecognized", "light sepia"],
    ] as const) {
      const themeDir = seedTheme(storagePath, themeID, {
        manifest: { name: themeID, version: "1.0.0", colorScheme },
      });
      const result = validateThemePackage(themeDir, themeID);
      expect(result.theme).toBeUndefined();
      expect(result.errors.join("\n")).toMatch(/colorScheme/);
      expect(result.errors.join("\n")).toContain("light");
      expect(result.errors.join("\n")).toContain("dark");
      expect(result.errors.join("\n")).toContain("light dark");
    }
  });

  it("returns the exact theme ID and supported metadata from a valid package", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const themeDir = seedTheme(storagePath, "Cobalt Theme.v2", {
      manifest: {
        name: "Cobalt Sky",
        version: "2.3.4-beta.2+build.9",
        authoredForAppVersion: "0.1.210",
        description: "not part of the runtime manifest",
        author: "Private Name",
      },
    });

    expect(validateThemePackage(themeDir, "Cobalt Theme.v2")).toEqual({
      theme: {
        id: "Cobalt Theme.v2",
        name: "Cobalt Sky",
        version: "2.3.4-beta.2+build.9",
        colorScheme: "light dark",
        authoredForAppVersion: "0.1.210",
      },
      errors: [],
    });
  });

  // proofs/arch/themes/index.md#^themes-t-readme-ignored
  it("ignores a package README during validation and registry scanning without changing it", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const themeID = "readme-probe";
    const themeDir = seedTheme(storagePath, themeID, {
      manifest: { name: "README Probe", version: "1.2.3" },
    });
    const readmePath = path.join(themeDir, "README.md");
    const readmeMarker = "PRIVATE_README_CONTENT_7f623d";
    const readmeBytes = Buffer.from(`# Theme authoring notes\n\n${readmeMarker}\n`, "utf8");
    writeFileSync(readmePath, readmeBytes);

    const expectedTheme = {
      id: themeID,
      name: "README Probe",
      version: "1.2.3",
      colorScheme: "light dark",
    };
    const validation = validateThemePackage(themeDir, themeID);
    const snapshot = scanThemesDirectory(getThemesDir(storagePath));

    expect(validation).toStrictEqual({ theme: expectedTheme, errors: [] });
    expect(snapshot).toStrictEqual({ themes: [expectedTheme], errors: [] });
    expect(JSON.stringify({ validation, snapshot })).not.toContain(readmeMarker);
    expect(readFileSync(readmePath)).toEqual(readmeBytes);
  });

  it("omits missing or unparseable authored-against metadata and accepts unrestricted filesystem theme IDs", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    for (const themeID of ["UPPERCASE", "with space", "with.dot!", "日本語-🎨"]) {
      const themeDir = seedTheme(storagePath, themeID);
      expect(validateThemePackage(themeDir, themeID)).toEqual({
        theme: {
          id: themeID,
          name: themeID,
          version: "1.0.0",
          colorScheme: "light dark",
        },
        errors: [],
      });
    }

    for (const [themeID, authoredForAppVersion] of [
      ["invalid-string", "current"],
      ["non-string", 210],
      ["null-value", null],
    ] as const) {
      const themeDir = seedTheme(storagePath, themeID, {
        manifest: { name: themeID, version: "1.0.0", authoredForAppVersion },
      });
      expect(validateThemePackage(themeDir, themeID)).toEqual({
        theme: {
          id: themeID,
          name: themeID,
          version: "1.0.0",
          colorScheme: "light dark",
        },
        errors: [],
      });
    }
  });

  it.each([
    ["empty name", { name: "   ", version: "1.0.0" }, /non-empty name/i],
    ["non-string name", { name: 7, version: "1.0.0" }, /non-empty name/i],
    ["short version", { name: "Paper", version: "1.0" }, /Semantic Version/i],
    ["prefixed version", { name: "Paper", version: "v1.0.0" }, /Semantic Version/i],
    ["leading-zero version", { name: "Paper", version: "01.0.0" }, /Semantic Version/i],
    ["leading-zero prerelease", { name: "Paper", version: "1.0.0-01" }, /Semantic Version/i],
  ])("rejects a manifest with %s", (_label, manifest, errorMatch) => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const themeDir = seedTheme(storagePath, "paper", { manifest });

    const result = validateThemePackage(themeDir, "paper");
    expect(result.theme).toBeUndefined();
    expect(result.errors.join("\n")).toMatch(errorMatch);
  });

  it("rejects malformed and non-file manifests", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const malformed = seedTheme(storagePath, "malformed", { manifestText: "{" });
    const nonFile = path.join(storagePath, "themes", "non-file");
    mkdirSync(path.join(nonFile, "manifest.json"), { recursive: true });
    writeFileSync(path.join(nonFile, "theme.css"), "/* theme */");

    expect(validateThemePackage(malformed, "malformed").errors.join("\n")).toMatch(/parse manifest\.json/i);
    expect(validateThemePackage(nonFile, "non-file").errors.join("\n")).toMatch(/read manifest\.json/i);
  });

  it("rejects a missing or non-file theme.css", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const missing = seedTheme(storagePath, "missing", { themeEntry: "missing" });
    const directory = seedTheme(storagePath, "directory", { themeEntry: "directory" });

    expect(validateThemePackage(missing, "missing").errors.join("\n")).toMatch(/theme\.css.*readable regular file/i);
    expect(validateThemePackage(directory, "directory").errors.join("\n")).toMatch(/theme\.css.*readable regular file/i);
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-package
  it("preserves all JavaScript declaration values and ignores unflagged or invalid script bytes", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    for (const [flag, filename] of JAVASCRIPT_ENTRIES) {
      for (const enabled of [true, false]) {
        const themeID = `${flag}-${enabled}`;
        const themeDir = seedTheme(storagePath, themeID, {
          manifest: { name: themeID, version: "1.0.0", [flag]: enabled },
          scripts: { [filename]: "this is not valid JavaScript {" },
        });
        expect(validateThemePackage(themeDir, themeID)).toEqual({
          theme: {
            id: themeID,
            name: themeID,
            version: "1.0.0",
            colorScheme: "light dark",
            [flag]: enabled,
          },
          errors: [],
        });
      }

      const unflaggedID = `${flag}-unflagged`;
      const unflagged = seedTheme(storagePath, unflaggedID, {
        scripts: { [filename]: "globalThis.unflagged = true;" },
      });
      expect(validateThemePackage(unflagged, unflaggedID)).toEqual({
        theme: {
          id: unflaggedID,
          name: unflaggedID,
          version: "1.0.0",
          colorScheme: "light dark",
        },
        errors: [],
      });
    }

    const joint = seedTheme(storagePath, "joint", {
      manifest: {
        name: "Joint",
        version: "1.0.0",
        enableMainJS: true,
        enableIframeBackgroundJS: false,
        enableIframeOverlayJS: true,
      },
      scripts: {
        "main.js": "/* main */",
        "iframe-background.js": "/* background */",
        "iframe-overlay.js": "/* overlay */",
      },
    });
    expect(validateThemePackage(joint, "joint")).toEqual({
      theme: {
        id: "joint",
        name: "Joint",
        version: "1.0.0",
        colorScheme: "light dark",
        enableMainJS: true,
        enableIframeBackgroundJS: false,
        enableIframeOverlayJS: true,
      },
      errors: [],
    });

    const cssOnly = seedTheme(storagePath, "css-only");
    expect(validateThemePackage(cssOnly, "css-only")).toEqual({
      theme: {
        id: "css-only",
        name: "css-only",
        version: "1.0.0",
        colorScheme: "light dark",
      },
      errors: [],
    });
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-package
  it("rejects every invalid JavaScript declaration and matching missing, non-file, or unreadable entry", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    for (const [flag, filename] of JAVASCRIPT_ENTRIES) {
      const entryError = new RegExp(
        `${filename.replaceAll(".", "\\.")}.*readable regular file`,
        "i",
      );
      for (const [label, value] of [
        ["string", "true"],
        ["number", 1],
        ["null", null],
        ["object", {}],
      ] as const) {
        const themeID = `${flag}-${label}`;
        const themeDir = seedTheme(storagePath, themeID, {
          manifest: { name: themeID, version: "1.0.0", [flag]: value },
          scripts: { [filename]: "/* present */" },
        });
        expect(validateThemePackage(themeDir, themeID).errors.join("\n"))
          .toMatch(new RegExp(`${flag}.*boolean`, "i"));
      }

      for (const enabled of [true, false]) {
        const themeID = `${flag}-missing-${enabled}`;
        const themeDir = seedTheme(storagePath, themeID, {
          manifest: { name: themeID, version: "1.0.0", [flag]: enabled },
        });
        expect(validateThemePackage(themeDir, themeID).errors.join("\n"))
          .toMatch(entryError);
      }

      const mismatchedFilename = JAVASCRIPT_ENTRIES.find(
        ([otherFlag]) => otherFlag !== flag,
      )![1];
      const mismatchedID = `${flag}-mismatched-entry`;
      const mismatched = seedTheme(storagePath, mismatchedID, {
        manifest: { name: mismatchedID, version: "1.0.0", [flag]: true },
        scripts: { [mismatchedFilename]: "/* wrong entry */" },
      });
      expect(validateThemePackage(mismatched, mismatchedID).errors.join("\n"))
        .toMatch(entryError);

      const directoryID = `${flag}-directory`;
      const directory = seedTheme(storagePath, directoryID, {
        manifest: { name: directoryID, version: "1.0.0", [flag]: true },
        scriptEntries: { [filename]: "directory" },
      });
      expect(validateThemePackage(directory, directoryID).errors.join("\n"))
        .toMatch(entryError);

      const unreadableID = `${flag}-unreadable`;
      const unreadable = seedTheme(storagePath, unreadableID, {
        manifest: { name: unreadableID, version: "1.0.0", [flag]: true },
        scripts: { [filename]: "/* unreadable */" },
      });
      const unreadablePath = path.join(unreadable, filename);
      chmodSync(unreadablePath, 0o000);
      try {
        let processCanRead = true;
        try {
          accessSync(unreadablePath, constants.R_OK);
        } catch {
          processCanRead = false;
        }
        if (!processCanRead) {
          expect(validateThemePackage(unreadable, unreadableID).errors.join("\n"))
            .toMatch(entryError);
        }
      } finally {
        chmodSync(unreadablePath, 0o600);
      }
    }

    const combined = seedTheme(storagePath, "combined", {
      manifest: {
        name: "",
        version: "1.0.0",
        enableMainJS: true,
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      },
    });
    const combinedErrors = validateThemePackage(combined, "combined").errors.join("\n");
    expect(combinedErrors).toMatch(/non-empty name/i);
    for (const [, filename] of JAVASCRIPT_ENTRIES) {
      expect(combinedErrors).toMatch(
        new RegExp(`${filename.replaceAll(".", "\\.")}.*readable regular file`, "i"),
      );
    }
  });

  it("reports several package defects in one folder error", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    seedTheme(storagePath, "broken", {
      manifest: { name: "", version: "bad", authoredForAppVersion: "also-bad" },
      themeEntry: "missing",
    });

    const snapshot = scanThemesDirectory(getThemesDir(storagePath));
    expect(snapshot.themes).toEqual([]);
    expect(snapshot.errors).toHaveLength(1);
    expect(snapshot.errors[0]).toMatchObject({ folder: "broken" });
    expect(snapshot.errors[0]!.error).toMatch(/name/i);
    expect(snapshot.errors[0]!.error).toMatch(/manifest version.*Semantic Version/i);
    expect(snapshot.errors[0]!.error).not.toMatch(/authoredForAppVersion/i);
    expect(snapshot.errors[0]!.error).toMatch(/theme\.css/i);
  });

  it("sorts valid themes by English display name and then exact theme ID", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    seedTheme(storagePath, "Zulu Theme", { manifest: { name: "Zulu", version: "1.0.0" } });
    seedTheme(storagePath, "Amber.B", { manifest: { name: "Amber", version: "1.0.0" } });
    seedTheme(storagePath, "Amber A", { manifest: { name: "Amber", version: "1.0.0" } });

    expect(scanThemesDirectory(getThemesDir(storagePath)).themes).toEqual([
      { id: "Amber A", name: "Amber", version: "1.0.0", colorScheme: "light dark" },
      { id: "Amber.B", name: "Amber", version: "1.0.0", colorScheme: "light dark" },
      { id: "Zulu Theme", name: "Zulu", version: "1.0.0", colorScheme: "light dark" },
    ]);
  });

  it("sorts invalid folders and ignores all dot folders, files, and symbolic links", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const themesDir = getThemesDir(storagePath);
    seedTheme(storagePath, "z-broken", { manifestText: "{" });
    seedTheme(storagePath, "a-broken", { manifestText: "{" });
    seedTheme(storagePath, ".valid-hidden");
    seedTheme(storagePath, ".invalid-hidden", { manifestText: "{" });
    const linkedTarget = seedTheme(storagePath, "linked-target");
    symlinkSync(linkedTarget, path.join(themesDir, "linked-alias"), "dir");
    writeFileSync(path.join(themesDir, "README.txt"), "not a package");

    const snapshot = scanThemesDirectory(themesDir);
    expect(snapshot.themes.map((theme) => theme.id)).toEqual(["linked-target"]);
    expect(snapshot.errors.map((entry) => entry.folder)).toEqual([
      "a-broken",
      "z-broken",
    ]);
  });

  it("returns one path-free error when the themes directory cannot be read", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const notDirectory = path.join(storagePath, "private-themes-location");
    writeFileSync(notDirectory, "not a directory");

    const snapshot = scanThemesDirectory(notDirectory);
    expect(snapshot).toEqual({
      themes: [],
      errors: [{ folder: null, error: "cannot read themes directory" }],
    });
    expect(JSON.stringify(snapshot)).not.toContain(storagePath);
  });

  it("omits absolute paths from package validation errors", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    seedTheme(storagePath, "private-folder-name", { manifestText: "{" , themeEntry: "missing" });

    const snapshot = scanThemesDirectory(getThemesDir(storagePath));
    expect(JSON.stringify(snapshot)).not.toContain(storagePath);
    expect(snapshot.errors[0]?.folder).toBe("private-folder-name");
  });

});
