# No Hardcoded Indigo Colors

Detect hardcoded indigo colors that should use semantic tokens.

Use `TEXT_COLOR.accent` or `text-primary` instead.

Migration mapping:
- `text-indigo-600 dark:text-indigo-400` → `TEXT_COLOR.accent` (text-primary)

```grit
language js

// Detect indigo color patterns in className strings
`$class` where {
  $class <: contains or {
    "text-indigo-600",
    "text-indigo-500",
    "text-indigo-400",
    "bg-indigo-"
  }
}
```
