---
paths: ['**/*.ts', '**/*.tsx']
---

# 型安全の実現手段（このリポジトリ固有）

原則は `../robustness.md` が SSOT。このファイルは、その原則をこのリポジトリで実装するときの手段だけを書く。

## Union 型の分岐は ts-pattern

Union 型の網羅チェックには `match()` + `.exhaustive()` を使う。if 文へ書き換えない。新しい値を追加したとき、扱い漏れがコンパイルエラーになるため。

```typescript
const getMessage = (status: Status): string =>
  match(status)
    .with('pending', () => '待機中')
    .with('running', () => '実行中')
    .with('completed', () => '完了')
    .with('failed', () => '失敗')
    .exhaustive();
```

単純な boolean 判定（`if (isLoading)`）だけは if 文でよい。網羅性より柔軟性を優先する場合だけ `.otherwise()` を使う。複数値は `P.union('a', 'b')`、型ガードは `P.instanceOf(Error)` で書ける。

自動強制は `pnpm lint:ts-pattern`。

## 外部境界は Zod

tRPC の input/output、ファイル読み込み、設定パース、ユーザー入力は Zod スキーマで受け、型は `z.infer` で導出する。

ID の取り違えを防ぐには `.brand<'Name'>()` を使う。

```typescript
const PhotoIdSchema = z.string().uuid().brand<'PhotoId'>();
```

値オブジェクトの書き方は `valueobject.md` を参照する。
