import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, type ChildProcessByStdio } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type TabPage,
} from "@telepath-computer/television-shared";
import { spawnOwnedProcess, type OwnedProcess } from "../helpers/owned-process.ts";
import { writeHomeConfig } from "../helpers/television-home.ts";

// Built-CLI onboarding-channels product acceptance
// (specs/product/onboarding/onboarding-channels.md, built-`tv`-CLI boundary):
// the really-built packages/cli/dist/cli.cjs spawned as a real process against
// real storage directories, observed through spawned `tv` commands and real
// HTTP. Bundle variation uses the production resolution mechanism itself —
// the built binary is copied beside a fixture bundle, or beside none. The
// e2e:node surface's preCommand runs the full package build, so the binary
// and its packaged production bundle are always fresh.

const REPO_ROOT = path.resolve(process.cwd());
const BUILT_CLI = path.join(REPO_ROOT, "packages", "cli", "dist", "cli.cjs");
const PRODUCTION_BUNDLE = path.join(REPO_ROOT, "packages", "cli", "dist", "onboarding");
const FIXTURE_BUNDLES = path.join(REPO_ROOT, "test", "node", "fixtures", "onboarding-bundles");
const PREINIT_FIXTURE = path.join(REPO_ROOT, "test", "node", "fixtures", "preinit-storage");
const START_TIMEOUT_MS = 30_000;

type ServeChild = ChildProcessByStdio<null, Readable, Readable>;

describe("onboarding channels (built CLI e2e)", () => {
  const dirs: string[] = [];
  const children: OwnedProcess[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) await stopServe(child);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  /**
   * A copy of the built binary beside the given fixture bundle (or beside
   * nothing): the production sibling-resolution layout. cli.cjs is a
   * standalone bundle, so copying the file gives exactly that layout.
   */
  function installedCLI(bundleName?: string): string {
    const dir = tempDir("television-onboarding-e2e-cli-");
    const cliEntry = path.join(dir, "cli.cjs");
    cpSync(BUILT_CLI, cliEntry);
    if (bundleName) {
      cpSync(path.join(FIXTURE_BUNDLES, bundleName), path.join(dir, "onboarding"), { recursive: true });
    }
    return cliEntry;
  }

  function swapBundle(cliEntry: string, bundleName: string): void {
    const sibling = path.join(path.dirname(cliEntry), "onboarding");
    rmSync(sibling, { recursive: true, force: true });
    cpSync(path.join(FIXTURE_BUNDLES, bundleName), sibling, { recursive: true });
  }

  function serveEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "" };
    delete env.TELEVISION_ACP_AGENT;
    return env;
  }

  // Every serve runs over a home whose config file sets port 0, written
  // before the first boot, so a config file never counts as served data.
  async function startServe(cliEntry: string, storagePath: string): Promise<{ port: number; stop: () => Promise<void> }> {
    writeHomeConfig(storagePath, { port: 0 });
    const owned = spawnOwnedProcess(process.execPath, [cliEntry, "--home", storagePath, "serve"], {
      cwd: path.dirname(cliEntry),
      env: serveEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(owned);
    try {
      const port = await waitForPort(owned.child as ServeChild);
      return { port, stop: () => stopServe(owned) };
    } catch (error) {
      await owned.dispose();
      throw error;
    }
  }

  function runCLIJSON(cliEntry: string, args: string[], storagePath: string, port: number): any {
    const stdout = execFileSync(process.execPath, [cliEntry, "--home", storagePath, ...args, "--port", String(port)], {
      cwd: path.dirname(cliEntry),
      env: serveEnv(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  }

  function runCLI(cliEntry: string, args: string[], storagePath: string, port: number): string {
    return execFileSync(process.execPath, [cliEntry, "--home", storagePath, ...args, "--port", String(port)], {
      cwd: path.dirname(cliEntry),
      env: serveEnv(),
      encoding: "utf8",
    });
  }

  async function fetchArtifactPath(port: number, storagePath: string, suffix: string): Promise<Response> {
    const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    return await fetch(`http://127.0.0.1:${port}/artifact/${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function fetchMarkdown(port: number, storagePath: string, artifactID: string): Promise<Response> {
    const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    return await fetch(`http://127.0.0.1:${port}/markdown/${artifactID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function fetchDisplay(port: number, storagePath: string): Promise<{
    focusedChannelId: string | null;
    pinnedChannelIds: string[];
  }> {
    const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    const response = await fetch(`http://127.0.0.1:${port}/display`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    return await response.json() as { focusedChannelId: string | null; pinnedChannelIds: string[] };
  }

  function expectInjectedHTMLMatchesPackaged(
    served: string,
    packaged: string,
    artifactID: string,
  ): void {
    let restored = served.replace(/\n<script>\n([\s\S]*?)\n<\/script>/g, (script, body: string) =>
      body.includes("__televisionAppearanceResolver") ||
        body.includes("__televisionArtifactBridgeInstalled")
        ? ""
        : script
    );
    // The appended bridge owns its final newline; the source may not have one.
    if (restored === `${packaged}\n`) restored = restored.slice(0, -1);
    expect(restored, artifactID).toBe(packaged);
  }

  /**
   * Prove an installed artifact serves its packaged source, resolving the
   * source shape from the packaged bundle at runtime. HTML routes receive the
   * production appearance and bridge scripts; removing those exact generated
   * insertions restores the packaged bytes. Raw markdown and sibling assets
   * remain byte-identical.
   */
  async function expectServesPackagedSource(
    port: number,
    storagePath: string,
    channelSlug: string,
    artifactSlug: string,
  ): Promise<void> {
    const artifactID = onboardingID(channelSlug, artifactSlug);
    const base = path.join(PRODUCTION_BUNDLE, channelSlug, artifactSlug);
    if (existsSync(`${base}.md`)) {
      const response = await fetchMarkdown(port, storagePath, artifactID);
      expect(response.status, artifactID).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).equals(readFileSync(`${base}.md`))).toBe(true);
      return;
    }
    if (existsSync(`${base}.html`)) {
      const response = await fetchArtifactPath(port, storagePath, artifactID);
      expect(response.status, artifactID).toBe(200);
      expectInjectedHTMLMatchesPackaged(
        await response.text(),
        readFileSync(`${base}.html`, "utf8"),
        artifactID,
      );
      return;
    }
    // Directory artifact: entry document plus every sibling file.
    for (const relative of listFilesRecursively(base)) {
      const response = await fetchArtifactPath(port, storagePath, `${artifactID}/${relative}`);
      expect(response.status, `${artifactID}/${relative}`).toBe(200);
      const packaged = readFileSync(path.join(base, relative));
      if (relative === "index.html") {
        expectInjectedHTMLMatchesPackaged(
          await response.text(),
          packaged.toString("utf8"),
          `${artifactID}/${relative}`,
        );
      } else {
        expect(Buffer.from(await response.arrayBuffer()).equals(packaged)).toBe(true);
      }
    }
  }

  // proofs/product/onboarding/onboarding-channels.md#^ac-fresh-install
  // Fixture: the shipped production bundle beside the built binary in dist/.
  // Every expectation is derived from the shipped config and packaged
  // sources at runtime — never restated copy — so replacing shipped content
  // under the replacement contract requires no change here.
  // proofs/product/onboarding/onboarding-channels.md#^ac-config-only-home
  it("Fresh install creates every bundled channel and focuses the designated channel", async () => {
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    writeHomeConfig(storagePath, { port: 0 });
    expect(readdirSync(storagePath)).toEqual(["config.json"]);
    const { port } = await startServe(BUILT_CLI, storagePath);

    const config = JSON.parse(readFileSync(path.join(PRODUCTION_BUNDLE, "onboarding-channels.json"), "utf8"));
    const { channels } = runCLIJSON(BUILT_CLI, ["list-channels"], storagePath, port);
    expect(channels).toHaveLength(config.channels.length);
    for (const channelConfig of config.channels) {
      const channel = channels.find((candidate: any) => candidate.onboarding?.slug === channelConfig.slug);
      expect(channel, channelConfig.slug).toBeDefined();
      expect(channel.name).toBe(channelConfig.name);
      expect(channel.onboarding).toEqual({ slug: channelConfig.slug });
      // Installed pages follow authored artifact order and carry each
      // configured-or-default page layout.
      expect(channel.layout, channelConfig.slug).toEqual(expectedInstalledPages(channelConfig));
    }

    // The shipped bundle's designated channel is active.
    const focusedSlug = config.focusChannel;
    const designated = channels.find((candidate: any) => candidate.onboarding?.slug === focusedSlug);
    const display = await fetchDisplay(port, storagePath);
    expect(display).toMatchObject({
      focusedChannelId: designated.id,
      pinnedChannelIds: [],
    });

    // Every configured artifact exists with its configured title and serves
    // its packaged source content, per source shape.
    const { artifacts } = runCLIJSON(BUILT_CLI, ["list-artifacts"], storagePath, port);
    for (const channelConfig of config.channels) {
      for (const artifactConfig of channelConfig.artifacts) {
        const artifactID = onboardingID(channelConfig.slug, artifactConfig.slug);
        const record = artifacts.find((candidate: any) => candidate.id === artifactID);
        expect(record, artifactID).toMatchObject({ kind: "path", title: artifactConfig.title });
        await expectServesPackagedSource(port, storagePath, channelConfig.slug, artifactConfig.slug);
      }
    }
  }, START_TIMEOUT_MS * 2);

  // proofs/product/onboarding/onboarding-channels.md#^ac-markdown-artifact
  // Fixture: a bundle with one markdown artifact.
  it("Markdown artifact installs as an ordinary markdown path artifact", async () => {
    const cliEntry = installedCLI("markdown");
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    const { port } = await startServe(cliEntry, storagePath);
    const guideID = "television-onboarding--md-notes--guide";

    // The CLI-reported record points at a .md file.
    const { artifacts } = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, port);
    const guide = artifacts.find((artifact: any) => artifact.id === guideID);
    expect(guide).toMatchObject({ kind: "path", title: "Guide" });
    expect(guide.path.endsWith(".md")).toBe(true);

    // Its content is served over the markdown content endpoint
    // (packages/artifact/src/model.ts) byte-identical to the packaged source.
    const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();
    const response = await fetch(`http://127.0.0.1:${port}/markdown/${guideID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const served = Buffer.from(await response.arrayBuffer());
    const packaged = readFileSync(path.join(FIXTURE_BUNDLES, "markdown", "md-notes", "guide.md"));
    expect(served.equals(packaged)).toBe(true);
  }, START_TIMEOUT_MS * 2);

  // proofs/product/onboarding/onboarding-channels.md#^ac-artifact-page-order
  // Fixture: a bundle with several artifacts in authored page order,
  // including size-only, full-screen-only, both-authored, and default pages.
  it("Configured artifact order installs as configured-or-default pages", async () => {
    const cliEntry = installedCLI("designed");
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    const { port } = await startServe(cliEntry, storagePath);
    const config = JSON.parse(
      readFileSync(path.join(FIXTURE_BUNDLES, "designed", "onboarding-channels.json"), "utf8"),
    );
    const studioConfig = config.channels.find((channel: any) => channel.slug === "studio");

    const { channels } = runCLIJSON(cliEntry, ["list-channels"], storagePath, port);
    const studio = channels.find((channel: any) => channel.onboarding?.slug === "studio");
    expect(studio.layout).toEqual(expectedInstalledPages(studioConfig));
    const { artifacts } = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, port);
    expect(artifacts.map((artifact: any) => artifact.id).sort()).toEqual(
      studioConfig.artifacts
        .map((artifact: any) => onboardingID(studioConfig.slug, artifact.slug))
        .sort(),
    );
  }, START_TIMEOUT_MS * 2);

  // A relative home must resolve against the serve process's working
  // directory before it reaches the store: artifact destinations derived from
  // a relative path are rejected as non-absolute, which would silently skip
  // onboarding while the server started fine.
  // proofs/arch/cli/index.md#^cli-relative-home-seam
  it("Fresh install works with a relative --home", async () => {
    const cliEntry = installedCLI("subset");
    const cwd = path.dirname(cliEntry);
    const storagePath = path.join(cwd, "home");
    dirs.push(storagePath);
    writeHomeConfig(storagePath, { port: 0 });

    const child = spawnOwnedProcess(process.execPath, [cliEntry, "--home", "./home", "serve"], {
      cwd,
      env: serveEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    const port = await waitForPort(child.child as ServeChild);

    const { channels } = runCLIJSON(cliEntry, ["list-channels"], storagePath, port);
    expect(channels.map((channel: any) => channel.name)).toEqual(["Alpha Screen"]);
    const { artifacts } = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, port);
    expect(artifacts).toHaveLength(1);
    const alpha = artifacts[0];
    expect(alpha.id).toBe("television-onboarding--alpha-screen--alpha");
    expect(path.isAbsolute(alpha.path)).toBe(true);
    expect(alpha.path.startsWith(`${realpathSync(storagePath)}${path.sep}`)).toBe(true);
    const served = await fetchArtifactPath(port, storagePath, alpha.id);
    expect(served.status).toBe(200);
    expect(await served.text()).toContain("alpha");
  }, START_TIMEOUT_MS * 2);

  // proofs/product/onboarding/onboarding-channels.md#^ac-missing-bundle
  it("Missing bundle control: the same binary without packaged siblings starts with one empty Default", async () => {
    const bareCLI = installedCLI();
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    const { port } = await startServe(bareCLI, storagePath);

    const { artifacts } = runCLIJSON(bareCLI, ["list-artifacts"], storagePath, port);
    expect(artifacts).toEqual([]);
    const { channels } = runCLIJSON(bareCLI, ["list-channels"], storagePath, port);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("Default");
    expect(channels[0].layout).toEqual([]);
    expect(channels[0].onboarding).toBeUndefined();
  }, START_TIMEOUT_MS * 2);

  // proofs/product/onboarding/onboarding-channels.md#^ac-upgrade-only-new
  // Fixtures: the subset and superset bundles.
  it("Upgrade receives only new channels", async () => {
    const cliEntry = installedCLI("subset");
    const storagePath = tempDir("television-onboarding-e2e-storage-");

    const firstBoot = await startServe(cliEntry, storagePath);
    const before = runCLIJSON(cliEntry, ["list-channels"], storagePath, firstBoot.port);
    expect(before.channels.map((channel: any) => channel.name)).toEqual(["Alpha Screen"]);
    const alphaBefore = before.channels[0];
    const displayBefore = await fetchDisplay(firstBoot.port, storagePath);
    expect(displayBefore).toMatchObject({
      focusedChannelId: alphaBefore.id,
      pinnedChannelIds: [],
    });
    const statePath = path.join(storagePath, "state", "onboarding.json");
    const stateBefore = JSON.parse(readFileSync(statePath, "utf8"));

    const alphaArtifactID = onboardingID("alpha-screen", "alpha");
    runCLI(cliEntry, ["update-artifact", "--id", alphaArtifactID, "--title", "User-edited Alpha"], storagePath, firstBoot.port);
    const alphaEdited = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, firstBoot.port).artifacts.find(
      (artifact: any) => artifact.id === alphaArtifactID,
    );
    const userEditedContent = "<!doctype html><title>User-owned Alpha</title>edited after install";
    writeFileSync(alphaEdited.path, userEditedContent);
    await firstBoot.stop();

    swapBundle(cliEntry, "superset");
    const secondBoot = await startServe(cliEntry, storagePath);
    const after = runCLIJSON(cliEntry, ["list-channels"], storagePath, secondBoot.port);
    expect(after.channels).toHaveLength(2);
    const alphaAfter = after.channels.find((channel: any) => channel.onboarding?.slug === "alpha-screen");
    expect(alphaAfter).toEqual(alphaBefore);
    const beta = after.channels.find((channel: any) => channel.onboarding?.slug === "beta-screen");
    expect(beta).toMatchObject({
      name: "Beta Screen",
      onboarding: { slug: "beta-screen" },
      layout: [targetPage(onboardingID("beta-screen", "beta"))],
    });

    const artifactsAfter = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, secondBoot.port).artifacts;
    expect(artifactsAfter).toHaveLength(2);
    expect(artifactsAfter.find((artifact: any) => artifact.id === alphaArtifactID)).toEqual(alphaEdited);
    expect(readFileSync(alphaEdited.path, "utf8")).toBe(userEditedContent);
    expect(await fetchDisplay(secondBoot.port, storagePath)).toEqual(displayBefore);
    const stateAfter = JSON.parse(readFileSync(statePath, "utf8"));
    expect(stateAfter.channels["alpha-screen"]).toEqual(stateBefore.channels["alpha-screen"]);
    expect(stateAfter.channels["beta-screen"]).toBeDefined();
  }, START_TIMEOUT_MS * 3);

  // proofs/product/onboarding/onboarding-channels.md#^ac-deletion-respected
  describe("Deletion respected", () => {
    it("a deleted onboarding channel is not re-created after restart", async () => {
      const cliEntry = installedCLI("superset");
      const storagePath = tempDir("television-onboarding-e2e-storage-");

      const firstBoot = await startServe(cliEntry, storagePath);
      const { channels } = runCLIJSON(cliEntry, ["list-channels"], storagePath, firstBoot.port);
      const beta = channels.find((channel: any) => channel.onboarding?.slug === "beta-screen");
      runCLI(cliEntry, ["remove-channel", "--channel", beta.id], storagePath, firstBoot.port);
      await firstBoot.stop();

      const secondBoot = await startServe(cliEntry, storagePath);
      const after = runCLIJSON(cliEntry, ["list-channels"], storagePath, secondBoot.port);
      expect(after.channels.map((channel: any) => channel.name)).toEqual(["Alpha Screen"]);
      const { artifacts } = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, secondBoot.port);
      expect(artifacts.some((artifact: any) => artifact.id.includes("beta"))).toBe(false);
    }, START_TIMEOUT_MS * 3);

    it("a deleted onboarding artifact is not re-created after restart", async () => {
      const cliEntry = installedCLI("superset");
      const storagePath = tempDir("television-onboarding-e2e-storage-");
      const alphaID = "television-onboarding--alpha-screen--alpha";

      const firstBoot = await startServe(cliEntry, storagePath);
      runCLI(cliEntry, ["delete-artifact", "--id", alphaID], storagePath, firstBoot.port);
      await firstBoot.stop();

      const secondBoot = await startServe(cliEntry, storagePath);
      const { artifacts } = runCLIJSON(cliEntry, ["list-artifacts"], storagePath, secondBoot.port);
      expect(artifacts.some((artifact: any) => artifact.id === alphaID)).toBe(false);
      const { channels } = runCLIJSON(cliEntry, ["list-channels"], storagePath, secondBoot.port);
      const alphaChannel = channels.find((channel: any) => channel.onboarding?.slug === "alpha-screen");
      expect(alphaChannel.layout).toEqual([]);
    }, START_TIMEOUT_MS * 3);
  });

  // proofs/product/onboarding/onboarding-channels.md#^ac-focus-not-stolen
  it("Focus is not stolen from a storage directory with real content", async () => {
    const cliEntry = installedCLI("subset");
    const storagePath = tempDir("television-onboarding-e2e-storage-");

    const firstBoot = await startServe(cliEntry, storagePath);
    // Give the installation real content through real tv commands.
    const created = runCLI(cliEntry, ["create-channel", "--name", "Workbench", "--focus-channel"], storagePath, firstBoot.port);
    const workbenchID = /Channel created: (\S+)/.exec(created)![1]!;
    const target = path.join(storagePath, "workbench.html");
    writeFileSync(target, "<!doctype html><title>Work</title>");
    runCLI(cliEntry, ["create-path-artifact", "--channel", workbenchID, "--title", "Work", "--path", target, "--no-focus"], storagePath, firstBoot.port);
    expect((await fetchDisplay(firstBoot.port, storagePath)).focusedChannelId).toBe(workbenchID);
    await firstBoot.stop();

    swapBundle(cliEntry, "superset");
    const secondBoot = await startServe(cliEntry, storagePath);
    const after = runCLIJSON(cliEntry, ["list-channels"], storagePath, secondBoot.port);
    expect(after.channels.some((channel: any) => channel.onboarding?.slug === "beta-screen")).toBe(true);
    expect((await fetchDisplay(secondBoot.port, storagePath)).focusedChannelId).toBe(workbenchID);
  }, START_TIMEOUT_MS * 3);

  // proofs/product/onboarding/onboarding-channels.md#^ac-preinit-focus
  // Fixture: the checked-in pre-initialized storage directory (see its
  // README; empty directories are recreated here because git cannot track
  // them).
  it("Pre-initialized storage counts as fresh", async () => {
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    cpSync(PREINIT_FIXTURE, storagePath, { recursive: true });
    rmSync(path.join(storagePath, "README.md"));
    for (const dir of ["state/channels", "state/artifacts", "themes", "artifacts"]) {
      mkdirSync(path.join(storagePath, dir), { recursive: true });
    }
    const fixtureToken = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();

    const { port } = await startServe(BUILT_CLI, storagePath);
    const config = JSON.parse(readFileSync(path.join(PRODUCTION_BUNDLE, "onboarding-channels.json"), "utf8"));
    const { channels } = runCLIJSON(BUILT_CLI, ["list-channels"], storagePath, port);
    // Every onboarding channel installed; the onboarding channels are the only
    // channels — no "Default".
    expect(channels).toHaveLength(config.channels.length);
    expect(channels.some((channel: any) => channel.name === "Default")).toBe(false);
    const designated = channels.find((channel: any) => channel.onboarding?.slug === config.focusChannel);
    expect(await fetchDisplay(port, storagePath)).toMatchObject({
      focusedChannelId: designated.id,
      pinnedChannelIds: [],
    });
    expect(readFileSync(path.join(storagePath, "state", "token"), "utf8").trim()).toBe(fixtureToken);
  }, START_TIMEOUT_MS * 2);

  // proofs/product/onboarding/onboarding-channels.md#^ac-legacy-upgrade
  // Hand-authored v1-era storage fixture, authored at materialization time
  // because the artifact record must carry an absolute path into the temp
  // storage directory. It contains exactly the migration path's input
  // surface — the v1 state file, the television-onboarding artifact record
  // pointing at the copied artifacts/television-onboarding/ directory with
  // its index.html, and the channel JSON carrying that artifact's 5-wide
  // card — plus the display state pointing at that channel, which is what
  // makes "focus is unchanged" observable.
  const LEGACY_UPGRADE_TITLE = "Legacy upgrade boots cleanly without duplicating TV Guide";

  it(LEGACY_UPGRADE_TITLE, async () => {
    const cliEntry = installedCLI("tv-guide-superset");
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    const legacyChannelID = "01J0000000000000000000TVGD";
    const legacyInstalledAt = "2025-06-01T12:00:00.000Z";
    const legacyContentDir = path.join(storagePath, "artifacts", "television-onboarding") + path.sep;
    mkdirSync(path.join(storagePath, "state", "channels"), { recursive: true });
    mkdirSync(path.join(storagePath, "state", "artifacts"), { recursive: true });
    mkdirSync(legacyContentDir, { recursive: true });
    const legacyIndexBytes = "<!doctype html><title>Welcome to Television</title>legacy copy";
    writeFileSync(path.join(legacyContentDir, "index.html"), legacyIndexBytes);
    const legacySentinelBytes = JSON.stringify({
      version: 1,
      artifactID: "television-onboarding",
      installedAt: legacyInstalledAt,
    }, null, 2);
    writeFileSync(path.join(storagePath, "state", "onboarding-artifact.json"), legacySentinelBytes);
    writeFileSync(
      path.join(storagePath, "state", "artifacts", "television-onboarding.json"),
      JSON.stringify({ id: "television-onboarding", kind: "path", title: "Welcome to Television", path: legacyContentDir }, null, 2),
    );
    writeFileSync(
      path.join(storagePath, "state", "channels", `${legacyChannelID}.json`),
      JSON.stringify({
        id: legacyChannelID,
        name: "TV Guide",
        layout: [{ type: "card", artifactID: "television-onboarding", width: 5, height: "auto" }],
      }, null, 2),
    );
    writeFileSync(
      path.join(storagePath, "state", "display.json"),
      JSON.stringify({ activeChannelID: legacyChannelID, activeThemeName: null }, null, 2),
    );

    const { port } = await startServe(cliEntry, storagePath);
    const { channels } = runCLIJSON(cliEntry, ["list-channels"], storagePath, port);
    // TV Guide is not duplicated; migration upgrades its stored record, and the newer channel installs.
    expect(channels).toHaveLength(2);
    const guides = channels.filter((channel: any) => channel.name === "TV Guide");
    expect(guides).toHaveLength(1);
    expect(guides[0].id).toBe(legacyChannelID);
    expect(guides[0].layout).toEqual([{
      artifactIds: ["television-onboarding"],
      geometry: { kind: "single", full_screen: false },
      size: DEFAULT_PAGE_SIZE,
    }]);
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "channels", `${legacyChannelID}.json`), "utf8"))).toMatchObject({
      id: legacyChannelID,
      name: "TV Guide",
      layoutVersion: 2,
      layout: guides[0].layout,
    });
    const whatsNew = channels.find((channel: any) => channel.onboarding?.slug === "whats-new");
    expect(whatsNew.name).toBe("What's New");

    // Focus unchanged; onboarding remains unpinned; legacy content and sentinel untouched.
    expect(await fetchDisplay(port, storagePath)).toMatchObject({
      focusedChannelId: legacyChannelID,
      pinnedChannelIds: [],
    });
    expect(readFileSync(path.join(legacyContentDir, "index.html"), "utf8")).toBe(legacyIndexBytes);
    expect(readFileSync(path.join(storagePath, "state", "onboarding-artifact.json"), "utf8")).toBe(legacySentinelBytes);

    // Migration recorded the already-installed fact under tv-guide, keeping
    // the v1 timestamp.
    const state = JSON.parse(readFileSync(path.join(storagePath, "state", "onboarding.json"), "utf8"));
    expect(state.version).toBe(3);
    expect(state.channels["tv-guide"]).toEqual({ installedAt: legacyInstalledAt });
    expect(state.channels["whats-new"]).toBeDefined();
  }, START_TIMEOUT_MS * 2);

  it("Pre-rename v2 onboarding state preserves every record through the built CLI", async () => {
    const cliEntry = installedCLI("subset");
    const storagePath = tempDir("television-onboarding-e2e-storage-");
    const statePath = path.join(storagePath, "state", "onboarding.json");

    const firstBoot = await startServe(cliEntry, storagePath);
    const before = runCLIJSON(cliEntry, ["list-channels"], storagePath, firstBoot.port);
    const alphaBefore = before.channels.find((channel: any) => channel.onboarding?.slug === "alpha-screen");
    const currentState = JSON.parse(readFileSync(statePath, "utf8"));
    const alphaInstalledAt = currentState.channels["alpha-screen"].installedAt;
    await firstBoot.stop();

    writeFileSync(
      statePath,
      `{ "version": 2,\n  "screens": ${JSON.stringify(currentState.channels)}\n}\n`,
    );
    swapBundle(cliEntry, "superset");

    const secondBoot = await startServe(cliEntry, storagePath);
    const after = runCLIJSON(cliEntry, ["list-channels"], storagePath, secondBoot.port);
    expect(after.channels.find((channel: any) => channel.onboarding?.slug === "alpha-screen")).toEqual(alphaBefore);
    expect(after.channels.find((channel: any) => channel.onboarding?.slug === "beta-screen").name).toBe("Beta Screen");
    const migrated = JSON.parse(readFileSync(statePath, "utf8"));
    expect(migrated.version).toBe(3);
    expect(migrated.channels["alpha-screen"]).toEqual({ installedAt: alphaInstalledAt });
    expect(migrated.channels["beta-screen"]).toBeDefined();
    const migratedBytes = readFileSync(statePath, "utf8");
    await secondBoot.stop();

    const thirdBoot = await startServe(cliEntry, storagePath);
    expect(readFileSync(statePath, "utf8")).toBe(migratedBytes);
    const afterRestart = runCLIJSON(cliEntry, ["list-channels"], storagePath, thirdBoot.port).channels;
    expect(afterRestart).toHaveLength(2);
    expect(afterRestart.filter((channel: any) => channel.onboarding?.slug === "alpha-screen")).toHaveLength(1);
    expect(afterRestart.filter((channel: any) => channel.onboarding?.slug === "beta-screen")).toHaveLength(1);
  }, START_TIMEOUT_MS * 4);
});

function onboardingID(channelSlug: string, artifactSlug: string): string {
  return `television-onboarding--${channelSlug}--${artifactSlug}`;
}

function targetPage(
  artifactID: string,
  configured: Partial<Pick<TabPage, "geometry" | "size">> = {},
): TabPage {
  return {
    artifactIds: [artifactID],
    geometry: { ...(configured.geometry ?? DEFAULT_PAGE_GEOMETRY) },
    size: { ...(configured.size ?? DEFAULT_PAGE_SIZE) },
  };
}

function expectedInstalledPages(channelConfig: any): TabPage[] {
  return channelConfig.artifacts.map((artifact: any) =>
    targetPage(onboardingID(channelConfig.slug, artifact.slug), artifact)
  );
}

function listFilesRecursively(root: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFilesRecursively(root, relative));
    else files.push(relative);
  }
  return files;
}

function waitForPort(child: ServeChild): Promise<number> {
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for tv serve startup. stderr:\n${stderr}`));
    }, START_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const url = stdout.match(/https?:\/\/[^\s]+/)?.[0];
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

async function stopServe(child: OwnedProcess): Promise<void> {
  const cleanup = await child.dispose();
  if (cleanup.outcome === "survived") throw new Error(`Onboarding server ${child.pid} survived cleanup`);
}
