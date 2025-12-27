# Linter化候補: ts-pattern if文置き換え

## 現状の規約
```xml
<pattern name="ts-pattern Usage" priority="critical">
  <mandatory>Replace ALL if statements with match() from ts-pattern</mandatory>
  <priority-targets>
    <target>Error handling conditionals</target>
    <target>Enum/string literal comparisons</target>
    <target>Type guards and instanceof checks</target>
    <target>Nested if-else chains</target>
  </priority-targets>
  <exceptions>
    <exception>Simple boolean checks (if (isLoading))</exception>
    <exception>Complex business logic conditions</exception>
    <exception>Test assertions</exception>
  </exceptions>
</pattern>
```

## 現在の違反状況
多数のif文が残存（特に以下のパターン）:
- `if (result.isErr())` - 20箇所以上
- `if (error instanceof UserFacingError)` - 複数箇所
- `if (value === null)` - 多数

## なぜLinter化すべきか
- 手動で全てチェックするのは非現実的
- 新規コードでもif文を書いてしまいがち
- 段階的な移行を促進できる

## 実装案
### GritQL (段階的に)
`.grit/patterns/ts_pattern_isErr.md`:
```grit
language js

// Detect if (result.isErr()) pattern
`if ($result.isErr()) { $body }`
```

### 優先度別アプローチ
1. **高優先度**: `if (x instanceof Y)` パターン
2. **中優先度**: `if (result.isErr())` パターン
3. **低優先度**: `if (x === null)` パターン

## 優先度
中

## 備考
- 全てのifを一度に禁止するのは現実的でない
- まずは新規コードに対する警告として導入
- 既存コードは段階的に移行（suppressコメント許可）
