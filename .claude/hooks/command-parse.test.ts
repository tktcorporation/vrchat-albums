import { describe, expect, test } from 'bun:test';
import { parseCommands } from './command-parse.ts';

/** 1 コマンドだけの source を解析し、そのコマンドが受け取る環境変数の名前を返す。 */
function envNames(source: string): string[] {
  const result = parseCommands(source, '/work');
  if (result.kind !== 'parsed') throw new Error(`parse failed: ${source}`);
  const [command] = result.commands;
  if (!command) throw new Error(`no command: ${source}`);
  return [...command.env.keys()].toSorted();
}

describe('env の環境変数の扱い', () => {
  test('env -i はそれまでに積んだ環境変数を捨てる', () => {
    expect(envNames('FOO=1 env -i BAR=2 git status')).toEqual(['BAR']);
    expect(envNames('FOO=1 env --ignore-environment git status')).toEqual([]);
  });

  test('env -0 は環境変数を捨てない', () => {
    expect(envNames('FOO=1 env -0 BAR=2 git status')).toEqual(['BAR', 'FOO']);
  });
});
