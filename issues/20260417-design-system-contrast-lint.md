# Linter化候補: デザインシステム コントラスト静的検証 (lint-contrast)

## 現状の規約

`src/v2/constants/ui.ts` と `src/index.css` の CSS 変数で定義されたセマンティックトークン (`bg-card`, `text-foreground` 等) を使い、ライト/ダークモード両方で WCAG コントラストを満たすことが求められている (`.claude/rules/project/ui-ux-design.md`)。

しかし以下が静的に検証されていない:

- **重ね合わせの実効コントラスト**: 親の `bg-*` の上に子の `text-*` が乗ったとき、ライト/ダーク両モードで AA を満たすか
- **半透明レイヤーの合成**: `bg-white/80` が別の bg の上に乗ったときの実効色
- **セマンティックトークンの組み合わせ妥当性**: 例えば `bg-muted` の上に `text-muted-foreground` を乗せたとき、ダークモードで十分か

既存の `rules/ast-grep/no-hardcoded-gray.yml` などは「直接色指定の禁止」止まりで、**組み合わせ妥当性**までは検出できない。

## なぜLinter化すべきか

- レビューでコントラスト違反に気付きにくい (特にダークモード)
- デザイントークンの組み合わせは有限集合なので静的に列挙・検証可能
- PostToolUse フックに組み込めばミリ秒オーダーでフィードバック可能

## スコープと非スコープ

### スコープ (Phase 1)

1. JSX の **親子ネスト**から背景色スタックを構築
2. Tailwind クラス → CSS 変数 → RGBA 解決 (ライト/ダーク両方)
3. 半透明の Porter-Duff "over" 合成
4. WCAG 2.1 AA コントラスト計算
5. **Strategy B**: 解決不能ケースは `warning` で報告 (`error` にしない)

### 非スコープ (将来 Phase または別手段に委ねる)

- z-index / position による視覚的重なり (`absolute inset-0` 等)
- React Portal (`Dialog`, `Tooltip`)
- 動的画像背景 (VRChat 写真) 上のテキスト可読性
- `style={{ background: dynamicVar }}` 等のランタイム決定色
- APCA (WCAG 3 ドラフト) — Phase 2 で追加検討

## アーキテクチャ

```text
src/**/*.tsx
    │
    │  (ast-grep pre-filter: className 属性を持つ JSX のみ)
    ▼
oxc-parser (AST)
    │
    ▼
collectJsxStacks.ts  ── 親→子の bg スタック配列を構築
    │     [{ file, loc, bgStack: ['bg-card', 'bg-white/80'], text: 'text-foreground' }, ...]
    │
    ▼
classify.ts          ── 各候補を { resolvable | unknown | skip } に分類
    │
    ▼
resolveTailwind.ts   ── "bg-card" → "var(--card)" (resolveConfig 経由)
    │                  ── "text-[#abcdef]" → "#abcdef"
    ▼
parseCssVars.ts      ── src/index.css の :root / .dark を HSLA → RGBA マップに
    │
    ▼
composite.ts         ── bgStack を Porter-Duff "over" で合成 → 単一 RGBA
    │                  ── ライト/ダーク独立に計算
    ▼
evaluateContrast.ts  ── WCAG 2 相対輝度比を計算
    │
    ▼
lint-contrast.ts     ── file:line:col 形式でレポート出力
                       ── exit 1 on error (resolvable かつ AA 未満), exit 0 on warn-only
```

## ファイル配置

```text
scripts/
├─ lint-contrast.ts                 # エントリ (pnpm lint:contrast で実行)
└─ lib/contrast/
   ├─ types.ts                      # 共有型定義
   ├─ parseCssVars.ts               # CSS 変数パーサ (postcss + culori)
   ├─ resolveTailwind.ts            # Tailwind クラス → CSS 値解決
   ├─ collectJsxStacks.ts           # oxc-parser で JSX スタック抽出
   ├─ composite.ts                  # Porter-Duff アルファ合成
   ├─ evaluateContrast.ts           # WCAG 2 コントラスト計算
   └─ classify.ts                   # unknown/skip/resolvable 分類 (Strategy B 契約)

rules/ast-grep/
└─ contrast-candidate.yml           # className 属性を含む JSX の pre-filter

scripts/test-fixtures/contrast/     # 期待値付きフィクスチャ
├─ ok-card-on-background.tsx
├─ ng-low-contrast-dark.tsx
├─ ng-alpha-composite.tsx
└─ warn-dynamic-class.tsx
```

## モジュール仕様

### `types.ts`

```typescript
export type Rgba = { r: number; g: number; b: number; a: number }; // 0-255, alpha 0-1
export type Theme = 'light' | 'dark';

export type ClassCandidate = {
  /** className 属性の1つの評価分岐を表すクラス配列 */
  classes: string[];
  /** 分岐条件 (cn/clsx の短絡評価など) のサマリ。報告時の説明用 */
  branchLabel?: string;
};

export type JsxStack = {
  file: string;
  line: number;
  column: number;
  /** 親ノードから辿った bg クラスのスタック (外→内) */
  bgStack: ClassCandidate[];
  /** この要素自身の text クラス候補 */
  textCandidates: ClassCandidate[];
  /** 報告時に表示する JSX タグ名 */
  elementName: string;
};

export type Resolution =
  | { kind: 'resolvable'; themes: Record<Theme, { bg: Rgba; fg: Rgba }> }
  | { kind: 'unknown'; reason: string }
  | { kind: 'skip'; reason: string };

export type ContrastIssue = {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  theme: Theme | 'both';
  ratio?: number;
  message: string;
};
```

### `parseCssVars.ts`

```typescript
/**
 * src/index.css をパースして :root (light) と .dark (dark) の
 * CSS 変数を RGBA マップに展開する。
 *
 * HSL 記法 ("0 0% 100%" や "0 0% 100% / 0.9") に対応。
 * culori の parseHsl で HSLA に変換し、sRGB 変換して RGBA を返す。
 */
export function parseCssVars(
  cssPath: string,
): Record<Theme, Record<string, Rgba>>;
```

- 入力: `src/index.css` の絶対パス
- 出力: `{ light: { '--background': {r:255,g:255,b:255,a:1}, ... }, dark: { ... } }`
- アルファ付き HSL (`0 0% 100% / 0.9`) を正しくパース

### `resolveTailwind.ts`

```typescript
/**
 * Tailwind クラスを CSS 値に解決する。
 *
 * - セマンティックトークン (`bg-card`) → `hsl(var(--card))` → 直接 RGBA を引く
 * - 色直指定 (`bg-blue-500`) → tailwindcss/resolveConfig で hex を引く
 * - 任意値 (`bg-[#abcdef]`, `bg-[hsl(0_0%_50%)]`) → 直接パース
 * - opacity modifier (`bg-white/80`) → alpha 0.8 を付与
 * - dark: プレフィックス → ダークテーマ時のみ適用
 *
 * 解決不能 (未定義変数、動的値) の場合は null。
 */
export function resolveClass(
  cls: string,
  theme: Theme,
  cssVars: Record<Theme, Record<string, Rgba>>,
): Rgba | null;
```

### `collectJsxStacks.ts`

```typescript
/**
 * oxc-parser で .tsx をパースし、各 JSX 要素の bg/text スタックを抽出する。
 *
 * - 親から子へ再帰下降し、bg-* を見つけたらスタックに push
 * - className が cn()/clsx()/cva() の場合は全分岐を候補として展開
 *   (展開失敗時は ClassCandidate に `branchLabel: 'dynamic'` で記録)
 * - コンポーネント境界 (`<Card>`) は解析対象ファイル内で定義を引ける場合のみ辿る。
 *   ファイル外は unknown として継続
 */
export function collectJsxStacks(filePath: string, source: string): JsxStack[];
```

### `composite.ts`

```typescript
/**
 * Porter-Duff "over" 合成で RGBA スタックを単一 RGBA に畳み込む。
 *
 * 外側から内側の順で stack が与えられる。最外層の下には白 (light) か
 * 黒に近いベース (dark) を仮定する (parseCssVars で解決した --background)。
 *
 * 合成式: out.a = a1 + a2*(1-a1)
 *        out.rgb = (c1*a1 + c2*a2*(1-a1)) / out.a
 */
export function compositeOver(stack: Rgba[], base: Rgba): Rgba;
```

### `evaluateContrast.ts`

```typescript
/**
 * WCAG 2.1 の相対輝度比を計算する。
 * ratio >= 4.5 で AA (通常テキスト), >= 3.0 で AA Large。
 *
 * 半透明テキストが背景に乗る場合は、事前に同じ compositeOver で
 * 実効 fg を計算してから渡す。
 */
export function wcagContrastRatio(fg: Rgba, bg: Rgba): number;
```

### `classify.ts`

```typescript
/**
 * JsxStack を Strategy B 契約に従って分類する。
 * 詳細ルールは下記「Classification Rules (決定版)」参照。
 * ts-pattern の match().with().exhaustive() で実装すること。
 */
export function classifyStack(stack: JsxStack): Resolution;
```

#### Classification Rules (決定版)

| #   | 入力条件                                                         | Resolution                                      | 理由                                   |
| --- | ---------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| 1   | `bgStack` が空 かつ `textCandidates` が空                        | `skip` (`reason: 'no-color-classes'`)           | 検査対象外                             |
| 2   | `textCandidates` が空 (bg のみ)                                  | `skip` (`reason: 'no-text'`)                    | コントラストは文字色があって意味を持つ |
| 3   | 全 `ClassCandidate.classes` が空配列 (完全動的)                  | `unknown` (`reason: 'dynamic-classname'`)       | warn で気付きを残す                    |
| 4   | `bgStack` に `branchLabel === 'dynamic'` を含む候補がある        | `unknown` (`reason: 'dynamic-bg-branch'`)       | 静的解決不能な分岐が混在               |
| 5   | `textCandidates` に `branchLabel === 'dynamic'` を含む候補がある | `unknown` (`reason: 'dynamic-text-branch'`)     | 同上                                   |
| 6   | 全候補が静的かつ解決可能、組合せ数 ≤ 32                          | `resolvable` (worst case ペアを theme 別に返す) | 検査対象                               |
| 7   | 組合せ数 > 32                                                    | `unknown` (`reason: 'combinatorial-explosion'`) | 列挙爆発の保険                         |

**worst case ペアの算出 (ルール 6)**:

- `bgStack` の各要素候補配列の直積 × `textCandidates` の候補配列を列挙
- 各組合せで light/dark 両モードの `(bg: Rgba, fg: Rgba)` を計算
- `Resolution.themes[theme]` には **コントラスト比が最低となる組合せの bg/fg ペア** を格納 (theme ごとに独立)

**`branchLabel` を立てる基準** (`collectJsxStacks.ts` 側の責務):

| 由来                                                                                            | `branchLabel`                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `className="bg-card text-foreground"` (リテラル)                                                | `undefined` (static)                                          |
| `className={cn('a', cond && 'b')}` — 全引数が文字列リテラル or `cond && 'literal'` パターン     | 各分岐を候補展開、`branchLabel: 'cn:N'`                       |
| `className={cn(dynamicVar, 'a')}` — 非リテラル識別子を含む                                      | `branchLabel: 'dynamic'`                                      |
| `className={clsx(...)}`                                                                         | cn と同等扱い                                                 |
| `className={someVar}` / `className={styles.foo}` — 識別子単独                                   | `branchLabel: 'dynamic'`                                      |
| `className={cva(...)({ variant: 'primary' })}` — cva 定義が同一ファイル、variant キーがリテラル | variant 展開、`branchLabel: 'cva:variant-name'`               |
| `className={cva(...)({ variant })}` — variant 非リテラル                                        | `branchLabel: 'dynamic'`                                      |
| cva 定義が別ファイルから import                                                                 | `branchLabel: 'dynamic'` (Phase 1 では cross-file 解析しない) |
| `style={{ background: ... }}` のみ                                                              | `ClassCandidate` 非生成 → ルール 1 で skip                    |

**暗黙のベース背景**:

- `bgStack` が空で `textCandidates` のみ存在する要素は、CSS 変数 `--background` を暗黙のベースに使う
- Phase 1 の仮定: 「bg 未指定のルート領域は `bg-background` 相当」
- body が別色のケースは既知の限界に追加

### `lint-contrast.ts` (エントリ)

```typescript
#!/usr/bin/env node
// 既存 lint-valueobjects.ts と同じ構成:
// 1. glob で対象 .tsx を列挙
// 2. ast-grep の pre-filter で候補ファイル絞込
// 3. parseCssVars で CSS 変数ロード
// 4. 各ファイルで collectJsxStacks → classifyStack → resolveTailwind → composite → evaluate
// 5. issues を集約して console 出力 (file:line:col 形式)
// 6. error があれば exit 1, warning のみなら exit 0
```

## データフロー例

入力 JSX:

```tsx
<div className="bg-card">
  <p className="text-muted-foreground">hello</p>
</div>
```

`src/index.css`:

```css
:root {
  --card: 0 0% 100%;
  --muted-foreground: 0 0% 45%;
}
.dark {
  --card: 220 15% 12%;
  --muted-foreground: 220 10% 60%;
}
```

処理結果 (light テーマ):

- bg = `rgba(255,255,255,1)`
- fg = `rgba(115,115,115,1)`
- ratio = 3.94 → **AA 未満 (< 4.5)** → error

処理結果 (dark テーマ):

- bg = `rgba(27,30,38,1)`
- fg = `rgba(141,147,155,1)`
- ratio = 5.02 → OK

## Strategy B (Warn-on-unknown) 契約

| ケース                                          | Resolution   | severity   |
| ----------------------------------------------- | ------------ | ---------- |
| 全候補が静的解決でき、AA 未満                   | `resolvable` | `error`    |
| 全候補が静的解決でき、AA 以上                   | `resolvable` | (報告なし) |
| 一部候補のみ解決不能                            | `unknown`    | `warning`  |
| 全候補が動的 (`style={{}}`, 完全動的 className) | `skip`       | (報告なし) |
| className に bg/text が1つもない                | `skip`       | (報告なし) |

`warning` は CI で fail させない。`error` のみ `exit 1`。

## 依存追加

- `oxc-parser` (devDep): JSX/TSX AST パーサ
- `culori` (devDep): HSL/HSLA → RGBA 色空間変換
- `postcss` (devDep): CSS 変数抽出

`tailwindcss` と `glob` と `pathe` は既存。

## 統合

### `package.json` scripts

```json
"lint:contrast": "tsx scripts/lint-contrast.ts"
```

### `scripts/lint-custom.ts` の tasks 配列に追加

```typescript
{ name: 'contrast', script: 'scripts/lint-contrast.ts' },
```

### CI

既存 `.github/workflows/lint-test-cross.yml` で `pnpm lint` が `lint:custom` を呼ぶ想定なら、自動的に CI で走る。明示的に `pnpm lint:contrast` ステップを足す必要があれば別途追加。

### PostToolUse フック

`.claude/hooks/post-edit-lint.sh` で `.tsx` 編集時に `lint:contrast --file <path>` を走らせる (引数対応は Phase 2)。

## テスト戦略

`scripts/test-fixtures/contrast/` に期待出力付きフィクスチャを置き、
`scripts/lint-contrast.test.ts` で Vitest により以下を検証:

| フィクスチャ                | 期待 severity | 期待検出理由                                       |
| --------------------------- | ------------- | -------------------------------------------------- |
| `ok-card-on-background.tsx` | (なし)        | `bg-card` × `text-foreground` で両モード AA クリア |
| `ng-low-contrast-dark.tsx`  | error         | ダークでコントラスト比 < 4.5                       |
| `ng-alpha-composite.tsx`    | error         | `bg-white/30` の合成後、fg との比が不足            |
| `warn-dynamic-class.tsx`    | warning       | `cn(dynamicVar)` で解決不能                        |
| `skip-no-colors.tsx`        | (なし)        | bg/text クラスを含まない                           |

## 段階的ロールアウト

1. **Phase 1 (本 Issue)**: 上記スコープを実装。`pnpm lint:contrast` を手動実行で使える状態に
2. **Phase 2**: `lint-custom.ts` への統合、CI ゲート有効化
3. **Phase 3**: APCA 追加、コンポーネント境界越えの bg 継承 (`<Card>` 内の再帰解決)
4. **Phase 4**: PostToolUse フックでリアルタイム検証

## 既知の限界

| 限界                            | 対応方針                                                              |
| ------------------------------- | --------------------------------------------------------------------- |
| z-index / position 由来の重なり | 対象外。ビジュアルリグレッション (Playwright + axe) で補完            |
| React Portal                    | 対象外。Storybook addon-a11y 等で補完                                 |
| 動的背景画像 (VRChat 写真)      | 対象外。ランタイム OCR/ルミナンス分析は別スクリプト                   |
| cva variant 網羅                | Phase 3 で cva 定義パーサを追加                                       |
| `@apply` 利用箇所               | CSS 側で bg/text が合成されている場合は PostCSS 側で解析必要。Phase 3 |

## 優先度

**中** (ダークモードの視認性問題は実害があるが、既存コードベースが安定していれば緊急度は低)

## 関連する既存のlinter

- `scripts/lint-valueobjects.ts` (スクリプト構造の参考)
- `rules/ast-grep/no-hardcoded-gray.yml` (色直指定の検出)
- `rules/ast-grep/no-hardcoded-indigo.yml` (同上)

## 関連 ADR

新規 ADR を併せて作成することを推奨:
`docs/adr/XXXX-design-system-contrast-validation.md` (コントラスト検証を静的 lint として導入する判断根拠)
