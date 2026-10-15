import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonl, readHead, readJson, readTail } from '../src/collect/fs';

const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-fs-'));
const lines = Array.from({ length: 200 }, (_, i) => JSON.stringify({ i, text: '日本語テキスト'.repeat(20) }));
const path = join(dir, 'big.jsonl');
writeFileSync(path, lines.join('\n') + '\n');

describe('readHead', () => {
  test('境界で切れた最後の行を捨てる', () => {
    const head = readHead(path, 1000);
    const rows = parseJsonl(head) as { i: number }[];
    expect(rows[0]?.i).toBe(0);
    expect(head.endsWith('\n')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
  test('ファイル全体より大きい要求はそのまま全部返す', () => {
    const head = readHead(path, 10_000_000);
    expect(parseJsonl(head).length).toBe(200);
  });
});

describe('readTail', () => {
  test('境界で切れた最初の行を捨て、最後の行を含む', () => {
    const tail = readTail(path, 1000);
    const rows = parseJsonl(tail) as { i: number }[];
    expect(rows.at(-1)?.i).toBe(199);
    expect(rows.every((r) => typeof r.i === 'number')).toBe(true);
  });
  test('読み取り開始位置がちょうど改行の直後なら、その行を捨てない', () => {
    const p = join(dir, 'boundary.jsonl');
    writeFileSync(p, '{"i":0}\n{"i":1}\n');
    const tail = readTail(p, 8); // '{"i":1}\n' の長さちょうど
    expect(tail).toBe('{"i":1}\n');
  });
});

describe('parseJsonl', () => {
  test('壊れた行と空行を読み飛ばす', () => {
    expect(parseJsonl('{"a":1}\n\n{broken\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe('readJson', () => {
  test('無いファイルは not_found', () => {
    const r = readJson(join(dir, 'missing.json'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('not_found');
  });
  test('壊れた JSON は parse_error', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{oops');
    const r = readJson(p);
    if (!r.ok) expect(r.error.type).toBe('parse_error');
    else throw new Error('should fail');
  });
  test('ディレクトリを渡すと読み取り失敗を io_error として分類する（EISDIR は not_found ではない）', () => {
    const r = readJson(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('io_error');
  });
});
