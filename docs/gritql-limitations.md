# GritQL制限事項と回避策

## GritQLでは実現困難な機能

### 1. 型システムの深い分析

#### 制限事項
- 間接的な継承関係の追跡が困難
- TypeScriptの型推論を利用できない
- ジェネリック型の詳細な検証不可

#### 例: 間接継承の検出
```typescript
// PathObject.ts
class PathObject extends BaseValueObject<'PathObject', string> {}

// SpecialPath.ts
class SpecialPath extends PathObject {} // GritQLでは検出困難
```

#### 回避策
- 直接継承のみをチェック対象とする
- または、TypeScriptベースのlinterと併用

### 2. クロスファイル分析

#### 制限事項
- インポート/エクスポートの追跡が限定的
- 別ファイルの型定義を参照できない

#### 回避策
```grit
// ファイル名パターンで対象を絞る
`export class $name extends BaseValueObject` where {
  $filename <: r".*valueobject.*\.ts$"
}
```

### 3. 動的設定の読み込み

#### 制限事項
- 外部設定ファイル（JSON等）を読めない
- 例外リストはパターン内にハードコード必須

#### 回避策
```bash
# シェルスクリプトで設定を注入
EXCEPTIONS=$(jq -r '.exceptions | @csv' config.json)
grit apply "pattern where { \$name <: not within [$EXCEPTIONS] }"
```

### 4. 複雑な条件ロジック

#### 制限事項
```grit
// GritQLでは複雑な条件の組み合わせが困難
// 例: (A && B) || (C && !D) のような条件
```

#### 回避策
- パターンを分割して個別にチェック
- 複数の単純なパターンに分解

```grit
// パターン1: 条件Aをチェック
pattern check_condition_a() {
  `export class $name extends BaseValueObject`
}

// パターン2: 条件Bをチェック
pattern check_condition_b() {
  `export { $name }`
}
```

### 5. カスタムレポート生成

#### 制限事項
- 出力フォーマットが固定
- エラーレベルの細かい制御不可
- 統計情報の集計困難

#### 回避策
```bash
# gritの出力をjqで加工
grit apply pattern . --json | jq '{
  total: length,
  errors: map(select(.severity == "error")) | length,
  warnings: map(select(.severity == "warning")) | length
}'
```

## 使い分けガイドライン

### GritQLが適している場合 ✅

1. **構文パターンの検出**
   - コードの表面的な構造をチェック
   - 命名規則の確認
   - 単純な禁止パターンの検出

2. **高速なスキャン**
   - 大規模コードベースの高速チェック
   - CI/CDでの軽量チェック

3. **クロスプラットフォーム**
   - Windows/Mac/Linuxで同一動作
   - ファイルI/O問題の回避

### TypeScript linterが必要な場合 ⚠️

1. **型システムの分析**
   - 継承チェーンの完全な追跡
   - 型推論を利用した検証
   - ジェネリック型の詳細チェック

2. **プロジェクト全体の整合性**
   - クロスファイルの依存関係分析
   - インポート/エクスポートの検証

3. **高度なカスタマイズ**
   - 動的な設定管理
   - カスタムレポート生成
   - 複雑なビジネスロジック

## 推奨アーキテクチャ

```yaml
# .github/workflows/lint.yml
jobs:
  quick-check:
    # GritQLで高速チェック
    run: |
      grit apply valueobject_export . --dry-run
      grit apply neverthrow_async . --dry-run

  deep-check:
    # TypeScript linterで詳細チェック
    run: |
      yarn lint:valueobjects
      yarn lint:neverthrow
```

### 段階的な使い分け

1. **開発時（ローカル）**: GritQL
   - 高速フィードバック
   - リアルタイムチェック

2. **プレコミット**: GritQL
   - 基本的なパターンチェック
   - 即座に修正可能な問題の検出

3. **CI/CD**: TypeScript linter
   - 完全な型チェック
   - プロジェクト全体の整合性確認

4. **定期監査**: 両方
   - GritQLで新規問題の検出
   - TypeScript linterで詳細分析

## まとめ

GritQLは「パターンマッチング」に特化したツールです。TypeScriptの型システムやプロジェクト全体の依存関係を分析する必要がある場合は、従来のTypeScriptベースのlinterと併用することが推奨されます。

両者の長所を活かし、適材適所で使い分けることが最も効果的なアプローチです。