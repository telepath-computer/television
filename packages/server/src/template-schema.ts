import { Ajv2020, ValidationError, type ErrorObject } from "ajv/dist/2020.js";
import type { JSONSchema } from "@telepath-computer/television-shared";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const schemaValidator = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });

export function compileTemplateSchema(schema: JSONSchema) {
  if (typeof schema === "object" && Object.hasOwn(schema, "$schema") && schema.$schema !== DIALECT) {
    throw new Error(`$schema must be ${DIALECT}`);
  }
  if (!schemaValidator.validateSchema(schema)) throw new Error(schemaValidator.errorsText());
  // Metaschemas check validity but must remain unavailable to caller references.
  return new Ajv2020({
    meta: false, validateSchema: false, strict: false, validateFormats: false, allErrors: true,
  }).compile(schema);
}

export function templateSchemaHint(id: string): string {
  return `Inspect with tv templates show -- '${id.replace(/'/g, "'\\''")}'`;
}

export async function validateTemplateData(schema: JSONSchema, value: unknown, id: string): Promise<void> {
  const validate = compileTemplateSchema(schema);
  let errors: Partial<ErrorObject>[] | null | undefined;
  try {
    const result = await validate(value);
    if ("$async" in validate || result) return;
    errors = validate.errors;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    errors = error.errors;
  }
  const message = (errors ?? []).map((error) => `${error.instancePath || "root"}: ${error.message}`).join("; ");
  throw new Error(`${message}. ${templateSchemaHint(id)}`);
}
