#!/usr/bin/env node
import process from "node:process";
import { appendPhaseMetricFile, phaseFromEpoch } from "./test/phase-metrics.mjs";

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::warning::phase metric omitted: ${message}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.file) fail("--file is required");

  if (options["github-job-name"]) {
    const phase = await githubSchedulePhase(options["github-job-name"], options["needs-job-name"]);
    appendPhaseMetricFile(options.file, phase);
  } else {
    const startedMs = Number(options["started-ms"]);
    const completedMs = options["completed-ms"] == null ? Date.now() : Number(options["completed-ms"]);
    if (!Number.isFinite(startedMs)) fail("--started-ms is required and must be numeric");
    appendPhaseMetricFile(options.file, phaseFromEpoch({
      name: options.name,
      category: options.category,
      status: options.status ?? "passed",
      startedMs,
      completedMs,
      cacheStatus: options["cache-status"],
    }));
  }
}

async function githubSchedulePhase(jobName, needsJobName) {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repository || !runId || !token) fail("GitHub schedule metrics require GITHUB_REPOSITORY, GITHUB_RUN_ID, and GH_TOKEN");
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const [run, jobs] = await Promise.all([
    requestJson(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, headers),
    requestJson(`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`, headers),
  ]);
  const job = jobs.jobs?.find((candidate) => candidate.name === jobName);
  if (!job?.started_at) fail(`GitHub run ${runId} does not contain started job ${JSON.stringify(jobName)}`);
  let readyAt = run.created_at;
  if (needsJobName) {
    const prerequisite = jobs.jobs?.find((candidate) => candidate.name === needsJobName);
    if (!prerequisite?.completed_at) fail(`GitHub run ${runId} does not contain completed prerequisite ${JSON.stringify(needsJobName)}`);
    readyAt = prerequisite.completed_at;
  }
  return phaseFromEpoch({ name: "vm-schedule", category: "schedule", startedMs: Date.parse(readyAt), completedMs: Date.parse(job.started_at) });
}

async function requestJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) fail(`GitHub API ${response.status} for ${url}`);
  return response.json();
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith("--")) fail(`unexpected argument ${name}`);
    const value = args[++index];
    if (value == null || value.startsWith("--")) fail(`${name} requires a value`);
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

function fail(message) {
  throw new TypeError(message);
}
