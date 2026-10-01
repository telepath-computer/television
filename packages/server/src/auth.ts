import { randomBytes } from "node:crypto";

const AUTH_TOKEN_BYTES = 32;
const AUTH_PARSE_BASE_URL = "http://localhost";

export function createToken(): string {
  return randomBytes(AUTH_TOKEN_BYTES).toString("hex");
}

export function isAuthorizedBearer(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
    return false;
  }

  return authorizationHeader.slice("Bearer ".length) === expectedToken;
}

export function isAuthorizedQueryToken(
  requestURL: string | undefined,
  expectedToken: string,
): boolean {
  if (!requestURL) {
    return false;
  }

  const token = new URL(requestURL, AUTH_PARSE_BASE_URL).searchParams.get("token");
  return token === expectedToken;
}
