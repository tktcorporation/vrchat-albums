# Linter化候補: Result型のジェネリックError禁止

## 現状の規約
```xml
<generic-error-types-warning jp="要注意">
  Result<T, Error>, Result<T, any>, Result<T, unknown> are red flags.
  Use specific error union types instead for proper error handling.

  Exception: Generic Error type is acceptable if error is logged to Sentry
  with logger.error() before returning (Sentry-notified error pattern).
</generic-error-types-warning>
```

## 現在の違反状況
```typescript
// electron/module/settingStore.ts
(key: SettingStoreKey): neverthrow.Result<void, Error>
clearStoredSetting: (key: SettingStoreKey) => neverthrow.Result<void, Error>
```

## なぜLinter化すべきか
- ジェネリックError型はエラーハンドリングの網羅性を損なう
- ts-patternのexhaustive checkが効かなくなる
- 具体的なエラー型への移行を促進

## 実装案
### TypeScript Compiler API (推奨)
`scripts/lint-neverthrow.ts` に追加:
```typescript
// Result<T, Error | any | unknown>を検出
function checkGenericErrorType(type: ts.Type): boolean {
  const typeText = checker.typeToString(type);
  return /Result<[^,]+,\s*(Error|any|unknown)>/.test(typeText);
}
```

### 除外条件
- `logger.error()` が直前にある場合は許可（Sentry通知パターン）

## 優先度
中

## 備考
- 既存のlint:neverthrowに統合可能
- まずは警告レベルで導入、段階的にエラーに昇格
