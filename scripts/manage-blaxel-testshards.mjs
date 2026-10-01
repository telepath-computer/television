#!/usr/bin/env node
import { SandboxInstance } from "@blaxel/core";
import { readFileSync } from "node:fs";
import process from "node:process";
import { listBlaxelPoolSandboxes } from "./test/blaxel-pool.mjs";
import { DEFAULT_BLAXEL_POOL_SIZE } from "./testshard-constants.mjs";

// nvm has no LTS channel; pin the installer so pool recreations do not
// silently change their provisioning path.
const NVM_RELEASE = "v0.40.3";

const options = parseArgs(process.argv.slice(2));
const command = options._[0] ?? "list";
const pool = options.pool ?? "default";
const arch = options.arch ?? "x64";
if (arch !== "x64") fail("Blaxel testshards currently support only verified x64/linux sandboxes. Omit --arch or use --arch x64.");
const size = Number.parseInt(options.size ?? String(DEFAULT_BLAXEL_POOL_SIZE), 10);
const memory = Number.parseInt(options.memory ?? "8192", 10);
const region = options.region ?? process.env.BL_REGION ?? "us-pdx-1";
// This image supplies browser/system dependencies. Node is provisioned
// independently from .nvmrc below, never inherited from the image.
const image = options.image ?? "blaxel/playwright-chromium:latest";
const nodeSelector = command === "ensure"
  ? readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim()
  : null;

if (!["list", "ensure", "delete"].includes(command)) {
  fail(`Usage: node scripts/manage-blaxel-testshards.mjs [list|ensure|delete] [--pool default] [--size ${DEFAULT_BLAXEL_POOL_SIZE}] [--image blaxel/playwright-chromium:latest]`);
}
if (!Number.isInteger(size) || size < 1) fail("--size must be a positive integer");
if (command === "ensure" && !/^\d+$/.test(nodeSelector)) fail(".nvmrc must contain one Node major before provisioning Blaxel workers");

if (command === "list") {
  const sandboxes = await listPoolSandboxes();
  for (const sandbox of sandboxes) {
    console.log(`${sandbox.metadata?.name}\t${sandbox.status}\t${sandbox.spec?.runtime?.memory ?? "?"}MB\t${sandbox.spec?.image ?? "?"}`);
  }
  process.exit(0);
}

if (command === "ensure") {
  const existing = await listPoolSandboxes();
  // createIfNotExists cannot reconcile commands or runtime state inside an
  // existing sandbox. Fresh-only provisioning avoids inspecting and repairing
  // unknown existing state.
  if (existing.length > 0) {
    fail(`Pool ${pool} already contains ${existing.length} worker(s). Delete the pool before ensure so every provisioned worker is fresh.`);
  }
  for (let index = 1; index <= size; index += 1) {
    const name = workerName(index);
    console.log(`ensuring ${name} (${image}, ${memory}MB, ${region})`);
    const sandbox = await SandboxInstance.createIfNotExists({
      name,
      image,
      memory,
      region,
      labels: {
        project: "television",
        purpose: "testshards",
        pool,
        arch,
      },
    });
    await sandbox.wait();
    await provisionSandboxRuntime(sandbox);
    await verifySandboxArchitecture(sandbox);
    console.log(`  ${sandbox.metadata?.name}: ${sandbox.status}`);
  }
  process.exit(0);
}

if (command === "delete") {
  const sandboxes = await listPoolSandboxes();
  for (const sandbox of sandboxes) {
    console.log(`deleting ${sandbox.metadata?.name}`);
    await SandboxInstance.delete(sandbox.metadata.name);
  }
  process.exit(0);
}

async function provisionSandboxRuntime(sandbox) {
  console.log(`  provisioning Node ${nodeSelector} with nvm ${NVM_RELEASE}`);
  const setup = [
    "set -euo pipefail",
    'export NVM_DIR="$HOME/.nvm"',
    "export PROFILE=/dev/null",
    `curl --fail --silent --show-error --location https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_RELEASE}/install.sh | bash`,
    '. "$NVM_DIR/nvm.sh"',
    `nvm install ${shellQuote(nodeSelector)}`,
    `nvm alias default ${shellQuote(nodeSelector)}`,
    `nvm use --silent ${shellQuote(nodeSelector)}`,
    "printf 'node='; node --version; printf 'npm='; npm --version",
  ].join("; ");
  const proc = await sandbox.process.exec({
    name: `tv-runtime-provision-${Date.now()}`,
    command: `bash -lc ${shellQuote(setup)}`,
    waitForCompletion: true,
    timeout: 300,
  });
  const logs = proc.logs ?? "";
  if (proc.exitCode !== 0) {
    fail(`Failed to provision Node ${nodeSelector} through nvm ${NVM_RELEASE} on ${sandbox.metadata?.name}. Output:\n${logs}`);
  }
  if (logs.trim()) console.log(logs.trimEnd());
}

async function verifySandboxArchitecture(sandbox) {
  const check = [
    "set -euo pipefail",
    'export NVM_DIR="$HOME/.nvm"',
    '. "$NVM_DIR/nvm.sh"',
    "nvm use --silent default",
    "printf uname=; uname -m; printf node=; node -p process.arch",
  ].join("; ");
  const proc = await sandbox.process.exec({
    name: `tv-arch-check-${Date.now()}`,
    command: `bash -lc ${shellQuote(check)}`,
    waitForCompletion: true,
    timeout: 30,
  });
  const logs = proc.logs ?? "";
  if (proc.exitCode !== 0 || !logs.includes("uname=x86_64") || !logs.includes("node=x64")) {
    fail(`Sandbox ${sandbox.metadata?.name} is not verified x64/linux under its provisioned runtime. Output:\n${logs}`);
  }
}

function listPoolSandboxes() {
  return listBlaxelPoolSandboxes({ pool, arch });
}

function workerName(index) {
  return `tv-testshard-${arch}-${pool}-${String(index).padStart(2, "0")}`.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "1";
    }
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
