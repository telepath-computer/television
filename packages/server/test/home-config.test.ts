import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readTelevisionConfig,
  resolveTelevisionHome,
  TelevisionConfigError,
  updateTelevisionConfig,
} from "../src/index.ts";

// Real temporary directories stand in for the operating-system home, the
// working directory, and the Television home, so no case reads or writes the
// operator's ~/.tv-home or ~/.television.

const DEFAULT_SETTINGS = { port: 32848, listen: [], auth: true };

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-home-config-"));
}

function writeConfig(home: string, contents: string): string {
  mkdirSync(home, { recursive: true });
  const configPath = path.join(home, "config.json");
  writeFileSync(configPath, contents);
  return configPath;
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected the action to throw");
}

describe("Television home and config", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fixture(): { osHome: string; cwd: string; root: string } {
    const root = tempDir();
    dirs.push(root);
    const osHome = path.join(root, "os-home");
    const cwd = path.join(root, "cwd");
    mkdirSync(osHome);
    mkdirSync(cwd);
    return { osHome, cwd, root };
  }

  function writePointer(osHome: string, contents: string): string {
    const pointerPath = path.join(osHome, ".tv-home");
    writeFileSync(pointerPath, contents);
    return pointerPath;
  }

  // proofs/arch/cli/index.md#^cli-home-option-contract
  describe("resolveTelevisionHome with --home", () => {
    it("resolves a relative --home against cwd and returns an absolute one unchanged", () => {
      const { osHome, cwd, root } = fixture();
      const absolute = path.join(root, "chosen-home");

      expect(resolveTelevisionHome({ homeOption: "homes/tv", operatingSystemHomeDir: osHome, cwd }))
        .toBe(path.join(cwd, "homes", "tv"));
      expect(resolveTelevisionHome({ homeOption: absolute, operatingSystemHomeDir: osHome, cwd }))
        .toBe(absolute);
    });

    it("gives ~ no special meaning in --home", () => {
      const { osHome, cwd } = fixture();

      expect(resolveTelevisionHome({ homeOption: "~/x", operatingSystemHomeDir: osHome, cwd }))
        .toBe(path.join(cwd, "~", "x"));
    });

    it("does not read .tv-home when --home is given, even when the file is invalid", () => {
      const { osHome, cwd, root } = fixture();
      writePointer(osHome, "~otheruser/tv\nsecond line\n");
      const absolute = path.join(root, "chosen-home");

      expect(resolveTelevisionHome({ homeOption: absolute, operatingSystemHomeDir: osHome, cwd }))
        .toBe(absolute);
    });

    it("rejects an empty or whitespace-only --home with an error naming --home", () => {
      const { osHome, cwd } = fixture();

      for (const homeOption of ["", "   ", "\t\n"]) {
        const error = captureError(() => resolveTelevisionHome({ homeOption, operatingSystemHomeDir: osHome, cwd }));
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("--home");
      }
    });
  });

  // proofs/arch/cli/index.md#^cli-home-pointer-contract
  describe("resolveTelevisionHome from the default home", () => {
    it("selects .television in the operating-system home when .tv-home is missing", () => {
      const { osHome, cwd } = fixture();

      expect(resolveTelevisionHome({ homeOption: undefined, operatingSystemHomeDir: osHome, cwd }))
        .toBe(path.join(osHome, ".television"));
    });

    it("resolves each .tv-home pointer form against the operating-system home", () => {
      const { osHome, cwd, root } = fixture();
      const absolute = path.join(root, "var", "tv");
      const cases: Array<[string, string]> = [
        [absolute, absolute],
        ["~", osHome],
        ["~/", osHome],
        ["~/Dropbox/television", path.join(osHome, "Dropbox", "television")],
        ["Dropbox/television", path.join(osHome, "Dropbox", "television")],
        [".television", path.join(osHome, ".television")],
        // Repeated separators keep each form's starting point.
        ["~//Dropbox/television", path.join(osHome, "Dropbox", "television")],
        ["~/Dropbox//television", path.join(osHome, "Dropbox", "television")],
        ["Dropbox//television", path.join(osHome, "Dropbox", "television")],
        [`/${absolute}`, absolute],
      ];

      for (const [contents, expected] of cases) {
        writePointer(osHome, contents);
        expect(resolveTelevisionHome({ homeOption: undefined, operatingSystemHomeDir: osHome, cwd }), contents)
          .toBe(expected);
      }
    });

    it("ignores a trailing slash, surrounding whitespace, and a final newline", () => {
      const { osHome, cwd } = fixture();
      const expected = path.join(osHome, "Dropbox", "television");

      for (const contents of [
        "Dropbox/television/",
        "  Dropbox/television  ",
        "Dropbox/television\n",
        "\n  ~/Dropbox/television/ \r\n",
      ]) {
        writePointer(osHome, contents);
        expect(resolveTelevisionHome({ homeOption: undefined, operatingSystemHomeDir: osHome, cwd }), JSON.stringify(contents))
          .toBe(expected);
      }
    });

    it("returns a symbolic link in the pointer path unresolved", () => {
      const { osHome, cwd, root } = fixture();
      const target = path.join(root, "real-home");
      const link = path.join(root, "linked-home");
      mkdirSync(target);
      symlinkSync(target, link);
      writePointer(osHome, link);

      expect(resolveTelevisionHome({ homeOption: undefined, operatingSystemHomeDir: osHome, cwd })).toBe(link);
    });
  });

  // proofs/arch/cli/index.md#^cli-home-pointer-errors
  describe("resolveTelevisionHome .tv-home errors", () => {
    function pointerError(osHome: string, cwd: string): Error {
      const error = captureError(() => resolveTelevisionHome({ homeOption: undefined, operatingSystemHomeDir: osHome, cwd }));
      expect(error).toBeInstanceOf(Error);
      return error as Error;
    }

    it("names the file and the problem when .tv-home cannot be read as a file", () => {
      const { osHome, cwd } = fixture();
      const pointerPath = path.join(osHome, ".tv-home");
      mkdirSync(pointerPath);

      const error = pointerError(osHome, cwd);
      expect(error.message).toContain(pointerPath);
      expect(error.message).toMatch(/cannot be read/i);
    });

    it("names the file and the problem when .tv-home holds no path", () => {
      const { osHome, cwd } = fixture();
      const pointerPath = writePointer(osHome, "  \n\t\n");

      const error = pointerError(osHome, cwd);
      expect(error.message).toContain(pointerPath);
      expect(error.message).toMatch(/holds no path/i);
    });

    it("names the file and the problem when .tv-home holds more than one line", () => {
      const { osHome, cwd } = fixture();
      const pointerPath = writePointer(osHome, "/var/tv\n/srv/tv\n");

      const error = pointerError(osHome, cwd);
      expect(error.message).toContain(pointerPath);
      expect(error.message).toMatch(/more than one line/i);
    });

    it("rejects ~ followed by a user name and suggests an absolute path", () => {
      const { osHome, cwd } = fixture();

      for (const contents of ["~otheruser/tv", "~x"]) {
        const pointerPath = writePointer(osHome, contents);
        const error = pointerError(osHome, cwd);
        expect(error.message).toContain(pointerPath);
        expect(error.message).toContain("~ followed by a user name is not supported");
        expect(error.message).toMatch(/absolute path/i);
      }
    });
  });

  // proofs/arch/cli/index.md#^cli-config-reader-defaults
  describe("readTelevisionConfig defaults", () => {
    it("returns the defaults for a missing file and for {}", () => {
      const home = path.join(tempDir(), "home");
      dirs.push(path.dirname(home));
      const configPath = path.join(home, "config.json");

      expect(readTelevisionConfig(home)).toEqual({
        home,
        configPath,
        configFileExists: false,
        settings: DEFAULT_SETTINGS,
      });

      writeConfig(home, "{}");
      expect(readTelevisionConfig(home)).toEqual({
        home,
        configPath,
        configFileExists: true,
        settings: DEFAULT_SETTINGS,
      });
    });

    it("fills absent keys of a partial file", () => {
      const home = tempDir();
      dirs.push(home);
      writeConfig(home, JSON.stringify({ port: 43123, installedByAgent: "Claude Code" }));

      expect(readTelevisionConfig(home).settings).toEqual({
        port: 43123,
        listen: [],
        auth: true,
        installedByAgent: "Claude Code",
      });
    });

    it("returns every value of a complete valid file", () => {
      const home = tempDir();
      dirs.push(home);

      for (const file of [
        { port: 0, listen: ["0.0.0.0"], auth: false, installedByAgent: "OpenClaw" },
        { port: 65535, listen: ["100.64.0.7", "192.168.1.42"], auth: true, installedByAgent: "" },
      ]) {
        writeConfig(home, JSON.stringify(file));
        expect(readTelevisionConfig(home)).toEqual({
          home,
          configPath: path.join(home, "config.json"),
          configFileExists: true,
          settings: file,
        });
      }
    });
  });

  // proofs/arch/cli/index.md#^cli-config-reader-errors
  describe("readTelevisionConfig errors", () => {
    function readError(home: string): TelevisionConfigError {
      const error = captureError(() => readTelevisionConfig(home));
      expect(error).toBeInstanceOf(TelevisionConfigError);
      const configError = error as TelevisionConfigError;
      expect(configError.configPath).toBe(path.join(home, "config.json"));
      expect(configError.message).toContain(configError.configPath);
      return configError;
    }

    it("rejects a config.json that cannot be read as a file", () => {
      const home = tempDir();
      dirs.push(home);
      mkdirSync(path.join(home, "config.json"));

      expect(readError(home).message).toMatch(/cannot be read/i);
    });

    it("rejects malformed JSON and a top level that is not an object", () => {
      const home = tempDir();
      dirs.push(home);
      const cases: Array<[string, RegExp]> = [
        ["{\"port\": 1,", /not valid JSON/i],
        ["[]", /must hold a JSON object/i],
        ["null", /must hold a JSON object/i],
        ["32848", /must hold a JSON object/i],
      ];

      for (const [contents, problem] of cases) {
        writeConfig(home, contents);
        expect(readError(home).message, contents).toMatch(problem);
      }
    });

    it("rejects an unknown key and names it", () => {
      const home = tempDir();
      dirs.push(home);
      writeConfig(home, JSON.stringify({ port: 32848, storagePath: "/var/tv" }));

      expect(readError(home).message).toContain("\"storagePath\"");
    });

    it("rejects each invalid value and names its key", () => {
      const home = tempDir();
      dirs.push(home);
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ port: "32848" }, "port"],
        [{ port: 1.5 }, "port"],
        [{ port: -1 }, "port"],
        [{ port: 65536 }, "port"],
        [{ listen: "100.64.0.7" }, "listen"],
        [{ listen: [7] }, "listen"],
        [{ listen: ["example.com"] }, "listen"],
        [{ listen: ["*"] }, "listen"],
        [{ listen: ["::1"] }, "listen"],
        [{ auth: "false" }, "auth"],
        [{ auth: 0 }, "auth"],
        [{ installedByAgent: 7 }, "installedByAgent"],
        [{ installedByAgent: null }, "installedByAgent"],
      ];

      for (const [file, key] of cases) {
        writeConfig(home, JSON.stringify({ port: 32848, ...file }));
        expect(readError(home).message, JSON.stringify(file)).toContain(`"${key}"`);
      }
    });

    it("ignores TELEVISION_PORT and TELEVISION_STORAGE_PATH", () => {
      const validHome = tempDir();
      const missingHome = path.join(tempDir(), "missing");
      const invalidHome = tempDir();
      dirs.push(validHome, path.dirname(missingHome), invalidHome);
      writeConfig(validHome, JSON.stringify({ port: 43123, auth: false }));
      writeConfig(invalidHome, JSON.stringify({ port: "43123" }));
      const baseline = {
        valid: readTelevisionConfig(validHome),
        missing: readTelevisionConfig(missingHome),
        invalid: readError(invalidHome).message,
      };

      for (const [port, storagePath] of [["51234", validHome], ["not-a-port", ""], ["0", "/nonexistent/tv"]]) {
        vi.stubEnv("TELEVISION_PORT", port);
        vi.stubEnv("TELEVISION_STORAGE_PATH", storagePath);
        expect(readTelevisionConfig(validHome)).toEqual(baseline.valid);
        expect(readTelevisionConfig(missingHome)).toEqual(baseline.missing);
        expect(readError(invalidHome).message).toBe(baseline.invalid);
      }
    });
  });

  // proofs/arch/cli/index.md#^cli-config-writer-contract
  describe("updateTelevisionConfig", () => {
    it("creates a missing home and its parents and writes the changes", () => {
      const root = tempDir();
      dirs.push(root);
      const home = path.join(root, "a", "b", "home");

      const result = updateTelevisionConfig(home, { port: 43123, listen: ["100.64.0.7"] });

      expect(readFileSync(path.join(home, "config.json"), "utf8"))
        .toBe("{\n  \"port\": 43123,\n  \"listen\": [\n    \"100.64.0.7\"\n  ]\n}\n");
      expect(readdirSync(home)).toEqual(["config.json"]);
      expect(result).toEqual(readTelevisionConfig(home));
      expect(result.settings).toEqual({ port: 43123, listen: ["100.64.0.7"], auth: true });
    });

    it("replaces only the changed keys, preserves the others, and replaces the file by rename", () => {
      const home = tempDir();
      dirs.push(home);
      mkdirSync(path.join(home, "state"));
      const configPath = writeConfig(home, JSON.stringify({ port: 43123, auth: false, installedByAgent: "Claude Code" }));
      const inodeBefore = statSync(configPath).ino;
      const entriesBefore = readdirSync(home).sort();

      const result = updateTelevisionConfig(home, { auth: true, listen: ["100.64.0.7"] });

      expect(readFileSync(configPath, "utf8")).toBe(
        "{\n  \"port\": 43123,\n  \"auth\": true,\n  \"installedByAgent\": \"Claude Code\",\n  \"listen\": [\n    \"100.64.0.7\"\n  ]\n}\n",
      );
      expect(statSync(configPath).ino).not.toBe(inodeBefore);
      expect(readdirSync(home).sort()).toEqual(entriesBefore);
      expect(result).toEqual(readTelevisionConfig(home));
    });

    it("replaces a stored invalid value of a known key with a valid one", () => {
      const home = tempDir();
      dirs.push(home);
      const configPath = writeConfig(home, JSON.stringify({ port: "abc", auth: false }));

      const result = updateTelevisionConfig(home, { port: 5 });

      expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ port: 5, auth: false });
      expect(result.settings).toEqual({ port: 5, listen: [], auth: false });
    });

    it("refuses unusable stored files and invalid results, leaving config.json unchanged", () => {
      const cases: Array<[string, string, Parameters<typeof updateTelevisionConfig>[1]]> = [
        ["an unknown stored key", JSON.stringify({ port: 1, bogus: true }), { port: 2 }],
        ["malformed stored JSON", "{\"port\": 1,", { port: 2 }],
        ["a stored top level that is not an object", "[1]", { port: 2 }],
        ["an invalid complete result", JSON.stringify({ port: 1 }), { listen: ["example.com"] }],
      ];

      for (const [label, contents, changes] of cases) {
        const home = tempDir();
        dirs.push(home);
        const configPath = writeConfig(home, contents);
        const bytesBefore = readFileSync(configPath);

        const error = captureError(() => updateTelevisionConfig(home, changes));

        expect(error, label).toBeInstanceOf(TelevisionConfigError);
        expect((error as TelevisionConfigError).configPath, label).toBe(configPath);
        expect((error as TelevisionConfigError).message, label).toContain(configPath);
        expect(readFileSync(configPath), label).toEqual(bytesBefore);
        expect(readdirSync(home), label).toEqual(["config.json"]);
      }
    });

    it("refuses an invalid result for a missing file without creating the home", () => {
      const root = tempDir();
      dirs.push(root);
      const home = path.join(root, "a", "home");

      const error = captureError(() => updateTelevisionConfig(home, { port: 70000 }));

      expect(error).toBeInstanceOf(TelevisionConfigError);
      expect((error as TelevisionConfigError).message).toContain(path.join(home, "config.json"));
      expect(existsSync(path.join(root, "a"))).toBe(false);
    });
  });
});
