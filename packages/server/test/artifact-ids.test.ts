import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateArtifactID } from "@telepath-computer/television-artifact";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

// proofs/product/artifacts.md#^af-ac-artifact-id: the server's artifact ID
// generator, and its artifact update route run in process over temporary
// storage. A generated ID is a ULID: ten Crockford base-32 characters of
// milliseconds, then sixteen of random bits.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARACTERS = 10;
const RANDOM_BITS = 80n;
const ALL_RANDOM_BITS = (1n << RANDOM_BITS) - 1n;
const COUNT = 10_000;

function decode(text: string): bigint {
  let value = 0n;
  for (const character of text) {
    const digit = CROCKFORD.indexOf(character);
    if (digit < 0) throw new Error(`not a Crockford base-32 character: ${character}`);
    value = value * 32n + BigInt(digit);
  }
  return value;
}

describe("generated artifact IDs", () => {
  it("carry 80 random bits beyond their time component", () => {
    const before = Date.now();
    const ids = Array.from({ length: COUNT }, () => generateArtifactID());
    const after = Date.now();
    let ones = 0n;
    let zeros = 0n;
    for (const id of ids) {
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      const time = Number(decode(id.slice(0, TIME_CHARACTERS)));
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
      const random = decode(id.slice(TIME_CHARACTERS));
      expect(random <= ALL_RANDOM_BITS).toBe(true);
      ones |= random;
      zeros |= ~random & ALL_RANDOM_BITS;
    }
    // Each of the 80 bits takes both values across the IDs, so none is fixed.
    expect(ones).toBe(ALL_RANDOM_BITS);
    expect(zeros).toBe(ALL_RANDOM_BITS);
  });

  it("are distinct across 10,000 generations", () => {
    const ids = Array.from({ length: COUNT }, () => generateArtifactID());
    expect(new Set(ids).size).toBe(COUNT);
  });

  it("share no random part when generated within one millisecond", () => {
    const byMillisecond = new Map<string, string[]>();
    for (let index = 0; index < COUNT; index += 1) {
      const id = generateArtifactID();
      const time = id.slice(0, TIME_CHARACTERS);
      byMillisecond.set(time, [...(byMillisecond.get(time) ?? []), id.slice(TIME_CHARACTERS)]);
    }
    const shared = [...byMillisecond.values()].filter((randoms) => randoms.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const randoms of shared) {
      // Neither half of the random part repeats within a millisecond, as it
      // would if IDs counted up from one random value.
      expect(new Set(randoms.map((random) => random.slice(0, 8))).size).toBe(randoms.length);
      expect(new Set(randoms.map((random) => random.slice(8))).size).toBe(randoms.length);
    }
  });
});

describe("the artifact update route", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("keeps an artifact's ID when it changes the artifact", async () => {
    const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-artifact-ids-"));
    cleanups.push(() => rmSync(storagePath, { recursive: true, force: true }));
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    await server.start();
    cleanups.push(() => server.dispose());
    const auth = { Authorization: `Bearer ${store.authToken}` };
    const target = path.join(storagePath, "note.md");
    const nextTarget = path.join(storagePath, "next.md");
    writeFileSync(target, "# Note\n");
    writeFileSync(nextTarget, "# Next\n");

    const created = await request(server.httpServer)
      .post("/artifacts")
      .set(auth)
      .send({ kind: "path", title: "Before", channelID: store.listChannels()[0]!.id, path: target })
      .expect(201);
    const id = created.body.artifact.id as string;
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const updated = await request(server.httpServer)
      .patch(`/artifacts/${id}`)
      .set(auth)
      .send({ title: "After", path: nextTarget })
      .expect(200);
    expect(updated.body.artifact).toEqual({ ...created.body.artifact, title: "After", path: nextTarget });
    await request(server.httpServer).get(`/artifacts/${id}`).set(auth).expect(200).expect(({ body }) => {
      expect(body.artifact.id).toBe(id);
    });
    expect(JSON.parse(readFileSync(path.join(storagePath, "state", "artifacts", `${id}.json`), "utf8")))
      .toMatchObject({ id, title: "After", path: nextTarget });
  });
});
