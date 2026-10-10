import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import express, { type RequestHandler } from "express";
import { hasTrailingSeparator, isMarkdownPath, type Artifact } from "@telepath-computer/television-artifact";
import type { ServerStore } from "./server-store.ts";
import { artifactRealLocation } from "./artifact-location.ts";

const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;

function isMarkdownArtifact(artifact: Artifact | undefined): artifact is Extract<Artifact, { kind: "path" }> {
  return artifact?.kind === "path" && !hasTrailingSeparator(artifact.path) && isMarkdownPath(artifact.path);
}

function sendMarkdownError(res: express.Response, status: number, message: string): void {
  res.status(status).json({ message });
}

function requestID(req: express.Request): string {
  return String(req.params.id ?? "");
}

function isNotFoundIOError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (
    (error as NodeJS.ErrnoException).code === "ENOENT" ||
    (error as NodeJS.ErrnoException).code === "ENOTDIR"
  );
}

export function serveMarkdownContent(store: ServerStore): { get: RequestHandler; put: RequestHandler } {
  const textBody = express.text({ type: "*/*", limit: "10mb" });

  const get: RequestHandler = async (req, res) => {
    const id = requestID(req);
    const artifact = store.getArtifact(id);
    if (!isMarkdownArtifact(artifact)) {
      sendMarkdownError(res, HTTP_NOT_FOUND, `Markdown artifact not found: ${id}`);
      return;
    }

    // A file whose real location is not a Markdown or HTML file is missing
    // (specs/product/artifacts.md#^af-real-location).
    const location = artifactRealLocation(artifact.path);
    if (location === null) {
      sendMarkdownError(res, HTTP_NOT_FOUND, `Markdown artifact not found: ${id}`);
      return;
    }

    try {
      const content = await fs.readFile(location.path, "utf8");
      res.type("text/markdown; charset=utf-8").send(content);
    } catch (error) {
      if (isNotFoundIOError(error)) {
        sendMarkdownError(res, HTTP_NOT_FOUND, `Markdown artifact not found: ${id}`);
        return;
      }
      sendMarkdownError(res, HTTP_INTERNAL_SERVER_ERROR, "Failed to read markdown artifact");
    }
  };

  const put: RequestHandler = async (req, res) => {
    const id = requestID(req);
    const artifact = store.getArtifact(id);
    if (!isMarkdownArtifact(artifact)) {
      sendMarkdownError(res, HTTP_NOT_FOUND, `Markdown artifact not found: ${id}`);
      return;
    }

    const location = artifactRealLocation(artifact.path);
    if (location === null) {
      sendMarkdownError(res, HTTP_NOT_FOUND, `Markdown artifact not found: ${id}`);
      return;
    }

    const content = typeof req.body === "string" ? req.body : "";
    try {
      await fs.access(location.path, constants.F_OK);
      await fs.writeFile(location.path, content, "utf8");
      res.status(HTTP_NO_CONTENT).end();
    } catch (error) {
      if (isNotFoundIOError(error)) {
        sendMarkdownError(res, HTTP_NOT_FOUND, `Markdown artifact not found: ${id}`);
        return;
      }
      sendMarkdownError(res, HTTP_INTERNAL_SERVER_ERROR, "Failed to write markdown artifact");
    }
  };

  return {
    get,
    put: (req, res, next) => textBody(req, res, (error) => {
      if (error) return next(error);
      return put(req, res, next);
    }),
  };
}
