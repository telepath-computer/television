import { describe, expect, it } from "vitest";
import type { JSONSchema } from "@telepath-computer/television-shared";
import { compileTemplateSchema, validateTemplateData } from "../src/template-schema.ts";

// proofs/arch/templates/index.md#^templates-t-schema
// Real schema compilation and caller-data validation, with no mocks.
describe("template caller-data schema validation", () => {
  it.each<JSONSchema>([
    true, false, { type: "object" },
    { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" },
    { $defs: { text: { type: "string" } }, properties: { message: { $ref: "#/$defs/text" } } },
    { $defs: { unused: { $ref: "#/$defs/missing" } } },
  ])("compiles valid schemas without inspecting unused references: %j", (schema) => {
    expect(() => compileTemplateSchema(schema)).not.toThrow();
  });

  it.each<JSONSchema>([
    { $schema: "http://json-schema.org/draft-07/schema#" },
    { type: "invalid" },
    { $ref: "#/$defs/missing" },
    { $ref: "#/name" },
    { $ref: "https://example.com/external" },
    { $ref: "https://json-schema.org/draft/2020-12/meta/validation#/$defs/stringArray" },
  ])("rejects invalid schemas, wrong dialects and unresolved references: %j", (schema) => {
    expect(() => compileTemplateSchema(schema)).toThrow();
  });

  // proofs/arch/templates/index.md#^templates-t-preflight
  it.each<[JSONSchema, unknown, RegExp | undefined]>([
    [true, null, undefined],
    [false, null, /root/],
    [{ $async: true, type: "boolean" }, false, undefined],
    [{ $async: true, type: "boolean" }, 42, /root.*boolean/],
    [{ type: "object", required: ["message"] }, {}, /root.*message/],
    [{ properties: { message: { type: "string" } } }, { message: 42 }, /\/message.*string/],
    [{ $defs: { text: { type: "string" } }, properties: { message: { $ref: "#/$defs/text" } } }, { message: 42 }, /\/message.*string/],
    [{ type: "string", format: "email", contentEncoding: "base64", contentMediaType: "application/json" }, "not email or base64", undefined],
    [{ properties: { message: { type: "string", default: "default" } } }, {}, undefined],
    [{ type: "object", required: ["message"], properties: { message: { default: "default" } } }, {}, /root.*message/],
    [{ properties: { count: { type: "integer" } } }, { count: "42" }, /\/count.*integer/],
    [{ type: "object", additionalProperties: false }, { extra: true }, /additional propert/],
  ])("validates %j without changing %j", async (schema, value, failure) => {
    const before = structuredClone(value);
    if (failure) {
      await expect(validateTemplateData(schema, value, "sample")).rejects.toThrow(failure);
      await expect(validateTemplateData(schema, value, "sample")).rejects.toThrow("tv templates show -- 'sample'");
    } else await expect(validateTemplateData(schema, value, "sample")).resolves.toBeUndefined();
    expect(value).toEqual(before);
  });
});
