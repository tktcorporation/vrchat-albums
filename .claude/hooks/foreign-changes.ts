/**
 * 「他人の未コミット変更」を見つけるための共通部品。
 * pre-bash-guard.ts が実行前の所有権判定に使う。
 *
 * 他人の変更とは、作業ツリーの未コミット変更のうち、このセッションのエージェントが Write / Edit で
 * 書いた内容のままではないもの（track-edits.ts の記録と内容のハッシュが一致しないもの）。
 */
import { $ } from 'bun';
import { resolve } from 'node:path';

/**
 * 作業ツリーの未コミット変更（絶対パス）。rename は新旧両方を含める。
 * `-z` で読むのは、既定の core.quotePath だと ASCII 以外のファイル名が 8 進エスケープされ、
 * 実際のパスと一致しなくなるため。git リポジトリでなければ空。
 */
export async function dirtyFiles(base: string): Promise<string[]> {
  const top = await $`git -C ${base} rev-parse --show-toplevel`.quiet().nothrow();
  if (top.exitCode !== 0) return [];
  const root = top.text().trim();
  const status = await $`git -C ${base} status --porcelain -z --untracked-files=all`
    .quiet()
    .nothrow();
  if (status.exitCode !== 0) return [];
  const files: string[] = [];
  const records = status.text().split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? '';
    if (record.length < 4) continue;
    files.push(resolve(root, record.slice(3)));
    // rename / copy は次のレコードが元のパス
    if (/^[RC]|^.[RC]/.test(record.slice(0, 2))) {
      const previous = records[++i];
      if (previous) files.push(resolve(root, previous));
    }
  }
  return files;
}
