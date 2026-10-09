import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentCommands, artifactExample, storeComment } from "../helpers/resource-guidance.ts";

/*
 * The resource guidance where agents receive it: the shipped skills that the
 * real manifest-driven skills build emits from production source, with no
 * mocks. Bounded checks find each taught item in recognizable form; the slice
 * review's independent guidance review judges the teaching itself. Proves
 * [[arch/resources/guidance.md#^rg-t-document]],
 * [[arch/resources/guidance.md#^rg-t-purpose]],
 * [[arch/resources/guidance.md#^rg-t-firebase]],
 * [[arch/resources/guidance.md#^rg-t-teaches]] and
 * [[arch/resources/guidance.md#^rg-t-tv-tasks]], and the `television`
 * skill's map guidance, [[arch/artifact-frame/isolation.md#^iso-t-map-guidance]].
 */

const REPO_ROOT = path.resolve(process.cwd());
const TELEVISION_SOURCE = path.join(REPO_ROOT, "packages", "skills", "skills", "television", "src");
let dist: string;

beforeAll(() => {
  dist = mkdtempSync(path.join(os.tmpdir(), "tv-resource-guidance-"));
  execFileSync(process.execPath, [path.join(REPO_ROOT, "packages", "skills", "scripts", "build.mjs")], {
    cwd: REPO_ROOT,
    env: { ...process.env, TV_SKILLS_DIST_DIR: dist },
    stdio: "pipe",
  });
});

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

function shipped(...segments: string[]): string {
  return readFileSync(path.join(dist, ...segments), "utf8");
}

/** The sentences of a document, with its line wrapping undone. */
function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z`])/);
}

/** The document's sections: each heading with the text up to the next heading of any level. */
function sections(text: string): Array<{ heading: string; body: string }> {
  const found: Array<{ heading: string; body: string }> = [];
  for (const part of text.split(/^(?=#{1,6} )/m)) {
    const newline = part.indexOf("\n");
    if (!part.startsWith("#")) continue;
    found.push({ heading: part.slice(0, newline === -1 ? undefined : newline), body: part });
  }
  return found;
}

/** The one section whose heading matches `heading`. */
function section(text: string, heading: RegExp): string {
  const matching = sections(text).filter((candidate) => heading.test(candidate.heading));
  expect(matching.map((candidate) => candidate.heading), String(heading)).toHaveLength(1);
  return matching[0]!.body;
}

describe("the resource guidance document", () => {
  it("is emitted from its source beside SKILL.md and theming.md, and SKILL.md introduces the JSON store in one paragraph that points to it", () => {
    expect(readdirSync(path.join(dist, "television")).sort()).toEqual(["SKILL.md", "resources.md", "theming.md"]);
    expect(shipped("television", "resources.md")).toBe(readFileSync(path.join(TELEVISION_SOURCE, "resources.md"), "utf8"));

    const pointers = shipped("television", "SKILL.md").split("\n").filter((line) => line.includes("resources.md"));
    expect(pointers).toHaveLength(1);
    const pointer = pointers[0]!;
    expect(pointer).toContain("](./resources.md)");
    expect(pointer).toMatch(/JSON store/);
    expect(pointer).toMatch(/needs to keep state/);
    expect(pointer).toMatch(/mentions JSON stores or resources/);
  });

  it("leads with the JSON store's purpose, leaves where an artifact's state lives to the agent, and introduces resources after it", () => {
    const intro = shipped("television", "SKILL.md").split("\n").find((line) => line.includes("resources.md"))!;
    const text = shipped("television", "resources.md");
    const opening = text.slice(0, text.search(/^## /m));
    for (const [where, passage] of [["SKILL.md", intro], ["resources.md", opening]] as const) {
      expect(passage, where).toMatch(/small database[^.]*inspired by Firebase's Realtime Database/);
      expect(passage, where).toMatch(/durabl/);
      expect(passage, where).toMatch(/every client viewing the artifact/);
      expect(passage, where).toMatch(/`tv` CLI/);
      expect(passage, where).toMatch(/`localStorage`, cookies and IndexedDB do not work in artifacts[^.]*CSP sandbox/);
      expect(passage, where).toMatch(/`sessionStorage`[^.]*`SecurityError`/);
      expect(passage, where).toMatch(/such as a library[^.]*catch/);
      expect(passage, where).toMatch(/no storage that stays in one browser/);
      expect(passage, where).toMatch(/Markdown artifact[^.]*shared, synchronized, editable state/);
      expect(passage, where).toMatch(/Markdown artifact[^.]*within Television[^.]*share link[^.]*read-only, unlike a JSON store/);
      expect(passage, where).toMatch(/presentational flexibility and interactivity/);
      expect(passage, where).toMatch(/third-party API[^.]*external service|external service[^.]*third-party API/);
      expect(passage, where).toMatch(/design[^.]*\buse\b[^.]*person[^.]*\bdecide\b/);
      expect(passage, where).toMatch(/to-do list[^.]*standard choice[^.]*JSON store/);
    }
    expect(opening.search(/JSON store/)).toBeGreaterThanOrEqual(0);
    expect(opening.search(/JSON store/)).toBeLessThan(opening.search(/\b[Rr]esources?\b/));
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-purpose
  it("names browser storage only to say that it does not work in artifacts or how to catch the exception", () => {
    for (const file of [["television", "SKILL.md"], ["television", "resources.md"], ["tv-tasks", "SKILL.md"]] as const) {
      // Split at every sentence end, whatever follows, so that a sentence opening with a storage name stands alone.
      const naming = shipped(...file).replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((sentence) => /localStorage|sessionStorage|\bcookies?\b|IndexedDB/i.test(sentence));
      expect(naming, file.join("/")).not.toEqual([]);
      for (const sentence of naming) {
        expect(sentence, file.join("/")).toMatch(/do not work in artifacts|`SecurityError`|catch/);
      }
    }
  });
});

describe("how the resource guidance speaks of Firebase", () => {
  // spec: proofs/arch/resources/guidance.md#^rg-t-firebase
  it("presents the store's API as inspired by Firebase's, never as Firebase's", () => {
    for (const file of ["SKILL.md", "resources.md"]) {
      const text = shipped("television", file).replace(/\s+/g, " ");
      expect(text, file).not.toMatch(/Firebase-(like|shaped)/i);
      expect(text, file).not.toMatch(/shaped like (the )?Firebase/i);
      expect(text, file).not.toMatch(/(has|have|with) Firebase's (shape|API)/i);
      expect(text, file).not.toMatch(/\bbehaves? (as|like) Firebase/i);
      expect(text, file).not.toMatch(/\bas in Firebase\b/i);
      expect(text, file).not.toMatch(/Firebase('s)? (modular )?API does/i);
      // Every mention of Firebase is the inspiration, the differences or the APIs that do not exist.
      for (const sentence of sentences(text).filter((candidate) => /Firebase/.test(candidate))) {
        expect(sentence, file).toMatch(/inspired by Firebase's|differs? from Firebase|Firebase APIs?|from Firebase/);
      }
    }
    for (const passage of [
      shipped("television", "SKILL.md").split("\n").find((line) => line.includes("resources.md"))!,
      shipped("television", "resources.md").slice(0, shipped("television", "resources.md").search(/^## /m)),
    ]) {
      expect(passage).toMatch(/inspired by Firebase's Realtime Database/);
    }
    expect(section(shipped("television", "resources.md"), /^## .*Firebase/)).toMatch(/differs from Firebase/);
  });
});

describe("what the resource guidance teaches", () => {
  const guidance = () => shipped("television", "resources.md");

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("an artifact's own store, documented by a comment beside getStore()", () => {
    const own = section(guidance(), /^## .*own store/);
    expect(own).toMatch(/[Ee]very HTML artifact has its own (JSON )?store/);
    expect(own).toContain("getStore()");
    expect(own).toMatch(/nothing to create or bind|nothing needs to be created or bound|without creating or binding/);
    // The section's own snippet documents the data beside the call, as the example does.
    expect(storeComment(own).join(" ")).toMatch(/\btype\b|string|boolean|number/);

    const comment = storeComment(artifactExample(guidance()));
    const fields = new Map(comment.flatMap((line) => {
      const match = /^- (\w+): (string|number|boolean|object|array)\b[^,]*, (required|optional)\./.exec(line);
      return match === null ? [] : [[match[1]!, match[3]!] as const];
    }));
    // Every field the page writes when it adds a task has a type and says whether it is required.
    const written = /push\(\w+, \{([^}]*)\}\)/.exec(artifactExample(guidance()))?.[1];
    expect(written).toBeDefined();
    const keys = [...written!.matchAll(/(?:^|,)\s*(\w+)/g)].map((match) => match[1]!);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect([...fields.keys()], key).toContain(key);
    const who = comment.join(" ");
    expect(who).toMatch(/\b[Tt]he page\b/);
    expect(who).toMatch(/\b[Aa]n? agents?\b/);
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("the commands by artifact and the share commands", () => {
    const text = guidance();
    const shell = section(text, /^## .*from the shell/);
    for (const command of ["get", "set", "update", "push", "remove", "watch"]) {
      expect(shell, command).toMatch(new RegExp(`^tv resource json ${command} +--artifact <artifact-id>`, "m"));
    }
    for (const argv of agentCommands(text)) expect(argv.slice(0, 6), argv.join(" ")).toEqual(["tv", "resource", "json", argv[3], "--artifact", "<artifact-id>"]);
    expect(agentCommands(text).map((argv) => argv[3])).toEqual(["push", "set"]);

    const sharing = section(text, /^## Share/);
    expect(sharing).toMatch(/^tv share-artifact --id <artifact-id>$/m);
    expect(sharing).toMatch(/^tv share-artifact --id <artifact-id> --access read-write$/m);
    // The default level, `read` when --access is left out.
    expect(sentences(sharing).some((sentence) => /`--access`/.test(sentence) && /`read`/.test(sentence) && /\b(default|[Ww]ithout)\b/.test(sentence))).toBe(true);
    // Never `read-write` for a Markdown artifact.
    expect(sentences(sharing).some((sentence) => /`(?:--access )?read-write`/.test(sentence) && /\bMarkdown\b/.test(sentence) && /\b(only|refused|cannot|never)\b/.test(sentence))).toBe(true);
    // Whether an artifact has a store decides nothing about sharing.
    expect(sentences(sharing).filter((sentence) => /`(?:--access )?read-write`/.test(sentence) && /\bstore\b/.test(sentence) && /\b(only|without)\b/i.test(sentence))).toEqual([]);
    expect(sharing).toMatch(/^tv unshare-artifact --id <artifact-id>$/m);
    expect(sharing).toMatch(/`read`/);
    expect(sharing).toMatch(/`read-write`/);
    expect(sentences(sharing).some((sentence) => /again/.test(sentence) && /level/.test(sentence))).toBe(true);
    expect(sentences(sharing).some((sentence) => /revok/.test(sentence))).toBe(true);
    expect(sentences(sharing).some((sentence) => /relative/.test(sentence) && /links?/.test(sentence) && /ID/.test(sentence))).toBe(true);
    expect(sentences(sharing).some((sentence) => /[Ww]hen the person asks/.test(sentence))).toBe(true);
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("not editing a store's files directly, and why", () => {
    const files = section(guidance(), /^## .*files directly/);
    const rule = sentences(files);
    expect(rule.some((sentence) => /[Dd]o not edit|[Dd]on't edit|[Nn]ever edit/.test(sentence) && /files/.test(sentence))).toBe(true);
    expect(files).toMatch(/tv resource json/);
    expect(files).toMatch(/only the paths? (it|they) names?/);
    expect(files).toMatch(/validat/);
    expect(files).toMatch(/in order with the page's writes/);
    expect(files).toMatch(/every client/);
    expect(files).toMatch(/replaces the whole value/);
    expect(files).toMatch(/drop/);
    expect(files).toMatch(/overwrit/);
    expect(rule.some((sentence) => /[Rr]eading/.test(sentence) && /content\.json/.test(sentence) && /fine/.test(sentence))).toBe(true);
    expect(rule.some((sentence) => /recovery/.test(sentence) && /server is stopped/.test(sentence))).toBe(true);
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("nothing the bindings flag hides", () => {
    for (const file of ["SKILL.md", "resources.md"]) {
      const text = shipped("television", file);
      expect(text, file).not.toMatch(/tv resource json create/);
      expect(text, file).not.toMatch(/tv resource (un)?bind/);
      expect(text, file).not.toMatch(/getStore\(\s*[^)\s]/);
      expect(text, file).not.toMatch(/listResources|getResourceInfo/);
    }
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("one complete artifact example on its own store that imports the SDK and shows onValue, push, a transaction, a server-filled value and the connection status, and a sentence leaving the tv-tasks skill out of it", () => {
    const text = guidance();
    const example = artifactExample(text);
    expect(example).toMatch(/^<!doctype html>/i);
    expect(example).toMatch(/<\/html>\s*$/);
    expect(example).toMatch(/from "\/sdk\/v1\/resources\.js"/);
    expect(example).toMatch(/\bgetStore\(\)/);
    for (const call of ["onValue(", "push(", "runTransaction("]) expect(example, call).toContain(call);
    expect(example).toMatch(/serverTimestamp\(\)|increment\(/);
    expect(example).toMatch(/onConnectionStatusChanged\([^;]*?=>[\s\S]{0,200}?"disconnected"/);
    const tvTasks = sentences(section(text, /^## A complete example/)).filter((sentence) => /`tv-tasks`/.test(sentence));
    expect(tvTasks).toHaveLength(1);
    expect(tvTasks[0]).toMatch(/to-do lists? for a person/);
    expect(tvTasks[0]).toMatch(/left out|leaves it out/);
    expect(tvTasks[0]).toMatch(/JSON store/);
  });

  it("that a page sees its own writes, that refused writes roll back, and a saving state from hasPendingWrites in an onValue listener", () => {
    const text = guidance();
    expect(text).toMatch(/onValue\([^;]*?=>[\s\S]{0,400}?\.metadata\.hasPendingWrites/);
    const local = section(text, /^## .*own writes/);
    expect(local).toMatch(/at once|immediately/);
    expect(local).toMatch(/roll(s|ed)? back/);
  });

  it("that there is no offline mode, that a write rolled back at a loss may still be applied, and the connection status shown with onConnectionStatusChanged", () => {
    const text = guidance();
    const connection = section(text, /^## .*connection/);
    expect(connection).toMatch(/no offline mode/);
    expect(connection).toMatch(/fail at once/);
    expect(connection).toMatch(/roll(s|ed)? back/);
    expect(connection).toMatch(/may still have been applied/);
    expect(connection).toMatch(/current value/);
    expect(connection).toMatch(/onConnectionStatusChanged\([^;]*?=>[\s\S]{0,200}?"disconnected"/);
    expect(text).not.toMatch(/30 seconds/);
  });

  it("where the store differs from Firebase: null is stored, deletion is explicit, and arrays stay arrays", () => {
    const differences = section(guidance(), /^## .*Firebase/);
    expect(differences).toMatch(/set\(\w+, null\)/);
    expect(differences).toContain("remove(");
    expect(differences).toContain("deleteValue()");
    expect(differences).toMatch(/[Aa]rrays stay arrays/);
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("checking the access level with getAccess or onAccessChanged and rendering a read-only view", () => {
    const access = section(guidance(), /^## .*access level/);
    expect(access).toMatch(/(getAccess|onAccessChanged)\(/);
    expect(access).toMatch(/"read(-write)?"/);
    expect(access).toMatch(/read-only/);
    expect(access).toMatch(/share link/);
    const example = artifactExample(guidance());
    expect(example).toMatch(/onAccessChanged\(/);
    expect(example).toMatch(/"read-write"|"read"/);
  });

  it("the APIs that do not exist", () => {
    const missing = section(guidance(), /^## .*do(es)? not exist/);
    expect(missing).toContain("orderByChild");
    expect(missing).toContain("onDisconnect");
    expect(missing).toMatch(/offline persistence/i);
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-teaches
  it("that no artifact ID, share ID, token or other secret goes into artifact source or the data its store holds", () => {
    const rule = sentences(guidance()).filter((sentence) => /artifact ID/.test(sentence) && /token/.test(sentence) && /secret/.test(sentence) && /source/.test(sentence));
    expect(rule.length).toBeGreaterThan(0);
    const joined = rule.join(" ");
    expect(joined).toMatch(/\b(never|no)\b/i);
    expect(joined).toMatch(/share ID/);
    expect(joined).toMatch(/store/);
  });
});

describe("the task-list skill", () => {
  const skill = () => shipped("tv-tasks", "SKILL.md");

  // spec: proofs/arch/resources/guidance.md#^rg-t-tv-tasks
  it("leaves where task data lives to the author, calling the JSON store the standard choice for a to-do list and saying that browser storage does not work in artifacts", () => {
    expect(sections(skill()).map(({ heading }) => heading).filter((heading) => /JSON store/.test(heading))).toEqual([]);
    const rule = sentences(skill());
    expect(rule.some((sentence) => /artifact's author/.test(sentence) && /depends on[^.]*design[^.]*\buse\b[^.]*person/.test(sentence))).toBe(true);
    const sources = rule.find((sentence) => /JSON store/.test(sentence) && /third-party API/.test(sentence));
    expect(sources).toMatch(/productivity app/);
    expect(sources).toMatch(/HTML itself/);
    expect(rule.some((sentence) => /`television` skill's `resources\.md`/.test(sentence))).toBe(true);
    expect(rule.some((sentence) => /JSON store/.test(sentence) && /standard choice/.test(sentence) && /to-do list/.test(sentence))).toBe(true);
    expect(rule.some((sentence) => /`localStorage`, cookies and IndexedDB do not work in artifacts/.test(sentence) && /CSP sandbox/.test(sentence))).toBe(true);
  });

  // spec: proofs/arch/resources/guidance.md#^rg-t-tv-tasks-message
  it("puts a live list's status or error message in the page header", () => {
    const rule = sentences(skill()).filter((sentence) => /status or error message/.test(sentence)).join(" ");
    expect(rule).toMatch(/page header/);
    expect(rule).toMatch(/subtitle/);
    expect(sentences(skill()).some((sentence) => /page header to hold it/.test(sentence))).toBe(true);
  });
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-map-guidance
describe("the television skill's map guidance", () => {
  it("says that mapping services may not work in artifacts because the sandbox strips what they expect, and recommends Leaflet with Esri's tiles", () => {
    const text = sentences(shipped("television", "SKILL.md"));
    expect(text.some((sentence) => /mapping services/.test(sentence) && /may not work/.test(sentence) && /sandbox/.test(sentence) && /referrer/.test(sentence))).toBe(true);
    expect(text.some((sentence) => /Leaflet/.test(sentence) && /Esri/.test(sentence) && /World Street Map/.test(sentence) && /World Imagery/.test(sentence))).toBe(true);
  });
});
