#!/usr/bin/env bun
/**
 * PreToolUse(Bash): 過去の実績から長くかかると分かっているコマンドを前景で走らせようとしたとき、
 * 見込み時間を知らせて背景実行を促す。
 *
 * 長いコマンドを前景で待つと、エージェントは経過を報告できず、待ち時間に別の作業もできない。
 * 実行後の記録（post-bash-timing.ts）だけでは走っている最中の沈黙は防げないので、実行前に
 * 「普段は何秒かかるか」を注入する。実績が無いコマンドには何もしない。
 */
import { BACKGROUND_MIN_SEC, commandKey, median, readTimings } from './bash-timing.ts';

interface Input {
  tool_input?: { command?: string; run_in_background?: boolean };
}
const input: Input | null = await Bun.stdin.json().catch(() => null);
const command = input?.tool_input?.command ?? '';
if (!command || input?.tool_input?.run_in_background) process.exit(0);

const key = commandKey(command);
const timings = key ? await readTimings() : null;
const history = timings?.store[key] ?? [];
if (history.length === 0) process.exit(0);
const usual = median(history);
if (usual < BACKGROUND_MIN_SEC) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `⏱ \`${key}\` は過去 ${history.length} 件の実績で中央値 ${usual} 秒かかっている。前景で待たず run_in_background で走らせ、待ち時間に別の作業を進める。ユーザーには「約 ${usual} 秒かかる見込み」と先に伝える。進捗の確認は 60 秒以上の間隔で行う。`,
    },
  }),
);
