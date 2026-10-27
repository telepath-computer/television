// The page's one connection, made when the page first needs it.
import { resourceError } from "./errors.ts";
import { pageIDFromPath, SdkConnection } from "./sdk-connection.ts";

let connection: SdkConnection | null = null;
const setups: Array<(connection: SdkConnection) => void> = [];

/** Runs `setup` on the page's connection when it is made. */
export function onPageConnection(setup: (connection: SdkConnection) => void): void {
  setups.push(setup);
  if (connection) setup(connection);
}

/**
 * The ID in the page's address, its artifact's ID or a share ID. Throws
 * `not-artifact-page` on a page that is not an artifact's content, where
 * every SDK function fails (specs/arch/resources/sdk.md#^sdk-artifact-id).
 */
export function requireArtifactPage(): string {
  if (connection) return connection.id;
  const id = pageIDFromPath(location.pathname);
  if (id === null) {
    throw resourceError("not-artifact-page", "This page is not served as an artifact's content, so it has no resources.");
  }
  return id;
}

/** The page's connection to its artifact's resources; throws `not-artifact-page` like `requireArtifactPage`. */
export function pageConnection(): SdkConnection {
  if (connection) return connection;
  connection = new SdkConnection(requireArtifactPage());
  for (const setup of setups) setup(connection);
  return connection;
}
