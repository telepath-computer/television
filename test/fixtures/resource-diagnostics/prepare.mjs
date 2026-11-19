import fs from "node:fs";
import path from "node:path";

const root = process.env.RESOURCE_FIXTURE_ROOT;
const resources = path.join(root, "results", "resources");
const records = fs.existsSync(resources) ? fs.readdirSync(resources).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(resources, name), "utf8"))) : [];
fs.writeFileSync(path.join(root, "preparation.json"), JSON.stringify({ observedAt: new Date().toISOString(), records }));
if (process.env.RESOURCE_FIXTURE_MODE === "interrupt") {
  // Abruptly end our own fixture parent. TERM would let the real supervisor
  // finalize, which is a different path.
  process.kill(process.ppid, "SIGKILL");
  // Then end this only descendant at once, without Node's normal exit. While
  // it lives after its supervisor is reaped, it carries a stale owner token
  // that the outer surface's cleanup does not own, and the next runner to
  // start on the host reaps it and refuses to run. That includes the next
  // surface in the isolated lifecycle run. Ending at once keeps that window
  // as short as it can be, but not empty.
  process.kill(process.pid, "SIGKILL");
}
