/**
 * Electrobun モジュールのカスタム ESM ローダー。
 *
 * 背景: dev-trpc-server.ts が electron/api.ts をインポートすると、
 * 依存チェーンで electrobun/bun がインポートされる。
 * Node.js/tsx 環境では electrobun ランタイムが存在しないため、
 * このローダーで electrobun モジュールの解決をインターセプトし、
 * モックモジュールを返す。
 *
 * 使い方: node --import ./scripts/mock-electrobun-loader.mjs ...
 */
import { register } from 'node:module';

register('./mock-electrobun-hooks.mjs', import.meta.url);
