import { app } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Connection {
  serverURL: string;
  token: string;
}

function storePath(): string {
  return path.join(app.getPath("userData"), "connection.json");
}

export function loadConnection(): Connection | null {
  const file = storePath();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Connection>;
    if (typeof parsed.serverURL !== "string") return null;
    return { serverURL: parsed.serverURL, token: typeof parsed.token === "string" ? parsed.token : "" };
  } catch {
    return null;
  }
}

export function saveConnection(connection: Connection): void {
  const file = storePath();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(connection, null, 2), "utf8");
  renameSync(tmp, file);
}
