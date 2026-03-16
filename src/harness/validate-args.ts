// ============================================================
// @oni.bot/core/harness — Tool Argument Validator
// Lightweight JSON Schema subset validation for tool call args.
// Catches malformed model outputs before they reach tool execute().
// ============================================================

import type { JSONSchema } from "../models/types.js";

/**
 * Validate tool call arguments against the tool's JSON Schema.
 * Returns null if valid, or a descriptive error string if invalid.
 *
 * Supports the JSON Schema subset used by our tool definitions:
 * - type: "object", "string", "number", "integer", "boolean", "array"
 * - required: string[] (required property names)
 * - properties: Record<string, schema> (property schemas)
 * - enum: any[] (allowed values)
 * - items: schema (array item schema)
 * - minimum, maximum (number bounds)
 * - minLength, maxLength (string bounds)
 */
export function validateToolArgs(
  args: unknown,
  schema: JSONSchema,
  toolName: string,
): string | null {
  // If no schema or empty schema, accept anything
  if (!schema || Object.keys(schema).length === 0) return null;

  // args must be an object (tool args are always key-value pairs)
  if (args === null || args === undefined) {
    return `${toolName}: expected arguments object, got ${args === null ? "null" : "undefined"}`;
  }

  if (typeof args !== "object" || Array.isArray(args)) {
    return `${toolName}: expected arguments object, got ${Array.isArray(args) ? "array" : typeof args}`;
  }

  const obj = args as Record<string, unknown>;
  const errors: string[] = [];

  // Check required properties — null counts as absent (model sent null for a required field = missing)
  const required = schema.required as string[] | undefined;
  if (required && Array.isArray(required)) {
    for (const key of required) {
      if (!(key in obj) || obj[key] === null) {
        errors.push(`missing required parameter "${key}"`);
      }
    }
  }

  // Check property types
  const properties = schema.properties as Record<string, JSONSchema> | undefined;
  if (properties && typeof properties === "object") {
    for (const [key, propSchema] of Object.entries(properties)) {
      const value = obj[key];
      if (value === undefined || value === null) continue; // null already caught by required check; undefined is absent

      const propError = validateValue(value, propSchema, key);
      if (propError) errors.push(propError);
    }
  }

  if (errors.length === 0) return null;
  return `${toolName}: invalid arguments — ${errors.join("; ")}`;
}

/**
 * Validate a single value against a property schema.
 * Returns null if valid, or error string.
 */
function validateValue(
  value: unknown,
  schema: JSONSchema,
  path: string,
): string | null {
  const expectedType = schema.type as string | undefined;

  if (expectedType) {
    const actual = getJSONType(value);

    // "integer" accepts numbers that are whole
    if (expectedType === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `"${path}" must be an integer, got ${actual}`;
      }
    } else if (expectedType !== actual) {
      // Allow number for "string" type (common model error — coerce)
      // Allow boolean for "string" type (common model error — coerce)
      // We DON'T coerce here — we just report the mismatch clearly
      return `"${path}" must be type ${expectedType}, got ${actual}`;
    }
  }

  // Enum check
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues && Array.isArray(enumValues)) {
    if (!enumValues.includes(value)) {
      return `"${path}" must be one of [${enumValues.map(v => JSON.stringify(v)).join(", ")}], got ${JSON.stringify(value)}`;
    }
  }

  // Number bounds
  if (typeof value === "number") {
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    if (min !== undefined && value < min) {
      return `"${path}" must be >= ${min}, got ${value}`;
    }
    if (max !== undefined && value > max) {
      return `"${path}" must be <= ${max}, got ${value}`;
    }
  }

  // String bounds
  if (typeof value === "string") {
    const minLen = schema.minLength as number | undefined;
    const maxLen = schema.maxLength as number | undefined;
    if (minLen !== undefined && value.length < minLen) {
      return `"${path}" must have length >= ${minLen}, got ${value.length}`;
    }
    if (maxLen !== undefined && value.length > maxLen) {
      return `"${path}" must have length <= ${maxLen}, got ${value.length}`;
    }
  }

  // Array items
  if (Array.isArray(value)) {
    const MAX_ARRAY_ITEMS = 1000;
    if (value.length > MAX_ARRAY_ITEMS) {
      return `"${path}" array too large (${value.length} items, max ${MAX_ARRAY_ITEMS})`;
    }
    if (schema.items) {
      const itemSchema = schema.items as JSONSchema;
      for (let i = 0; i < value.length; i++) {
        const itemError = validateValue(value[i], itemSchema, `${path}[${i}]`);
        if (itemError) return itemError;
      }
    }
  }

  // Nested object properties
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    schema.properties
  ) {
    const props = schema.properties as Record<string, JSONSchema>;
    const obj = value as Record<string, unknown>;
    // Check required fields on nested objects (mirrors top-level validateToolArgs check)
    const required = schema.required as string[] | undefined;
    if (required && Array.isArray(required)) {
      for (const key of required) {
        if (!(key in obj) || obj[key] === null) {
          return `missing required field "${path ? `${path}.${key}` : key}"`;
        }
      }
    }
    for (const [k, propSchema] of Object.entries(props)) {
      if (k in obj) {
        const propError = validateValue(obj[k], propSchema, path ? `${path}.${k}` : k);
        if (propError) return propError;
      }
    }
  }

  return null;
}

/** Map a JS value to its JSON Schema type name */
function getJSONType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "string", "number", "boolean", "object"
}
