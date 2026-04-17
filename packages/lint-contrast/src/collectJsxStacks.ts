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
 * Tailwind クラス文字列から bg-* または text-* クラスを抽出する。
 *
 * スペース区切りのクラスリストから bg- または text- で始まるクラスを返す。
 */
function extractColorClasses(classStr: string): string[] {
  return classStr.split(/\s+/).filter((cls) => {
    const trimmed = cls.trim();
    return (
      trimmed.startsWith('bg-') ||
      trimmed.startsWith('text-') ||
      trimmed.startsWith('dark:bg-') ||
      trimmed.startsWith('dark:text-')
    );
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
 * 行/列番号を oxc-parser のバイトオフセットから計算する。
 *
 * oxc-parser は start/end をバイトオフセットで返すため、
 * ソース文字列を逐次スキャンして行番号と列番号に変換する。
 */
function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, column: col };
}

/**
 * JSX 要素ツリーを再帰下降し、各要素の JsxStack を収集する。
 *
 * @param node - 現在の AST ノード
 * @param source - ソース文字列 (行番号計算に使用)
 * @param filePath - ファイルパス (報告用)
 * @param parentBgStack - 親要素から継承した bg クラス候補のスタック
 * @param results - 収集結果を追記するリスト
 */
function visitNode(
  node: AstNode,
  source: string,
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
              source,
              filePath,
              parentBgStack,
              results,
            );
          }
        }
      } else if (val && typeof val === 'object' && 'type' in val) {
        visitNode(val as AstNode, source, filePath, parentBgStack, results);
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
    const { line, column } = offsetToLineCol(source, opening.start);
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
      visitNode(child, source, filePath, newBgStack, results);
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

  visitNode(program, source, filePath, [], stacks);

  return stacks;
}
