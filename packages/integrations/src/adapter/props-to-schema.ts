// Local definitions matching @activepieces/pieces-common types
export enum PropertyType {
  SHORT_TEXT = "SHORT_TEXT",
  LONG_TEXT = "LONG_TEXT",
  MARKDOWN = "MARKDOWN",
  NUMBER = "NUMBER",
  CHECKBOX = "CHECKBOX",
  SELECT = "SELECT",
  STATIC_SELECT = "STATIC_DROPDOWN",
  MULTI_SELECT = "MULTI_SELECT_DROPDOWN",
  STATIC_MULTI_SELECT = "STATIC_MULTI_SELECT_DROPDOWN",
  DATETIME = "DATE_TIME",
  FILE = "FILE",
  JSON = "JSON",
  ARRAY = "ARRAY",
  OBJECT = "OBJECT",
  BASIC_AUTH = "BASIC_AUTH",
  CUSTOM_AUTH = "CUSTOM_AUTH",
  OAUTH2 = "OAUTH2",
  SECRET_TEXT = "SECRET_TEXT",
  DYNAMIC = "DYNAMIC",
}

export interface BaseProperty {
  displayName: string;
  description?: string;
  required: boolean;
}

export interface ShortTextProperty extends BaseProperty { type: PropertyType.SHORT_TEXT; defaultValue?: string; }
export interface LongTextProperty extends BaseProperty { type: PropertyType.LONG_TEXT; }
export interface NumberProperty extends BaseProperty { type: PropertyType.NUMBER; }
export interface CheckboxProperty extends BaseProperty { type: PropertyType.CHECKBOX; defaultValue?: boolean; }
export interface StaticDropdownProperty extends BaseProperty {
  type: PropertyType.STATIC_SELECT;
  options: { options: Array<{ label: string; value: unknown }> };
  defaultValue?: unknown;
}
export interface ArrayProperty extends BaseProperty { type: PropertyType.ARRAY; properties?: Record<string, Property>; }
export interface ObjectProperty extends BaseProperty { type: PropertyType.OBJECT; }
export interface FileProperty extends BaseProperty { type: PropertyType.FILE; }
export interface DateTimeProperty extends BaseProperty { type: PropertyType.DATETIME; }

export type Property =
  | ShortTextProperty
  | LongTextProperty
  | NumberProperty
  | CheckboxProperty
  | StaticDropdownProperty
  | ArrayProperty
  | ObjectProperty
  | FileProperty
  | DateTimeProperty
  | BaseProperty;

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
}

export function propsToJsonSchema(props: Record<string, Property>): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  for (const [key, prop] of Object.entries(props)) {
    properties[key] = propToJsonSchema(prop);
    if (prop.required) required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function propToJsonSchema(prop: Property): JSONSchema {
  const base: JSONSchema = { description: prop.description ?? prop.displayName };

  if (!("type" in prop)) return { ...base, type: "string" };

  // Cast to PropertyType to handle all enum variants (including those not in the union discriminant)
  switch (prop.type as PropertyType) {
    case PropertyType.SHORT_TEXT:
    case PropertyType.LONG_TEXT:
    case PropertyType.MARKDOWN:
    case PropertyType.SECRET_TEXT:
    case PropertyType.DATETIME:
      return { ...base, type: "string" };
    case PropertyType.NUMBER:
      return { ...base, type: "number" };
    case PropertyType.CHECKBOX:
      return { ...base, type: "boolean" };
    case PropertyType.STATIC_SELECT:
      return {
        ...base,
        type: "string",
        enum: (prop as StaticDropdownProperty).options.options.map(o => o.value),
      };
    case PropertyType.ARRAY:
      return { ...base, type: "array" };
    case PropertyType.FILE:
      return {
        ...base,
        type: "object",
        properties: {
          base64: { type: "string", description: "Base64 encoded file content" },
          extension: { type: "string", description: "File extension (e.g. pdf, jpg)" },
          filename: { type: "string" },
        },
      };
    case PropertyType.OBJECT:
    case PropertyType.JSON:
    case PropertyType.DYNAMIC:
      return { ...base, type: "object" };
    default:
      return { ...base, type: "string" };
  }
}
