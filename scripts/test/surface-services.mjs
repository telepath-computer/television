import { createServer as createHTTPServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { createServer as createViteServer } from "vite";
import { OWNER_TOKEN_ENV } from "./process-lifecycle.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const REQUEST_IDLE_TIMEOUT_MS = 20_000;
const VITE_CLOSE_TIMEOUT_MS = 5_000;
const requireFromHere = createRequire(import.meta.url);
const requireFromVite = createRequire(requireFromHere.resolve("vite"));

/**
 * Start a surface's registry-declared Vite services in declaration order.
 *
 * Vite config loading reads process.env directly, so published variables and
 * the owner token remain installed in the runner process for the service
 * lifetime. stop() restores every prior value, including on startup failure.
 */
export async function startSurfaceServices(services, { env = process.env, root = process.cwd() } = {}) {
  if (!Array.isArray(services)) throw new TypeError("Surface services must be an array");
  const managedNames = [...new Set([OWNER_TOKEN_ENV, ...services.map((service) => service.publishUrlEnv)])];
  const parentValues = new Map(managedNames.map((name) => [name, process.env[name]]));
  const childEnv = { ...env };
  const running = [];
  let stopped = false;

  installManagedEnvironment(managedNames, childEnv);
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const failures = [];
    try {
      for (const service of [...running].reverse()) {
        try {
          await service.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (running.length > 0) {
        try {
          // Vite's close() leaves its process-global esbuild transform service
          // alive. Stop the exact esbuild instance resolved by Vite before the
          // owner token is restored, or it is correctly reported as a leak.
          await requireFromVite("esbuild").stop();
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      restoreEnvironment(parentValues);
    }
    if (failures.length > 0) throw new AggregateError(failures, "Failed to stop one or more surface services");
  };

  try {
    for (const declaration of services) {
      assertServiceDeclaration(declaration);
      installManagedEnvironment(managedNames, childEnv);
      const service = await startViteService(declaration, root);
      running.push(service);
      childEnv[declaration.publishUrlEnv] = service.url;
      process.env[declaration.publishUrlEnv] = service.url;
    }
    return {
      env: childEnv,
      services: running.map(({ id, url, port }) => ({ id, url, port })),
      stop,
    };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Surface service startup and cleanup failed");
    }
    throw error;
  }
}

async function startViteService(declaration, root) {
  const httpServer = createHTTPServer();
  let vite;
  try {
    vite = await createViteServer({
      configFile: path.resolve(root, declaration.config),
      appType: "spa",
      logLevel: "warn",
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        preTransformRequests: false,
      },
    });
    if (vite.config.server.middlewareMode !== true) throw new Error(`Surface service ${declaration.id} did not retain Vite middleware mode`);
    httpServer.on("request", vite.middlewares);
    await listen(httpServer);
    const address = httpServer.address();
    if (!address || typeof address === "string" || address.port === 0) throw new Error(`Surface service ${declaration.id} did not publish a TCP address`);
    const port = address.port;
    const url = `http://${LOOPBACK_HOST}:${port}`;
    return {
      id: declaration.id,
      url,
      port,
      async close() {
        const failures = [];
        try {
          await withTimeout(vite.waitForRequestsIdle(), REQUEST_IDLE_TIMEOUT_MS, `${declaration.id} Vite requests did not become idle`);
        } catch (error) {
          failures.push(error);
        }
        try {
          await closeHTTPServer(httpServer);
        } catch (error) {
          failures.push(error);
        }
        try {
          await withTimeout(vite.close(), VITE_CLOSE_TIMEOUT_MS, `${declaration.id} Vite close timed out`);
        } catch (error) {
          failures.push(error);
        }
        if (failures.length > 0) throw new AggregateError(failures, `Surface service ${declaration.id} teardown failed`);
      },
    };
  } catch (error) {
    await closeHTTPServer(httpServer).catch(() => {});
    if (vite) await withTimeout(vite.close(), VITE_CLOSE_TIMEOUT_MS, `${declaration.id} Vite close timed out`).catch(() => {});
    throw error;
  }
}

function assertServiceDeclaration(service) {
  if (!service || service.kind !== "vite") throw new Error(`Unsupported surface service kind: ${service?.kind ?? "missing"}`);
  if (typeof service.id !== "string" || !service.id) throw new Error("Surface service requires a non-empty id");
  if (typeof service.config !== "string" || !service.config) throw new Error(`Surface service ${service.id} requires a config path`);
  if (typeof service.publishUrlEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(service.publishUrlEnv)) throw new Error(`Surface service ${service.id} has invalid publishUrlEnv`);
}

function installManagedEnvironment(names, values) {
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
}

function restoreEnvironment(values) {
  for (const [name, value] of values) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(0, LOOPBACK_HOST);
  });
}

async function closeHTTPServer(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
