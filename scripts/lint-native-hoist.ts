#!/usr/bin/env node

/**
 * ネイティブモジュールの electron-builder asarUnpack と pnpm hoist パターンの整合性を検証する。
 *
 * 2つのチェックを行う:
 * 1. electronExternal にリストされたネイティブモジュール（プラットフォーム固有パッケージを持つもの）が
 *    asarUnpack に含まれているか（入れ忘れ検知）
 * 2. asarUnpack のワイルドカードパターンに対応する public-hoist-pattern が .npmrc に存在するか
 *
 * 背景: pnpm の isolated モードでは、napi-rs 系ネイティブモジュールのプラットフォーム固有
 * パッケージ（例: clip-filepaths-win32-x64-msvc）が node_modules/.pnpm/ 内に配置される。
 * electron-builder の asarUnpack はトップレベル node_modules のみ対象とするため、
 * asarUnpack に含め、かつ .npmrc の public-hoist-pattern でホイストしないと
 * ランタイムで "Cannot find module" エラーになる。
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import consola from 'consola';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

/**
 * electron/vite.config.ts の electronExternal 配列からモジュール名を抽出する。
 * Electron API や Sequelize 等を除いた、ネイティブモジュールの候補を返す。
 */
function parseElectronExternal(): string[] {
  const configPath = path.join(ROOT, 'electron', 'vite.config.ts');
  const content = fs.readFileSync(configPath, 'utf8');

  const modules: string[] = [];
  const externalMatch = content.match(
    /electronExternal\s*=\s*\[([\s\S]*?)\.\.\./,
  );
  if (!externalMatch) {
    return modules;
  }

  const entries = externalMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g);
  for (const entry of entries) {
    modules.push(entry[1] ?? entry[2]);
  }
  return modules;
}

/**
 * パッケージがプラットフォーム固有の optionalDependencies を持つか判定する。
 * napi-rs 系ネイティブモジュールの特徴: win32, darwin, linux を含む optional deps を持つ。
 */
function hasPlatformSpecificDeps(pkgName: string): boolean {
  try {
    const pkgJson = require(`${pkgName}/package.json`) as {
      optionalDependencies?: Record<string, string>;
    };
    if (!pkgJson.optionalDependencies) {
      return false;
    }
    return Object.keys(pkgJson.optionalDependencies).some(
      (dep) =>
        dep.includes('win32') ||
        dep.includes('darwin') ||
        dep.includes('linux'),
    );
  } catch {
    return false;
  }
}

/**
 * electron-builder.cjs から asarUnpack のパターンを抽出する。
 * node_modules/ プレフィックスを除去したパッケージ名パターンを返す。
 *
 * 例: 'node_modules/clip-filepaths*\/**' → 'clip-filepaths*'
 */
function parseAsarUnpackPatterns(): string[] {
  const configPath = path.join(ROOT, 'electron-builder.cjs');
  const content = fs.readFileSync(configPath, 'utf8');

  const patterns: string[] = [];
  const asarUnpackMatch = content.match(/asarUnpack\s*:\s*\[([\s\S]*?)\]/);
  if (!asarUnpackMatch) {
    return patterns;
  }

  const entries = asarUnpackMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g);
  for (const entry of entries) {
    const raw = entry[1] ?? entry[2];
    const pkgMatch = raw.match(/^node_modules\/(.+?)(?:\/\*\*)?$/);
    if (pkgMatch) {
      patterns.push(pkgMatch[1]);
    }
  }
  return patterns;
}

/**
 * .npmrc から public-hoist-pattern の値を全て取得する。
 */
function parseHoistPatterns(): string[] {
  const npmrcPath = path.join(ROOT, '.npmrc');
  const content = fs.readFileSync(npmrcPath, 'utf8');

  const patterns: string[] = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^public-hoist-pattern\[\]\s*=\s*(.+)/);
    if (match) {
      patterns.push(match[1].trim());
    }
  }
  return patterns;
}

/**
 * asarUnpack パターンがネイティブモジュール名にマッチするか判定する。
 * 例: "clip-filepaths*" は "clip-filepaths" にマッチ
 *     "@resvg/resvg-js*" は "@resvg/resvg-js" にマッチ
 */
function asarPatternMatchesModule(
  asarPattern: string,
  moduleName: string,
): boolean {
  if (asarPattern === moduleName) {
    return true;
  }
  // ワイルドカード末尾パターン: "clip-filepaths*" matches "clip-filepaths"
  if (asarPattern.endsWith('*')) {
    const base = asarPattern.slice(0, -1);
    return moduleName === base || moduleName.startsWith(base);
  }
  return false;
}

/**
 * Check 1: electronExternal のネイティブモジュールが asarUnpack に含まれているか
 */
function checkAsarUnpackCompleteness(
  externalModules: string[],
  asarPatterns: string[],
): string[] {
  const errors: string[] = [];

  const nativeModules = externalModules.filter((pkg) =>
    hasPlatformSpecificDeps(pkg),
  );

  for (const mod of nativeModules) {
    const inAsarUnpack = asarPatterns.some((p) =>
      asarPatternMatchesModule(p, mod),
    );
    if (!inAsarUnpack) {
      errors.push(
        `"${mod}" はプラットフォーム固有バイナリを持つネイティブモジュールですが、\n` +
          `  electron-builder.cjs の asarUnpack に含まれていません。\n` +
          `  追加してください: 'node_modules/${mod}*/**'`,
      );
    }
  }

  return errors;
}

/**
 * Check 2: asarUnpack のワイルドカードパターンに対応する hoist パターンがあるか
 */
function checkHoistPatterns(
  asarPatterns: string[],
  hoistPatterns: string[],
): string[] {
  const errors: string[] = [];

  for (const asarPattern of asarPatterns) {
    // ワイルドカード末尾のパターンのみチェック（例: clip-filepaths*）
    if (!asarPattern.endsWith('*')) {
      continue;
    }

    const baseName = asarPattern.slice(0, -1);

    // ベースパッケージ自体の hoist チェック
    const baseHoisted = hoistPatterns.some(
      (h) => h === baseName || h === `${baseName}*` || h === `${baseName}-*`,
    );
    if (!baseHoisted) {
      errors.push(
        `"${baseName}" が asarUnpack に含まれていますが、.npmrc の public-hoist-pattern にありません。\n` +
          `  追加してください: public-hoist-pattern[]=${baseName}`,
      );
    }

    // プラットフォーム固有パッケージの hoist チェック
    const platformPattern = baseName.endsWith('-')
      ? `${baseName}*`
      : `${baseName}-*`;
    const platformHoisted = hoistPatterns.some(
      (h) => h === platformPattern || h === `${baseName}*`,
    );
    if (!platformHoisted) {
      errors.push(
        `"${asarPattern}" が asarUnpack にありますが、プラットフォーム固有パッケージの hoist パターンがありません。\n` +
          `  追加してください: public-hoist-pattern[]=${platformPattern}\n` +
          `  理由: pnpm isolated モードではプラットフォーム固有パッケージ（例: ${baseName}-win32-x64-msvc）が\n` +
          `         node_modules/.pnpm/ 内に配置され、electron-builder の asarUnpack に含まれません。`,
      );
    }
  }

  return errors;
}

function main(): void {
  consola.start(
    'Checking native module asarUnpack and hoist patterns for electron-builder...',
  );

  const externalModules = parseElectronExternal();
  const asarPatterns = parseAsarUnpackPatterns();
  const hoistPatterns = parseHoistPatterns();

  const errors = [
    ...checkAsarUnpackCompleteness(externalModules, asarPatterns),
    ...checkHoistPatterns(asarPatterns, hoistPatterns),
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      consola.error(error);
    }
    consola.fail(
      `${errors.length} 件のネイティブモジュール設定の不整合が見つかりました。`,
    );
    process.exit(1);
  }

  consola.success(
    'ネイティブモジュールの asarUnpack・hoist パターンが正しく設定されています。',
  );
}

main();
