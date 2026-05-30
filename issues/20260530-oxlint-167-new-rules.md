# oxlint 1.67 で correctness 昇格した新ルールへの対応

## 背景

oxlint を 1.56 → 1.67 にアップグレードした際、以下のルールが新たに
correctness カテゴリ（= error）に追加・昇格し、既存コードが広範に違反した。
依存アップグレードのバッチで数百箇所をコード修正するのは不適切なため、
一旦 `warn` に下げて非ブロッキングとした（`.oxlintrc.json` の rules セクション）。

## 対象ルールと違反件数（アップグレード時点）

| ルール                                            | 件数 | 種別   |
| ------------------------------------------------- | ---- | ------ |
| `vitest/require-mock-type-parameters`             | 367  | テスト |
| `vitest/no-conditional-expect`                    | 189  | テスト |
| `vitest/require-to-throw-message`                 | 19   | テスト |
| `vitest/expect-expect`                            | 4    | テスト |
| `vitest/no-disabled-tests`                        | 1    | テスト |
| `jsx-a11y/control-has-associated-label`           | 2    | a11y   |
| `jsx-a11y/no-noninteractive-element-interactions` | 2    | a11y   |

## やるべきこと

1. テスト系ルールはテストの品質向上に寄与するため、段階的に `error` へ戻す
   - `vitest/require-mock-type-parameters`: `vi.fn()` に型引数を付与（`vi.fn<() => void>()`）
   - `vitest/no-conditional-expect`: 条件分岐内の `expect` を解消
   - `vitest/require-to-throw-message`: `toThrow()` にメッセージを付与
   - `vitest/expect-expect` / `vitest/no-disabled-tests`: 件数が少ないので先行対応可能
2. `jsx-a11y` 系は件数が少ない（各2件）。`SearchOverlay.tsx` / `PhotoCard.tsx` を
   個別に a11y 改善し `error` へ戻す
3. 各ルールを `error` に戻したら本チケットを更新

## 関連

- `.oxlintrc.json` の rules セクション（該当ルールに `// 一時的に warn` 相当の集約）
- アップグレード元コミット: oxlint 1.56 → 1.67
