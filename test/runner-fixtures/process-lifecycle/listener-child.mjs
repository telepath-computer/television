import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import process from "node:process";

const readyFile = process.env.TV_LIFECYCLE_READY_FILE;
if (!readyFile) throw new Error("TV_LIFECYCLE_READY_FILE is required");
const ignoreTerm = process.argv.includes("--ignore-term");
const server = createServer((_request, response) => response.end("fixture"));
if (ignoreTerm) process.on("SIGTERM", () => {});
else process.on("SIGTERM", () => server.close(() => process.exit(0)));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture listener did not bind");
  writeFileSync(readyFile, `${JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${address.port}`, ownerToken: process.env.TV_TEST_SURFACE_OWNER })}\n`);
});
