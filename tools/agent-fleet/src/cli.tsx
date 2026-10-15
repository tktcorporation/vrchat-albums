import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import React from 'react';
import type { SourceError } from './collect/types';
import { defaultAckPath, loadAcks, type AckStore } from './model/ack';
import { createCollector, defaultCollectorDeps } from './model/collector';
import { groupRows } from './model/group';
import type { Snapshot } from './model/row';
import { openRow } from './tui/actions';
import { App } from './tui/App';
import { buildLine1, buildLine2 } from './tui/row-lines';

// ワークスペースの root は「このツールが置かれた場所」から 2 つ上（tools/agent-fleet/src → 3 つ上）で決める。
// cwd に依存させないのは、Herdr の pane がどの worktree にいても同じ root を見せたいから。
// URL.pathname は空白などを %XX でエンコードしたまま返すため、実際のパスに戻すには
// fileURLToPath を使う（そうしないと space を含むパス配下で全ての読み取りが失敗する）。
export function workspaceRootFrom(importMetaUrl: string): string {
  return fileURLToPath(new URL('../../../', importMetaUrl)).replace(/\/$/, '');
}
export const workspaceRoot = workspaceRootFrom(import.meta.url);

// --once はパイプ・CI 越しに読まれることもあるため、実端末が無くても崩れない
// 固定幅（100）を既定にする。TUI 経路（cli.tsx の main）とは違い、この関数自体は
// 端末を持たない場面（テスト等）からも呼べるよう width を引数で受け取れるようにする。
export function renderOnce(snapshot: Snapshot, acks: AckStore, now: number, ackError: SourceError | null = null, width = 100): string {
  const g = groupRows(snapshot.rows, acks, now);
  // TUI（RowList.tsx）と同じ row-lines.ts を通すことで、--once と TUI の2行の
  // 組み立てがずれない（幅の式は片方だけ直しても崩れる）。
  const lines = (r: (typeof snapshot.rows)[number]) => {
    const line1 = buildLine1(r, width, now, false);
    const line2 = buildLine2(r, width);
    return [line1.plain, line2.plain];
  };
  const section = (title: string, rows: typeof snapshot.rows) =>
    rows.length ? [`${title} (${rows.length})`, ...rows.flatMap(lines)] : [];
  const errors = Object.entries(snapshot.sources).filter(([, e]) => e).map(([k, e]) => `${k}: ${e?.detail}`);
  if (ackError) errors.push(`ack: ${ackError.detail}`);
  return [
    ...section('要対応', g.pending),
    ...section('作業中', g.working),
    ...section('待機', g.idle),
    ...section('その他', g.other),
    ...(errors.length ? ['', ...errors] : []),
  ].join('\n');
}

async function main(argv: string[]) {
  const collector = createCollector(defaultCollectorDeps(workspaceRoot));
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(await collector.collect(), null, 2) + '\n');
    return;
  }
  if (argv.includes('--once')) {
    const snapshot = await collector.collect();
    // loadAcks は分類済みの SourceResult を返す。ack ファイルが読めなくても
    // 一覧表示そのものは続けたいので、未確認扱い（空の AckStore）で進めつつ
    // 理由は renderOnce の末尾に出す。
    const r = loadAcks(defaultAckPath());
    const acks = r.ok ? r.value : {};
    process.stdout.write(renderOnce(snapshot, acks, Date.now(), r.ok ? null : r.error, process.stdout.columns ?? 100) + '\n');
    return;
  }
  // alternate screen は vim/htop と同じ仕組みで、端末の scrollback を汚さずに描く。
  // 非 TTY（パイプ・CI）では Ink が自動的に無効化するため、--once/--json 側では指定しない。
  render(<App collector={collector} ackPath={defaultAckPath()} intervalMs={3000} onOpen={(row) => openRow(row)} />, {
    alternateScreen: true,
  });
}

if (import.meta.main) await main(process.argv.slice(2));
