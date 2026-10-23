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

  it.each<JSONSchema>([
    { $async: true, type: "boolean" },
    { $async: false },
    { $async: true, $ref: "#/$async" },
  ])("rejects a root async declaration without rewriting the schema: %j", (schema) => {
    const before = structuredClone(schema);
    expect(() => compileTemplateSchema(schema)).toThrow("$async is not supported in dataSchema");
    expect(schema).toEqual(before);
  });

  it("rejects a synchronous schema referencing an async subschema through Ajv", () => {
    expect(() => compileTemplateSchema({
      $defs: { text: { $async: true, type: "string" } },
      $ref: "#/$defs/text",
    })).toThrow("async schema in sync schema");
  });

  // proofs/arch/templates/index.md#^templates-t-preflight
  it.each<[JSONSchema, unknown, RegExp | undefined]>([
    [true, null, undefined],
    [false, null, /root/],
    [{ type: "object", required: ["message"] }, {}, /root.*message/],
    [{ properties: { message: { type: "string" } } }, { message: 42 }, /\/message.*string/],
    [{ $defs: { text: { type: "string" } }, properties: { message: { $ref: "#/$defs/text" } } }, { message: 42 }, /\/message.*string/],
    [{ type: "string", format: "email", contentEncoding: "base64", contentMediaType: "application/json" }, "not email or base64", undefined],
    [{ properties: { message: { type: "string", default: "default" } } }, {}, undefined],
    [{ type: "object", required: ["message"], properties: { message: { default: "default" } } }, {}, /root.*message/],
    [{ properties: { count: { type: "integer" } } }, { count: "42" }, /\/count.*integer/],
    [{ type: "object", additionalProperties: false }, { extra: true }, /additional propert/],
  ])("validates %j without changing %j", (schema, value, failure) => {
    const before = structuredClone(value);
    const schemaBefore = structuredClone(schema);
    if (failure) {
      expect(() => validateTemplateData(schema, value, "sample")).toThrow(failure);
      expect(() => validateTemplateData(schema, value, "sample")).toThrow("tv templates show -- 'sample'");
    } else expect(validateTemplateData(schema, value, "sample")).toBeUndefined();
    expect(value).toEqual(before);
    expect(schema).toEqual(schemaBefore);
  });
});
