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

    const { base, hasDarkVariant, hasNonDarkVariant } =
      stripVariantPrefixes(trimmed);

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
  let accumulators: {
    classes: string[];
    branchLabel: string | undefined;
  }[] = [{ classes: [], branchLabel: undefined }];

  // variant-pseudo クラス (sm:, hover: 等) のクラス文字列を収集する。
  // これらは別途 branchLabel:'variant-pseudo' の候補として末尾に追加する。
  const variantPseudoCollected: string[] = [];

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

      if (logical.right.type === 'Literal') {
        const lit = logical.right as Literal;
        if (typeof lit.value === 'string') {
          const { classes: addedClasses, variantPseudoClasses } =
            extractColorClasses(lit.value);
          variantPseudoCollected.push(...variantPseudoClasses);
          // 「右辺適用」パス (既存アキュムレータを複製して addedClasses を追加)
          const withBranch = accumulators.map((acc) => ({
            classes: [...acc.classes, ...addedClasses],
            branchLabel: acc.branchLabel ?? branchLabel,
          }));
          // 「右辺なし」パスにも branchLabel を付与して分岐の存在を示す
          for (const acc of accumulators) {
            acc.branchLabel = acc.branchLabel ?? branchLabel;
          }
          accumulators = [...accumulators, ...withBranch];

          // アキュムレータ爆発ガード: 上限超過時は dynamic 単一候補に集約する。
          // これ以上の展開を続けると 2^N 個の候補が生まれる可能性がある。
          if (accumulators.length > MAX_ACCUMULATORS) {
            accumulators = [{ classes: [], branchLabel: 'dynamic' }];
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
            accumulators.push({ classes: [], branchLabel: 'dynamic' });
          }
        }
      } else {
        // 非リテラル右辺: 全アキュムレータを dynamic に変換
        for (const acc of accumulators) {
          acc.branchLabel = 'dynamic';
        }
      }
      continue;
    }

    // Conditional expression: cond ? 'bg-a' : 'bg-b'
    // 健全性確保: 非リテラル分岐 (変数・式など) は silently drop せず
    // branchLabel: 'dynamic' として記録する。
    // これにより classify の Rule 4/5 が発火して unknown に落ちる (偽陰性を防ぐ)。
    if (arg.type === 'ConditionalExpression') {
      const cond = arg as AstNode & {
        consequent: AstNode;
        alternate: AstNode;
      };

      const newAccumulators: typeof accumulators = [];
      for (const acc of accumulators) {
        for (const branch of [cond.consequent, cond.alternate]) {
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
              });
            }
          } else {
            // 非リテラル分岐 (Identifier, MemberExpression 等) は動的として記録する
            newAccumulators.push({
              classes: [...acc.classes],
              branchLabel: 'dynamic',
            });
          }
        }
      }
      // アキュムレータ爆発ガード: 上限超過時は dynamic 単一候補に集約する。
      accumulators =
        newAccumulators.length > MAX_ACCUMULATORS
          ? [{ classes: [], branchLabel: 'dynamic' }]
          : newAccumulators;
      continue;
    }

    // Any other dynamic expression: 全アキュムレータを dynamic に変換
    for (const acc of accumulators) {
      acc.branchLabel = 'dynamic';
    }
  }

  // アキュムレータから ClassCandidate 配列に変換。
  // classes が空で branchLabel も undefined の候補 (引数なし cn()) は除外する。
  const result = accumulators
    .filter((acc) => acc.classes.length > 0 || acc.branchLabel !== undefined)
    .map((acc) => ({ classes: acc.classes, branchLabel: acc.branchLabel }));

  // variant-pseudo クラスがあれば追加候補として記録する。
  // ランタイム条件依存のため静的解析不能 → classify Rule 4/5 で unknown に落ちる。
  if (variantPseudoCollected.length > 0) {
    result.push({
      classes: variantPseudoCollected,
      branchLabel: 'variant-pseudo',
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
 * @param parentBgStack - 親要素から継承した bg クラス候補のスタック
 * @param results - 収集結果を追記するリスト
 */
function visitNode(
  node: AstNode,
  offsetIndex: OffsetIndex,
  filePath: string,
  parentBgStack: ClassCandidate[],
  results: JsxStack[],
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
              offsetIndex,
              filePath,
              parentBgStack,
              results,
            );
          }
        }
      } else if (val && typeof val === 'object' && 'type' in val) {
        visitNode(
          val as AstNode,
          offsetIndex,
          filePath,
          parentBgStack,
          results,
        );
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
      // 全体の classes が variant-pseudo クラスのみなので、stripVariantPrefixes で base を得る。
      if (candidate.branchLabel === 'variant-pseudo') {
        const hasBgClass = candidate.classes.some((c) => {
          const { base } = stripVariantPrefixes(c);
          return base.startsWith('bg-');
        });
        const hasTextClass = candidate.classes.some((c) => {
          const { base } = stripVariantPrefixes(c);
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

      const bgClasses = candidate.classes.filter(
        (c) => c.startsWith('bg-') || c.startsWith('dark:bg-'),
      );
      const textClasses = candidate.classes.filter(
        (c) => c.startsWith('text-') || c.startsWith('dark:text-'),
      );

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
  // CSS cascade セマンティクスの設計:
  // - bgStack の各エントリは 1 つの DOM 層 (祖先要素) を表す。
  // - 同一要素内の複数 bg クラス (例: cn('bg-black/50', 'bg-white/50')) は、
  //   指摘 1 の修正により 1 つの ClassCandidate { classes: ['bg-black/50', 'bg-white/50'] }
  //   に集約されている。classify 側の「最後勝ち」ロジックが同一 candidate 内で処理する。
  // - bgStack.push の対象は「この要素自身の bgCandidates を子要素へ継承する」ためのもの。
  //   親子ネスト由来の compositeOver は classify.ts が bgStack エントリ間で行う。
  // - 同一要素内の複数 bg は最後勝ちのみ有効 (DOM ネスト由来の compositeOver は不要)。
  const newBgStack =
    bgCandidates.length > 0
      ? [...parentBgStack, ...bgCandidates]
      : parentBgStack;

  // If this element has text candidates, record a JsxStack entry.
  // bgStack が空 (祖先に bg 指定なし) の場合も記録する。
  // classify.ts Rule 6 が bgStack 空時に暗黙の --background をベースとして使うため、
  // ページデフォルト背景に描画される一般テキストのコントラスト検証が可能になる。
  if (textCandidates.length > 0) {
    const { line, column } = offsetIndex.toLineCol(opening.start);
    results.push({
      file: filePath,
      line,
      column,
      bgStack: newBgStack,
      textCandidates,
      elementName,
    });
  }

  // Recurse into children with the new bg stack
  for (const child of node.children) {
    if (child && typeof child === 'object' && 'type' in child) {
      visitNode(child, offsetIndex, filePath, newBgStack, results);
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
          visitNode(expr, offsetIndex, filePath, [], results);
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

  visitNode(program, offsetIndex, filePath, [], stacks);

  return stacks;
}
