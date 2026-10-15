import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJson } from '../collect/fs';
import { fail, ok, type SourceResult } from '../collect/types';
import type { FleetRow } from './row';

// row.key → その done を確認したときの doneMarker。
// marker が変わる（再び作業して再び done になる）と自然に未確認へ戻る。
export type AckStore = Record<string, string>;

export function defaultAckPath(): string {
  const fallback = join(homedir(), '.local', 'state');
  const raw = process.env.XDG_STATE_HOME;
  // XDG Base Directory 仕様上、相対パスの値は無効として無視する。
  // 空文字・空白のみの値も未設定として扱う（一部シェルは unset の代わりに空文字を渡す）。
  const xdgStateHome = raw !== undefined && raw.trim() !== '' && raw.startsWith('/') ? raw : fallback;
  return join(xdgStateHome, 'agent-fleet', 'ack.json');
}

// 読めない（ファイルが無い）のは初回起動として正常系だが、壊れた JSON・
// 想定外の形（配列など）・権限や種別の問題（io_error）は呼び出し側が気づける
// よう分類元の種別（parse_error / io_error）を保ったまま返す。
export function loadAcks(path: string): SourceResult<AckStore> {
  const r = readJson(path);
  if (!r.ok) return r.error.type === 'not_found' ? ok({}) : fail(r.error.type, r.error.detail);
  if (typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) {
    return fail('parse_error', `${path}: expected a JSON object`);
  }
  const out: AckStore = {};
  for (const [k, v] of Object.entries(r.value as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return ok(out);
}

// この関数はツール内で唯一のファイル書き込み。読み取り専用ディレクトリなど
// mkdirSync/writeFileSync が失敗しうる環境でも TUI を落とさないよう、
// 例外を投げずに SourceResult として返す。
export function saveAcks(path: string, acks: AckStore): SourceResult<void> {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(acks, null, 2) + '\n');
    return ok(undefined);
  } catch (e) {
    return fail('not_found', `${path}: ${(e as Error).message}`);
  }
}

export const isAcked = (acks: AckStore, row: FleetRow): boolean =>
  row.doneMarker !== null && acks[row.key] === row.doneMarker;

export const withAck = (acks: AckStore, row: FleetRow): AckStore =>
  row.doneMarker === null ? acks : { ...acks, [row.key]: row.doneMarker };
