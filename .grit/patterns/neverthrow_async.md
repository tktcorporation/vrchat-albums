# Neverthrow Async Functions Check

Async functions in service.ts should return Result type.

```grit
language js

// Async functions without Result return type
or {
  `async function $name($_): Promise<$type> { $_ }`,
  `export async function $name($_): Promise<$type> { $_ }`,
  `const $name = async ($_): Promise<$type> => { $_ }`,
  `export const $name = async ($_): Promise<$type> => { $_ }`
} where {
  $type <: not contains `Result`
}
```