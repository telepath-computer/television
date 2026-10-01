const TOKEN_QUERY_PARAM = "token";

export interface ParsedConnectURL {
  serverURL: string;
  token: string | null;
}

export function buildConnectURL(serverURL: string, token?: string | null): string {
  const url = new URL(serverURL);
  if (!token) return url.origin;
  const clean = new URL(url.origin);
  clean.searchParams.set(TOKEN_QUERY_PARAM, token);
  return clean.toString();
}

export function parseConnectURL(input: string): ParsedConnectURL {
  const url = new URL(input);
  const token = url.searchParams.get(TOKEN_QUERY_PARAM);
  return { serverURL: url.origin, token };
}
