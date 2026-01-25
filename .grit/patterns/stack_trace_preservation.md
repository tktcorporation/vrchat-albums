# Stack Trace Preservation Check

Detects patterns that lose the original stack trace when re-throwing errors.

When you wrap an error with `new Error()`, the original stack trace is lost, making debugging difficult.

## Bad pattern

```typescript
// ❌ Stack trace is lost
catch (error) {
  throw new Error(`Failed: ${error.message}`);
}
```

## Good patterns

```typescript
// ✅ Preserve with cause (ES2022+)
catch (error) {
  throw new Error('Failed to process', { cause: error });
}

// ✅ Re-throw the original error
catch (error) {
  throw error;
}
```

## Pattern

```grit
language js

// Detect throw new Error with message interpolation inside catch
`catch ($_) { $body }` where {
  $body <: contains `throw new Error($msg)` where {
    $msg <: contains `.message`
  }
}
```
