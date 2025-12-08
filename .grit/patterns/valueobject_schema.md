# ValueObject Zod Schema Check

Check that Zod schemas follow naming convention.

```grit
language js

// Check for incorrectly named schemas
or {
  `export const $schemaName = z.string().transform((val) => new $className(val))`,
  `export const $schemaName = z.string().transform(($var) => new $className($var))`,
  `export const $schemaName = z.number().transform((val) => new $className(val))`,
  `export const $schemaName = z.number().transform(($var) => new $className($var))`
} where {
  // Schema name should be ClassName + "Schema"
  $schemaName <: not r"^[A-Z][a-zA-Z0-9]*Schema$"
}
```