import express from "express";
import { HTTP_NOT_FOUND, HTTP_UPGRADE_REQUIRED } from "./http.ts";

/**
 * Plain HTTP requests under `/artifact-resources/`, whose one route is the
 * page connection's WebSocket. They are answered whatever their origin, with
 * no CORS headers (specs/arch/resources/index.md#^rs-any-origin).
 */
export function createArtifactRouter(): express.Router {
  const router = express.Router();
  router.all("/:artifactID/v1/connection", (_req, res) => {
    res.status(HTTP_UPGRADE_REQUIRED).set("Upgrade", "websocket").json({ error: "The page connection is a WebSocket." });
  });
  router.use((_req, res) => {
    res.status(HTTP_NOT_FOUND).json({ error: "Not found" });
  });
  return router;
}
