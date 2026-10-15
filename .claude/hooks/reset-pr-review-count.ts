#!/usr/bin/env bun
import { rm } from 'node:fs/promises';
import { readInput } from './hook-utils.ts';
import { reviewCountFile } from './review-count.ts';
// 端末から手で実行したときは現在地のブランチ、hook から呼ばれたときは入力の cwd が
// 指す作業ツリーのブランチを消す。
await rm(await reviewCountFile(await readInput()), { force: true });
