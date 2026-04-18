# @vrchat-albums/lint-contrast

デザインシステムのコントラスト静的検証ツール。JSX の親子ネストから背景色スタックを構築し、Tailwind クラス → CSS 変数 → RGBA を解決して WCAG 2.1 AA コントラスト比 (>= 4.5) を静的に検証する。

## インストール

pnpm workspace 内で使用する場合は workspace 依存として参照する:

```json
{
  "dependencies": {
    "@vrchat-albums/lint-contrast": "workspace:*"
  }
}
```

将来的には npm パッケージとして公開予定:

```bash
pnpm add @vrchat-albums/lint-contrast
```

## CLI 使用例

```bash
# プロジェクトルートに対して実行
pnpm lint:contrast

# カスタムオプション付き
lint-contrast --project /path/to/project --glob "src/**/*.tsx" --css src/index.css

# JSON 形式で出力
lint-contrast --project . --format json

# unknown を error に昇格 (CI で厳格にする場合)
lint-contrast --project . --warn-as-error
```

### CLI オプション

```text
Options:
  --project <path>           対象プロジェクトのルート (default: cwd)
  --glob <pattern>           走査対象 glob (default: "src/**/*.tsx")
  --css <path>               CSS 変数定義ファイル (default: "src/index.css")
  --threshold <n>            AA 閾値 (default: 4.5)
  --format <fmt>             出力形式: text|json (default: text)
  --warn-as-error            unknown を error に昇格
  --ignore <pattern>         除外パターンを追加 (複数指定可能)。デフォルト除外: "**/node_modules/**", "**/*.test.tsx", "**/*.spec.tsx"
  --max-combinations <n>     worst case 算出時の組合せ数上限。これを超えると unknown 扱い (default: 32)
  --help                     ヘルプ表示
```

### 終了コード

- `0`: エラーなし (warning のみは 0)
- `1`: コントラスト比 AA 未満のエラーあり

## ライブラリとしての使用

```typescript
import {
  parseCssVars,
  collectJsxStacks,
  classifyStack,
  wcagContrastRatio,
  WCAG_AA_THRESHOLD,
} from '@vrchat-albums/lint-contrast';

// 1. CSS 変数を読み込む
const cssVars = parseCssVars('/path/to/index.css');

// 2. JSX スタックを抽出
const source = readFileSync('Component.tsx', 'utf8');
const stacks = collectJsxStacks('Component.tsx', source);

// 3. 各スタックを分類してコントラストを評価
for (const stack of stacks) {
  const resolution = classifyStack(stack, cssVars);

  if (resolution.kind === 'resolvable') {
    const { bg, fg } = resolution.themes.light;
    const ratio = wcagContrastRatio(fg, bg);
    if (ratio < WCAG_AA_THRESHOLD) {
      console.error(`Contrast violation: ${ratio.toFixed(2)} < 4.5`);
    }
  } else if (resolution.kind === 'unknown') {
    console.warn(`Cannot resolve: ${resolution.reason}`);
  }
}
```

## 検出パターン

| パターン                        | 検出     | 説明                                                     |
| ------------------------------- | -------- | -------------------------------------------------------- |
| 静的セマンティックトークン      | 検出可   | `bg-card`, `text-foreground` など CSS 変数ベースのクラス |
| 半透明レイヤー                  | 検出可   | `bg-white/30` など opacity modifier 付きクラス           |
| 任意値                          | 検出可   | `bg-[#abcdef]`, `bg-[hsl(220_15%_85%)]`                  |
| dark: プレフィックス            | 検出可   | `dark:bg-card` はダークモード時のみ適用                  |
| 動的クラス (cn/clsx の静的引数) | 部分対応 | 静的文字列引数のみ展開                                   |
| 動的クラス (変数参照)           | warning  | `unknown` として報告                                     |
| cn() 内の条件式                 | 部分対応 | `cond && 'bg-card'` の右辺のみ展開                       |

## 非スコープ

以下は検出対象外:

- `z-index` / `position` による視覚的重なり (`absolute inset-0` 等)
- React Portal (`Dialog`, `Tooltip` 等のポータル要素)
- 動的背景画像 (VRChat 写真等) 上のテキスト可読性
- `style={{ background: dynamicVar }}` 等のランタイム決定色
- APCA (WCAG 3 ドラフト) — Phase 2 で追加検討予定

## Strategy B (Warn-on-unknown) 契約

| ケース                        | Resolution   | severity   |
| ----------------------------- | ------------ | ---------- |
| 全候補が静的解決でき、AA 未満 | `resolvable` | `error`    |
| 全候補が静的解決でき、AA 以上 | `resolvable` | (報告なし) |
| 一部候補のみ解決不能          | `unknown`    | `warning`  |
| 全候補が動的                  | `skip`       | (報告なし) |
| bg/text クラスが1つもない     | `skip`       | (報告なし) |

`warning` は CI で fail させない。`error` のみ `exit 1`。

## 関連ドキュメント

- `issues/20260417-design-system-contrast-lint.md` — 設計書
- `docs/adr/` — 設計判断の記録
