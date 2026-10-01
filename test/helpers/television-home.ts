import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Writes `<home>/config.json`, creating the home when it is missing. A test
 * that spawns `tv serve` gives the server a home whose config file sets port
 * 0, then passes the acquired port to client commands with --port
 * (specs/arch/test-runner/test-runner.md, "Test infrastructure addresses").
 */
export function writeHomeConfig(home: string, config: Record<string, unknown>): string {
  mkdirSync(home, { recursive: true });
  const configPath = path.join(home, "config.json");
  writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  return configPath;
}
