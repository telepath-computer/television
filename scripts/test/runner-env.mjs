import path from "node:path";
import process from "node:process";

export function runnerEnv(baseEnv = process.env, ...layers) {
  const env = {
    ...baseEnv,
    FLAKY_TEST_RETRIES: baseEnv.FLAKY_TEST_RETRIES ?? "5",
    PATH: `${path.join(process.cwd(), "node_modules", ".bin")}${path.delimiter}${baseEnv.PATH ?? ""}`,
  };
  for (const layer of layers) Object.assign(env, layer ?? {});
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}
