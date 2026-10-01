const HOST_URL_ENV = "TV_ARTIFACT_E2E_HOST_URL";
const VIEW_URL_ENV = "TV_ARTIFACT_E2E_VIEW_URL";

export type ArtifactE2EURLs = {
  hostURL: string;
  viewURL: string;
  viewOrigin: string;
};

export function readPublishedArtifactE2EURLs(env: NodeJS.ProcessEnv = process.env): ArtifactE2EURLs {
  const host = requiredURL(env, HOST_URL_ENV);
  const view = requiredURL(env, VIEW_URL_ENV);
  if (host.origin === view.origin) {
    throw new Error(`${HOST_URL_ENV} and ${VIEW_URL_ENV} must publish distinct origins`);
  }
  return {
    hostURL: host.href,
    viewURL: view.href,
    viewOrigin: view.origin,
  };
}

function requiredURL(env: NodeJS.ProcessEnv, name: string): URL {
  const value = env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`${name} must be a loopback HTTP URL; received ${JSON.stringify(value)}`);
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
