import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import { Effect, Exit } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runInWorker } from './workerClient';

/**
 * runInWorker のモックなし統合テスト。
 *
 * ShareDialog のフリーズ根本原因は「Main プロセスで同期 CPU バウンド処理を
 * 直接実行していたこと」だった (ADR-005)。ここでは worker_threads への
 * オフロードが実際のビルド成果物で機能することを、モックなしで resvg-js による
 * 実レンダリングを通して検証する。
 *
 * ビルドは共有の main/ ディレクトリ（electron/vite.config.ts の emptyOutDir: true
 * により、書き込むたびに丸ごと空にされる）ではなく、このテスト専用の一時
 * ディレクトリに出力する。共有 main/ に書くと `pnpm dev` 等の並行実行や
 * 他のテストと競合するため。
 *
 * 一時ディレクトリは os.tmpdir() ではなくプロジェクト直下に作る。
 * @napi-rs/image・@resvg/resvg-js は vite の外部化設定により bundle されず
 * 実行時に require() で解決されるため、プロジェクトの node_modules を
 * 辿れる場所に置く必要がある（.gitignore の .vitest-tmp-builds/ を参照）。
 */
const projectRoot = path.resolve(import.meta.dirname, '../../..');
const tmpBuildsRoot = path.join(projectRoot, '.vitest-tmp-builds');
fs.mkdirSync(tmpBuildsRoot, { recursive: true });
const testBuildDir = fs.mkdtempSync(path.join(tmpBuildsRoot, 'worker-'));
const workerScriptPath = path.join(testBuildDir, 'renderWorker.cjs');

// 1x1 の透明 PNG（テスト用の最小画像）
const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('runInWorker (real worker_threads)', () => {
  beforeAll(() => {
    // shell: true — Windows では pnpm は pnpm.cmd/.ps1 経由の実行になり、
    // shell を介さない execFileSync は ENOENT になる（cross-platform CI 対応）
    execFileSync(
      'pnpm',
      [
        'exec',
        'vite',
        'build',
        '-c',
        'electron/vite.config.ts',
        '--outDir',
        testBuildDir,
      ],
      {
        cwd: projectRoot,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, SENTRY_DSN: '' },
      },
    );
    // expect() はテストブロック外では正しく機能しないため、ビルド成果物の
    // 欠落は beforeAll 自体を失敗させる明示的な throw で検知する
    if (!fs.existsSync(workerScriptPath)) {
      throw new Error(
        `ビルド後も worker スクリプトが見つかりません: ${workerScriptPath}`,
      );
    }
  }, 60_000);

  afterAll(() => {
    fs.rmSync(testBuildDir, { recursive: true, force: true });
  });

  it('should render a real PNG through the built worker script', async () => {
    const buffer = await Effect.runPromise(
      runInWorker(
        {
          outputFormat: 'png',
          worldName: 'Integration Test World',
          imageBase64: tinyPngBase64,
          players: [{ playerName: 'Alice' }],
          showAllPlayers: true,
          fontFilePaths: [],
        },
        workerScriptPath,
      ),
    );

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // PNG シグネチャ
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }, 20_000);

  it('should render a real JPEG through the built worker script', async () => {
    const buffer = await Effect.runPromise(
      runInWorker(
        {
          outputFormat: 'jpeg',
          worldName: 'Integration Test World',
          imageBase64: tinyPngBase64,
          players: null,
          showAllPlayers: true,
          fontFilePaths: [],
          jpegQuality: 80,
        },
        workerScriptPath,
      ),
    );

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // JPEG シグネチャ (FF D8)
    expect(buffer.subarray(0, 2).toString('hex')).toBe('ffd8');
  }, 20_000);

  it('should surface an unexpected in-worker defect as WorkerCrashed instead of hanging', async () => {
    // imageBase64 が data URI プレフィックス付きで assertValidBase64 が
    // 同期的に throw する（プログラミングミス相当の、Effect.try で捕捉されない
    // 予期しない失敗の経路）。renderWorker.ts はこれを 'error' イベントとして
    // worker の外へ伝播させる設計であり、ここではそれが実際に WorkerCrashed として
    // 観測できることを検証する。
    const exit = await Effect.runPromiseExit(
      runInWorker(
        {
          outputFormat: 'png',
          worldName: 'Integration Test World',
          imageBase64: `data:image/png;base64,${tinyPngBase64}`,
          players: null,
          showAllPlayers: false,
          fontFilePaths: [],
        },
        workerScriptPath,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('WorkerCrashed');
    }
  }, 20_000);
});

describe('structured clone over real worker_threads', () => {
  it('should preserve _tag/message on a plain error object (unlike a TaggedError class instance)', async () => {
    // renderWorker.spec.ts は「TaggedError インスタンスをプレーンオブジェクトに
    // 変換してから postMessage する」ことを検証しているが、その変換が実際に
    // 意味を持つのは、プレーンオブジェクトなら構造化クローンで _tag が失われない
    // 場合に限られる。ここでは resvg 等を経由せず、その前提そのものを
    // 実際の worker_threads の postMessage で検証する。
    const worker = new Worker(
      `
      const { parentPort } = require('node:worker_threads');
      parentPort.postMessage({
        ok: false,
        error: { _tag: 'SvgRenderFailed', message: 'boom from real worker' },
      });
      `,
      { eval: true },
    );

    const received = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    await worker.terminate();

    expect(received).toEqual({
      ok: false,
      error: { _tag: 'SvgRenderFailed', message: 'boom from real worker' },
    });
  });
});
