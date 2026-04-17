/**
 * lint-contrast ライブラリ API。
 *
 * デザインシステムのコントラスト静的検証ツールの公開 API。
 * パッケージ名: @vrchat-albums/lint-contrast
 * CLI として使う場合は bin/lint-contrast.ts を参照。
 */

export { classifyStack } from './classify.js';
export { collectJsxStacks } from './collectJsxStacks.js';
export { compositeOver } from './composite.js';
export {
  wcagContrastRatio,
  relativeLuminance,
  WCAG_AA_THRESHOLD,
  WCAG_AA_LARGE_THRESHOLD,
} from './evaluateContrast.js';
export { parseCssVars } from './parseCssVars.js';
export { resolveClass } from './resolveTailwind.js';
export type {
  ClassCandidate,
  ContrastIssue,
  JsxStack,
  Resolution,
  Rgba,
  Theme,
} from './types.js';
