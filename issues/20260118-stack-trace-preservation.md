# Linter化候補: スタックトレース保持の強制

## 現状の規約

```xml
<anti-pattern name="stack-trace-loss" priority="critical" jp="スタックトレース消失">
  <description>new Error()でエラーを包み直すとスタックトレースが消失する</description>
  <![CDATA[
  // ❌ Bad: スタックトレースが消失
  catch (error) {
    throw new Error(`Failed: ${error.message}`);
  }

  // ✅ Good: causeで元エラーを保持
  catch (error) {
    throw new Error('Failed to process', { cause: error });
  }
  ]]>
</anti-pattern>
```

## なぜLinter化すべきか

- スタックトレースが消失すると、本番環境でのデバッグが著しく困難になる
- Sentryに送信されるエラーの情報量が減少し、根本原因の特定が困難
- ES2022の `{ cause: error }` パターンを強制することで一貫性を確保
- 手動レビューでは見落としやすいパターン

## 検出対象パターン

### 1. catch内でnew Error()をthrow

```typescript
// ❌ 検出すべき
catch (error) {
  throw new Error(`Something failed: ${error.message}`);
}

// ❌ 検出すべき
catch (e) {
  throw new Error(String(e));
}
```

### 2. 許可すべきパターン

```typescript
// ✅ OK: causeを使用
catch (error) {
  throw new Error('Failed', { cause: error });
}

// ✅ OK: 元のエラーを再スロー
catch (error) {
  throw error;
}

// ✅ OK: カスタムエラークラス（causeをコンストラクタで受け取る場合）
catch (error) {
  throw new CustomError('Failed', error);
}
```

## 実装案

### 1. GritQL (推奨)

`.grit/patterns/stack_trace_preservation.md`:

```grit
language js

// catch内でnew Error()をthrowしているが、causeオプションがないパターン
`catch ($error) {
  $$$before
  throw new Error($msg)
  $$$after
}` where {
  // causeオプションがない場合のみマッチ
  $msg <: not contains `{ cause:`
}
```

### 2. TypeScript Compiler API

`scripts/lint-neverthrow.ts` に追加:

```typescript
function checkStackTracePreservation(node: ts.CatchClause): void {
  // catch内のthrow new Error()を検出
  // { cause: ... } オプションがない場合に警告
}
```

### 選択基準

- **GritQL推奨**: シンプルな構文パターンマッチングで検出可能
- TypeScript APIは型情報が必要な場合のみ

## 優先度

高

## 理由

- 本番環境でのデバッグに直接影響
- 一度スタックトレースが消失すると復元不可能
- 開発者が意識せずに書いてしまいやすいパターン

## 関連する既存のlinter

- `yarn lint:neverthrow` - catch-errパターン検出（関連するがスタックトレースは未チェック）
- `.grit/patterns/neverthrow_catch.md` - 基本的なcatchパターン

## 備考

- ES2022の `Error.cause` プロパティはNode.js 16.9+でサポート
- このプロジェクトはNode.js 22 LTSを使用しているため問題なし
