import {
  artifactBasename,
  hasTrailingSeparator,
  isMarkdownPath,
  isTvArtifact,
  type Artifact,
} from "@telepath-computer/television-artifact";

export type ArtifactRenderRoute =
  | { renderer: "proxy-iframe"; viewURL: string; contentURL: null }
  | { renderer: "markdown"; viewURL: string; contentURL: string }
  | { renderer: "url-webview"; viewURL: string; contentURL: string | null }
  | { renderer: "url-unsupported"; viewURL: string; contentURL: null }
  // Browser demo mode (specs/product/artifacts.md#^af-demo-mode): an external
  // page loaded directly in a bridgeless iframe.
  | { renderer: "url-direct"; viewURL: string; contentURL: null };

export interface ArtifactRenderOptions {
  electron: boolean;
  /** The server's browser demo mode flag; only browsers act on it. */
  browserDemo?: boolean;
}

const MARKDOWN_VIEW_URL = "/views/markdown/";
const URL_UNSUPPORTED_VIEW_URL = "/views/url-unsupported/";

function isWebURL(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function proxyMountPath(id: string): string {
  return `/artifact/${encodeURIComponent(id)}`;
}

function proxyFilePath(id: string, basename: string): string {
  return `${proxyMountPath(id)}/${encodeURIComponent(basename)}`;
}

function markdownContentPath(id: string): string {
  return `/markdown/${encodeURIComponent(id)}`;
}

export function artifactRenderRoute(
  artifact: Artifact,
  options: ArtifactRenderOptions = { electron: false },
): ArtifactRenderRoute {
  if (artifact.kind === "url") {
    if (options.electron) return { renderer: "url-webview", viewURL: artifact.url, contentURL: null };
    if (isTvArtifact(artifact.url)) return { renderer: "proxy-iframe", viewURL: artifact.url, contentURL: null };
    if (options.browserDemo && isWebURL(artifact.url)) {
      return { renderer: "url-direct", viewURL: artifact.url, contentURL: null };
    }
    return { renderer: "url-unsupported", viewURL: URL_UNSUPPORTED_VIEW_URL, contentURL: null };
  }

  if (isMarkdownPath(artifact.path)) {
    const route = {
      viewURL: MARKDOWN_VIEW_URL,
      contentURL: markdownContentPath(artifact.id),
    };
    return options.electron
      ? { renderer: "url-webview", ...route }
      : { renderer: "markdown", ...route };
  }

  const viewURL = hasTrailingSeparator(artifact.path)
    ? `${proxyMountPath(artifact.id)}/`
    : proxyFilePath(artifact.id, artifactBasename(artifact.path));

  return options.electron
    ? { renderer: "url-webview", viewURL, contentURL: null }
    : { renderer: "proxy-iframe", viewURL, contentURL: null };
}
