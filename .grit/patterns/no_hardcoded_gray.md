# No Hardcoded Gray Colors

Detect hardcoded gray colors that should use semantic tokens.

Use `TEXT_COLOR.primary/secondary/muted` or `SURFACE_COLOR` instead.

Migration mapping:
- `text-gray-900 dark:text-white` → `TEXT_COLOR.primary` (text-foreground)
- `text-gray-700 dark:text-gray-300` → `TEXT_COLOR.secondary` (text-muted-foreground)
- `text-gray-500 dark:text-gray-400` → `TEXT_COLOR.muted` (text-muted-foreground/60)
- `bg-gray-100 dark:bg-gray-800` → `SURFACE_COLOR.muted` (bg-muted)

```grit
language js

// Detect text-gray-XXX patterns in className strings
`$class` where {
  $class <: contains or {
    "text-gray-900",
    "text-gray-800",
    "text-gray-700",
    "text-gray-600",
    "text-gray-500",
    "text-gray-400",
    "text-gray-300"
  }
}
```
