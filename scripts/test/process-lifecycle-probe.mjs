#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  OWNER_TOKEN_ENV,
  classifyOwnedProcesses,
  encodeOwnerToken,
  readLinuxListeners,
  readLinuxProcess,
  readMacOSListeners,
  readMacOSProcesses,
  scanLinuxProcesses,
} from "./process-lifecycle.mjs";

if (process.argv.includes("--listener-child")) {
  await runListenerChild();
} else {
  await runProbe();
}

async function runListenerChild() {
  const server = createServer((_request, response) => response.end("ok"));
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("listener child did not bind TCP");
    process.stdout.write(`${JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${address.port}` })}\n`);
  });
}

async function runProbe() {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error(`unsupported process-lifecycle probe platform ${process.platform}`);
  }
  const supervisor = currentProcessIdentity();
  const token = encodeOwnerToken({
    runId: `preflight-${process.pid}`,
    surfaceId: "process-lifecycle-preflight",
    supervisorPid: supervisor.pid,
    supervisorStartTime: supervisor.startTime,
  });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--listener-child"], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, [OWNER_TOKEN_ENV]: token },
  });
  const stopForSignal = (signal) => {
    // The listener is detached so killing only this probe would orphan it.
    // A synchronous group kill is the last-resort cleanup path when the
    // outer spawnSync timeout or an operator interrupts preflight.
    signalGroup(child.pid, "SIGKILL");
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onSigint = () => stopForSignal("SIGINT");
  const onSigterm = () => stopForSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  let exited = false;
  let childStderr = "";
  child.once("exit", () => { exited = true; });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { childStderr += chunk; });

  let finalOwnerCount = -1;
  try {
    const published = await readPublishedListener(child, () => childStderr);
    const port = Number(new URL(published.url).port);
    const attribution = await waitForAttribution(token, child.pid, port);
    const classified = classifyOwnedProcesses(attribution.processes).filter((entry) => entry.token === token);
    if (classified.length !== 1 || classified[0].supervisorStatus !== "live") {
      throw new Error(`owner classification did not find one live-supervisor child: ${JSON.stringify(classified)}`);
    }
    if (classified[0].process.pgid !== child.pid) {
      throw new Error(`listener child PGID ${classified[0].process.pgid} did not match detached root PID ${child.pid}`);
    }
    const details = {
      backend: process.platform === "linux" ? "linux-procfs-ss" : "macos-ps-lsof",
      attributedProcessCount: classified.length,
      attributedListenerCount: attribution.listeners.length,
      finalOwnerCount: 0,
      childPid: child.pid,
      childPgid: classified[0].process.pgid,
      listenerURL: published.url,
    };
    await terminateChildGroup(child, () => exited);
    finalOwnerCount = await waitForOwnerCount(token, 0);
    details.finalOwnerCount = finalOwnerCount;
    process.stdout.write(`${JSON.stringify(details)}\n`);
  } finally {
    if (!exited) await terminateChildGroup(child, () => exited).catch(() => {});
    if (finalOwnerCount !== 0) await waitForOwnerCount(token, 0).catch(() => {});
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

function currentProcessIdentity() {
  if (process.platform === "linux") return readLinuxProcess(process.pid);
  const identity = readMacOSProcesses().find((entry) => entry.pid === process.pid);
  if (!identity) throw new Error(`ps did not report probe supervisor PID ${process.pid}`);
  return identity;
}

function inspectProcesses() {
  return process.platform === "linux" ? scanLinuxProcesses() : readMacOSProcesses();
}

function inspectListeners() {
  return process.platform === "linux" ? readLinuxListeners() : readMacOSListeners();
}

async function waitForAttribution(token, childPid, port) {
  const deadline = Date.now() + 5_000;
  let state = "not inspected";
  while (Date.now() < deadline) {
    const processes = inspectProcesses();
    const listeners = inspectListeners().filter((listener) => listener.pid === childPid && listener.port === port);
    const owned = processes.filter((entry) => entry.ownerToken === token && entry.pid === childPid);
    if (owned.length === 1 && listeners.length === 1) return { processes, listeners };
    state = `owned=${owned.length}, listeners=${listeners.length}`;
    await delay(25);
  }
  throw new Error(`timed out attributing disposable child PID ${childPid} port ${port}: ${state}`);
}

async function waitForOwnerCount(token, wanted) {
  const deadline = Date.now() + 5_000;
  let count = -1;
  while (Date.now() < deadline) {
    count = inspectProcesses().filter((entry) => entry.ownerToken === token).length;
    if (count === wanted) return count;
    await delay(25);
  }
  throw new Error(`owner token scan retained ${count} process(es), expected ${wanted}`);
}

function readPublishedListener(child, stderr) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`listener child did not publish in time: ${stderr()}`)), 5_000);
    const finish = (callback) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      callback();
    };
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      finish(() => {
        try {
          resolve(JSON.parse(output.slice(0, newline)));
        } catch (error) {
          reject(new Error(`listener child published invalid JSON: ${error.message}`));
        }
      });
    };
    const onExit = (status, signal) => finish(() => reject(new Error(`listener child exited before publication: status=${status} signal=${signal} ${stderr()}`)));
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.once("error", (error) => finish(() => reject(error)));
  });
}

async function terminateChildGroup(child, isExited) {
  if (isExited()) return;
  signalGroup(child.pid, "SIGTERM");
  const deadline = Date.now() + 2_000;
  while (!isExited() && Date.now() < deadline) await delay(20);
  if (!isExited()) {
    signalGroup(child.pid, "SIGKILL");
    const killDeadline = Date.now() + 2_000;
    while (!isExited() && Date.now() < killDeadline) await delay(20);
  }
  if (!isExited()) throw new Error(`disposable listener child PID ${child.pid} survived SIGKILL`);
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
