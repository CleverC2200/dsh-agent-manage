export type JsonSchemaScalar = string | number | boolean | null

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

export interface JsonSchemaNode {
  type?: JsonSchemaType

  oneOf?: JsonSchemaNode[]

  properties?: Record<string, JsonSchemaNode>

  required?: string[]

  additionalProperties?: boolean

  items?: JsonSchemaNode

  enum?: JsonSchemaScalar[]

  const?: JsonSchemaScalar

  description?: string

  title?: string

  default?: JsonSchemaScalar | Record<string, unknown> | unknown[]

  examples?: JsonSchemaScalar | Record<string, unknown> | unknown[]
}

const CONSTRAINT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const'])

const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])
const SCHEMA_TYPES: readonly JsonSchemaType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonScalar(value: unknown): value is JsonSchemaScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isLosslessJson(value: unknown): boolean {
  if (!isRecord(value) && !Array.isArray(value)) return isJsonScalar(value)
  try {
    return JSON.parse(JSON.stringify(value)) !== undefined || value !== undefined
  } catch {
    return false
  }
}

function scalarMatches(schemaType: JsonSchemaType | undefined, value: JsonSchemaScalar): boolean {
  if (schemaType === undefined) return true
  switch (schemaType) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null

    case 'object':
    case 'array':
      return false
  }
}

export function assertSupportedJsonSchema(schema: unknown): asserts schema is JsonSchemaNode {
  const violations: string[] = []
  checkSchemaNode(schema, 'schema', violations, new Set())
  if (violations.length > 0) {
    throw new Error(`unsupported JSON schema: ${violations.join('; ')}`)
  }
}

function checkSchemaNode(node: unknown, path: string, violations: string[], seen: Set<unknown>): void {
  if (seen.has(node)) {
    violations.push(`${path} is recursive; the subset does not accept recursive schemas`)
    return
  }
  if (!isRecord(node)) {
    violations.push(`${path} must be an object`)
    return
  }
  seen.add(node)
  try {
    for (const key of Object.keys(node)) {
      if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
        violations.push(`${path}.${key} is not part of the enforced subset`)
      }
    }
    const hasType = Object.hasOwn(node, 'type')
    const hasOneOf = Object.hasOwn(node, 'oneOf')
    const type = hasType ? node.type : undefined
    if (hasType && !SCHEMA_TYPES.includes(type as JsonSchemaType)) {
      violations.push(`${path}.type must be one of ${SCHEMA_TYPES.join(', ')}`)
    }
    if (hasOneOf) {
      if (hasType) violations.push(`${path} must not declare both type and oneOf`)
      const branches = node.oneOf
      if (!Array.isArray(branches) || branches.length < 2) {
        violations.push(`${path}.oneOf requires at least two branches`)
      } else {
        for (const [index, branch] of branches.entries()) {
          checkSchemaNode(branch, `${path}.oneOf[${index}]`, violations, seen)
        }
      }
    }
    if (Object.hasOwn(node, 'properties')) {
      if (type !== 'object') violations.push(`${path}.properties is only valid on an object schema`)
      const properties = node.properties
      if (!isRecord(properties)) {
        violations.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [name, property] of Object.entries(properties)) {
          checkSchemaNode(property, `${path}.properties.${name}`, violations, seen)
        }
      }
    }
    if (Object.hasOwn(node, 'required')) {
      if (type !== 'object') violations.push(`${path}.required is only valid on an object schema`)
      const required = node.required
      if (!Array.isArray(required) || !required.every(entry => typeof entry === 'string')) {
        violations.push(`${path}.required must be an array of property names`)
      } else {
        const properties = isRecord(node.properties) ? node.properties : undefined
        for (const name of required as string[]) {
          if (properties === undefined || !Object.hasOwn(properties, name)) {
            violations.push(`${path}.required lists "${name}" which has no declared property`)
          }
        }
      }
    }
    if (Object.hasOwn(node, 'additionalProperties')) {
      if (type !== 'object') violations.push(`${path}.additionalProperties is only valid on an object schema`)
      if (typeof node.additionalProperties !== 'boolean') {
        violations.push(`${path}.additionalProperties must be a boolean`)
      }
    }
    if (Object.hasOwn(node, 'items')) {
      if (type !== 'array') violations.push(`${path}.items is only valid on an array schema`)
      checkSchemaNode(node.items, `${path}.items`, violations, seen)
    }
    if (Object.hasOwn(node, 'enum')) {
      const values = node.enum
      if (!Array.isArray(values) || values.length === 0 || !values.every(isJsonScalar)) {
        violations.push(`${path}.enum must be a non-empty array of JSON scalars`)
      } else {
        for (const value of values) {
          if (!scalarMatches(type as JsonSchemaType | undefined, value)) {
            violations.push(`${path}.enum values must match the declared ${String(type)} type`)
            break
          }
        }
      }
    }
    if (Object.hasOwn(node, 'const')) {
      const value = node.const
      if (!isJsonScalar(value) || !scalarMatches(type as JsonSchemaType | undefined, value)) {
        violations.push(`${path}.const must be a scalar matching the declared schema type`)
      }
    }
    for (const annotation of ['default', 'examples'] as const) {
      if (Object.hasOwn(node, annotation) && !isLosslessJson(node[annotation])) {
        violations.push(`${path}.${annotation} must be lossless JSON`)
      }
    }
  } finally {
    seen.delete(node)
  }
}
