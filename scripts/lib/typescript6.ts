import consola from 'consola';

/**
 * 独自 lint が読む TypeScript のコンパイラ API が 6 系であることを確かめ、違えば非ゼロで終了する。
 *
 * TypeScript 7 の `typescript` パッケージはコンパイラ API（`ts.createProgram` など）を公開しないため、
 * lint は package.json の別名 `typescript-6` から 6 系を読む。依存の一括更新でこの別名が 7 系へ
 * 上がると、lint はコンパイラ API の欠落で分かりにくい形で落ちるので、読み込んだ直後に版を確かめる。
 *
 * @param versionMajorMinor 読み込んだ `ts.versionMajorMinor`（例: '6.0'）
 * @param linterName 失敗時の文言に出す lint の名前
 */
export const ensureTypeScript6CompilerApi = (
  versionMajorMinor: string,
  linterName: string,
): void => {
  if (versionMajorMinor.startsWith('6.')) {
    return;
  }
  consola.error(
    `${linterName}: この lint は TypeScript 6 のコンパイラ API を使います。` +
      `読み込んだ typescript-6 は ${versionMajorMinor} 系でした。` +
      'package.json の typescript-6 の別名を npm:typescript@~6 に保ってください。',
  );
  process.exit(1);
};
