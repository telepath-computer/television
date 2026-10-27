export function workerLeaseCommand({ lockId, runId, shardIndex, shardTotal, owner, expiresAt, tmpRoot = "/tmp" }) {
  const freshJson = JSON.stringify({ lockId, runId, shard: `${shardIndex}/${shardTotal}`, owner, expiresAt });
  const reclaimedJson = JSON.stringify({ lockId, runId, shard: `${shardIndex}/${shardTotal}`, owner, expiresAt, reclaimed: true });
  const command = [
    "set -euo pipefail",
    "lock=/tmp/tv-testshard.lock",
    "now=$(date +%s)",
    `if mkdir "$lock" 2>/dev/null; then node -e ${shellQuote(`const fs=require("fs"); const data=${JSON.stringify(freshJson)}; const obj=JSON.parse(data); obj.acquiredAt=Number(process.env.now||${Date.now()}); fs.writeFileSync("/tmp/tv-testshard.lock/owner.json", JSON.stringify(obj));`)}; exit 0; fi`,
    "expires=0",
    "if [ -f \"$lock/owner.json\" ]; then expires=$(node -e 'try{console.log(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\")).expiresAt||0)}catch{console.log(0)}' \"$lock/owner.json\"); fi",
    `if [ "$expires" -gt 0 ] && [ "$expires" -lt "$now" ]; then rm -rf "$lock"; mkdir "$lock"; node -e ${shellQuote(`const fs=require("fs"); const data=${JSON.stringify(reclaimedJson)}; const obj=JSON.parse(data); obj.acquiredAt=Number(process.env.now||${Date.now()}); fs.writeFileSync("/tmp/tv-testshard.lock/owner.json", JSON.stringify(obj));`)}; exit 0; fi`,
    "exit 42",
  ].join("; ");
  return command.replaceAll("/tmp/tv-testshard.lock", `${tmpRoot}/tv-testshard.lock`);
}

function shellQuote(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }
