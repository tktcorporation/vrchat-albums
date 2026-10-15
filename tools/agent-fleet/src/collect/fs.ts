import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { fail, ok, type SourceError, type SourceResult } from './types';

// パスが存在しない・親が存在しない（ENOENT/ENOTDIR）だけを not_found とし、それ以外
// （EISDIR・EACCES 等、パスはあるのに読めない事情）は io_error にする。not_found は
// 「無いのが正常系」として呼び出し側が握りつぶせるが、io_error は権限やファイル種別の
// 問題なので握りつぶさず失敗として扱わせたい。この判定基準は readJson 以外の I/O
// 分類（transcript の読み取りなど）とも共有し、判定がファイルごとにばらけないようにする。
export function classifyIoError(e: unknown, path: string): SourceError {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return { type: 'not_found', detail: `${path}: ${(e as Error).message}` };
  return { type: 'io_error', detail: `${path}: ${code ?? (e as Error).message}` };
}

// transcript は数十 MB になるので、先頭と末尾の固定長だけを読む。
// 境界で切れた行は捨てる（切れた行は JSON として壊れており、多バイト文字の途中で
// 切れていることもあるため、行単位で落とすのが最も単純で安全）。
export function readHead(path: string, bytes: number): string {
  const size = statSync(path).size;
  const len = Math.min(bytes, size);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, 0);
    const text = buf.toString('utf8');
    if (len >= size) return text;
    const cut = text.lastIndexOf('\n');
    return cut >= 0 ? text.slice(0, cut + 1) : '';
  } finally {
    closeSync(fd);
  }
}

export function readTail(path: string, bytes: number): string {
  const size = statSync(path).size;
  const len = Math.min(bytes, size);
  const start = size - len;
  const fd = openSync(path, 'r');
  try {
    // start がちょうど改行の直後なら、読み取った先頭は完全な行なので捨てない。
    // 判定しないと、行境界ぴったりで切った場合でも常に先頭行を破棄してしまう。
    let startsAfterNewline = start === 0;
    if (!startsAfterNewline) {
      const prevByte = Buffer.alloc(1);
      readSync(fd, prevByte, 0, 1, start - 1);
      startsAfterNewline = prevByte[0] === 0x0a;
    }
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    const text = buf.toString('utf8');
    if (len >= size || startsAfterNewline) return text;
    const cut = text.indexOf('\n');
    return cut >= 0 ? text.slice(cut + 1) : '';
  } finally {
    closeSync(fd);
  }
}

export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // 書き込み途中の行や境界で切れた行は正常系の一部なので読み飛ばす
    }
  }
  return out;
}

export function readJson(path: string): SourceResult<unknown> {
  // existsSync だけでは TOCTOU（チェック後に削除される、ディレクトリを渡される等）を防げないため、
  // 読み取り自体も分類対象にする（分類基準は classifyIoError を参照）。
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    const { type, detail } = classifyIoError(e, path);
    return fail(type, detail);
  }
  try {
    return ok(JSON.parse(text));
  } catch (e) {
    return fail('parse_error', `${path}: ${(e as Error).message}`);
  }
}

export function fileSize(path: string): number | null {
  return existsSync(path) ? statSync(path).size : null;
}
