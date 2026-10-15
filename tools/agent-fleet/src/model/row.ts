import type { SourceError } from '../collect/types';

export type RowStatus = 'blocked' | 'working' | 'idle' | 'done' | 'failed' | 'stopped';

export type FleetRow = {
  key: string;
  agent: 'claude' | 'codex';
  kind: 'background' | 'interactive';
  name: string;
  // 生の識別子のまま保持する。表の短い表示名は描画時に導出するが、
  // ここでは `[1m]`（コンテキストウィンドウ拡張）のような詳細ペインで
  // 見たい情報まで落とさないよう、加工前の値を持つ。
  model: string | null;
  status: RowStatus;
  statusSource: 'job' | 'herdr' | 'transcript' | 'session';
  // Herdr 由来の status は「照合できた事実」ではなく推定である。unknown は
  // idle に丸めてしまうため区別がつかなくなり、blocked/done は画面照合の推定に
  // すぎないため誤検知でも人が判断できるようにしたい。この由来を row summary と
  // 詳細ペインの両方に出すためのラベル（該当しなければ null）。
  statusNote: string | null;
  originalPrompt: string | null;
  latestPrompt: string | null;
  activity: string | null;
  pending: { kind: string; text: string | null } | null;
  location: { cwd: string; display: string; branch: string | null; paneId: string | null };
  artifacts: { kind: string; id: string; href: string }[];
  startedAt: number | null;
  updatedAt: number | null;
  // 「その done がいつのものか」。確認済み判定はこの値の一致で行う（Task 10）
  doneMarker: string | null;
  attach: { type: 'focus'; paneId: string } | { type: 'claude-attach'; jobId: string } | { type: 'hint'; text: string };
};

export type SourceName = 'herdr' | 'claudeAgents' | 'claudeJobs' | 'claudeSessions' | 'codex' | 'worktrees' | 'transcripts';

export type Snapshot = {
  rows: FleetRow[];
  sources: Record<SourceName, SourceError | null>;
  collectedAt: number;
};
