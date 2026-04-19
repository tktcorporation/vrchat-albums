/**
 * oxc-parser を使用して JSX ファイルから bg/text スタックを抽出するモジュール。
 *
 * 親から子へ再帰下降し、各 JSX 要素が持つ bg/text クラスを収集する。
 * className が静的文字列リテラルの場合はそのまま分解する。
 * cn()/clsx() 呼び出しは展開を試みるが、動的引数は branchLabel: 'dynamic' で記録する。
 * コンポーネント境界 (<Card> 等) は解析対象ファイル内で定義を引ける場合のみ辿る。
 */

import { parseSync } from 'oxc-parser';

import type { ClassCandidate, JsxStack } from './types';

/** oxc-parser の AST ノード型 (最小限の型定義) */
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

type JsxElement = AstNode & {
  type: 'JSXElement';
  openingElement: JsxOpeningElement;
  children: AstNode[];
};

type JsxOpeningElement = AstNode & {
  type: 'JSXOpeningElement';
  name: AstNode & { name?: string };
  attributes: JsxAttribute[];
};

type JsxAttribute = AstNode & {
  type: 'JSXAttribute';
  name: AstNode & { name?: string };
  value: AstNode | null;
};

type Literal = AstNode & {
  type: 'Literal';
  value: unknown;
};

type CallExpression = AstNode & {
  type: 'CallExpression';
  callee: AstNode;
  arguments: AstNode[];
};

type TemplateLiteral = AstNode & {
  type: 'TemplateLiteral';
  quasis: (AstNode & { value?: { cooked?: string; raw?: string } })[];
};

/**
 * ノードが JSX 要素かどうかを判定する型ガード。
 */
function isJsxElement(node: AstNode): node is JsxElement {
  return node.type === 'JSXElement';
}

/**
 * text-* / bg-* プレフィックスを持つが色ではない Tailwind ユーティリティクラスのサフィックス。
 *
 * これらは抽出対象から除外することで誤検出を防ぐ。
 * text-transparent / text-current / text-inherit は前景色が不明なため skip 対象として除外する。
 */
const NON_COLOR_TEXT_SUFFIXES = new Set([
  // フォントサイズ
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  // テキスト整列
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  // テキストオーバーフロー
  'ellipsis',
  'clip',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  // 特殊値 (前景色不明なため除外)
  'transparent',
  'current',
  'inherit',
]);

const NON_COLOR_BG_SUFFIXES = new Set([
  // 背景画像・配置
  'none',
  'cover',
  'contain',
  'auto',
  'top',
  'bottom',
  'left',
  'right',
  'center',
  // 対角配置 (bg-right-top 等の複合サフィックスは後続の startsWith チェックで除外)
  'right-top',
  'right-bottom',
  'left-top',
  'left-bottom',
  // 背景固定
  'fixed',
  'local',
  'scroll',
  // 繰り返し (bg-repeat, bg-repeat-x, bg-no-repeat 等)
  'repeat',
  'repeat-x',
  'repeat-y',
  'no-repeat',
  'repeat-round',
  'repeat-space',
  // クリップ・オリジン (text 等はサフィックスなので prefix チェック)
  'transparent',
  'current',
  'inherit',
]);

/**
 * Tailwind バリアントプレフィックス (`dark:`, `sm:`, `hover:`, `aria-[...]:`,
 * `[&>*]:`, `[@media(...)]:` 等) を全て剥がし、残りの実クラスとバリアント情報を返す。
 *
 * 戻り値:
 * - `base`: プレフィックスを除いた実クラス (例: "text-foreground")
 * - `hasDarkVariant`: `dark:` プレフィックスが含まれていたか
 * - `hasNonDarkVariant`: `dark:` 以外のバリアントプレフィックスが含まれていたか
 *   (例: `sm:`, `hover:`, `focus:`, `md:dark:` の `md:` 部分)
 *
 * Tailwind のバリアントプレフィックスはコロン区切りで複数連続できる
 * (例: `dark:md:text-foreground`, `[&>*]:dark:text-accent`, `sm:[&>*]:text-foreground`)。
 *
 * 旧実装はアルファベット始まりのバリアントのみ対応していた。
 * 新実装: ループで 1 バリアントずつ消費し、ブラケット始まり `[...]:` も認識する。
 * - アルファベット始まり: `[a-zA-Z][\w-]*(?:\[[^\]]*\])?:`
 * - ブラケット始まり: `\[[^\]]+\]:`
 */
// 単一バリアントにマッチする正規表現 (チェイン対応のためループで使用)
// アルファベット始まり (例: "dark:", "sm:", "hover:", "aria-[label]:")
const ALPHA_VARIANT_RE = /^[a-zA-Z][\w-]*(?:\[[^\]]*\])?:/;
// ブラケット始まり任意バリアント (例: "[&>*]:", "[@media(prefers-contrast:high)]:")
const BRACKET_VARIANT_RE = /^\[[^\]]+\]:/;

function stripVariantPrefixes(cls: string): {
  base: string;
  hasDarkVariant: boolean;
  hasNonDarkVariant: boolean;
} {
  let remaining = cls;
  let hasDarkVariant = false;
  let hasNonDarkVariant = false;

  // 1 バリアントずつ消費するループ。アルファベット始まりとブラケット始まりの両方を認識する。
  // チェイン例: "sm:[&>*]:text-foreground" → "sm:" → "[&>*]:" → "text-foreground"
  while (remaining.length > 0) {
    const alphaMatch = ALPHA_VARIANT_RE.exec(remaining);

    if (alphaMatch) {
      // アルファベット始まりバリアント: dark: の有無を判定
      const variantToken = alphaMatch[0].slice(0, -1); // trailing ':' を除去
      // "dark" 部分のみ抽出 (例: "aria-[label]" → "aria-[label]", "dark" → "dark")
      const variantName = variantToken.replace(/\[[^\]]*\]$/, '');
      if (variantName === 'dark') {
        hasDarkVariant = true;
      } else {
        hasNonDarkVariant = true;
      }
      remaining = remaining.slice(alphaMatch[0].length);
      continue;
    }

    const bracketMatch = BRACKET_VARIANT_RE.exec(remaining);
    if (bracketMatch) {
      // ブラケット始まり任意バリアント: dark: ではないので hasNonDarkVariant
      hasNonDarkVariant = true;
      remaining = remaining.slice(bracketMatch[0].length);
      continue;
    }

    // バリアントではない → 実クラス部分 (例: "text-foreground")
    break;
  }

  return { base: remaining, hasDarkVariant, hasNonDarkVariant };
}

/**
 * 単一 Tailwind クラスが「色」クラスかどうかを、プレフィックスを除いた base で判定する。
 *
 * @returns 色クラスなら true
 */
function isColorClass(base: string): boolean {
  if (base.startsWith('text-')) {
    const suffix = base.slice(5);
    // text-opacity-*, text-clip (text-overflow), text-decoration-* は色クラスではない。
    // underline / overline / line-through / uppercase 等は text- prefix を持たない
    // standalone Tailwind utility なので、このブランチに入ることはない (dead check 削除済み)。
    if (
      suffix.startsWith('opacity-') ||
      suffix.startsWith('clip') ||
      suffix.startsWith('decoration-')
    ) {
      return false;
    }
    return !NON_COLOR_TEXT_SUFFIXES.has(suffix);
  }

  if (base.startsWith('bg-')) {
    const suffix = base.slice(3);
    if (
      suffix.startsWith('gradient-') ||
      suffix.startsWith('clip-') ||
      suffix.startsWith('origin-') ||
      suffix.startsWith('blend-') ||
      suffix.startsWith('opacity-')
    ) {
      return false;
    }
    return !NON_COLOR_BG_SUFFIXES.has(suffix);
  }

  return false;
}

/**
 * バリアントプレフィックスと important 修飾子 (!) を剥がした実クラス base と
 * バリアント情報を返す。
 *
 * Tailwind v3+ の important 修飾子 `!` は `!text-foreground`, `!bg-card`,
 * `dark:!bg-muted` のようにバリアント剥がし後の先頭に残る。
 * isColorClass は `!` なしの base で判定する必要があるため、ここで除去する。
 *
 * @internal stripVariantPrefixes の後処理として使用する
 */
function extractBase(cls: string): {
  base: string;
  hasDarkVariant: boolean;
  hasNonDarkVariant: boolean;
} {
  const {
    base: afterVariants,
    hasDarkVariant,
    hasNonDarkVariant,
  } = stripVariantPrefixes(cls);
  // Important modifier (!): Tailwind v3+ syntax — 先頭の `!` を除去して base を得る
  const base = afterVariants.startsWith('!')
    ? afterVariants.slice(1)
    : afterVariants;
  return { base, hasDarkVariant, hasNonDarkVariant };
}

/**
 * Tailwind クラス文字列から bg-* または text-* の「色」クラスのみを抽出する。
 *
 * スペース区切りのクラスリストから bg- または text- で始まるクラスを返すが、
 * フォントサイズ・整列・配置など色以外のユーティリティは除外する。
 * `NON_COLOR_TEXT_SUFFIXES` / `NON_COLOR_BG_SUFFIXES` が除外リスト。
 *
 * バリアント処理:
 * - `dark:` は extractColorClasses の戻り値にそのまま含まれる (classify 側で処理)
 * - `dark:` 以外のバリアント (`sm:`, `hover:`, `focus:` 等) を持つ色クラスは
 *   `variant-pseudo` ラベル付きで別途戻り値に含まれる。
 *   コントラストをランタイムに依存せず静的解析できないため unknown に落とす。
 *
 * important 修飾子 (`!`) 対応:
 * - `!text-foreground`, `!bg-card`, `dark:!bg-muted` のような important 修飾子は
 *   バリアント剥がし後に `extractBase` で除去し、base で color class 判定を行う。
 *
 * @returns { classes, variantPseudoClasses }
 *   - `classes`: dark: あり/なしの色クラス (従来どおり)
 *   - `variantPseudoClasses`: dark: 以外のバリアント付きの色クラス
 */
function extractColorClasses(classStr: string): {
  classes: string[];
  variantPseudoClasses: string[];
} {
  const classes: string[] = [];
  const variantPseudoClasses: string[] = [];

  for (const rawCls of classStr.split(/\s+/)) {
    const trimmed = rawCls.trim();
    if (!trimmed) {
      continue;
    }

    const { base, hasDarkVariant, hasNonDarkVariant } = extractBase(trimmed);

    if (!isColorClass(base)) {
      continue;
    }

    if (hasNonDarkVariant) {
      // dark: 以外のバリアント付き → variant-pseudo として記録
      // dark: も同時に持つ複合バリアント (md:dark:text-*) も variant-pseudo 扱い
      variantPseudoClasses.push(trimmed);
    } else {
      // dark: のみ or バリアントなし → 従来どおり classes に追加
      // (dark: プレフィックスは classify の isApplicableForTheme で処理)
      classes.push(trimmed);
    }

    // hasDarkVariant は classes/variantPseudoClasses への振り分けで使用済み。
    // classify 側が cls.startsWith('dark:') で判定するため元の trimmed を格納している。
    void hasDarkVariant;
  }

  return { classes, variantPseudoClasses };
}

/**
 * JSX 属性の value ノードから静的クラス文字列を抽出する。
 *
 * 対応するケース:
 * - 文字列リテラル: className="bg-card text-foreground"
 * - JSX式コンテナ内のリテラル: className={"bg-card"}
 * - テンプレートリテラル (静的部分のみ): className={`bg-card`}
 */
function extractStaticClassString(valueNode: AstNode): string | null {
  // Direct string literal
  if (valueNode.type === 'Literal') {
    const lit = valueNode as Literal;
    return typeof lit.value === 'string' ? lit.value : null;
  }

  // JSXExpressionContainer: className={...}
  if (valueNode.type === 'JSXExpressionContainer') {
    const expr = (valueNode as AstNode & { expression: AstNode }).expression;
    if (!expr) {
      return null;
    }

    if (expr.type === 'Literal') {
      const lit = expr as Literal;
      return typeof lit.value === 'string' ? lit.value : null;
    }

    // Template literal with only static content
    if (expr.type === 'TemplateLiteral') {
      const tmpl = expr as TemplateLiteral;
      if (
        tmpl.quasis.length === 1 &&
        (tmpl as AstNode & { expressions?: AstNode[] }).expressions?.length ===
          0
      ) {
        return tmpl.quasis[0]?.value?.cooked ?? null;
      }
    }
  }

  return null;
}

/**
 * cn()/clsx() 呼び出しから ClassCandidate 配列を抽出する試み。
 *
 * CSS cascade セマンティクスに基づいた引数解析:
 * - **無条件引数 (文字列リテラル)** は同一要素に同時適用されるため、
 *   1 つの ClassCandidate の classes 配列に連結する。
 *   (cascade 最後勝ちは classify 側の「最後勝ち」ロジックで処理される)
 * - **条件付き引数** (cond && 'literal', cond ? 'a' : 'b') のみが
 *   実行時分岐を表すため、それぞれ独立した候補として展開する。
 * - 動的引数 (変数参照、関数呼び出し等) は branchLabel: 'dynamic' で記録する。
 * - variant-pseudo クラス (sm:, hover: 等) は branchLabel: 'variant-pseudo' の
 *   追加候補として記録する (静的解析不能のため unknown に落とす)。
 *
 * 実装: 候補アキュムレータの集合を持ち、各引数で状態遷移する。
 * - 初期状態: accumulator = [{ classes: [], branchLabel: undefined }] (単一の空候補)
 * - 無条件リテラル: 全アキュムレータの classes に追加 (分岐なし)
 * - cond && 'b': 各アキュムレータを複製し、一方に 'b' を追加
 *   (「b なし」と「b あり」の 2 分岐)
 *   さらに左辺が非リテラルなら dynamic 候補も追加する
 * - cond ? 'b' : 'c': 各アキュムレータを複製し、一方に 'b', 他方に 'c' を追加
 *   (「b」と「c」の 2 分岐)
 * - 動的: 全アキュムレータを dynamic に変換 (その後の処理を安全側に倒す)
 *
 * 例:
 * - cn('a', 'b', 'c') → 1 候補 {classes: ['a', 'b', 'c']}
 * - cn('a', cond && 'b') → 2 候補 [{classes:['a']}, {classes:['a','b']}]
 * - cn('a', cond ? 'b' : 'c') → 2 候補 [{classes:['a','b']}, {classes:['a','c']}]
 * - cn('a', cond && 'b', 'c') → 2 候補 [{classes:['a','c']}, {classes:['a','b','c']}]
 * - cn(dynVar || 'b') → 2 候補 [{classes:['b']}, {classes:[], branchLabel:'dynamic'}]
 * - cn(dynVar && 'b') → 2 候補 [{classes:['b']}, {classes:[], branchLabel:'dynamic'}]
 */
/**
 * cn()/clsx() 展開時のアキュムレータ上限。
 * 条件分岐が深くネストされた場合に 2^N 個の候補が生成されるのを防ぐ。
 * 上限を超えた場合は残りの分岐を 'dynamic' の単一候補に集約する。
 */
const MAX_ACCUMULATORS = 64;

function extractCandidatesFromCnCall(node: AstNode): ClassCandidate[] {
  const call = node as CallExpression;

  // 候補アキュムレータの集合。各エントリが1つの実行時パスを表す。
  // branchLabel は最初の分岐発生時に付与される。
  // branchId は ConditionalExpression / LogicalExpression 引数ごとに割り当てられる機械可読な識別子。
  // 同じ branchId を持つ bg 候補と text 候補のみが classify で組合せ対象となる。
  let accumulators: {
    classes: string[];
    branchLabel: string | undefined;
    branchId: string | undefined;
  }[] = [{ classes: [], branchLabel: undefined, branchId: undefined }];

  // variant-pseudo クラス (sm:, hover: 等) のクラス文字列を収集する。
  // これらは別途 branchLabel:'variant-pseudo' の候補として末尾に追加する。
  const variantPseudoCollected: string[] = [];

  // AST ノードの start offset を branchId に含めることで、
  // 異なる cn() 呼び出し間で同じ argIndex を持つ branchId が衝突しないようにする (F1 修正)。
  // 例: 親の cn() と子の cn() で argIndex=0 が同じでも callSite が異なるため安全。
  const callSite = call.start;

  // 引数インデックス (branchId の一部として使用)
  let argIndex = 0;

  for (const arg of call.arguments) {
    // Static string literal argument: 全アキュムレータに追加 (分岐なし)
    if (arg.type === 'Literal') {
      const lit = arg as Literal;
      if (typeof lit.value === 'string') {
        const { classes, variantPseudoClasses } = extractColorClasses(
          lit.value,
        );
        for (const acc of accumulators) {
          acc.classes = [...acc.classes, ...classes];
        }
        variantPseudoCollected.push(...variantPseudoClasses);
      }
      argIndex++;
      continue;
    }

    // Logical expression: cond && 'bg-red' / dynVar || 'text-foreground' / a ?? 'b'
    //
    // 健全性設計:
    // - 右辺がリテラルの場合:「右辺なし」と「右辺あり」の 2 分岐に展開する。
    // - 左辺が非リテラルの場合 (動的変数 etc.): 左辺が truthy で勝つケースを
    //   branchLabel:'dynamic' の追加候補として記録する。
    //   例: cn(dynVar || 'text-foreground')
    //   → [{classes:['text-foreground'], branchLabel:'conditional(||)'},
    //      {classes:[], branchLabel:'dynamic'}]
    //   これにより classify Rule 5 が発火して unknown に落ちる (偽陰性を防ぐ)。
    if (arg.type === 'LogicalExpression') {
      const logical = arg as AstNode & {
        left: AstNode;
        right: AstNode;
        operator: string;
      };
      const branchLabel = `conditional(${logical.operator})`;
      // branchId: この LogicalExpression 引数に対して「右辺あり」パスを識別する。
      // 「右辺なし」パスには undefined を維持 (右辺が適用されないパスは無条件扱い)。
      // callSite (cn() 呼び出しの AST offset) を prefix に含めることで
      // 異なる cn() 呼び出し間での branchId 衝突を防ぐ (F1 修正)。
      const activeBranchId = `cn@${callSite}:${argIndex}:rhs`;

      if (logical.right.type === 'Literal') {
        const lit = logical.right as Literal;
        if (typeof lit.value === 'string') {
          const { classes: addedClasses, variantPseudoClasses } =
            extractColorClasses(lit.value);
          variantPseudoCollected.push(...variantPseudoClasses);
          // 「右辺適用」パス (既存アキュムレータを複製して addedClasses を追加)
          // branchId を activeBranchId に設定して「右辺あり」パスを識別する。
          const withBranch = accumulators.map((acc) => ({
            classes: [...acc.classes, ...addedClasses],
            branchLabel: acc.branchLabel ?? branchLabel,
            branchId:
              acc.branchId === null || acc.branchId === undefined
                ? activeBranchId
                : `${acc.branchId}|${activeBranchId}`,
          }));
          // 「右辺なし」パスにも branchLabel を付与して分岐の存在を示す。
          // branchId は変えない (右辺が適用されないパスは無条件扱い = undefined のまま)。
          for (const acc of accumulators) {
            acc.branchLabel = acc.branchLabel ?? branchLabel;
          }
          accumulators = [...accumulators, ...withBranch];

          // アキュムレータ爆発ガード: 上限超過時は dynamic 単一候補に集約する。
          // これ以上の展開を続けると 2^N 個の候補が生まれる可能性がある。
          if (accumulators.length > MAX_ACCUMULATORS) {
            accumulators = [
              { classes: [], branchLabel: 'dynamic', branchId: undefined },
            ];
            argIndex++;
            continue;
          }

          // || / ?? 演算子かつ左辺が非リテラルの場合: 左辺が truthy/非null で勝つ
          // ランタイムケースを dynamic で記録する。
          // 例: cn(dynVar || 'text-fg') → dynVar が truthy なら dynVar の値が使われる
          // && は left が boolean 条件として使われるため対象外
          // (cn(cond && 'cls') の cond は boolean で左辺値がクラスとして使われない)
          if (
            (logical.operator === '||' || logical.operator === '??') &&
            logical.left.type !== 'Literal'
          ) {
            accumulators.push({
              classes: [],
              branchLabel: 'dynamic',
              branchId: undefined,
            });
          }
        }
      } else {
        // 非リテラル右辺: 全アキュムレータを dynamic に変換
        for (const acc of accumulators) {
          acc.branchLabel = 'dynamic';
        }
      }
      argIndex++;
      continue;
    }

    // Conditional expression: cond ? 'bg-a' : 'bg-b'
    // 健全性確保: 非リテラル分岐 (変数・式など) は silently drop せず
    // branchLabel: 'dynamic' として記録する。
    // これにより classify の Rule 4/5 が発火して unknown に落ちる (偽陰性を防ぐ)。
    //
    // branchId: consequent は 'cn@<callSite>:<i>:c', alternate は 'cn@<callSite>:<i>:a' を付与する。
    // callSite は cn() 呼び出しの AST start offset で、異なる cn() 間での衝突を防ぐ (F1 修正)。
    // 同一 ConditionalExpression 内で bg と text が現れる場合、
    // 同じ branchId を持つ候補同士のみが classify で組合せ対象となる。
    if (arg.type === 'ConditionalExpression') {
      const condExpr = arg as AstNode & {
        consequent: AstNode;
        alternate: AstNode;
      };

      const newAccumulators: typeof accumulators = [];
      const branchSuffixes = ['c', 'a'] as const; // consequent, alternate
      const branches = [condExpr.consequent, condExpr.alternate];

      for (const acc of accumulators) {
        for (let bi = 0; bi < branches.length; bi++) {
          const branch = branches[bi];
          const suffix = branchSuffixes[bi];
          // この引数の branchId: 親の branchId と組み合わせてネストを表現する。
          // callSite (cn() 呼び出しの AST offset) を prefix に含めることで
          // 異なる cn() 呼び出し間での branchId 衝突を防ぐ (F1 修正)。
          const thisBranchId = `cn@${callSite}:${argIndex}:${suffix}`;
          const newBranchId =
            acc.branchId === null || acc.branchId === undefined
              ? thisBranchId
              : `${acc.branchId}|${thisBranchId}`;

          if (branch.type === 'Literal') {
            const lit = branch as Literal;
            if (typeof lit.value === 'string') {
              const { classes, variantPseudoClasses } = extractColorClasses(
                lit.value,
              );
              variantPseudoCollected.push(...variantPseudoClasses);
              newAccumulators.push({
                classes: [...acc.classes, ...classes],
                branchLabel: acc.branchLabel ?? 'conditional(?)',
                branchId: newBranchId,
              });
            }
          } else {
            // 非リテラル分岐 (Identifier, MemberExpression 等) は動的として記録する
            newAccumulators.push({
              classes: [...acc.classes],
              branchLabel: 'dynamic',
              branchId: newBranchId,
            });
          }
        }
      }
      // アキュムレータ爆発ガード: 上限超過時は dynamic 単一候補に集約する。
      accumulators =
        newAccumulators.length > MAX_ACCUMULATORS
          ? [{ classes: [], branchLabel: 'dynamic', branchId: undefined }]
          : newAccumulators;
      argIndex++;
      continue;
    }

    // Any other dynamic expression: 全アキュムレータを dynamic に変換
    for (const acc of accumulators) {
      acc.branchLabel = 'dynamic';
    }
    argIndex++;
  }

  // アキュムレータから ClassCandidate 配列に変換。
  // classes が空で branchLabel も undefined の候補 (引数なし cn()) は除外する。
  const result = accumulators
    .filter((acc) => acc.classes.length > 0 || acc.branchLabel !== undefined)
    .map((acc) => ({
      classes: acc.classes,
      branchLabel: acc.branchLabel,
      branchId: acc.branchId,
    }));

  // variant-pseudo クラスがあれば追加候補として記録する。
  // ランタイム条件依存のため静的解析不能 → classify Rule 4/5 で unknown に落ちる。
  if (variantPseudoCollected.length > 0) {
    result.push({
      classes: variantPseudoCollected,
      branchLabel: 'variant-pseudo',
      branchId: undefined,
    });
  }

  return result;
}

/**
 * JSX 属性の value ノードから ClassCandidate 配列を抽出する。
 *
 * 静的文字列 → classes にクラスを格納した単一 ClassCandidate
 * cn()/clsx() 呼び出し → 各引数を展開した複数 ClassCandidate
 * それ以外の動的式 → branchLabel: 'dynamic' の単一 ClassCandidate
 *
 * variant-pseudo クラス (sm:, hover: 等) が存在する場合は
 * branchLabel: 'variant-pseudo' の候補を追加する。
 */
function extractClassCandidates(valueNode: AstNode): ClassCandidate[] {
  // Static string
  const staticStr = extractStaticClassString(valueNode);
  if (staticStr !== null) {
    const { classes, variantPseudoClasses } = extractColorClasses(staticStr);
    const result: ClassCandidate[] = [{ classes }];
    // variant-pseudo クラスが存在すれば追加候補として記録する
    if (variantPseudoClasses.length > 0) {
      result.push({
        classes: variantPseudoClasses,
        branchLabel: 'variant-pseudo',
      });
    }
    return result;
  }

  // JSXExpressionContainer with a call expression (cn/clsx)
  if (valueNode.type === 'JSXExpressionContainer') {
    const expr = (valueNode as AstNode & { expression: AstNode }).expression;
    if (expr && expr.type === 'CallExpression') {
      const call = expr as CallExpression;
      const callee = call.callee;

      // Check if it's a known utility function: cn, clsx, cx
      const isKnownUtil =
        (callee.type === 'Identifier' &&
          ['cn', 'clsx', 'cx'].includes(
            (callee as AstNode & { name: string }).name,
          )) ||
        (callee.type === 'MemberExpression' &&
          ['cn', 'clsx', 'cx'].includes(
            (
              (callee as AstNode & { property: AstNode })
                .property as AstNode & {
                name: string;
              }
            ).name ?? '',
          ));

      if (isKnownUtil) {
        return extractCandidatesFromCnCall(expr);
      }
    }
  }

  // Unknown/dynamic expression
  return [{ classes: [], branchLabel: 'dynamic' }];
}

/**
 * JSXOpeningElement から className 属性の value ノードを取得する。
 */
function getClassNameAttr(opening: JsxOpeningElement): AstNode | null {
  for (const attr of opening.attributes) {
    if (attr.type === 'JSXAttribute') {
      const attrName = (attr.name as AstNode & { name?: string }).name;
      if (attrName === 'className' && attr.value !== null) {
        return attr.value;
      }
    }
  }
  return null;
}

/**
 * JSX 要素名を文字列で取得する。
 *
 * JSXIdentifier: "div", "p", "Card" など
 * JSXMemberExpression: "Foo.Bar" など
 */
function getElementName(nameNode: AstNode): string {
  if (nameNode.type === 'JSXIdentifier') {
    return (nameNode as AstNode & { name: string }).name;
  }
  if (nameNode.type === 'JSXMemberExpression') {
    const member = nameNode as AstNode & {
      object: AstNode;
      property: AstNode;
    };
    return `${getElementName(member.object)}.${getElementName(member.property)}`;
  }
  return 'unknown';
}

/**
 * WCAG 1.4.11 の「非テキスト UI コンポーネント」扱いにする標準 HTML / SVG 要素名。
 *
 * これらは装飾・状態表現であり「本文テキスト」ではないため、4.5:1 基準ではなく
 * 3:1 基準で評価する（「隣接色と 3:1 以上」の要件に対応）。
 *
 * ref: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
 */
const NON_TEXT_HTML_ELEMENTS = new Set([
  'svg',
  'circle',
  'rect',
  'path',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
  'use',
]);

/**
 * import 元パッケージ名が「装飾アイコンライブラリ」であることを示すリスト。
 *
 * これらからデフォルトエクスポート・名前付きエクスポートされた React コンポーネントは
 * 装飾アイコンとして扱い、3:1 基準で評価する。
 * 新しいアイコンライブラリを使う場合はここに追加する。
 */
const ICON_PACKAGE_NAMES = new Set(['lucide-react']);

/**
 * ファイル先頭のみを走査して「装飾アイコンコンポーネント名」の集合を収集する。
 *
 * ESM import 文のみ対象。CommonJS require や dynamic import は対象外。
 * バンドルサイズ最適化のため、全 AST ノードの走査は避けて Program.body の
 * トップレベル statement のみを見る。
 */
interface IconIdentifiers {
  /** 名前付き import された装飾アイコンコンポーネント名 */
  names: Set<string>;
  /** `import * as Icons from 'lucide-react'` の namespace 名 */
  namespaces: Set<string>;
}

/**
 * ファイル先頭のみを走査して「装飾アイコンコンポーネント名」の集合を収集する。
 *
 * ESM import 文のみ対象。CommonJS require や dynamic import は対象外。
 * バンドルサイズ最適化のため、全 AST ノードの走査は避けて Program.body の
 * トップレベル statement のみを見る。
 *
 * 名前付き import (`{ Bug }`) / default import (`Bug`) は names に、
 * namespace import (`* as Icons`) は namespaces に分けて記録する。
 * JSX 側で `<Icons.Bug>` のように member expression で参照された場合は
 * `elementName.startsWith(ns + '.')` で判定する。
 */
function collectIconComponentNames(program: AstNode): IconIdentifiers {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const body = (program as AstNode & { body?: AstNode[] }).body;
  if (!Array.isArray(body)) {
    return { names, namespaces };
  }

  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') {
      continue;
    }
    const source = (
      stmt as AstNode & { source?: AstNode & { value?: unknown } }
    ).source;
    const sourceValue = source?.value;
    if (typeof sourceValue !== 'string') {
      continue;
    }
    if (!ICON_PACKAGE_NAMES.has(sourceValue)) {
      continue;
    }

    const specifiers =
      (stmt as AstNode & { specifiers?: AstNode[] }).specifiers ?? [];
    for (const spec of specifiers) {
      const local = (spec as AstNode & { local?: AstNode & { name?: string } })
        .local;
      const localName = local?.name;
      if (typeof localName !== 'string') {
        continue;
      }
      if (spec.type === 'ImportNamespaceSpecifier') {
        namespaces.add(localName);
      } else {
        // ImportSpecifier (名前付き) / ImportDefaultSpecifier (default)
        names.add(localName);
      }
    }
  }
  return { names, namespaces };
}

/**
 * 要素名が装飾アイコンコンポーネントに該当するか判定する。
 *
 * 名前付き/デフォルト import は `names.has(elementName)` で直接一致、
 * namespace import は `elementName` が `{namespace}.` で始まるかで判定する。
 */
function isIconElement(elementName: string, iconIds: IconIdentifiers): boolean {
  if (iconIds.names.has(elementName)) {
    return true;
  }
  for (const ns of iconIds.namespaces) {
    if (elementName.startsWith(`${ns}.`)) {
      return true;
    }
  }
  return false;
}

/**
 * `bg-gradient-*` / `bg-linear-*` / `bg-radial-*` / `bg-conic-*` を含む
 * Tailwind クラス検出用の正規表現。
 *
 * Tailwind v3 は `bg-gradient-to-*`、v4 は `bg-linear-*` / `bg-radial-*` /
 * `bg-conic-*` が対応するため両方拾う。
 * 単語境界の直後に bg- から始まるグラデーション指定がくる箇所を探し、
 * `dark:bg-gradient-to-t` のような variant prefix 付きも拾う。
 */
const GRADIENT_CLASS_PATTERN = /(?<![\w-])bg-(?:gradient|linear|radial|conic)-/;

/**
 * Tailwind の alpha 修飾子 (`/50`, `/[0.3]`, `/[50%]`) が後続するかを検出。
 *
 * 半透明な背景は祖先のグラデーションを完全には覆わないため、solid 判定から
 * 除外する必要がある (Codex P2 指摘)。
 */
const ALPHA_MODIFIER_PATTERN = /\/(?:\d|\[)/;

/**
 * bg-transparent / bg-current / bg-inherit など、実効的に「色を持たない」
 * 背景クラスのサフィックス。これらは solid 扱いしない。
 */
const NON_OPAQUE_BG_KEYWORDS = new Set(['transparent', 'current', 'inherit']);

/**
 * className の value AST を走査して「祖先 gradient を覆い隠せる不透明 bg-*」が
 * 含まれるかをテーマ別に判定する。
 *
 * Tailwind の cascading を踏まえた分類:
 * - variant なし opaque bg (例: `bg-white`): light/dark 両方で solid
 * - `dark:` 付き opaque bg (例: `dark:bg-card`): dark のみで solid
 * - `hover:`/`focus:`/`sm:` 等の非 dark variant: 常時適用でないため ignore
 * - variant なし alpha/gradient/透明 (例: `bg-transparent`): 両テーマで masking
 * - `dark:` 付き alpha/gradient/透明 (例: `dark:bg-transparent`): dark を masking
 *
 * masking はすでに立った solid フラグを打ち消す (例: `bg-white dark:bg-transparent`
 * → light=true, dark=false)。これにより dark モードでは solid ではないので、
 * 祖先の `dark:bg-gradient-*` は引き続き伝播する (Codex P1 指摘)。
 *
 * 注意: ClassCandidate ではなく生の classNameValue AST を走査するのは、
 * extractColorClasses が `bg-transparent` を色クラスでないとして除外するため
 * (bgCandidates に残らないため masking 情報が失われる)。
 * jsxContainsGradientClass と同じ戦略で生文字列を直接スキャンする。
 */
/**
 * opaque bg の中間計算状態。masking 情報は `light && !lightMasked` のように
 * 最後にまとめて適用するため、文字列 / AST ノード間での合成ではこの 4 値を
 * そのまま保持する。
 *
 * `cn('bg-white', 'dark:bg-transparent')` のように Literal が分かれていても、
 * 両者を merge してから masking を適用することで `'bg-white dark:bg-transparent'`
 * と等価な結果を得られる (Codex P1 指摘への対応)。
 */
interface OpaqueAccum {
  light: boolean;
  dark: boolean;
  lightMasked: boolean;
  darkMasked: boolean;
}

const NO_OPAQUE: OpaqueAccum = {
  light: false,
  dark: false,
  lightMasked: false,
  darkMasked: false,
};

function mergeOpaqueAccum(a: OpaqueAccum, b: OpaqueAccum): OpaqueAccum {
  return {
    light: a.light || b.light,
    dark: a.dark || b.dark,
    lightMasked: a.lightMasked || b.lightMasked,
    darkMasked: a.darkMasked || b.darkMasked,
  };
}

/**
 * 相互排他的 branch (`cond && X` や `cond ? A : B`) の AST を合成する際の
 * マージ規則。opaque は OR (「どちらかの branch で opaque なら覆う可能性がある」)、
 * masking は AND (「全 branch で揃って masked のときのみ確実に masked」) で合成する。
 *
 * これにより `cn('bg-low-bg', cond && 'dark:bg-transparent')` のような
 * branch 分岐で、cond=false 側の solid 背景を正しく AA 評価できる
 * (Codex P1 指摘: branch に masked が片寄ると全ケースで skip されていた問題)。
 *
 * linter の設計哲学として「疑わしきは AA 評価」を採り、branch が分かれたら
 * 最も opaque が強く出る方に倒して false negative を避ける。
 */
function mergeOpaqueBranches(a: OpaqueAccum, b: OpaqueAccum): OpaqueAccum {
  return {
    light: a.light || b.light,
    dark: a.dark || b.dark,
    lightMasked: a.lightMasked && b.lightMasked,
    darkMasked: a.darkMasked && b.darkMasked,
  };
}

function jsxOpaqueBgFlags(valueNode: AstNode | null): GradientFlags {
  if (valueNode === null) {
    return NO_GRADIENT;
  }
  const acc = extractOpaqueFromAst(valueNode);
  return {
    light: acc.light && !acc.lightMasked,
    dark: acc.dark && !acc.darkMasked,
  };
}

function extractOpaqueFromAst(node: AstNode): OpaqueAccum {
  if (node.type === 'Literal') {
    const value = (node as Literal).value;
    return typeof value === 'string' ? opaqueAccumInString(value) : NO_OPAQUE;
  }

  // 相互排他的 branch: LogicalExpression (`&&` / `||` / `??`) と
  // ConditionalExpression (`cond ? A : B`) は「ランタイムで一方の branch のみ
  // 適用される」形なので、子の opaque 情報は branch 合成 (masking は AND) で
  // 統合する。
  if (node.type === 'LogicalExpression') {
    const left = (node as AstNode & { left: AstNode }).left;
    const right = (node as AstNode & { right: AstNode }).right;
    // cond && X: cond=true の branch で両方適用、cond=false の branch で left のみ。
    // 実用的には left は boolean なので leftAcc は NO_OPAQUE になることが多い。
    // 「両方適用」ケースを OR 合成で表し、「left のみ」ケースを別 branch として
    // branch 合成する。
    const leftAcc = extractOpaqueFromAst(left);
    const rightAcc = extractOpaqueFromAst(right);
    const bothBranch = mergeOpaqueAccum(leftAcc, rightAcc);
    return mergeOpaqueBranches(leftAcc, bothBranch);
  }

  if (node.type === 'ConditionalExpression') {
    const consequent = (node as AstNode & { consequent: AstNode }).consequent;
    const alternate = (node as AstNode & { alternate: AstNode }).alternate;
    return mergeOpaqueBranches(
      extractOpaqueFromAst(consequent),
      extractOpaqueFromAst(alternate),
    );
  }

  // 関数先頭で acc を宣言し、TemplateLiteral の quasis 処理結果も
  // その後の子ノード走査にマージする (Codex P1 指摘: 旧実装は quasis 処理結果を
  // 捨てていたため `className={\`bg-white\`}` 等の静的テンプレートで
  // opaque 情報が失われていた)。
  let acc: OpaqueAccum = NO_OPAQUE;

  if (node.type === 'TemplateLiteral') {
    const quasis = (node as TemplateLiteral).quasis;
    for (const q of quasis) {
      const cooked = q.value?.cooked ?? '';
      acc = mergeOpaqueAccum(acc, opaqueAccumInString(cooked));
    }
    // `${...}` で埋め込まれた expressions は下の共通 AST 走査で処理される。
    // opaqueAccumInString は冪等 (OR 合成) なので、TemplateElement を再走査
    // しても結果は変わらない。
  }

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === 'object' && 'type' in child) {
          acc = mergeOpaqueAccum(acc, extractOpaqueFromAst(child as AstNode));
        }
      }
    } else if (val && typeof val === 'object' && 'type' in val) {
      acc = mergeOpaqueAccum(acc, extractOpaqueFromAst(val as AstNode));
    }
  }
  return acc;
}

/**
 * 単一クラス列からの opaque bg 中間表現を計算する。
 *
 * Tailwind の cascading を踏まえた分類:
 * - variant なし opaque bg (例: `bg-white`): light/dark 両方で solid
 * - `dark:` 付き opaque bg (例: `dark:bg-card`): dark のみで solid
 * - `hover:`/`focus:`/`sm:` 等の非 dark variant: 常時適用でないため ignore
 * - variant なし alpha/gradient/透明 (例: `bg-transparent`): 両テーマで masking
 * - `dark:` 付き alpha/gradient/透明 (例: `dark:bg-transparent`): dark を masking
 *
 * masking はすでに立った solid フラグを打ち消す (例: `bg-white dark:bg-transparent`
 * → light=true, dark=false)。これにより dark モードでは solid ではないので、
 * 祖先の `dark:bg-gradient-*` は引き続き伝播する (Codex P1 指摘)。
 *
 * masking の最終適用は呼出側 (jsxOpaqueBgFlags) で行う。関数間合成に備えて
 * ここでは masked を解除せず中間表現のまま返すのが重要 (Codex P1 #2 指摘:
 * `cn('bg-white', 'dark:bg-transparent')` のように Literal が分かれた際に
 * 外側から masking 情報が失われないようにするため)。
 *
 * 注意: ClassCandidate ではなく生の classNameValue AST を走査するのは、
 * extractColorClasses が `bg-transparent` を色クラスでないとして除外するため
 * (bgCandidates に残らないため masking 情報が失われる)。
 * jsxContainsGradientClass と同じ戦略で生文字列を直接スキャンする。
 */
function opaqueAccumInString(classStr: string): OpaqueAccum {
  let light = false;
  let dark = false;
  let lightMasked = false;
  let darkMasked = false;

  for (const rawCls of classStr.split(/\s+/)) {
    const trimmed = rawCls.trim();
    if (!trimmed) {
      continue;
    }
    const { base, hasDarkVariant, hasNonDarkVariant } = extractBase(trimmed);
    if (hasNonDarkVariant) {
      continue;
    }
    if (!base.startsWith('bg-')) {
      continue;
    }

    const suffix = base.slice(3);
    const isTransparent = NON_OPAQUE_BG_KEYWORDS.has(suffix);
    const isAlpha = ALPHA_MODIFIER_PATTERN.test(base);
    const isGradient = GRADIENT_CLASS_PATTERN.test(base);

    // `bg-cover` / `bg-center` / `bg-repeat` / `bg-clip-*` 等の「色ではない
    // bg-* utility」は背景色としての意味を持たないため opaque masking にも
    // 計上しない (Codex P2 指摘)。isColorClass で色クラスかを判定する。
    // ただし transparent/current/inherit は色クラス判定からは外れるが masking
    // として扱う必要があるため、ここでは除外しない (下の分岐で処理)。
    if (!isTransparent && !isAlpha && !isGradient && !isColorClass(base)) {
      continue;
    }

    const isOpaque = !isAlpha && !isGradient && !isTransparent;

    if (hasDarkVariant) {
      if (isOpaque) {
        dark = true;
      } else {
        darkMasked = true;
      }
    } else if (isOpaque) {
      light = true;
      dark = true;
    } else {
      lightMasked = true;
      darkMasked = true;
    }
  }

  return { light, dark, lightMasked, darkMasked };
}

/**
 * className の value AST を走査して gradient クラスが「常時適用される状態で」
 * 含まれるか判定する。
 *
 * `isColorClass` は `bg-gradient-*` を「色クラスでない」として除外するため、
 * ClassCandidate 経由ではグラデーション背景を検出できない。
 * ここでは静的文字列を直接スキャンして擬陽性抑制用のフラグを得る。
 * cn()/clsx() 経由の条件分岐も含めて走査するため、条件の真偽に関わらず
 * グラデーションが含まれれば skip 対象とする (conservative な判定)。
 *
 * ただし `hover:bg-gradient-to-t` のように `dark:` 以外の variant prefix が
 * ついた gradient は「状態依存で常時適用されない」ので無視する。そうしないと
 * `bg-low-bg hover:bg-gradient-to-*` のような通常 solid + hover のみグラデ、
 * というパターンで通常状態の AA 違反を silent に見逃す (Codex P1 指摘)。
 */
function jsxContainsGradientClass(valueNode: AstNode | null): GradientFlags {
  if (valueNode === null) {
    return NO_GRADIENT;
  }
  return containsGradientInAst(valueNode);
}

/** テーマ別の gradient 有無フラグ。 */
interface GradientFlags {
  light: boolean;
  dark: boolean;
}

const NO_GRADIENT: GradientFlags = { light: false, dark: false };

/** 2 つの GradientFlags を OR 合成する。 */
function mergeGradient(a: GradientFlags, b: GradientFlags): GradientFlags {
  return { light: a.light || b.light, dark: a.dark || b.dark };
}

/**
 * 単一の className 文字列中に「常時適用される gradient 背景」があるかを
 * テーマ別に判定する。
 *
 * 各クラスを空白で分割し、variant prefix を剥がしてから gradient パターンに
 * 該当するかを見る:
 * - バリアントなし: light/dark 両方で常時適用 → 両方 true
 * - `dark:` のみ: dark モードでのみ適用 → dark=true のみ
 * - `hover:`/`focus:`/`sm:` 等: 状態依存で常時適用でない → ignore (両方 false)
 * - `md:dark:` 等のチェーン: `dark:` 以外の variant が混ざるため状態依存と判定 → ignore
 */
function hasEffectiveGradientBg(classStr: string): GradientFlags {
  let light = false;
  let dark = false;

  for (const rawCls of classStr.split(/\s+/)) {
    const trimmed = rawCls.trim();
    if (!trimmed) {
      continue;
    }

    const { base, hasDarkVariant, hasNonDarkVariant } = extractBase(trimmed);
    // hover:, focus:, sm: 等が混ざれば常時適用でないため無視。
    if (hasNonDarkVariant) {
      continue;
    }

    if (!GRADIENT_CLASS_PATTERN.test(base)) {
      continue;
    }

    if (hasDarkVariant) {
      dark = true;
    } else {
      light = true;
      dark = true;
    }
  }

  return { light, dark };
}

function containsGradientInAst(node: AstNode): GradientFlags {
  if (node.type === 'Literal') {
    const value = (node as Literal).value;
    return typeof value === 'string'
      ? hasEffectiveGradientBg(value)
      : NO_GRADIENT;
  }

  // 関数先頭で acc を宣言し、TemplateLiteral の quasis 処理結果も続く
  // 子ノード走査にマージする (extractOpaqueFromAst と同じ Codex P1 対応)。
  let acc: GradientFlags = NO_GRADIENT;

  if (node.type === 'TemplateLiteral') {
    const quasis = (node as TemplateLiteral).quasis;
    for (const q of quasis) {
      const cooked = q.value?.cooked ?? '';
      acc = mergeGradient(acc, hasEffectiveGradientBg(cooked));
    }
    if (acc.light && acc.dark) {
      return acc;
    }
  }

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === 'object' && 'type' in child) {
          acc = mergeGradient(acc, containsGradientInAst(child as AstNode));
          if (acc.light && acc.dark) {
            return acc;
          }
        }
      }
    } else if (val && typeof val === 'object' && 'type' in val) {
      acc = mergeGradient(acc, containsGradientInAst(val as AstNode));
      if (acc.light && acc.dark) {
        return acc;
      }
    }
  }
  return acc;
}

/**
 * バイトオフセット → 行/列番号の変換を効率化するインデックス。
 *
 * ファイル単位で改行位置を一度だけ走査してキャッシュし、
 * 二分探索で O(log n) の位置決定を実現する。
 *
 * 注意: oxc-parser は UTF-8 バイトオフセットを返す。
 * この実装は JS 文字列 (UTF-16) のインデックスとして扱うため、
 * CJK 等の多バイト文字が多い場合にオフセットがずれることがある。
 * Phase 1 では精度より速度を優先し、この制限を受け入れる。
 */
class OffsetIndex {
  /** 各改行文字の位置 (先頭が 0 行目、改行後が 1 行目...) */
  private readonly lineStarts: number[];

  constructor(source: string) {
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /** バイトオフセットを 1-indexed の { line, column } に変換する。 */
  toLineCol(offset: number): { line: number; column: number } {
    // Binary search for the last lineStart <= offset
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const line = lo + 1;
    const column = offset - this.lineStarts[lo] + 1;
    return { line, column };
  }
}

/**
 * JSX 要素ツリーを再帰下降し、各要素の JsxStack を収集する。
 *
 * @param node - 現在の AST ノード
 * @param offsetIndex - バイトオフセット → 行番号変換インデックス
 * @param filePath - ファイルパス (報告用)
 * @param parentBgStack - 親要素から継承した bg クラス候補の階層配列 (外→内)
 * @param results - 収集結果を追記するリスト
 */
interface VisitContext {
  offsetIndex: OffsetIndex;
  filePath: string;
  results: JsxStack[];
  /** ファイル内で `lucide-react` 等から import された装飾アイコン名/namespace */
  iconIds: IconIdentifiers;
}

function visitNode(
  node: AstNode,
  ctx: VisitContext,
  parentBgStack: ClassCandidate[][],
  /** 祖先要素が bg-gradient-* を持っているか (テーマ別)。子要素まで継承する。 */
  ancestorHasGradient: GradientFlags,
): void {
  if (!isJsxElement(node)) {
    // Recurse into non-JSX nodes' children
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === 'object' && 'type' in child) {
            visitNode(
              child as AstNode,
              ctx,
              parentBgStack,
              ancestorHasGradient,
            );
          }
        }
      } else if (val && typeof val === 'object' && 'type' in val) {
        visitNode(val as AstNode, ctx, parentBgStack, ancestorHasGradient);
      }
    }
    return;
  }

  const opening = node.openingElement;
  const elementName = getElementName(opening.name);
  const classNameValue = getClassNameAttr(opening);

  const bgCandidates: ClassCandidate[] = [];
  const textCandidates: ClassCandidate[] = [];

  if (classNameValue !== null) {
    const allCandidates = extractClassCandidates(classNameValue);

    // Separate bg and text candidates
    for (const candidate of allCandidates) {
      // variant-pseudo 候補 (sm:text-*, hover:bg-* 等) は base クラスで bg/text を判定する。
      // 全体の classes が variant-pseudo クラスのみなので、extractBase で base を得る。
      if (candidate.branchLabel === 'variant-pseudo') {
        const hasBgClass = candidate.classes.some((c) => {
          const { base } = extractBase(c);
          return base.startsWith('bg-');
        });
        const hasTextClass = candidate.classes.some((c) => {
          const { base } = extractBase(c);
          return base.startsWith('text-');
        });
        if (hasBgClass) {
          bgCandidates.push({ classes: [], branchLabel: 'variant-pseudo' });
        }
        if (hasTextClass) {
          textCandidates.push({ classes: [], branchLabel: 'variant-pseudo' });
        }
        continue;
      }

      // important 修飾子 (!) 付きのクラスも bg-*/text-* として認識する。
      // `!bg-card`, `dark:!bg-muted` → extractBase で `!` を除去して base で判定した上で
      // 元の trimmed クラス文字列 (! 含む) を格納する。
      const bgClasses = candidate.classes.filter((c) => {
        const { base } = extractBase(c);
        return base.startsWith('bg-');
      });
      const textClasses = candidate.classes.filter((c) => {
        const { base } = extractBase(c);
        return base.startsWith('text-');
      });

      if (bgClasses.length > 0) {
        bgCandidates.push({ ...candidate, classes: bgClasses });
      }
      if (textClasses.length > 0) {
        textCandidates.push({ ...candidate, classes: textClasses });
      }

      // Dynamic/variant-pseudo branch with no classes - propagate as signal
      if (
        candidate.branchLabel === 'dynamic' &&
        candidate.classes.length === 0
      ) {
        bgCandidates.push({ classes: [], branchLabel: 'dynamic' });
        textCandidates.push({ classes: [], branchLabel: 'dynamic' });
      }
    }
  }

  // Build the new bg stack for this element and its children.
  //
  // 階層配列設計:
  // - bgStack の各エントリ (層) は 1 つの DOM 階層を表す。
  // - この要素自身の bgCandidates を 1 つの「層」として push する。
  //   → 同一要素内の排他分岐 (cn(cond ? 'bg-black' : 'bg-white')) は同じ層に入る。
  //   → classify の enumerateCombinations が各層から 1 つずつ alternative を選ぶ直積を生成する。
  // - 親子ネスト由来の compositeOver は classify.ts が各層間で行う。
  // - bgCandidates が空 (この要素に bg 指定なし) なら親の bgStack をそのまま継承する。
  const newBgStack: ClassCandidate[][] =
    bgCandidates.length > 0
      ? [...parentBgStack, bgCandidates] // この要素の候補群を 1 層として追加
      : parentBgStack;

  // WCAG 1.4.11 判定: 標準 SVG primitives とファイル内の装飾アイコン import を
  // 非テキスト UI コンポーネントとして扱う。CLI 側で閾値を 3:1 に切り替える。
  const isNonTextElement =
    NON_TEXT_HTML_ELEMENTS.has(elementName) ||
    isIconElement(elementName, ctx.iconIds);

  // 自要素の bg-gradient-* クラスを検出。親から継承した gradient も考慮する。
  // グラデーション背景は単色として扱えず静的コントラスト計算が不正確になるため、
  // CLI 側で skip の目印として使う。
  const myGradient = jsxContainsGradientClass(classNameValue);
  // 自要素が非グラデの solid bg-* を持てば、祖先のグラデはこの要素でカバーされる
  // (不透明な背景で上書きされる) ので、子孫には gradient フラグを引き継がない。
  // これをやらないと `<div bg-gradient-to-t><div bg-white><p text-white/></div></div>`
  // のような「グラデ下にさらに不透明レイヤーを重ねて上書き」パターンで、
  // p 要素の `text-white on bg-white` (1:1) 違反を silent に見逃す false negative が出る。
  //
  // 重要:
  // - 半透明な bg-* (`bg-white/50`, `bg-muted/40`) は祖先のグラデを完全には
  //   覆わないため solid 扱いしない (Codex P2 指摘)。
  // - `bg-white dark:bg-transparent` のようにテーマ別に透明度が変わるクラスは
  //   テーマ別に solid 有無を判定する必要がある (Codex P1 指摘: 単一 boolean
  //   では dark モードの gradient propagation が誤ってクリアされる)。
  const myOpaqueBg: GradientFlags = jsxOpaqueBgFlags(classNameValue);
  // テーマ別に gradient を伝播する。自要素がそのテーマで gradient を宣言しているか、
  // 祖先の gradient が有効 & かつ自要素で solid bg による上書きが無い場合に true。
  const hasGradientBackground: GradientFlags = {
    light: myGradient.light || (ancestorHasGradient.light && !myOpaqueBg.light),
    dark: myGradient.dark || (ancestorHasGradient.dark && !myOpaqueBg.dark),
  };

  // If this element has text candidates, record a JsxStack entry.
  // bgStack が空 (祖先に bg 指定なし) の場合も記録する。
  // classify.ts Rule 6 が bgStack 空時に暗黙の --background をベースとして使うため、
  // ページデフォルト背景に描画される一般テキストのコントラスト検証が可能になる。
  if (textCandidates.length > 0) {
    const { line, column } = ctx.offsetIndex.toLineCol(opening.start);
    ctx.results.push({
      file: ctx.filePath,
      line,
      column,
      bgStack: newBgStack,
      textCandidates,
      elementName,
      isNonTextElement,
      hasGradientBackground,
    });
  }

  // Recurse into children with the new bg stack
  for (const child of node.children) {
    if (child && typeof child === 'object' && 'type' in child) {
      visitNode(child, ctx, newBgStack, hasGradientBackground);
    }
  }

  // Recurse into JSX elements embedded in attribute values.
  // 例: <Dialog trigger={<Button className="..." />}>
  // attribute 内 JSX は論理的に別ツリーなので parentBgStack を引き継がない
  // (属性値 JSX は DOM 上で別の場所にレンダリングされるため)。
  //
  // Phase 1 制限: 属性値内の直接 JSX 埋め込み (<Element />) のみ対応。
  // ConditionalExpression ({cond ? <A /> : <B />}) や Fragment ({<><A /><B /></>})
  // 経由の JSX は未対応 (expr.type !== 'JSXElement' のためスキップされる)。
  // 将来の Phase で ConditionalExpression / Fragment の再帰走査を拡張可能。
  for (const attr of opening.attributes) {
    if (attr.type === 'JSXAttribute' && attr.value !== null) {
      const value = attr.value;
      if (value.type === 'JSXExpressionContainer') {
        const expr = (value as AstNode & { expression: AstNode }).expression;
        if (expr && isJsxElement(expr)) {
          visitNode(expr, ctx, [], NO_GRADIENT);
        }
      }
    }
  }
}

/**
 * oxc-parser で .tsx をパースし、各 JSX 要素の bg/text スタックを抽出する。
 *
 * - 親から子へ再帰下降し、bg-* を見つけたらスタックに push
 * - className が cn()/clsx()/cva() の場合は全分岐を候補として展開
 *   (展開失敗時は ClassCandidate に `branchLabel: 'dynamic'` で記録)
 * - コンポーネント境界 (`<Card>`) は解析対象ファイル内で定義を引ける場合のみ辿る。
 *   ファイル外は unknown として継続
 *
 * @param filePath - 解析するファイルパス (エラー報告に使用)
 * @param source - ファイルの内容
 * @returns 抽出した JsxStack の配列
 */
export function collectJsxStacks(filePath: string, source: string): JsxStack[] {
  const result = parseSync(filePath, source, { sourceType: 'module' });

  if (result.errors && result.errors.length > 0) {
    // Parse errors: return empty result
    // Caller can decide how to handle (warn or skip)
    return [];
  }

  const stacks: JsxStack[] = [];
  // oxc-parser's Program type lacks the [key: string]: unknown index signature
  // required by AstNode. Cast through unknown to satisfy both type constraints.
  const program = result.program as unknown as AstNode;

  // ファイル単位で改行インデックスを一度だけ構築し、二分探索で行番号計算する
  const offsetIndex = new OffsetIndex(source);

  const ctx: VisitContext = {
    offsetIndex,
    filePath,
    results: stacks,
    iconIds: collectIconComponentNames(program),
  };

  visitNode(program, ctx, [], NO_GRADIENT);

  return stacks;
}
