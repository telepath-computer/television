import path from "node:path";
import type { RequestHandler } from "express";

/** Where pages load the resource SDK; `v1` is the resource API version (specs/arch/resources/sdk.md#^sdk-serving). */
export const SDK_ROUTE = "/sdk/v1/resources.js";

/** The SDK's third-party notices, beside the module (specs/arch/licensing.md#^licensing-sdk-notices). */
export const SDK_NOTICES_ROUTE = "/sdk/v1/THIRD-PARTY-NOTICES.txt";

/**
 * Serves the built SDK from `sdkDir` without authorization: the module
 * carries no credentials or per-request content, and revalidates on every
 * use (specs/arch/canonical.md#^cn-cache-policy).
 */
export function serveResourceSdk(sdkDir: string): RequestHandler {
  return serveSdkFile(path.resolve(sdkDir, "v1", "resources.js"), "text/javascript; charset=utf-8");
}

/** Serves the notices the SDK build wrote beside the module, as the module is served. */
export function serveResourceSdkNotices(sdkDir: string): RequestHandler {
  return serveSdkFile(path.resolve(sdkDir, "v1", "THIRD-PARTY-NOTICES.txt"), "text/plain; charset=utf-8");
}

function serveSdkFile(file: string, contentType: string): RequestHandler {
  return (_req, res, next) => {
    res.sendFile(
      file,
      { cacheControl: false, headers: { "Content-Type": contentType, "Cache-Control": "no-cache" } },
      (error) => {
        if (error && !res.headersSent) next(error);
      },
    );
  };
}
