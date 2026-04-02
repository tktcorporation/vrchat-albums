/**
 * ファイルベースの JSON 設定ストア。
 *
 * 背景: electron-store は Electron 依存（app.getPath を内部で使用）のため、
 * Electrobun 環境では動作しない。シンプルな JSON ファイルベースの
 * key-value ストアで代替する。
 *
 * electron-store の API（get/set/delete/clear/path）を模倣し、
 * settingStore.ts からの移行を最小限にする。
 *
 * 不要になれば: Electrobun 固有のストレージ API が提供された場合に置き換え可能
 */
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  private data: Record<string, unknown>;
  readonly path: string;

  constructor(options: { name: string; cwd?: string }) {
    const dir = options.cwd ?? this.getDefaultDir();
    this.path = path.join(dir, `${options.name}.json`);
    this.data = this.load();
  }

  private getDefaultDir(): string {
    // effect-lint-allow-try-catch: Electrobun 環境検出パターン
    try {
      const { Utils } = require('electrobun/bun');
      return Utils.paths.userData;
    } catch {
      // テストまたは非 Electrobun 環境
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
      return path.join(homeDir, '.vrchat-albums');
    }
  }

  private load(): Record<string, unknown> {
    // effect-lint-allow-try-catch: ファイル読み込みは失敗しうるインフラ操作
    try {
      if (fs.existsSync(this.path)) {
        const content = fs.readFileSync(this.path, 'utf8');
        return JSON.parse(content) as Record<string, unknown>;
      }
    } catch {
      // ファイルが壊れている場合は空で開始
    }
    return {};
  }

  private save(): void {
    // effect-lint-allow-try-catch: ファイル書き込みは失敗しうるインフラ操作
    try {
      const dir = path.dirname(this.path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // 書き込み失敗は無視（次回の save で再試行される）
    }
  }

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.save();
  }

  delete(key: string): void {
    delete this.data[key];
    this.save();
  }

  clear(): void {
    this.data = {};
    this.save();
  }

  has(key: string): boolean {
    return key in this.data;
  }
}
