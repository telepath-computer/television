import fs from "node:fs";
import path from "node:path";

const root = process.env.RESOURCE_FIXTURE_ROOT;
const resources = path.join(root, "results", "resources");
const records = fs.existsSync(resources) ? fs.readdirSync(resources).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(resources, name), "utf8"))) : [];
fs.writeFileSync(path.join(root, "preparation.json"), JSON.stringify({ observedAt: new Date().toISOString(), records }));
if (process.env.RESOURCE_FIXTURE_MODE === "interrupt") {
  // Abruptly end our own fixture parent, then exit this only descendant too.
  // TERM permits the real supervisor to finalize, which is a different path.
  process.kill(process.ppid, "SIGKILL");
}
