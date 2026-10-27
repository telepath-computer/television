import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { owningSurfaces, selectSurfaces } from "./config.mjs";
import { enumerateTrackedPaths, TEST_FILE_PATTERN } from "./file-inventory.mjs";

export const BROAD_LOCAL = "against-test-guidance-broad-local-run";
export const BROAD_ZERO = "against-test-guidance-turn-flakes-into-failures-on-broad-runs";

export function hasBlaxelMarker() {
  return fs.existsSync(path.join(os.homedir(), ".tvdev-use-blaxel"));
}

// Resolve once, before admission. The native adapters consume these same files.
export function resolveFileSelection({ config, options, repoRoot = process.cwd(), commit = null }) {
  const candidates = selectSurfaces(config, { ...options, file: undefined });
  if (!options.file) {
    if (!candidates.length) throw new Error("Selection matched no test surfaces.");
    return { surfaces: candidates, files: null, oneFile: false };
  }
  const filter = path.relative(repoRoot, path.resolve(repoRoot, options.file)).split(path.sep).join("/");
  const paths = enumerateTrackedPaths({ repoRoot, commit, includeUntracked: !commit }).filter((file) => TEST_FILE_PATTERN.test(file));
  const exact = paths.includes(filter);
  const matches = paths.filter((file) => exact ? file === filter : file.includes(filter));
  if (!matches.length) throw new Error(`No test files match --file ${options.file}.${commit ? "" : " Local selection includes tracked and non-ignored working-tree test files."}`);
  const files = [];
  for (const file of matches) {
    const owners = owningSurfaces(config.surfaces, file);
    if (!owners.length) throw new Error(`No test surface owns ${file}.`);
    const selected = owners.filter((owner) => candidates.some((candidate) => candidate.id === owner.id));
    if (selected.length > 1) throw new Error(`${file} is owned by multiple surfaces: ${selected.map((owner) => owner.id).join(", ")}. Pass --surface <id> to disambiguate.`);
    if (selected.length === 1) files.push({ path: file, surfaceId: selected[0].id });
  }
  if (!files.length) throw new Error(`${options.file} is not part of the selected surfaces. Check its owning surface and co-selectors.`);
  const surfaces = candidates.filter((surface) => files.some((file) => file.surfaceId === surface.id));
  if (surfaces.length > 1) throw new Error(`${options.file} is owned by multiple surfaces: ${surfaces.map((surface) => surface.id).join(", ")}. Pass --surface <id> to disambiguate.`);
  return { surfaces, files, oneFile: files.length === 1 };
}

export function resolveRetryPolicy(options, { oneFile = false } = {}) {
  const raw = options.retries;
  if (raw !== undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))) throw new Error("--retries must be a non-negative integer.");
  if (options[BROAD_ZERO] && raw !== undefined && Number(raw) !== 0) throw new Error(`--${BROAD_ZERO} conflicts with a positive --retries count.`);
  if (raw !== undefined && Number(raw) === 0 && !oneFile && !options[BROAD_ZERO]) {
    throw new Error(`Use the default retry budget for broader validation. Plain --retries 0 is for a focused --file <one-test-file> check, optionally with --grep. To deliberately turn flakes into failures on a broader run, use --${BROAD_ZERO}.`);
  }
  return options[BROAD_ZERO] ? 0 : raw === undefined ? 2 : Number(raw);
}

export function enforceLocalFileGuidance(options, { surfaces, oneFile }) {
  if (!hasBlaxelMarker() || oneFile || options[BROAD_LOCAL]) return;
  const localOnly = surfaces.filter((surface) => surface.agent || /^(telemetry-posthog-roundtrip|daemon-acceptance):/.test(surface.id));
  let route;
  if (localOnly.length) {
    const requirements = localOnly.map((surface) => surface.agent ? "agent tests require local agent setup" : surface.id.startsWith("telemetry") ? "PostHog tests require the local PostHog test read key" : "daemon tests require a dedicated local host with TV_DAEMON_TEST_HOST=1");
    const commands = localOnly.map((surface) => {
      const file = surface.roots.length === 1 && TEST_FILE_PATTERN.test(surface.roots[0]) ? shellQuote(surface.roots[0]) : "<one-test-file>";
      return `${surface.id.startsWith("daemon-acceptance:") ? "TV_DAEMON_TEST_HOST=1 " : ""}npm test -- local --file ${file}`;
    });
    route = `${[...new Set(requirements)].join("; ")}. Use ${commands.join(" or ")} with those prerequisites; this selection has no equivalent supported Blaxel command.`;
  } else if ((options.file || options.grep || options.surface) && surfaces.length !== 1 || options.suite && !["all", "unit", "e2e"].includes(options.suite) && !options.file && !options.surface && !options.package && !options.runner && !options.tag) {
    route = "This selection has no equivalent supported Blaxel command. npm test -- blaxel supports a single targeted surface or planned all/unit/e2e, package, runner, and tag selections. Commit and push to origin before a supported Blaxel run.";
  } else {
    const args = ["npm", "test", "--", "blaxel"];
    for (const key of ["suite", "surface", "package", "file", "grep", "runner", "tag"]) if (options[key]) args.push(`--${key}`, options[key]);
    if (options.all) args.push("--all");
    if (options.force) args.push("--force");
    route = `Commit and push to origin first, then run: ${args.map(shellQuote).join(" ")}.`;
  }
  throw new Error(`~/.tvdev-use-blaxel is present. Local iteration selects at most one test file with --file, optionally narrowed by --grep. A file filter can match several files. Broader runs can exhaust the shared host. ${route} Do not replace broader validation with serial file loops. With explicit human permission under testing policy, --${BROAD_LOCAL} permits a broader local run.`);
}

function shellQuote(value) {
  return /^[a-zA-Z0-9_./:@=-]+$/.test(value) ? value : `'${String(value).replaceAll("'", "'\\''")}'`;
}
