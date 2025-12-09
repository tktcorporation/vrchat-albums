# Neverthrow Catch Block Check

Catch blocks should properly classify errors.

```grit
language js

// Catch blocks that wrap errors without classification
`catch ($error) { return err($error) }`
```