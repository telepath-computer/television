import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adminRoutes,
  encodeUpdateEntries,
  encodeWriteValue,
  generatePushKey,
  storeQuery,
  type StoreAddress,
} from "@telepath-computer/television-shared/resources";
import { ResourceTestContext, type RunningServer } from "./harness.ts";

const context = new ResourceTestContext();
afterEach(() => context.cleanup());

interface RouteCall {
  method: "GET" | "POST";
  route: string;
  body?: unknown;
}

interface Fixture {
  artifactID: string;
  /** The artifact's own store's resource ID. */
  own: string;
  /** A created store. */
  todos: string;
  /** A created store the last call destroys. */
  doomed: string;
}

const value = (store: StoreAddress, path = "") => {
  const query = storeQuery(store);
  query.set("path", path);
  return `${adminRoutes.jsonGet}?${query.toString()}`;
};

/** One valid call of every administrative route but the share routes, in an order that succeeds against `prepare`'s fixture with the flag on. */
function everyRoute(fixture: Fixture): RouteCall[] {
  const { artifactID, own, todos, doomed } = fixture;
  return [
    { method: "GET", route: adminRoutes.list },
    { method: "GET", route: `${adminRoutes.list}?artifact=${artifactID}` },
    { method: "GET", route: adminRoutes.info(own) },
    { method: "POST", route: adminRoutes.describe(own), body: { description: "Shared chores" } },
    { method: "POST", route: adminRoutes.bind(todos), body: { artifactID, access: "read" } },
    { method: "POST", route: adminRoutes.unbind(todos), body: { artifactID } },
    { method: "POST", route: adminRoutes.jsonCreate, body: { description: "Fresh" } },
    { method: "GET", route: value({ artifactID }) },
    { method: "POST", route: adminRoutes.jsonSet, body: { store: { artifactID }, path: "a", value: encodeWriteValue(1) } },
    { method: "POST", route: adminRoutes.jsonUpdate, body: { store: { resourceID: todos }, path: "", entries: encodeUpdateEntries({ b: 2 }) } },
    { method: "POST", route: adminRoutes.jsonPush, body: { store: { artifactID }, path: "list", key: generatePushKey(), value: encodeWriteValue("x") } },
    { method: "POST", route: adminRoutes.jsonRemove, body: { store: { resourceID: own }, path: "a" } },
    { method: "POST", route: adminRoutes.destroy(doomed), body: { force: false } },
  ];
}

async function prepare(server: RunningServer): Promise<Fixture> {
  const artifactID = server.createArtifact();
  expect((await server.jsonSet({ artifactID }, "", {})).status).toBe(200);
  return {
    artifactID,
    own: server.storePointer(artifactID)!,
    todos: await server.createdStore({ description: "Todos", value: {} }),
    doomed: await server.createdStore({ description: "Doomed" }),
  };
}

async function unchanged(server: RunningServer, fixture: Fixture): Promise<void> {
  const list = await server.list();
  expect(list.body.resources.map((resource: { resourceID: string; description: string }) => [resource.resourceID, resource.description]).sort()).toEqual(
    [
      [fixture.own, expect.any(String)],
      [fixture.todos, "Todos"],
      [fixture.doomed, "Doomed"],
    ].sort((left, right) => ((left[0] as string) < (right[0] as string) ? -1 : 1)),
  );
  expect((await server.jsonGet({ artifactID: fixture.artifactID })).body).toEqual({ exists: true, value: {} });
  expect((await server.info(fixture.own)).body.resource.description).not.toBe("Shared chores");
  expect((await server.info(fixture.todos)).body.resource.bindings).toEqual([]);
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-admin-routes
describe("administrative route authorization", () => {
  it("refuses every route without the bearer token, with a wrong one, or with an artifact ID, and accepts the token", async () => {
    const server = await context.start({ auth: true, resourceBindings: true });
    const fixture = await prepare(server);
    for (const token of [null, "wrong-token", fixture.artifactID]) {
      for (const call of everyRoute(fixture)) {
        const result = await server.request(call.method, call.route, call.body, { token });
        expect(result.status, `${call.method} ${call.route} with ${String(token)}`).toBe(401);
      }
      await unchanged(server, fixture);
    }
    for (const call of everyRoute(fixture)) {
      const result = await server.request(call.method, call.route, call.body);
      expect(result.status, `${call.method} ${call.route}: ${JSON.stringify(result.body)}`).toBeGreaterThanOrEqual(200);
      expect(result.status, `${call.method} ${call.route}: ${JSON.stringify(result.body)}`).toBeLessThan(300);
    }
  });

  it("refuses a share change without the bearer token, with a wrong one, or with an artifact ID or share ID, and accepts the token", async () => {
    const server = await context.start({ auth: true });
    const artifactID = server.createArtifact();
    const other = server.createArtifact("Other");
    const shareID = await server.sharedAt(other, "read");
    for (const token of [null, "wrong-token", artifactID, shareID]) {
      expect((await server.share(artifactID, "read", { token })).status, String(token)).toBe(401);
      expect((await server.unshare(other, { token })).status, String(token)).toBe(401);
    }
    expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8"))).not.toHaveProperty("share");
    expect(JSON.parse(readFileSync(server.recordFile(other), "utf8")).share).toEqual({ id: shareID, access: "read" });
    expect((await server.share(artifactID, "read")).status).toBe(200);
    expect((await server.unshare(other)).status).toBe(200);
  });

  it("succeeds without a token on a tokenless server", async () => {
    const server = await context.start({ auth: false, resourceBindings: true });
    const fixture = await prepare(server);
    for (const call of everyRoute(fixture)) {
      const result = await server.request(call.method, call.route, call.body, { token: null });
      expect(result.status, `${call.method} ${call.route}: ${JSON.stringify(result.body)}`).toBeLessThan(300);
    }
    expect((await server.share(fixture.artifactID, "read", { token: null })).body).toMatchObject({ code: "tokenless" });
  });
});

type Refusal = [string, Promise<{ status: number; body: { error: string; code: string } }>];

async function expectRefusals(refusals: Refusal[]): Promise<void> {
  for (const [code, pending] of refusals) {
    const result = await pending;
    expect(result.status, `${code}: ${JSON.stringify(result.body)}`).toBeGreaterThanOrEqual(400);
    expect(result.body, code).toEqual({ error: expect.any(String), code });
  }
}

const MISSING = "01JZZZZZZZZZZZZZZZZZZZZZZZ";

// spec: proofs/arch/resources/index.md#^rs-arch-t-refusals
describe("administrative refusals", () => {
  it("with the flag off, refuses what the flag hides, unknown artifacts and stores, invalid descriptions and usages, and an artifact without a store", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "", {});
    const own = server.storePointer(artifactID)!;
    const storeless = server.createArtifact("Onboarding", { id: "onboarding-welcome" });
    const url = server.createArtifact("Link", { form: "url" });
    await expectRefusals([
      ["not-enabled", server.createJsonStore({ description: "Fresh" })],
      ["not-enabled", server.bind(own, server.createArtifact("Other"), "read")],
      ["not-enabled", server.unbind(own, artifactID)],
      ["no-artifact", server.jsonGet({ artifactID: "no-such-artifact" })],
      ["no-artifact", server.jsonSet({ artifactID: "no-such-artifact" }, "a", 1)],
      ["no-artifact", server.list("no-such-artifact")],
      ["no-store", server.jsonGet({ artifactID: storeless })],
      ["no-store", server.jsonSet({ artifactID: storeless }, "a", 1)],
      ["not-found", server.jsonGet({ resourceID: MISSING })],
      ["not-found", server.jsonSet({ resourceID: MISSING }, "a", 1)],
      ["not-found", server.info(MISSING)],
      ["not-found", server.describe(MISSING, { description: "x" })],
      ["not-found", server.destroy(MISSING)],
      ["not-found", server.info("todos")],
      ["not-found", server.jsonGet({ resourceID: "../state" })],
      ["invalid-description", server.describe(own, { description: "" })],
      ["invalid-description", server.describe(own, { description: "x".repeat(1025) })],
      ["invalid-description", server.describe(own, { description: "two\nlines" })],
      ["invalid-usage", server.describe(own, { usage: "x".repeat(16_385) })],
      ["no-artifact", server.share("no-such-artifact", "read")],
      ["no-artifact", server.unshare("no-such-artifact")],
      ["not-shareable", server.share(url, "read")],
      ["not-shared", server.unshare(artifactID)],
    ]);
    expect((await server.share(url, "read")).body.error).toMatch(/only artifacts this server serves from its own files can be shared/i);
    expect((await server.unshare(artifactID)).body.error).toBe(`Artifact ${artifactID} is not shared.`);
    const tokenless = await context.start({ auth: false });
    const unshared = tokenless.createArtifact();
    const refusal = await tokenless.share(unshared, "read", { token: null });
    expect(refusal.status).toBeGreaterThanOrEqual(400);
    expect(refusal.body).toEqual({ error: expect.stringMatching(/needs the server's auth token/), code: "tokenless" });
    expect((await server.info(MISSING)).body.error).toBe(`Resource not found: ${MISSING}`);
    expect((await server.jsonGet({ artifactID: "no-such-artifact" })).body.error).toBe("Artifact not found: no-such-artifact");
    expect((await server.list()).body.resources).toHaveLength(1);

    const refused = await server.destroy(own);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body).toEqual({ error: expect.any(String), code: "still-bound", bindings: [{ resourceID: own, artifactID, access: "read-write" }] });
    expect(refused.body.error).toContain(`${artifactID} (read-write)`);
    expect(refused.body.error).toContain("--force");
  });

  it("with the flag on, refuses a creation without a description, a binding to no artifact, an unbinding of an unbound artifact and the owner's binding, and a bound store's destruction without force", async () => {
    const server = await context.start({ resourceBindings: true });
    const owner = server.createArtifact("Owner");
    const reader = server.createArtifact("Reader");
    await server.jsonSet({ artifactID: owner }, "", {});
    const own = server.storePointer(owner)!;
    await expectRefusals([
      ["invalid-description", server.request("POST", adminRoutes.jsonCreate, {})],
      ["invalid-description", server.request("POST", adminRoutes.jsonCreate, { description: "" })],
      ["invalid-usage", server.request("POST", adminRoutes.jsonCreate, { description: "Fresh", usage: "x".repeat(16_385) })],
      ["no-artifact", server.bind(own, "no-such-artifact", "read")],
      ["not-found", server.bind(MISSING, reader, "read")],
      ["not-bound", server.unbind(own, reader)],
      ["owner-binding", server.bind(own, owner, "read")],
      ["owner-binding", server.unbind(own, owner)],
    ]);
    expect((await server.list()).body.resources).toHaveLength(1);

    await server.bind(own, reader, "read");
    const expected = [
      { resourceID: own, artifactID: owner, access: "read-write" },
      { resourceID: own, artifactID: reader, access: "read" },
    ].sort((left, right) => (left.artifactID < right.artifactID ? -1 : 1));
    const refused = await server.destroy(own);
    expect(refused.body).toEqual({ error: expect.any(String), code: "still-bound", bindings: expected });
    expect(refused.body.error).toContain(`${owner} (read-write)`);
    expect(refused.body.error).toContain(`${reader} (read)`);

    const forced = await server.destroy(own, true);
    expect(forced.status).toBe(200);
    expect(forced.body).toEqual({ removedBindings: expected });
    expect((await server.info(own)).body.code).toBe("not-found");
  });

  it("refuses operations on an unavailable store with unavailable", async () => {
    const server = await context.start();
    const artifactID = server.createArtifact();
    await server.jsonSet({ artifactID }, "", {});
    const resourceID = server.storePointer(artifactID)!;
    await server.stop();
    writeFileSync(path.join(server.home, "resources", "json", resourceID, "content.json"), "{ not json");
    const restarted = await context.start({ home: server.home });
    for (const pending of [
      restarted.jsonGet({ artifactID }),
      restarted.jsonGet({ resourceID }),
      restarted.jsonSet({ resourceID }, "a", 1),
      restarted.describe(resourceID, { description: "x" }),
    ]) {
      const result = await pending;
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.body).toEqual({ error: expect.any(String), code: "unavailable" });
    }
    expect((await restarted.info(resourceID)).body.resource).toMatchObject({ status: "unavailable", unavailableReason: expect.any(String) });
  });
});

function corsHeaders(headers: Headers): string[] {
  return [...headers.keys()].filter((name) => name.toLowerCase().startsWith("access-control-"));
}

// spec: proofs/arch/resources/index.md#^rs-arch-t-origin
/** The origins of pages on another site, and of pages behind a front that terminates TLS for the server's own host. */
function otherOrigins(server: RunningServer): Array<[string, string]> {
  return [
    ["another site", "http://other-site.example"],
    ["an HTTPS front", `https://${server.host}`],
  ];
}

describe("requests from other origins on the administrative routes", () => {
  it("applies a POST of the kind browsers send without a preflight from another site or an HTTPS front, as one without Origin, on a tokenless server", async () => {
    const server = await context.start({ auth: false });
    for (const [name, headers] of [...otherOrigins(server).map(([label, origin]) => [label, { Origin: origin }] as const), ["no Origin", {}] as const]) {
      const artifactID = server.createArtifact(name);
      const result = await server.request("POST", adminRoutes.jsonSet, undefined, {
        token: null,
        rawBody: JSON.stringify({ store: { artifactID }, path: "", value: encodeWriteValue({ planted: name }) }),
        headers: { "Content-Type": "text/plain;charset=UTF-8", ...headers },
      });
      expect(result.status, name).toBe(200);
      expect(corsHeaders(result.headers), name).toEqual([]);
      expect((await server.jsonGet({ artifactID })).body, name).toEqual({ exists: true, value: { planted: name } });
    }
  });

  it("applies the same request from another site or an HTTPS front with the token, and refuses it without the token, changing nothing, where the token is required", async () => {
    const server = await context.start({ auth: true });
    for (const [name, origin] of otherOrigins(server)) {
      const artifactID = server.createArtifact(name);
      const share = (options: { token?: null }) => server.request("POST", adminRoutes.share(artifactID), undefined, {
        ...options,
        rawBody: JSON.stringify({ access: "read-write" }),
        headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: origin },
      });
      const refused = await share({ token: null });
      expect(refused.status, name).toBe(401);
      expect(corsHeaders(refused.headers), name).toEqual([]);
      expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8")), name).not.toHaveProperty("share");
      const shared = await share({});
      expect(shared.status, name).toBe(200);
      expect(corsHeaders(shared.headers), name).toEqual([]);
      expect(JSON.parse(readFileSync(server.recordFile(artifactID), "utf8")).share, name).toMatchObject({ access: "read-write" });
    }
  });

  it("sends no CORS headers on any response, including OPTIONS", async () => {
    const server = await context.start({ auth: true });
    const responses = [
      await server.request("GET", adminRoutes.list),
      await server.request("GET", adminRoutes.list, undefined, { headers: { Origin: `http://${server.host}` } }),
      await server.request("GET", adminRoutes.list, undefined, { token: null }),
      await server.request("GET", adminRoutes.info(MISSING)),
      await server.request("OPTIONS", adminRoutes.jsonSet, undefined, { headers: { Origin: "http://attacker.example", "Access-Control-Request-Method": "POST" } }),
      await server.request("OPTIONS", adminRoutes.jsonSet, undefined, { headers: { Origin: `http://${server.host}` } }),
      await server.request("OPTIONS", adminRoutes.list),
      await server.request("GET", `${adminRoutes.list}/unknown/route`),
    ];
    for (const response of responses) expect(corsHeaders(response.headers)).toEqual([]);
  });

  it("changes nothing on GET or HEAD to a state-changing route", async () => {
    const server = await context.start({ auth: true, resourceBindings: true });
    const fixture = await prepare(server);
    const stateChanging = everyRoute(fixture).filter((call) => call.method === "POST");
    for (const call of stateChanging) {
      for (const method of ["GET", "HEAD"]) {
        const query = call.body ? `?${new URLSearchParams(Object.entries(call.body as Record<string, unknown>).map(([key, field]) => [key, typeof field === "string" ? field : JSON.stringify(field)]))}` : "";
        const result = await server.request(method, `${call.route}${query}`);
        expect(result.status, `${method} ${call.route}`).toBeGreaterThanOrEqual(400);
      }
    }
    await unchanged(server, fixture);
    expect(readFileSync(server.recordFile(fixture.artifactID), "utf8")).toContain(fixture.own);

    const shared = server.createArtifact("Shared");
    const shareID = await server.sharedAt(shared, "read");
    for (const method of ["GET", "HEAD"]) {
      for (const route of [`${adminRoutes.share(fixture.artifactID)}?access=read`, adminRoutes.unshare(shared)]) {
        expect((await server.request(method, route)).status, `${method} ${route}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(JSON.parse(readFileSync(server.recordFile(fixture.artifactID), "utf8"))).not.toHaveProperty("share");
    expect(JSON.parse(readFileSync(server.recordFile(shared), "utf8")).share).toEqual({ id: shareID, access: "read" });
  });
});
