# ValueObject Export Check

Check that ValueObject classes are exported as types only.

```grit
language js

// Direct class export (should be type-only)
`export class $name extends BaseValueObject<$_, $_> {}`
```