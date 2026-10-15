#!/usr/bin/env bun
/**
 * PostToolUse(Bash): 時間のかかったコマンドの所要時間を、同種コマンドの過去実績と並べて
 * エージェントへ知らせる。
 *
 * 長いコマンドを前景で待つと、エージェントは経過時間を把握できず、「いつもより遅い」にも
 * 気づけない。ここで所要時間をコマンド種別ごとに蓄積し、閾値を超えたときだけ
 * 「何秒かかったか / 普段は何秒か / 背景実行に切り替えるべきか」を注入する。
 * 閾値未満のコマンドではファイルに触らず終わる。
 */
import {
  BACKGROUND_MIN_SEC,
  RECORD_MIN_SEC,
  REPORT_MIN_SEC,
  appendTiming,
  commandKey,
  median,
} from './bash-timing.ts';

interface Input {
  tool_input?: { command?: string };
  tool_response?: { duration_ms?: number; durationMs?: number; interrupted?: boolean };
}
const input: Input | null = await Bun.stdin.json().catch(() => null);
const command = input?.tool_input?.command ?? '';
const durationMs = input?.tool_response?.duration_ms ?? input?.tool_response?.durationMs;
// duration が取れない実装では計測しない（自前で時計を持つより、何もしない方が安全）
if (!command || typeof durationMs !== 'number' || input?.tool_response?.interrupted)
  process.exit(0);
const seconds = Math.round(durationMs / 1000);
if (seconds < RECORD_MIN_SEC) process.exit(0);

const key = commandKey(command);
const history = key ? await appendTiming(key, seconds) : [];
if (seconds < REPORT_MIN_SEC) process.exit(0);

const lines = [`⏱ このコマンドは ${seconds} 秒かかった（種別: \`${key}\`）。`];
if (history.length > 0) {
  const usual = median(history);
  lines.push(`同種の過去実績: 中央値 ${usual} 秒（${history.length} 件）。`);
  if (seconds > usual * 2 && seconds - usual >= REPORT_MIN_SEC)
    lines.push(
      '普段の 2 倍以上かかっている。ハング、環境負荷、対象の増加のどれかを確かめ、報告に理由を書く。',
    );
} else {
  lines.push('同種の過去実績は無い（今回が初回の記録）。');
}
lines.push('ユーザーへの報告に所要時間を含める。');
if (seconds >= BACKGROUND_MIN_SEC)
  lines.push(
    '次に同種のコマンドを走らせるときは run_in_background にして、待ち時間に別の作業を進める。進捗の確認は 60 秒以上の間隔で行う。',
  );
console.log(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') },
  }),
);
