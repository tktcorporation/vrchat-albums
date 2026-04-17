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
 * Tailwind クラス文字列から bg-* または text-* の「色」クラスのみを抽出する。
 *
 * スペース区切りのクラスリストから bg- または text- で始まるクラスを返すが、
 * フォントサイズ・整列・配置など色以外のユーティリティは除外する。
 * `NON_COLOR_TEXT_SUFFIXES` / `NON_COLOR_BG_SUFFIXES` が除外リスト。
 */
function extractColorClasses(classStr: string): string[] {
  return classStr.split(/\s+/).filter((cls) => {
    const trimmed = cls.trim();
    // dark: プレフィックスを除いた実クラスで判定
    const base = trimmed.startsWith('dark:') ? trimmed.slice(5) : trimmed;

    if (base.startsWith('text-')) {
      const suffix = base.slice(5);
      // bg-clip-text, bg-gradient-to-* 等: 複合プレフィックスを持つ非色クラス
      if (
        suffix.startsWith('opacity-') ||
        suffix.startsWith('clip') ||
        suffix.startsWith('decoration-') ||
        suffix.startsWith('underline') ||
        suffix.startsWith('overline') ||
        suffix.startsWith('line-through') ||
        suffix.startsWith('no-underline') ||
        suffix.startsWith('uppercase') ||
        suffix.startsWith('lowercase') ||
        suffix.startsWith('capitalize') ||
        suffix.startsWith('normal-case')
      ) {
        return false;
      }
      return !NON_COLOR_TEXT_SUFFIXES.has(suffix);
    }

    if (base.startsWith('bg-')) {
      const suffix = base.slice(3);
      // bg-gradient-to-*, bg-clip-*, bg-origin-*, bg-blend-* は非色
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
  });
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
 * 各引数を独立した ClassCandidate として扱う (最大限の保守的展開)。
 * 動的引数 (変数参照、関数呼び出し等) は branchLabel: 'dynamic' で記録する。
 * 引数が論理式 (&&, ||) の場合は右辺を候補として展開する。
 */
function extractCandidatesFromCnCall(node: AstNode): ClassCandidate[] {
  const call = node as CallExpression;
  const candidates: ClassCandidate[] = [];

  for (const arg of call.arguments) {
    // Static string literal argument
    if (arg.type === 'Literal') {
      const lit = arg as Literal;
      if (typeof lit.value === 'string') {
        const classes = extractColorClasses(lit.value);
        if (classes.length > 0) {
          candidates.push({ classes, branchLabel: undefined });
        }
      }
      continue;
    }

    // Logical expression: cond && 'bg-red' → extract 'bg-red' as conditional branch
    if (arg.type === 'LogicalExpression') {
      const logical = arg as AstNode & { right: AstNode; operator: string };
      if (logical.right.type === 'Literal') {
        const lit = logical.right as Literal;
        if (typeof lit.value === 'string') {
          const classes = extractColorClasses(lit.value);
          if (classes.length > 0) {
            candidates.push({
              classes,
              branchLabel: `conditional(${logical.operator})`,
            });
          }
        }
      } else {
        candidates.push({ classes: [], branchLabel: 'dynamic' });
      }
      continue;
    }

    // Conditional expression: cond ? 'bg-a' : 'bg-b'
    if (arg.type === 'ConditionalExpression') {
      const cond = arg as AstNode & {
        consequent: AstNode;
        alternate: AstNode;
      };
      for (const branch of [cond.consequent, cond.alternate]) {
        if (branch.type === 'Literal') {
          const lit = branch as Literal;
          if (typeof lit.value === 'string') {
            const classes = extractColorClasses(lit.value);
            if (classes.length > 0) {
              candidates.push({ classes, branchLabel: 'conditional(?)' });
            }
          }
        }
      }
      continue;
    }

    // Any other dynamic expression
    candidates.push({ classes: [], branchLabel: 'dynamic' });
  }

  return candidates;
}

/**
 * JSX 属性の value ノードから ClassCandidate 配列を抽出する。
 *
 * 静的文字列 → classes にクラスを格納した単一 ClassCandidate
 * cn()/clsx() 呼び出し → 各引数を展開した複数 ClassCandidate
 * それ以外の動的式 → branchLabel: 'dynamic' の単一 ClassCandidate
 */
function extractClassCandidates(valueNode: AstNode): ClassCandidate[] {
  // Static string
  const staticStr = extractStaticClassString(valueNode);
  if (staticStr !== null) {
    const classes = extractColorClasses(staticStr);
    // Return even if empty - caller can filter
    return [{ classes }];
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

      // Dynamic branch with no classes - propagate as dynamic
      if (
        candidate.branchLabel === 'dynamic' &&
        candidate.classes.length === 0
      ) {
        bgCandidates.push({ classes: [], branchLabel: 'dynamic' });
        textCandidates.push({ classes: [], branchLabel: 'dynamic' });
      }
    }
  }

  // Build the new bg stack for this element and its children
  const newBgStack =
    bgCandidates.length > 0
      ? [...parentBgStack, ...bgCandidates]
      : parentBgStack;

  // If this element has text candidates, record a JsxStack entry
  if (textCandidates.length > 0 && newBgStack.length > 0) {
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
